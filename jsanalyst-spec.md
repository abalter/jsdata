# JSAnalyst — Project Specification

## Overview

JSAnalyst is a browser-based, lightweight data analysis IDE inspired by RStudio and the RMarkdown/Quarto literate programming model. It is built for data analysts familiar with R who want an interactive, markdown-first JavaScript environment for data wrangling, analysis, and visualization.

The project is intentionally scoped to be buildable incrementally by a solo developer, starting with a working prototype and evolving toward a more complete tool.

---

## Design Philosophy

### Literate Programming, Not Notebooks

The core interaction model follows RMarkdown/Quarto, **not** Jupyter. This is a deliberate and important distinction:

- Documents are plain `.md` files with fenced JavaScript code chunks
- Text is primary; code chunks are embedded guests
- Documents are re-executable top-to-bottom
- Files are human-readable, diff-friendly, and version-control friendly
- The document format is simple and does not require a special runtime to read

This avoids the problems of Jupyter's cell model: hidden state, out-of-order execution, and JSON notebook files that are hard to version control.

### Shared Session Model

The editor, console, and output pane all share a single JavaScript runtime session. Code executed in a chunk is visible in the console, and code typed in the console affects the same session state. This is the key to the fluid, interactive feel of RStudio and is a non-negotiable design goal.

### Separation of Concerns

Following RStudio's model, the UI has three loosely coupled panes:

- **Editor** — owns document state (the `.md` file)
- **Console** — owns runtime interaction (REPL)
- **Output pane** — owns rendered results (tables, plots, text)

These communicate through execution events, not tight integration. This keeps the architecture simple and makes each piece independently testable.

---

## Technology Stack

### Editor
**CodeMirror 6** is the preferred editor component.

- First-class support for widget decorations (injecting DOM nodes inline)
- Designed for embedded language modes (JavaScript inside Markdown fences)
- Active development and good documentation
- Better suited than Monaco for a document-centric, output-rich environment

### Data Layer
**Arquero** (v1) → **DuckDB-WASM** (later)

- Arquero provides dplyr-like tabular data manipulation in JavaScript. It is the starting point because it is easy to integrate, its tables are plain JS objects, and it requires no build tools.
- DuckDB-WASM will be introduced later as the persistent storage and query engine for larger data, file I/O (Parquet, CSV, Arrow), and SQL-based workflows.
- Arquero and DuckDB speak Arrow natively, so the transition will not require rewriting user-facing APIs.
- DuckDB is the data layer, not the full compute engine. Non-relational computation (statistical modeling, custom algorithms) remains in JavaScript.

### Visualization
**Observable Plot**

- Grammar-of-graphics inspired, closest JS equivalent to ggplot2
- Made by the D3 team; excellent defaults, composable marks
- Returns an SVG DOM node that can be injected directly into the output pane
- D3.js is available as the low-level escape hatch for custom visualizations

### Runtime Environment
**Browser-first, vanilla JavaScript**

- No framework dependency in v1
- ES6+ modules, native browser APIs
- No build tools required to start (single HTML file or minimal dev server)
- Electron wrapping deferred to a later phase; the browser version should work standalone first

### Frameworks
**None in v1.** State management between panes will use a simple custom pub/sub event pattern (approx. 30 lines). A framework (preferably Svelte, not React) may be introduced later when state complexity justifies it.

---

## UI Layout

```
┌─────────────────────────────────────────────────────┐
│  Toolbar: Open / Save / Run Chunk / Run All          │
├──────────────────────────┬──────────────────────────┤
│                          │                          │
│   Editor Pane            │   Output Pane            │
│   (CodeMirror 6)         │   (tables, plots, text)  │
│   .md file with          │                          │
│   ```js fenced chunks    │                          │
│                          │                          │
├──────────────────────────┴──────────────────────────┤
│  Console / REPL (shared JS session)                  │
└─────────────────────────────────────────────────────┘
```

The layout is resizable panes. The editor and output pane sit side by side (or top/bottom on narrow screens). The console runs across the bottom.

---

## Code Chunk Format

Code chunks follow standard Markdown fenced code block syntax:

````markdown
```js
const data = aq.from([
  { category: "A", value: 10 },
  { category: "B", value: 20 }
])

