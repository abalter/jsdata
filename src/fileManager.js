// ── File Manager ─────────────────────────────────────────────────────────────
// Two-layer storage: IndexedDB (working state) + File System Access API (disk)
// Single-file for now; schema supports multiple files for future tabs.

import { loadWorkspace, saveWorkspace } from './db.js'

// ── State ─────────────────────────────────────────────────────────────────────

let _editorView    = null
let _filenameEl    = null
let _ops           = {}     // { clearOutput, runAll, consolePrint }
let _currentFile   = null   // { id, name, content, lastModified, fileHandle, runOnOpen }
let _isDirty       = false
let _autosaveTimer = null
let _allFiles      = []
let _paused        = false  // suppress onEditorChange during programmatic loads

const AUTOSAVE_DELAY = 2000

function generateId() { return crypto.randomUUID() }

function blankFile(name = 'untitled.md', content = '') {
  return {
    id: generateId(),
    name,
    content,
    lastModified: Date.now(),
    fileHandle: null,
    runOnOpen: false,
  }
}

// ── Title management ──────────────────────────────────────────────────────────

function updateTitle() {
  const name  = _currentFile?.name ?? 'untitled.md'
  const dirty = _isDirty ? ' *' : ''
  if (_filenameEl) _filenameEl.textContent = name + dirty
  document.title = `${name}${dirty} — JSAnalyst`
  _ops.onFilesChanged?.()
}

function setDirty(val) {
  _isDirty = val
  _filenameEl?.classList.toggle('dirty', val)
  updateTitle()
}

// ── Persistence ───────────────────────────────────────────────────────────────

async function persistToIDB() {
  if (!_currentFile) return
  _currentFile.content = _editorView.state.doc.toString()
  _currentFile.lastModified = Date.now()
  const idx = _allFiles.findIndex(f => f.id === _currentFile.id)
  if (idx >= 0) _allFiles[idx] = _currentFile
  else _allFiles.push(_currentFile)
  await saveWorkspace({ version: 1, activeFileId: _currentFile.id, files: _allFiles })
}

function scheduleAutosave() {
  clearTimeout(_autosaveTimer)
  _autosaveTimer = setTimeout(() => persistToIDB(), AUTOSAVE_DELAY)
}

// ── Core file switch sequence ─────────────────────────────────────────────────
// 1. Save current file to IDB
// 2. Clear inline output + output pane
// 3. Load new content into editor (suppressing autosave listener)
// 4. Update title
// 5. If runOnOpen, run all chunks

async function switchTo(file) {
  // 1. Save current
  await persistToIDB()

  // 2. Clear output (inline decorations + output pane)
  _ops.clearOutput?.()

  // 3. Load content — pause change listener so autosave doesn't fire
  _paused = true
  _editorView.dispatch({
    changes: { from: 0, to: _editorView.state.doc.length, insert: file.content ?? '' },
  })
  _paused = false

  // 4. Update state + title
  _currentFile = file
  setDirty(false)
  updateTitle()

  // 5. Run all if requested
  if (file.runOnOpen) {
    _ops.consolePrint?.('\x1b[90mRunning all chunks...\x1b[0m')
    _ops.runAll?.()
  }
}

// ── Disk I/O ──────────────────────────────────────────────────────────────────

const hasNativeFS = typeof window.showOpenFilePicker === 'function'

