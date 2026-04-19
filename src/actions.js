// ── actions.js ────────────────────────────────────────────────────────────────
// Central action registry. Both menu click handlers and keyboard shortcuts
// call these functions so there is exactly one implementation per action.
//
// Call initActions(deps) once all dependencies exist (after editorView is built).

const _d = {}  // deps injected by main.js

export function initActions(deps) {
  Object.assign(_d, deps)
}

// ── File ─────────────────────────────────────────────────────────────────────

export const newFile = async () => {
  try { await _d.FM.newFile() } catch (e) { _d.displayError(e) }
}

export const openFile = async () => {
  try { await _d.FM.openFile() } catch (e) { _d.displayError(e) }
}

export const saveFile = async () => {
  try { await _d.FM.saveFile() } catch (e) { _d.displayError(e) }
}

export const saveFileAs = async () => {
  try { await _d.FM.saveFileAs() } catch (e) { _d.displayError(e) }
}

export const closeFile = async () => {
  try {
    const id = _d.FM.getCurrentFile()?.id
    if (id) await _d.FM.closeFile(id)
  } catch (e) { _d.displayError(e) }
}

// ── Edit ─────────────────────────────────────────────────────────────────────

export const undo = () => _d.undo?.()
export const redo = () => _d.redo?.()

export const insertChunk = () => _d.insertChunk?.()

export const clearSession = () => _d.clearSession?.()

// ── Run ──────────────────────────────────────────────────────────────────────

// Note: runCurrentLine (Ctrl+Enter) is handled entirely by ctrlEnter.js and
// does not route through actions.js — it is wired directly into the editor.
export const runCurrentChunk  = () => _d.runChunkAtCursor?.()
export const runAll           = () => _d.runAll?.()

export const clearOutputAndRunAll = () => {
  _d.clearOutput?.()
  _d.runAll?.()
}

export const runAllAboveCursor = () => _d.runAllAboveCursor?.()
export const runAllBelowCursor = () => _d.runAllBelowCursor?.()

export const toggleRunOnOpen = async () => {
  const isOn = await _d.FM.toggleRunOnOpen()
  // Sync checkbox UI to the persisted IDB value
  const item = document.querySelector('[data-action="toggleRunOnOpen"]')
  if (item) item.checked = isOn
}

// ── View ─────────────────────────────────────────────────────────────────────

export const toggleConsole    = () => _d.toggleConsole?.()
export const toggleOutputPane = () => _d.toggleOutputPane?.()
export const refreshPreview   = () => _d.refreshPreview?.()

// ── Help ─────────────────────────────────────────────────────────────────────

export const showShortcutsHelp = () => {
  const dialog = document.querySelector('.shortcuts-dialog')
  if (dialog) dialog.show()
}
