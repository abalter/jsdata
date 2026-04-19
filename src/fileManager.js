// ── File Manager ─────────────────────────────────────────────────────────────
// Two-layer storage: IndexedDB (working state) + File System Access API (disk)
// Explicit file status machine:
//   UNTITLED → new, never saved to disk, no fileHandle
//   CLEAN    → saved, no changes since last save
//   DIRTY    → has unsaved changes
//   SAVING   → save in progress (blocks concurrent saves)

import { loadWorkspace, saveWorkspace } from './db.js'
import { showConfirmDialog } from './dialog.js'

// ── File status ───────────────────────────────────────────────────────────────

export const FileStatus = {
  UNTITLED: 'untitled',
  CLEAN:    'clean',
  DIRTY:    'dirty',
  SAVING:   'saving',
}

// ── State ─────────────────────────────────────────────────────────────────────

let _editorView    = null
let _filenameEl    = null
let _ops           = {}     // { clearOutput, runAll, consolePrint, onFilesChanged }
let _currentFile   = null   // { id, name, content, lastModified, fileHandle, runOnOpen, status }
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
    status: FileStatus.UNTITLED,
  }
}

// ── Feature detection ─────────────────────────────────────────────────────────

function hasFileSystemAccess() {
  return typeof window.showSaveFilePicker === 'function'
}

const hasNativeFSOpen = typeof window.showOpenFilePicker === 'function'

// ── Download-based fallback save ──────────────────────────────────────────────

