# Current State
- Working editor (CodeMirror 6, markdown + JS highlighting)
- Working output window
- Working console (xterm.js terminal)
- Run all, run chunk, clear output working
- Ctrl+Shift+Enter runs current chunk
- Remark-based chunk detection
- Vite build system
- File Open/Save (File System Access API + fallback)
- Multi-line statement detection (Ctrl+Enter)
- Cursor advances after execution
- xterm.js console with ANSI colors, history, line editing
- Ctrl+C copy/clear, Ctrl+V paste, Ctrl+L clear terminal

# Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| Ctrl+Enter | Run current statement (multi-line aware), advance cursor |
| Ctrl+Shift+Enter | Run current chunk |
| Ctrl+Shift+N | Run next chunk |
| Ctrl+Alt+I | Insert new chunk (planned — Phase 4C) |
| Enter | Submit console input |
| ↑ / ↓ | Console history navigation |
| Ctrl+C | Copy selection / clear input |
| Ctrl+V | Paste from clipboard |
| Ctrl+L | Clear terminal |

# Phases

## Phase 4A — Behavioral Fixes
- [x] Ctrl+Enter runs current line (fixed: keymap priority with Prec.highest)
- [x] File I/O: Open/Save via File System Access API
- [x] Window title shows filename

## Phase 4B — Console Overhaul (xterm.js)
- [x] Replace textarea REPL with xterm.js + FitAddon
- [x] Real terminal feel: input at cursor, output scrolls up
- [x] Enter submits line to evalInSession()
- [x] Up/Down arrow cycles command history
- [x] ANSI color for errors (red), results (green), prompts (cyan)
- [x] Ctrl+C copy/clear, Ctrl+V paste, Ctrl+L clear terminal
- [x] ResizeObserver auto-fits terminal on pane resize

## Phase 4C — Chunk UI
- [x] Visual control buttons on chunks (CodeMirror widget decorations)
  - ▶ Run chunk, ⏫ Run all above, ⏬ Run this and below
- [x] "Add Chunk" toolbar button (inserts ```js template)
- [x] Ctrl+Alt+I inserts a new chunk at cursor

## Phase 4D — Chunk Options
- [x] Parse chunks with `{js}` syntax (like RMarkdown `{r, echo=FALSE}`)
- [x] Support options: label, eval (echo ready for Phase 5 inline output)
- [x] Remark `lang`+`meta` parsing handles all variants: `js`, `{js}`, `{js, eval=false}`
- [x] `eval=false` skips execution in Run All, Run Chunk, and all run-above/below
- [x] Ctrl+Enter still works in `eval=false` chunks (manual override, like RStudio)

## Phase 4E — Variable Explorer
- [x] Tabbed Output/Variables/View pane (click to switch)
- [x] Shows SESSION_VARS with name, type, preview (Elements filtered out)
- [x] Smart type display: table[rows×cols], array[n], function, element, etc.
- [x] Updates after every evalInSession() and clearSession()
- [x] View tab with sortable data table for Arquero tables (click column headers to sort)
- [x] View tab with collapsible JSON tree for objects/arrays (color-coded, lazy rendering)
- [x] View tab appears on demand, labeled "View: varName"
- [x] Console returns expression values (not just ✓)
- [x] Editor-executed code added to console history (arrow key recall)
- [x] Chunk buttons floated to right edge of fence line

## Phase 5 — Inline Output
- [x] Render chunk output inline in the document (below each chunk)
- [x] Tables, plots, and text output appear between chunks like RMarkdown/Quarto
- [x] CodeMirror block widget decorations below closing fence
- [x] Auto-display last expression value if no explicit display() call
- [x] Clear inline output on re-run or clear all
- [x] Batched dispatch via flushInlineOutputs() for efficient multi-chunk runs
- [x] Position remapping on document changes
- [x] ✕ close button on individual inline outputs (appears on hover)
- [x] Ctrl+Enter routes to inline output (not output pane)
- [x] Console rich display: objects/tables/arrays → Output pane with auto-tab-switch
- [x] Console primitives shown in green, errors in red
- [ ] Toggle between inline and side-pane output modes

### Design Notes
- **Routing**: Console execution → output pane (existing). Chunk execution → inline below chunk (new).
- **Output pane becomes console-only** — like RStudio's console output area. Chunk output lives in the document.
- **Widget approach**: `OutputWidget extends WidgetType` anchored at each chunk's closing fence line. `eq()` returns false to always redraw on rerun.
- **Flow**: Chunk runs → output captured → find chunk endLine → convert to doc position → insert/replace widget decoration.
- **Height gotcha**: CodeMirror needs widget heights for scrolling. Call `requestMeasure()` after dynamic content (tables, plots) renders.
- **RStudio nuance**: `print()`/console output still goes to console pane. Only rendered display output (tables, plots) goes inline. This distinction matters more when chunk options (`echo`, `print`) arrive in Phase 4D.
- **Separate code paths already exist**: `runCode()` for chunks vs `replRun()` for console — routing is just extending `runCode` to capture display output and render it as a widget at `chunkEndPos`.

## Phase 6 — Execution Isolation (future)
- [ ] Evaluate iframe-based execution for isolated global scope
- [ ] Or wait for TC39 Compartment API
- [ ] Current approach (indirect eval + const→var rewrite) works for now