display(data)
```
````

- Language tag is `js`
- Chunks are extracted by parsing fence boundaries in the document
- A chunk is executed by sending its code to the shared JS runtime

---

## Execution Model

### Chunk Execution
- **Ctrl+Enter** on a line or selection sends it to the console (like RStudio)
- **Ctrl+Shift+Enter** runs the current chunk (the chunk containing the cursor)
- A toolbar button runs all chunks top-to-bottom
- Chunk boundaries are identified by parsing ` ```js ` and ` ``` ` fence markers

### Output Capture
Chunks communicate results to the output pane through a small set of display functions injected into the runtime:

```javascript
display(value)      // auto-detects type: table, plot, or text
displayTable(df)    // renders an Arquero table as HTML table
displayPlot(plot)   // renders an Observable Plot SVG
displayText(str)    // renders plain text or markdown
```

These functions post a message to the output pane, which renders the content. The output pane clears and re-renders on each chunk execution.

### Error Handling
Runtime errors are caught and displayed in the output pane (and console) with a clear error message. A bad chunk should not break the session.

### Session State
All variables declared in chunks or the console persist in the shared session. This mirrors R's global environment model. A "Clear Session" button resets the runtime state.

---

## Filesystem

**v1: File System Access API**

The browser's File System Access API allows opening and saving files via a native file picker, and optionally granting persistent folder access. This is sufficient for v1 and avoids a backend server requirement.

- Open a `.md` file → load into editor
- Save → write back to the same file handle
- No project management or file tree in v1 — single file at a time

**Later: OPFS for DuckDB persistence**

The Origin Private File System will be used to give DuckDB a persistent storage location for `.duckdb` database files, which are not user-visible but survive page refreshes.

---

## Build Phases

### Phase 1 — Runtime and Output (First Priority)

**Goal:** Data flows from Arquero into a visible HTML table in the browser. No editor yet.

- Single `index.html` file, no build tools
- Arquero loaded via CDN script tag
- Hardcoded sample data processed by Arquero
- `displayTable()` function renders result as HTML table in a div
- Observable Plot loaded via CDN; `displayPlot()` renders a chart
- Manual JS execution in browser console to test

**Success criterion:** Load the page, run Arquero code in the browser console, see a table and a plot update in the page.

### Phase 2 — Console / REPL

**Goal:** A working REPL connected to the shared session.

- Textarea or simple input field for code entry
- Code submitted on Shift+Enter
- Output rendered in the output pane
- Error messages displayed clearly
- Session state persists between submissions

**Success criterion:** Type Arquero code into the console, see table output update.

### Phase 3 — Editor Integration

**Goal:** Replace textarea with CodeMirror 6 editor.

- CodeMirror 6 with Markdown mode and JS syntax highlighting inside fences
- Ctrl+Enter sends current line/selection to console
- Ctrl+Shift+Enter extracts and runs current chunk
- Run All button executes all chunks in order

**Success criterion:** Open a `.md` file with JS chunks, run them from the editor, see output.

### Phase 4 — File I/O

**Goal:** Open and save real `.md` files.

- File System Access API integration
- Open button → file picker → load into editor
- Save button → write back to file handle
- Window title shows filename

### Phase 5 — DuckDB Integration

**Goal:** Add DuckDB-WASM as the data engine alongside Arquero.

- DuckDB-WASM loaded and initialized on startup
- SQL chunks (` ```sql `) parsed and routed to DuckDB
- Results returned as Arrow tables, rendered via `displayTable()`
- Arquero can consume DuckDB Arrow output directly
- OPFS used for DuckDB persistence

### Phase 6 — Polish and Electron

**Goal:** Wrap in Electron for desktop deployment.

- Replace DuckDB-WASM with native DuckDB Node.js binding (better performance)
- Replace File System Access API with Node.js `fs` module
- Native file menus (Open, Save, Save As)
- Window management, app packaging
- Cross-platform builds (Mac, Windows, Linux) via Electron Forge

---

## Key Design Decisions and Rationale

| Decision | Rationale |
|---|---|
| Markdown-first, not notebook | Version control friendly, simpler format, better for literate programming |
| Shared session across panes | Essential for fluid interactive feel (the RStudio lesson) |
| Arquero before DuckDB | Faster to prototype; clean migration path via Arrow |
| Browser-first | Fastest iteration cycle; Electron wrapping is straightforward later |
| No framework in v1 | Reduces learning curve; state complexity doesn't justify it yet |
| CodeMirror over Monaco | Better suited for document + output hybrid; widget decorations API |
| Observable Plot over D3 direct | Higher-level API, faster to useful charts; D3 available underneath |
| Output pane separate from editor | Simpler architecture; matches RStudio model users already know |

---

## Out of Scope (v1)

- Statistical modeling (no equivalent of lm, glm, etc.)
- Package management / npm integration
- Multiple files / project management
- Collaborative editing
- Export to HTML/PDF (Quarto-style rendering)
- Inline output decorations within the editor
- Python or R interop

---

## Reference Libraries and CDN Links

```html
<!-- Arquero -->
<script src="https://cdn.jsdelivr.net/npm/arquero@latest/dist/arquero.min.js"></script>

<!-- Observable Plot -->
<script src="https://cdn.jsdelivr.net/npm/@observablehq/plot@latest/dist/plot.umd.min.js"></script>

<!-- CodeMirror 6 (via esm.sh or bundled) -->
<!-- https://codemirror.net/docs/guide/ -->

<!-- DuckDB-WASM (Phase 5) -->
<!-- https://duckdb.org/docs/api/wasm/instantiation -->
```

---

## Prior Art Worth Studying

- **Starboard Notebook** — open source, markdown-first, CodeMirror 6, inline output. Closest existing project to this vision.
- **Observable Framework** — reactive notebook, DuckDB + Plot integration, shows the data flow model.
- **Quarto OJS chunks** — proves the markdown + Observable JS model works well for R users.
