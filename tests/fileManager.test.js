/**
 * tests/fileManager.test.js
 *
 * Tests for file state logic in src/fileManager.js.
 *
 * Testing strategy:
 *  - src/db.js (IndexedDB) is mocked via vi.mock so no real IDB calls are made.
 *  - src/dialog.js is mocked so confirmation dialogs resolve immediately without
 *    a real DOM (default: "Don't Save" — proceed without saving).
 *  - src/fileManager.js is dynamically imported AFTER globals are stubbed, so
 *    the module-level `typeof window.showOpenFilePicker` check does not throw.
 *  - vi.resetModules() in beforeEach gives each test a clean module instance
 *    (all private `let` state in fileManager.js is reset).
 *  - Only the pure state logic is tested: getCurrentFile(), getAllFiles(),
 *    toggleRunOnOpen(), switchToId(), closeFile(), onEditorChange() side effects.
 *
 * NOTE on design signal: The private helpers blankFile(), generateId(),
 * setFileStatus(), updateTitle() etc. are not exported.  If those need
 * independent tests, they should be extracted to a separate utility module.
 * For now we observe their effects through the exported API and through the
 * document.title side effect.
 *
 * Tests for saveFile() / saveFileAs() / openFile() are marked it.todo because
 * they require mocking the File System Access API (window.showSaveFilePicker,
 * window.showOpenFilePicker), which is cumbersome without a dedicated helper.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest'

// ── Mock db.js BEFORE fileManager.js is imported ─────────────────────────────
// vi.mock is hoisted to the top of the file by vitest's transform, so this mock
// is in place even when fileManager.js is imported dynamically in beforeEach.

vi.mock('../src/db.js', () => ({
  loadWorkspace: vi.fn().mockResolvedValue(null),      // no saved state by default
  saveWorkspace: vi.fn().mockResolvedValue(undefined),
}))

// ── Mock dialog.js ────────────────────────────────────────────────────────────
// showConfirmDialog requires a live DOM with Shoelace registered, which is not
// available in the Node test environment.  Default to "Don't Save" so tests
// that trigger the unsaved-changes guard proceed without blocking.

vi.mock('../src/dialog.js', () => ({
  showConfirmDialog: vi.fn().mockResolvedValue("Don't Save"),
}))

// ── Browser-like globals so fileManager.js runs in Node ──────────────────────
// fileManager.js has module-level: `const hasNativeFSOpen = typeof window.showOpenFilePicker === 'function'`
// Without these stubs it throws ReferenceError in Node.

vi.stubGlobal('window', {
  showOpenFilePicker: undefined,
  showSaveFilePicker: undefined,
})
vi.stubGlobal('document', { title: '' })

// ── Per-test fresh imports ────────────────────────────────────────────────────

let FM
/** @type {ReturnType<typeof import('../src/db.js')>} */
let db

const mockEditorView = () => ({
  state: { doc: { toString: () => '# test document', length: 15 } },
  dispatch: vi.fn(),
})

const mockOps = () => ({
  clearOutput:    vi.fn(),
  runAll:         vi.fn(),
  consolePrint:   vi.fn(),
  onFilesChanged: vi.fn(),
})

beforeEach(async () => {
  // Reset the module registry so fileManager.js private state is fresh
  vi.resetModules()

  // Re-import both modules so we hold references to the fresh mock fns
  db = await import('../src/db.js')
  FM = await import('../src/fileManager.js')
})

// ── init() with no saved state ────────────────────────────────────────────────

describe('init() — no saved workspace', () => {
  it('creates a current file with a generated id', async () => {
    db.loadWorkspace.mockResolvedValueOnce(null)
    await FM.init(mockEditorView(), null, mockOps())
    const f = FM.getCurrentFile()
    expect(f).not.toBeNull()
    expect(typeof f.id).toBe('string')
    expect(f.id.length).toBeGreaterThan(0)
  })

  it('current file has default name untitled or demo.md', async () => {
    db.loadWorkspace.mockResolvedValueOnce(null)
    await FM.init(mockEditorView(), null, mockOps())
    // When IDB is empty the app records whatever is in the editor as demo.md
    expect(FM.getCurrentFile()?.name).toBeTruthy()
  })

  it('getAllFiles() returns an array with exactly one entry after init', async () => {
    db.loadWorkspace.mockResolvedValueOnce(null)
    await FM.init(mockEditorView(), null, mockOps())
    expect(FM.getAllFiles()).toHaveLength(1)
  })

  it('current file has runOnOpen default of false', async () => {
    db.loadWorkspace.mockResolvedValueOnce(null)
    await FM.init(mockEditorView(), null, mockOps())
    expect(FM.getCurrentFile()?.runOnOpen).toBe(false)
  })

  it('demo doc is given CLEAN status (treated as already saved to IDB)', async () => {
    db.loadWorkspace.mockResolvedValueOnce(null)
    await FM.init(mockEditorView(), null, mockOps())
    expect(FM.getCurrentFile()?.status).toBe(FM.FileStatus.CLEAN)
  })
})

// ── init() with saved workspace ───────────────────────────────────────────────

