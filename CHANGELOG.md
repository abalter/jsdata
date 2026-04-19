# Changelog

All notable changes to JSAnalyst, organized by development phase.

---

## Phase 1 — Runtime and Output

**Built:** Core application scaffold using Vite as the build system. CodeMirror 6 editor with Markdown language support and one-dark theme. Arquero, D3, and Observable Plot loaded as CDN UMD globals (available to user chunks without imports). A basic output pane that renders Arquero tables and Observable Plot SVGs as DOM nodes. A `display()` function injected into `window` so user code can trigger output explicitly.

**Notable decisions:** CDN globals for the data layer (Arquero/D3/Plot) keep chunk code clean — users write `aq.from(...)` not `import aq from 'arquero'`. Vite handles only the IDE code, not user data dependencies.

---

## Phase 2 — Console / REPL

**Built:** A `<textarea>`-based REPL panel below the editor. Users type JavaScript, press Enter, results appear above. `evalInSession()` using indirect `eval` with `const`/`let` → `var` rewriting so variables persist across calls. Basic error display.

**Notable decisions:** Indirect eval (`(0, eval)(code)`) evaluates in global scope, making variables available to subsequent chunks. The `const`→`var` rewrite is a regex hack acknowledged as fragile; it handles the common case while Phase 9 isolation remains a future item.

---

## Phase 3 — Editor Integration

**Built:** Remark-based chunk detection (`getChunks`, `getChunkAtLine`). Ctrl+Shift+Enter runs the current chunk. Ctrl+Enter runs the current line. Run All executes all chunks in document order and clears output first. The xterm.js terminal replaced the textarea REPL.

**Notable decisions:** Using remark to parse chunk boundaries gives accurate 1-based line numbers and correct handling of nested/indented fences. The alternative (regex fence scanning) was retained as a lighter-weight path in `ctrlEnter.js` for the Ctrl+Enter case where remark's parse tree is unnecessarily heavy.

---

## Phase 4A — Behavioral Fixes

**Built:** Correct Ctrl+Enter keymap priority using `Prec.highest` so it fires before CodeMirror's default handlers. File Open/Save via the File System Access API with a `<input type=file>` / `<a download>` fallback for browsers without native picker support. Window title updates to show the current filename.

---

## Phase 4B — xterm.js Console Overhaul

**Built:** Replaced the textarea REPL with a full xterm.js terminal. Features: real cursor and line editing (left/right arrows, home/end, delete), command history with up/down arrow navigation, ANSI color for prompts (cyan), results (green/white), and errors (red). `FitAddon` auto-resizes the terminal when its container changes size via `ResizeObserver`. Ctrl+C clears current input (with selection-copy bypass), Ctrl+V pastes from clipboard, Ctrl+L clears the terminal buffer.

**Notable decisions:** Two paste code paths exist: `customKeyEventHandler` lets the browser handle Ctrl+V natively, while a `paste` event listener on the container captures the clipboard text and inserts it at the cursor position. The dual path handles cross-browser inconsistencies.

---

## Phase 4C — Chunk UI

**Built:** `ChunkButtonsWidget` CodeMirror decoration renders ▶ / ⏫ / ⏬ buttons on the opening fence line of every JS chunk. Buttons use `onmousedown` + `preventDefault()` so clicking them doesn't steal editor focus. Ctrl+Alt+I inserts a new empty chunk template at the cursor. Run All Above / Run All Below operate on chunks strictly above/below the given start line.

---

## Phase 4D — Chunk Options

**Built:** `parseChunkOptions()` parses the `lang`+`meta` fields from remark's code node. Supports `` ```js ``, `` ```{js} ``, and `` ```{js, eval=false, label=foo} `` syntax, coercing values to booleans and numbers where appropriate. The `eval=false` option skips execution in all run-all paths. Ctrl+Enter still fires in `eval=false` chunks (manual override, matching RStudio behavior).

---

## Phase 4E — Variable Explorer