function saveViaDownload(content, filename) {
  const blob = new Blob([content], { type: 'text/markdown' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── Title management ──────────────────────────────────────────────────────────

function updateTitle() {
  const name   = _currentFile?.name ?? 'untitled.md'
  const suffix = _currentFile?.status === FileStatus.DIRTY ? ' \u2022' : ''  // bullet •
  if (_filenameEl) _filenameEl.textContent = name + suffix
  document.title = `${name}${suffix} \u2014 JSAnalyst`
  _ops.onFilesChanged?.()
}

// ── Status management ─────────────────────────────────────────────────────────

function setFileStatus(status) {
  if (!_currentFile) return
  _currentFile.status = status
  updateTitle()
}

// ── Persistence ───────────────────────────────────────────────────────────────

async function persistToIDB() {
  if (!_currentFile) return
  _currentFile.content      = _editorView.state.doc.toString()
  _currentFile.lastModified = Date.now()
  const idx = _allFiles.findIndex(f => f.id === _currentFile.id)
  if (idx >= 0) _allFiles[idx] = _currentFile
  else          _allFiles.push(_currentFile)
  await saveWorkspace({ version: 1, activeFileId: _currentFile.id, files: _allFiles })
}

function scheduleAutosave() {
  clearTimeout(_autosaveTimer)
  _autosaveTimer = setTimeout(() => persistToIDB(), AUTOSAVE_DELAY)
}

// ── Unsaved-change guard ──────────────────────────────────────────────────────
// Returns true if it is safe to navigate away from (or close) `file`.
// Shows Save / Don't Save / Cancel when the file has unsaved content.

async function _confirmClose(file) {
  if (!file) return true

  const contentLen = file.id === _currentFile?.id
    ? _editorView.state.doc.length
    : (file.content ?? '').length

  const hasUnsaved =
    file.status === FileStatus.DIRTY ||
    (file.status === FileStatus.UNTITLED && contentLen > 0)

  if (!hasUnsaved) return true

  const choice = await showConfirmDialog({
    message: `Save changes to "${file.name}" before closing?`,
    buttons: ['Save', "Don't Save", 'Cancel'],
  })

  if (choice === 'Cancel') return false
  if (choice === 'Save') {
    if (file.id !== _currentFile?.id) await switchToId(file.id)
    await saveFile()
    if (_currentFile?.status !== FileStatus.CLEAN) return false  // save failed or cancelled
  }
  return true
}

// ── Core file switch sequence ─────────────────────────────────────────────────
// 1. Save current file content to IDB (only if it is still tracked in _allFiles)
// 2. Clear inline output + output pane
// 3. Load new content into editor (suppressing autosave listener)
// 4. Update current file reference + title
// 5. If runOnOpen, run all chunks
//
// NOTE: callers are responsible for calling persistToIDB() after switchTo() to
// record the new activeFileId in IDB.

async function switchTo(file) {
  // 1. Persist current file (skip if it was removed from _allFiles before this call)
  if (_currentFile && _allFiles.some(f => f.id === _currentFile.id)) {
    await persistToIDB()
  }

  // 2. Clear output (inline decorations + output pane)
  _ops.clearOutput?.()

  // 3. Load content — pause change listener so autosave doesn't fire
  _paused = true
  _editorView.dispatch({
    changes: { from: 0, to: _editorView.state.doc.length, insert: file.content ?? '' },
  })
  _paused = false

  // 4. Update state + title (preserve the file's existing status across switches)
  _currentFile = file
  updateTitle()

  // 5. Run all if requested
  if (file.runOnOpen) {
    _ops.consolePrint?.('\x1b[90mRunning all chunks...\x1b[0m')
    _ops.runAll?.()
  }
}

// ── Disk I/O ──────────────────────────────────────────────────────────────────

async function writeToDisk(handle, content) {
  const writable = await handle.createWritable()
  await writable.write(content)
  await writable.close()
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * ops: { clearOutput, runAll, consolePrint, onFilesChanged }
 */
export async function init(editorView, filenameEl, ops = {}) {
  _editorView = editorView
  _filenameEl = filenameEl
  _ops        = ops

  try {
    const state = await loadWorkspace()
    if (state?.files?.length > 0) {
      _allFiles = state.files.map(f => ({
        runOnOpen: false,
        ...f,
        // Migrate old records: add status if missing
        status: f.status ?? (f.fileHandle ? FileStatus.CLEAN : FileStatus.UNTITLED),
      }))
      _currentFile = _allFiles.find(f => f.id === state.activeFileId) ?? _allFiles[0]
      // Initial load: just set content, no clearOutput
      _paused = true
      _editorView.dispatch({
        changes: { from: 0, to: _editorView.state.doc.length, insert: _currentFile.content ?? '' },
      })
      _paused = false
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
  _currentFile.status = FileStatus.CLEAN  // treat initial content as already saved to IDB
  _allFiles = [_currentFile]
  await persistToIDB()
  updateTitle()
  ops.runAll?.()
}

export function onEditorChange() {
  if (_paused) return
  if (!_currentFile) return
  if (_currentFile.status !== FileStatus.SAVING) {
    setFileStatus(FileStatus.DIRTY)
  }
  scheduleAutosave()
}

export async function newFile() {
  if (!await _confirmClose(_currentFile)) return

  const file = blankFile()
  _allFiles.push(file)
  await switchTo(file)
  await persistToIDB()
}

export async function openFile() {
  try {
    if (hasNativeFSOpen) {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.qmd'] } }],
      })
      const file     = await handle.getFile()
      const text     = await file.text()
      const newEntry = {
        ...blankFile(handle.name, text),
        fileHandle: handle,
        status: FileStatus.CLEAN,
      }
      _allFiles.push(newEntry)
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
        const newEntry = { ...blankFile(file.name, text), status: FileStatus.CLEAN }
        _allFiles.push(newEntry)
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
  const file = _currentFile
  if (!file) return
  if (file.status === FileStatus.SAVING) return
  if (!file.fileHandle || !hasFileSystemAccess()) return saveFileAs()

  setFileStatus(FileStatus.SAVING)
  const content = _editorView.state.doc.toString()
  try {
    await writeToDisk(file.fileHandle, content)
    file.content      = content
    file.name         = file.fileHandle.name
    file.lastModified = Date.now()
    await persistToIDB()
    setFileStatus(FileStatus.CLEAN)
  } catch (e) {
    setFileStatus(FileStatus.DIRTY)
    _ops.consolePrint?.(`\x1b[31mSave failed: ${e.message}\x1b[0m`)
  }
}

export async function saveFileAs() {
  const file = _currentFile
  if (!file) return
  if (file.status === FileStatus.SAVING) return

  if (!hasFileSystemAccess()) {
    const content = _editorView.state.doc.toString()
    saveViaDownload(content, file.name)
    file.content      = content
    file.lastModified = Date.now()
    await persistToIDB()
    setFileStatus(FileStatus.CLEAN)
    _ops.consolePrint?.(
      '\x1b[90mNote: File System Access API not available. File downloaded instead.\x1b[0m'
    )
    return
  }

  const prevStatus = file.status
  setFileStatus(FileStatus.SAVING)
  const content = _editorView.state.doc.toString()
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: file.name,
      types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.qmd'] } }],
    })
    await writeToDisk(handle, content)
    file.fileHandle   = handle
    file.name         = handle.name
    file.content      = content
    file.lastModified = Date.now()
    await persistToIDB()
    setFileStatus(FileStatus.CLEAN)
  } catch (e) {
    if (e.name === 'AbortError') {
      setFileStatus(prevStatus)
      return
    }
    setFileStatus(FileStatus.DIRTY)
    _ops.consolePrint?.(`\x1b[31mSave failed: ${e.message}\x1b[0m`)
  }
}

export async function toggleRunOnOpen() {
  if (!_currentFile) return
  _currentFile.runOnOpen = !_currentFile.runOnOpen
  await persistToIDB()
  return _currentFile.runOnOpen
}

export function getCurrentFile()     { return _currentFile }
export function getCurrentFileName() { return _currentFile?.name ?? 'untitled.md' }
export function getAllFiles()         { return [..._allFiles] }

export async function switchToId(fileId) {
  const file = _allFiles.find(f => f.id === fileId)
  if (!file || file.id === _currentFile?.id) return
  await switchTo(file)
  await persistToIDB()
}

export async function closeFile(fileId) {
  const file = _allFiles.find(f => f.id === fileId)
  if (!file) return
  if (!await _confirmClose(file)) return

  const idx = _allFiles.findIndex(f => f.id === fileId)
  if (idx < 0) return

  if (_allFiles.length === 1) {
    // Always keep at least one file open — replace with a fresh blank
    const blank = blankFile()
    _allFiles = [blank]
    _currentFile = null   // prevents switchTo from persisting the closed file
    await switchTo(blank)
    await persistToIDB()
    return
  }

  const wasActive = _currentFile?.id === fileId
  _allFiles.splice(idx, 1)

  if (wasActive) {
    // closed file is no longer in _allFiles → switchTo will skip its persist
    const next = _allFiles[Math.min(idx, _allFiles.length - 1)]
    await switchTo(next)
    await persistToIDB()
  } else {
    await persistToIDB()
    _ops.onFilesChanged?.()
  }
}
