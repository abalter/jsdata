// ── shortcuts.js ──────────────────────────────────────────────────────────────
// Global keyboard shortcuts via tinykeys.
// Ctrl+Enter / Ctrl+Shift+Enter stay in the CodeMirror keymap — not here.

import { tinykeys } from 'tinykeys'

export function registerShortcuts(actions) {
  tinykeys(window, {
    // File
    'Control+n': e => { e.preventDefault(); actions.newFile() },
    'Control+o': e => { e.preventDefault(); actions.openFile() },
    'Control+s': e => { e.preventDefault(); actions.saveFile() },
    'Control+S': e => { e.preventDefault(); actions.saveFileAs() },

    // Edit
    'Control+Alt+i': e => { e.preventDefault(); actions.insertChunk() },

    // Run
    'Control+A': e => { e.preventDefault(); actions.runAll() },
    'Control+R': e => { e.preventDefault(); actions.clearOutputAndRunAll() },
  })
}
