# JSAnalyst — Architecture

## Overview

JSAnalyst is a browser-based data analysis IDE targeting the same workflow as RStudio and Quarto: write prose and executable code in the same document, run statements interactively, see results inline. It differs from Jupyter in that the document is plain Markdown (no JSON notebook format, no cell metadata, fully readable without the IDE). It differs from Observable in that execution is imperative and sequential, not reactive — variables declared in one chunk are available in all later chunks within a shared session, matching the RMarkdown mental model.

The three pillars of the execution model are:

1. **Markdown-first source** — the document is a .md file. Code chunks are fenced blocks (` ```js ` or ` ```{js, eval=false} `) parsed by remark. The same file can be opened in any text editor.
2. **Shared session** — all chunks share a single `window`-level scope via indirect `eval`. `const`/`let` are rewritten to `var` at eval time so variables survive across calls. The session persists across file switches; only inline output is cleared on file switch.
3. **Two-tier output** — chunk execution produces inline output anchored below the chunk's closing fence (like a notebook), while the xterm.js terminal pane provides a live REPL with persistent history.

---

## Module Inventory

### `src/chunkDetection.js`

Pure module (no DOM, no app state) for locating and classifying code chunks in a document. Exports `ChunkType` (`DISPLAY | EXECUTABLE`), `parseChunkOptions(lang, meta)`, `getChunks(docText)`, and `getChunkAtLine(docText, line)`. `getChunks` returns `{ type, lang, code, options, startLine, endLine }` objects with 1-based line numbers. Executable chunks match the pattern `` ```{js...} ``; display-only chunks match `` ```js `` (no braces) and are never executed. The `isExecutableLang` regex accepts end-of-string as a valid trailing delimiter to handle remark truncating `node.lang` at the first space (e.g. `{js label=foo}` → remark produces `lang="{js"` without trailing delimiter).

### `src/dialog.js`

Minimal wrapper around Shoelace `sl-dialog` for programmatic confirm dialogs. Exports `showConfirmDialog({ message, buttons })` which returns a Promise resolving to the button label the user clicked. Owns the dialog lifecycle (create → show → destroy). Used by `fileManager.js` for unsaved-changes prompts; available to any future module that needs a non-blocking confirm UI.

### `src/preview.js`

Renders a document as clean HTML for the Preview tab. Two exports:

- `segmentDocument(docText)` — splits the document into alternating `{ type: 'prose', text }` and `{ type: 'chunk', chunk }` segments. Uses `getChunks()` to locate chunk boundaries and slices surrounding lines as prose. Pure function; no DOM or app state.
- `renderPreview(docText, chunkOutputs)` — iterates segments and builds an HTML string. Prose is rendered via `marked.parse()` and sanitized with `DOMPurify`. Display chunks are rendered as `highlight.js`-highlighted code blocks. Executable chunks show their captured output from `chunkOutputs: Map<endLine, innerHTML>` (DOMPurify-sanitized), or a `.chunk-not-run` placeholder if the chunk has not been run yet. The `echo=true` option renders the source code block above the output for executable chunks.

Imported by `main.js` only. Dependencies: `marked`, `dompurify`, `highlight.js/lib/core` + explicit `javascript` language registration.

### `src/main.js`

The application kernel. Owns everything that requires a live DOM: editor construction, xterm terminal setup, inline output widget system, `evalInSession()`, display functions (`display`, `displayTable`, `displayPlot`, `displayText`, `displayError`), console output formatter (`formatForConsole`, `formatArqueroTable`, `formatError`), chunk detection wrappers (`getChunks`, `getChunkAtLine`), run functions (`runCode`, `runAll`, `runChunkAtCursor`, `runNextChunk`, `runAllAbove`, `runAllBelow`), variable explorer (`updateExplorer`, `viewVariable`, `renderSortableTable`, `renderJsonTree`), and the xterm REPL input loop. Also owns `chunkOutputs` (a `Map<endLine, innerHTML>` capturing the rendered HTML of each run chunk for the preview pane) and `refreshPreview()`. Wires together all other modules at startup: calls `FM.init()`, `Actions.initActions()`, `registerShortcuts()`, attaches the Shoelace `sl-select` delegated listener, and renders file tabs.

`main.js` intentionally does not own keyboard shortcut binding (delegated to `ctrlEnter.js` for Ctrl+Enter, `shortcuts.js` for global shortcuts, and `jsAnalystKeymap` for remaining CodeMirror shortcuts) or file persistence logic (owned by `fileManager.js`).

### `src/ctrlEnter.js`

A fully self-contained CodeMirror extension module with zero imports from the rest of the application. Owns the Ctrl+Enter behaviour: finding which JS chunk the cursor is in, determining the complete multi-line statement at the cursor using acorn as a parse oracle, and advancing the cursor past the executed statement. The only connection to `main.js` is the `evalFn` callback injected at construction time via `createCtrlEnterExtension(evalFn)`.