describe('init() — from saved workspace', () => {
  const savedFile = {
    id: 'abc-123',
    name: 'analysis.md',
    content: '# Saved',
    lastModified: 1000,
    fileHandle: null,
    runOnOpen: false,
  }
  const savedState = { version: 1, activeFileId: 'abc-123', files: [savedFile] }

  it('restores the saved file as current file', async () => {
    db.loadWorkspace.mockResolvedValueOnce(savedState)
    await FM.init(mockEditorView(), null, mockOps())
    expect(FM.getCurrentFile()?.id).toBe('abc-123')
  })

  it('restores all saved files', async () => {
    db.loadWorkspace.mockResolvedValueOnce(savedState)
    await FM.init(mockEditorView(), null, mockOps())
    expect(FM.getAllFiles()).toHaveLength(1)
    expect(FM.getAllFiles()[0].name).toBe('analysis.md')
  })

  it('migrates old files missing runOnOpen to runOnOpen: false', async () => {
    const oldFile = { id: 'x', name: 'old.md', content: '', lastModified: 0, fileHandle: null }
    db.loadWorkspace.mockResolvedValueOnce({ version: 1, activeFileId: 'x', files: [oldFile] })
    await FM.init(mockEditorView(), null, mockOps())
    expect(FM.getCurrentFile()?.runOnOpen).toBe(false)
  })

  it('migrates old files missing status: null fileHandle → UNTITLED', async () => {
    const oldFile = { id: 'x', name: 'old.md', content: '', lastModified: 0, fileHandle: null }
    db.loadWorkspace.mockResolvedValueOnce({ version: 1, activeFileId: 'x', files: [oldFile] })
    await FM.init(mockEditorView(), null, mockOps())
    expect(FM.getCurrentFile()?.status).toBe(FM.FileStatus.UNTITLED)
  })

  it('calls runAll when runOnOpen is true', async () => {
    const ops = mockOps()
    const roFile = { ...savedFile, runOnOpen: true }
    db.loadWorkspace.mockResolvedValueOnce({ version: 1, activeFileId: 'abc-123', files: [roFile] })
    await FM.init(mockEditorView(), null, ops)
    expect(ops.runAll).toHaveBeenCalled()
  })

  it('does not call runAll when runOnOpen is false', async () => {
    const ops = mockOps()
    db.loadWorkspace.mockResolvedValueOnce(savedState)
    await FM.init(mockEditorView(), null, ops)
    expect(ops.runAll).not.toHaveBeenCalled()
  })
})

// ── toggleRunOnOpen() ─────────────────────────────────────────────────────────

describe('toggleRunOnOpen()', () => {
  it('returns true on first toggle (starts false)', async () => {
    await FM.init(mockEditorView(), null, mockOps())
    const result = await FM.toggleRunOnOpen()
    expect(result).toBe(true)
  })

  it('returns false on second toggle', async () => {
    await FM.init(mockEditorView(), null, mockOps())
    await FM.toggleRunOnOpen()
    const result = await FM.toggleRunOnOpen()
    expect(result).toBe(false)
  })

  it('persists the new value to getCurrentFile()', async () => {
    await FM.init(mockEditorView(), null, mockOps())
    await FM.toggleRunOnOpen()
    expect(FM.getCurrentFile()?.runOnOpen).toBe(true)
  })
})

// ── newFile() ─────────────────────────────────────────────────────────────────

describe('newFile()', () => {
  it('creates a new current file', async () => {
    await FM.init(mockEditorView(), null, mockOps())
    const originalId = FM.getCurrentFile()?.id
    await FM.newFile()
    expect(FM.getCurrentFile()?.id).not.toBe(originalId)
  })

  it('new file has name untitled.md', async () => {
    await FM.init(mockEditorView(), null, mockOps())
    await FM.newFile()
    expect(FM.getCurrentFile()?.name).toBe('untitled.md')
  })

  it('new file has runOnOpen false', async () => {
    await FM.init(mockEditorView(), null, mockOps())
    await FM.newFile()
    expect(FM.getCurrentFile()?.runOnOpen).toBe(false)
  })

  it('new file has a non-empty id', async () => {
    await FM.init(mockEditorView(), null, mockOps())
    await FM.newFile()
    const f = FM.getCurrentFile()
    expect(typeof f?.id).toBe('string')
    expect(f?.id.length).toBeGreaterThan(0)
  })

  it('new file has status UNTITLED', async () => {
    await FM.init(mockEditorView(), null, mockOps())
    await FM.newFile()
    expect(FM.getCurrentFile()?.status).toBe(FM.FileStatus.UNTITLED)
  })

  it('new file always gets a distinct UUID (never reuses existing untitled)', async () => {
    await FM.init(mockEditorView(), null, mockOps())
    await FM.newFile()
    const id1 = FM.getCurrentFile()?.id
    await FM.newFile()
    const id2 = FM.getCurrentFile()?.id
    expect(id1).not.toBe(id2)
  })
})

// ── switchToId() ──────────────────────────────────────────────────────────────

