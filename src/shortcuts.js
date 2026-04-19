// ── shortcuts.js ──────────────────────────────────────────────────────────────
// Global keyboard shortcuts via tinykeys.
//
// Ownership model:
//   - CodeMirror has focus  → CM keymaps handle editor keys; tinykeys defers
//   - xterm has focus       → xterm handles its keys; tinykeys defers
//   - App-level actions (save, open, new) → always fire regardless of focus
//
// Rule: shortcuts that have a CodeMirror equivalent use nativeInputHasFocus()
// to bail out and let the native handler run. App-level shortcuts never bail.

import { tinykeys } from 'tinykeys'

function editorHasFocus() {
  return !!document.querySelector('.cm-editor')?.contains(document.activeElement)
}

function terminalHasFocus() {
  return !!document.querySelector('.xterm')?.contains(document.activeElement)
}

function nativeInputHasFocus() {
  return editorHasFocus() || terminalHasFocus()
}

export function registerShortcuts(actions) {
  tinykeys(window, {
    // ── File — always fire, no CodeMirror equivalent ──────────────────────
    'Control+n': e => { e.preventDefault(); actions.newFile() },
    'Control+o': e => { e.preventDefault(); actions.openFile() },
    'Control+s': e => { e.preventDefault(); actions.saveFile() },
    'Control+S': e => { e.preventDefault(); actions.saveFileAs() },

    // ── Edit — guard: CodeMirror owns these when editor has focus ─────────
    'Control+Alt+i': e => {
      if (nativeInputHasFocus()) return
      e.preventDefault()
      actions.insertChunk()
    },

    // ── Run — guard: Ctrl+A is select-all in CodeMirror ───────────────────
    'Control+A': e => {
      if (nativeInputHasFocus()) return
      e.preventDefault()
      actions.runAll()
    },
    'Control+R': e => {
      if (nativeInputHasFocus()) return
      e.preventDefault()
      actions.clearOutputAndRunAll()
    },

    // ── View — guard: Ctrl+P is browser print / no CM binding but defer ───
    'Control+P': e => {
      if (nativeInputHasFocus()) return
      e.preventDefault()
      actions.refreshPreview()
    },
  })
}