Exports `getStatementAtCursor` (pure function, string-in/string-out), `getStatementInfoAtCursor` (same but also returns the last document line of the statement), and `createCtrlEnterExtension` (CodeMirror extension factory). This module is the purest in the codebase: no side effects, no globals, fully unit-testable.

### `src/fileManager.js`

Owns all file-state management. Maintains the `_allFiles` array, `_currentFile`, `_isDirty` flag, and the two-layer persistence contract: IndexedDB (via `db.js`) for working state / autosave, File System Access API (or fallback `<a download>`) for saving to disk. Implements the `switchTo()` sequence (save current → clear output → load new content → run-on-open). Exposes the `onFilesChanged` hook so `main.js` can re-render the file tab bar after any state change. Does not own the editor view or DOM directly — it receives `editorView` and `filenameEl` as arguments at `init()` time and uses only `editorView.dispatch()` and `editorView.state.doc`.

### `src/db.js`

Thin wrapper around the IndexedDB API. Owns the database schema (`jsanalyst` / `workspace` / `workspaceState` key) and exposes exactly two functions: `loadWorkspace()` and `saveWorkspace(state)`. Has no knowledge of file structure; the schema shape is the caller's responsibility. No side effects beyond IDB reads/writes.

### `src/dataIO.js`

Factory for the `loadCSV`, `loadJSON`, and `loadFile` helpers that are injected into `window` and therefore available to user code chunks. Accepts `consolePrint` and `formatForConsole` as constructor arguments so it has no direct dependency on `main.js` internals. Owns the File System Access API / `<input type=file>` dual-path logic for loading files (mirroring the pattern in `fileManager.js`), fetch-based URL loading, and the size-warning threshold. Returns plain Arquero tables.

### `src/actions.js`

Centralised action registry. Receives all app dependencies via `initActions(deps)` and exposes one named export per user-facing action (`newFile`, `openFile`, `saveFile`, `saveFileAs`, `closeFile`, `undo`, `redo`, `insertChunk`, `clearSession`, `runCurrentChunk`, `runAll`, `clearOutputAndRunAll`, `runAllAboveCursor`, `runAllBelowCursor`, `toggleRunOnOpen`, `toggleConsole`, `toggleOutputPane`, `refreshPreview`, `showShortcutsHelp`). Both the Shoelace menu `sl-select` listener and `shortcuts.js` call these exports, ensuring there is exactly one implementation per action. Does not own any logic; every export is a one-liner that delegates to a dep.

### `src/shortcuts.js`

Thin wrapper around `tinykeys`. Registers the global keyboard shortcut table (Ctrl+N/O/S/Shift+S, Ctrl+Alt+I, Ctrl+A, Ctrl+R, Ctrl+Shift+P) and nothing else. Intentionally does not handle Ctrl+Enter or Ctrl+Shift+Enter — those remain in the CodeMirror keymap so they respect focus correctly.

---

## Data Flow: Ctrl+Enter → Inline Output

```
User presses Ctrl+Enter in the editor
        │
        ▼
ctrlEnter.js  »  createCtrlEnterExtension.run()
  ├── findChunkAtLine(docText, cursorLine)     [fence scan, O(n lines)]
  ├── getStatementInfoAtCursor(...)            [acorn parse oracle]
  │     ├── Phase 1: expand downward from cursor
  │     └── Phase 2: if invalid, walk upward to find statement start,
  │                  then expand downward (skipping false-positive fragments)
  └── call evalFn(statement, endLine1)
             │
             ▼  (lambda in main.js)
        runCode(code, echo=true, endLine)
          ├── captureTarget = new div.chunk-output
          ├── evalInSession(code)               [indirect eval, const→var rewrite]
          │     ├── updates SESSION_VARS
          │     └── updateExplorer()
          ├── display*() calls inside code write into captureTarget
          ├── auto-display if no explicit output and result !== undefined
          └── push { endLine, dom } → pendingInlineOutputs[]
             │
             ▼
        flushInlineOutputs()
          ├── resolve each endLine → doc position via doc.line(endLine).to
          ├── dispatch setInlineOutput effects in one transaction
          └── requestMeasure()  [tells CM to re-measure widget heights]
             │
             ▼
        inlineOutputField (StateField)
          └── buildInlineOutputDecorations()
                └── Decoration.widget(block:true) anchored at chunk closing fence
             │
             ▼
        xterm console  (if echo=true)
          ├── consoleAppend() echoes the code
          └── formatForConsole(result) → ANSI-colored string → term.writeln()
```

---

## Data Flow: Run Chunk → Preview Capture