describe('switchToId()', () => {
  it('switches the active file by id', async () => {
    const file1 = { id: 'f1', name: 'first.md', content: '', lastModified: 0, fileHandle: null, runOnOpen: false }
    const file2 = { id: 'f2', name: 'second.md', content: '', lastModified: 0, fileHandle: null, runOnOpen: false }
    db.loadWorkspace.mockResolvedValueOnce({ version: 1, activeFileId: 'f1', files: [file1, file2] })
    await FM.init(mockEditorView(), null, mockOps())

    await FM.switchToId('f2')
    expect(FM.getCurrentFile()?.id).toBe('f2')
  })

  it('switching to current file is a no-op', async () => {
    const file1 = { id: 'f1', name: 'first.md', content: '', lastModified: 0, fileHandle: null, runOnOpen: false }
    db.loadWorkspace.mockResolvedValueOnce({ version: 1, activeFileId: 'f1', files: [file1] })
    const ops = mockOps()
    await FM.init(mockEditorView(), null, ops)
    const clearCallsBefore = ops.clearOutput.mock.calls.length
    await FM.switchToId('f1')
    // clearOutput is part of switchTo — if it didn't actually switch, it shouldn't fire
    expect(ops.clearOutput.mock.calls.length).toBe(clearCallsBefore)
  })

  it('switching to unknown id is a no-op', async () => {
    await FM.init(mockEditorView(), null, mockOps())
    const originalId = FM.getCurrentFile()?.id
    await FM.switchToId('does-not-exist')
    expect(FM.getCurrentFile()?.id).toBe(originalId)
  })
})

// ── closeFile() ───────────────────────────────────────────────────────────────

describe('closeFile()', () => {
  it('removes the file from getAllFiles()', async () => {
    const file1 = { id: 'f1', name: 'a.md', content: '', lastModified: 0, fileHandle: null, runOnOpen: false }
    const file2 = { id: 'f2', name: 'b.md', content: '', lastModified: 0, fileHandle: null, runOnOpen: false }
    db.loadWorkspace.mockResolvedValueOnce({ version: 1, activeFileId: 'f1', files: [file1, file2] })
    await FM.init(mockEditorView(), null, mockOps())
    await FM.closeFile('f2')
    expect(FM.getAllFiles().map(f => f.id)).not.toContain('f2')
  })

  it('closing the active file switches to the adjacent file', async () => {
    const file1 = { id: 'f1', name: 'a.md', content: '', lastModified: 0, fileHandle: null, runOnOpen: false }
    const file2 = { id: 'f2', name: 'b.md', content: '', lastModified: 0, fileHandle: null, runOnOpen: false }
    db.loadWorkspace.mockResolvedValueOnce({ version: 1, activeFileId: 'f1', files: [file1, file2] })
    await FM.init(mockEditorView(), null, mockOps())
    await FM.closeFile('f1')
    // Should switch to f2
    expect(FM.getCurrentFile()?.id).toBe('f2')
  })

  it('closing the only file makes a blank file active', async () => {
    const file1 = { id: 'f1', name: 'only.md', content: '', lastModified: 0, fileHandle: null, runOnOpen: false }
    db.loadWorkspace.mockResolvedValueOnce({ version: 1, activeFileId: 'f1', files: [file1] })
    await FM.init(mockEditorView(), null, mockOps())
    await FM.closeFile('f1')
    // The active file is a new blank — not the original
    expect(FM.getCurrentFile()?.id).not.toBe('f1')
    expect(FM.getCurrentFile()?.name).toBe('untitled.md')
    // Zombie bug is fixed: _currentFile is nulled before switchTo so persistToIDB
    // inside switchTo skips the old file, leaving exactly one entry in allFiles.
    expect(FM.getAllFiles()).toHaveLength(1)
  })
})

// ── onEditorChange() — dirty flag observable via document.title ───────────────

describe('onEditorChange()', () => {
  it('marks the document title as dirty (contains bullet •)', async () => {
    await FM.init(mockEditorView(), null, mockOps())
    // Reset title to known state
    globalThis.document.title = ''
    FM.onEditorChange()
    expect(globalThis.document.title).toContain('\u2022')  // bullet character •
  })
})

// ── File with null fileHandle ─────────────────────────────────────────────────

describe('saveFile() — null fileHandle routing', () => {
  it.todo('null fileHandle routes to Save As (requires mocking showSaveFilePicker)')
})

// ── getCurrentFileName() ──────────────────────────────────────────────────────

describe('getCurrentFileName()', () => {
  it('returns the current file name', async () => {
    const file1 = { id: 'f1', name: 'report.md', content: '', lastModified: 0, fileHandle: null, runOnOpen: false }
    db.loadWorkspace.mockResolvedValueOnce({ version: 1, activeFileId: 'f1', files: [file1] })
    await FM.init(mockEditorView(), null, mockOps())
    expect(FM.getCurrentFileName()).toBe('report.md')
  })

  it('returns untitled.md when no current file', async () => {
    // Before init, _currentFile is null
    expect(FM.getCurrentFileName()).toBe('untitled.md')
  })
})