**Built:** Three-tab panel (Output / Variables / View) replacing the single output pane. Variables tab shows `SESSION_VARS` with name, inferred type (`table[r×c]`, `array[n]`, `function`, etc.), and a truncated preview. Click a variable row to open it in the View tab. View tab renders Arquero tables as sortable, clickable-header tables and other values as a collapsible JSON tree with ANSI-style color coding. The JSON tree lazily renders children beyond 200 items. `updateExplorer()` is called after every `evalInSession()` and after `clearSession()`.

---

## Phase 5 — Inline Output

**Built:** Chunk output rendered inline in the editor document below each chunk's closing fence, using CodeMirror `Decoration.widget(block:true)`. The `captureTarget` variable in `runCode()` redirects `display*()` calls into a capture `<div>` during chunk execution; after all chunks run, `flushInlineOutputs()` converts pending outputs to widget decorations in a single batched `editorView.dispatch()` call. Each inline output has a ✕ close button. Position remapping via `tr.changes.mapPos()` keeps widgets anchored as the document is edited. `clearInlineOutputs` StateEffect wipes all widgets at once (used on file switch and clear session).

**Notable decisions:** Auto-display of the last expression value is suppressed for assignment statements (detected by `isAssignment()`) to prevent implicit output of large objects. The `captureTarget` → `pendingInlineOutputs` → `flushInlineOutputs()` pipeline exists because widget positions need document positions, which must be resolved after the run completes, not during it.

---

## Phase 6 — File Management

**Built:** Full two-layer persistence. IndexedDB autosaves after 2 seconds of inactivity (debounced timer). Schema: `{ version, activeFileId, files[] }` with each file having `{ id, name, content, lastModified, fileHandle, runOnOpen }`. The `switchTo()` sequence: persist current file → clear inline output and output pane → load new content (with `_paused` flag suppressing autosave) → update title → run-on-open if set. Multi-file support with a tab bar rendered by `renderFileTabs()`. Closing the last file creates a blank replacement. `runOnOpen` per-file toggle persisted to IDB.

---

## Phase 7 — Shoelace Menubar + Keyboard Shortcuts

**Built:** Replaced all toolbar buttons with a `<nav class="menubar">` using Shoelace `sl-dropdown` / `sl-menu` / `sl-menu-item` web components. File / Edit / Run / View / Help menus. `<sl-menu-item type="checkbox">` for the Run on Open toggle, synced to IDB state before the Run menu opens. A `sl-dialog` keyboard shortcuts reference modal in the Help menu. `actions.js` centralised action registry — both the `sl-select` delegated listener and `shortcuts.js` call the same exports. `tinykeys` global shortcuts for Ctrl+N/O/S/Shift+S, Ctrl+Alt+I, Ctrl+A, Ctrl+R. Undo/Redo wired to `@codemirror/commands`.

---

## Phase 8 — Ctrl+Enter Multi-line (Isolated Module)

**Built:** `ctrlEnter.js` refactored into a fully self-contained module with no app imports. `getStatementAtCursor()` / `getStatementInfoAtCursor()` use acorn as a parse oracle with a two-phase algorithm: expand downward from the cursor (phase 1); if the cursor is mid-statement (detected as `invalid` in isolation), walk upward to find the statement's true start then expand downward again (phase 2). A false-positive detection step handles acorn's `LabeledStatement` ambiguity for object property interiors. `createCtrlEnterExtension(evalFn)` wraps the logic in a CodeMirror `Prec.highest` keymap. Cursor advances to the line after the statement's actual end (using `statementEndLine` from phase 2, not the cursor line). 11 → 26 unit tests covering all edge cases.

**Notable decisions:** The module is isolated precisely so it can be tested without a browser and without any app state. The acorn `e.pos >= code.trimEnd().length` check (rather than `e.message` string matching) is required to correctly classify unclosed parentheses and brackets as `incomplete` rather than `invalid`.