```
runCode(code, echo, endLine)
  ├── captureTarget = new div.chunk-output
  ├── evalInSession(code)
  ├── display*() writes into captureTarget
  └── if container has children:
        chunkOutputs.set(endLine, container.innerHTML)   ← snapshot BEFORE close-btn injected
        pendingInlineOutputs.push({ endLine, dom: container })

clearOutput()
  └── chunkOutputs.clear()           ← preview and inline outputs stay in sync

refreshPreview()   (wired to Ctrl+Shift+P and View → Refresh Preview)
  ├── docText = editorView.state.doc.toString()
  ├── html = renderPreview(docText, chunkOutputs)
  │     ├── segmentDocument(docText)  →  prose / chunk segments
  │     ├── prose  →  marked.parse()  →  DOMPurify.sanitize()
  │     ├── display chunk  →  hljs.highlight()  →  <pre class="preview-code">
  │     └── executable chunk:
  │           chunkOutputs.has(endLine)?
  │             yes  →  DOMPurify.sanitize(html)  →  <div class="chunk-output-preview">
  │             no   →  <div class="chunk-not-run">▷ Not yet run</div>
  └── document.getElementById('preview-content').innerHTML = html
        + switchTab(previewBtn)
```

---

## Key Design Decisions

### Ephemeral Inline Output

Inline outputs (the DOM nodes anchored below chunk fences) are not persisted. They live only in memory as CodeMirror widget decorations and are cleared when switching files, clearing the session, or re-running the chunk. This keeps the file format clean (plain Markdown) and avoids the notebook serialization problem. The trade-off: re-opening a file means re-running to see output.

### Shared Session Across Files

All files share the same `window` scope. Switching files does not clear the session. This lets users build up a common data layer in one file and visualize it in another, which matches how RMarkdown projects work (source files, helper files). The risk is unexpected variable name collisions; the variable explorer makes the current session state visible.

### Two-Layer Storage (IndexedDB + File System Access API)

IndexedDB provides resilient autosave: closing the browser tab does not lose work. The File System Access API provides round-trip disk fidelity: Save writes the exact same bytes to the `.md` file, which can then be opened by any text editor. The fallback (`<a download>`) handles browsers that don't support the native file picker. The `fileManager.js` module owns this dual-path logic and presents a single `saveFile()` / `saveFileAs()` surface to the rest of the app.

### Plain Text Terminal vs Rich Inline Output

Console output (REPL and echoed chunk code) passes through `formatForConsole()` and renders as ANSI-colored text in xterm.js. Chunk output (tables, plots, HTML elements) is captured as DOM nodes and rendered inline in the editor as CodeMirror block decorations. This split mirrors RStudio: the console pane shows text output, the document shows rendered output. The `captureTarget` variable in `main.js` is the switch: when set, `display*()` writes into the capture div instead of the output pane.

### acorn as Statement Parser

The Ctrl+Enter handler uses acorn to determine whether a fragment of code is a complete statement, an incomplete fragment (asking for more input), or a genuine syntax error. The key insight is checking acorn's `e.pos` field: if the error position sits at or past the trimmed end of the code, the fragment is valid so far but was cut off. Three-state returns (`complete`, `incomplete`, `invalid`) drive a two-phase search: expand downward first, then walk upward if the cursor is mid-statement. A false-positive detection step handles acorn seeing `marks: [...]` as a valid `LabeledStatement` fragment when the cursor is inside a `Plot.plot({})` call.

---

## Known Fragility Points

| Area | Risk | Mitigation |
|---|---|---|
| `const`/`let` → `var` rewrite | Regex rewrite is syntactically naive; breaks `concatenate` or `construct` | Currently acceptable; replaced by proper AST transform or iframe isolation in Phase 9 |
| Inline output position remapping | `tr.changes.mapPos()` can lose widget positions during large edits | Positions are silently dropped (try/catch); user re-runs to restore output |
| acorn `LabeledStatement` false positive | `key: [value]` fragments parse as complete LabeledStatements, confusing the upward phase-2 search | Mitigated by "continue upward if inner downward expansion hits invalid"; covered by tests |
| Shared `window` scope | User code can overwrite builtins or app globals | No mitigation yet; Phase 9 (iframe) would fix this |
| xterm.js paste path | Two code paths (customKeyEventHandler bypass + paste event) can race on some browsers | Covered by the `termContainer.addEventListener('paste')` handler taking precedence |
| `flushInlineOutputs()` must be called after every `runCode()` | Forgetting the call leaves outputs in the pending queue with no position to anchor | All call sites in `main.js` call it immediately after; `ctrlEnterExtension`'s lambda also calls it |
| Preview shows stale output after document edit | `chunkOutputs` keys are line numbers; editing lines above a chunk shifts its endLine, causing key mismatch | User must re-run the affected chunks and refresh preview; a future fix would track chunk identity by content hash |