async function writeToDisk(handle, content) {
  const writable = await handle.createWritable()
  await writable.write(content)
  await writable.close()
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * ops: { clearOutput, runAll, consolePrint }
 */
export async function init(editorView, filenameEl, ops = {}) {
  _editorView = editorView
  _filenameEl = filenameEl
  _ops        = ops

  try {
    const state = await loadWorkspace()
    if (state?.files?.length > 0) {
      _allFiles    = state.files.map(f => ({ runOnOpen: false, ...f }))  // migrate old records
      _currentFile = _allFiles.find(f => f.id === state.activeFileId) ?? _allFiles[0]
      // Initial load: just set content, no clearOutput
      _paused = true
      _editorView.dispatch({
        changes: { from: 0, to: _editorView.state.doc.length, insert: _currentFile.content ?? '' },
      })
      _paused = false
      setDirty(false)
      updateTitle()
      if (_currentFile.runOnOpen) {
        ops.consolePrint?.('\x1b[90mRunning all chunks...\x1b[0m')
        ops.runAll?.()
      }
      return
    }
  } catch (e) {
    console.warn('IDB restore failed:', e)
  }

  // Nothing in IDB — record the demo doc already in the editor
  _currentFile = blankFile('demo.md', _editorView.state.doc.toString())
  _allFiles = [_currentFile]
  await persistToIDB()
  setDirty(false)
  updateTitle()
  ops.runAll?.()
}

export function onEditorChange() {
  if (_paused) return
  setDirty(true)
  scheduleAutosave()
}

export async function newFile() {
  const file = blankFile()
  await switchTo(file)
  await persistToIDB()
}

export async function openFile() {
  try {
    if (hasNativeFS) {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.qmd'] } }],
      })
      const file     = await handle.getFile()
      const text     = await file.text()
      const newEntry = {
        ...blankFile(handle.name, text),
        fileHandle: handle,
      }
      await switchTo(newEntry)
      await persistToIDB()
    } else {
      const input  = document.createElement('input')
      input.type   = 'file'
      input.accept = '.md,.qmd,text/markdown'
      input.onchange = async () => {
        const file     = input.files[0]
        if (!file) return
        const text     = await file.text()
        const newEntry = blankFile(file.name, text)
        await switchTo(newEntry)
        await persistToIDB()
      }
      input.click()
    }
  } catch (e) {
    if (e.name !== 'AbortError') throw e
  }
}

export async function saveFile() {
  const content = _editorView.state.doc.toString()
  try {
    if (hasNativeFS) {
      if (_currentFile.fileHandle) {
        try {
          await writeToDisk(_currentFile.fileHandle, content)
          _currentFile.name    = _currentFile.fileHandle.name
          _currentFile.content = content
          _currentFile.lastModified = Date.now()
          await persistToIDB()
          setDirty(false)
          return
        } catch {
          _currentFile.fileHandle = null
        }
      }
      await saveFileAs()
    } else {
      const blob = new Blob([content], { type: 'text/markdown' })
      const a    = document.createElement('a')
      a.href     = URL.createObjectURL(blob)
      a.download = _currentFile.name
      a.click()
      URL.revokeObjectURL(a.href)
      setDirty(false)
    }
  } catch (e) {
    if (e.name !== 'AbortError') throw e
  }
}

export async function saveFileAs() {
  const content = _editorView.state.doc.toString()
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: _currentFile.name,
      types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.qmd'] } }],
    })
    await writeToDisk(handle, content)
    _currentFile.fileHandle    = handle
    _currentFile.name          = handle.name
    _currentFile.content       = content
    _currentFile.lastModified  = Date.now()
    await persistToIDB()
    setDirty(false)
  } catch (e) {
    if (e.name !== 'AbortError') throw e
  }
}

export async function toggleRunOnOpen() {
  if (!_currentFile) return
  _currentFile.runOnOpen = !_currentFile.runOnOpen
  await persistToIDB()
  return _currentFile.runOnOpen
}

export function getCurrentFile()     { return _currentFile }
export function getCurrentFileName()  { return _currentFile?.name ?? 'untitled.md' }
export function getAllFiles()          { return [..._allFiles] }

export async function switchToId(fileId) {
  const file = _allFiles.find(f => f.id === fileId)
  if (!file || file.id === _currentFile?.id) return
  await switchTo(file)
}

export async function closeFile(fileId) {
  const idx = _allFiles.findIndex(f => f.id === fileId)
  if (idx < 0) return
  if (_allFiles.length === 1) {
    // Replace with blank rather than allowing zero open files
    const blank = blankFile()
    _allFiles[0] = blank
    await switchTo(blank)
    return
  }
  const wasActive = _currentFile?.id === fileId
  _allFiles.splice(idx, 1)
  if (wasActive) {
    const next = _allFiles[Math.min(idx, _allFiles.length - 1)]
    await switchTo(next)
  } else {
    await persistToIDB()
    _ops.onFilesChanged?.()
  }
}
