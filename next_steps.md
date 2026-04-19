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
- [ ] Visual control buttons on chunks (CodeMirror widget decorations)
  - Run chunk, Run all above, Run all below
- [ ] "Add Chunk" toolbar button (inserts ```js template)
- [ ] Ctrl+Alt+I inserts a new chunk at cursor

## Phase 4D — Chunk Options
- [ ] Parse chunks with `{js}` syntax (like RMarkdown `{r, echo=FALSE}`)
- [ ] Support options: label, echo, eval, etc.
- [ ] Update remark parsing or add post-processing for `{js ...}` headers

## Phase 4E — Variable Explorer
- [ ] New pane (tab or collapsible, next to output)
- [ ] Shows SESSION_VARS with name, type, preview
- [ ] Updates after each chunk/console execution
- [ ] Click to display() a variable

## Phase 5 — Execution Isolation (future)
- [ ] Evaluate iframe-based execution for isolated global scope
- [ ] Or wait for TC39 Compartment API
- [ ] Current approach (indirect eval + const→var rewrite) works for now
