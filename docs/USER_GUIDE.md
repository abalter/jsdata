# JSAnalyst User Guide

JSAnalyst is a browser-based notebook for exploratory data analysis in JavaScript. You write a plain Markdown document that mixes prose with fenced JavaScript code blocks, run those blocks interactively, and see results — tables, charts, or any DOM content — rendered inline in the editor. Arquero, D3, and Observable Plot are available globally without any import statements.

---

## Contents

1. [Getting Started](#getting-started)
2. [Document Format](#document-format)
3. [Chunk Options](#chunk-options)
4. [Running Code](#running-code)
5. [Inline Output](#inline-output)
6. [Console / REPL](#console--repl)
7. [Display Functions](#display-functions)
8. [Data Loading](#data-loading)
9. [Variable Explorer](#variable-explorer)
10. [Preview Pane](#preview-pane)
11. [File Management](#file-management)
12. [Menus](#menus)
13. [Keyboard Shortcuts](#keyboard-shortcuts)
14. [Known Limitations](#known-limitations)

---

## Getting Started

Open the app in a browser. A demo document loads automatically. The layout has two panes:

- **Left** — the CodeMirror editor where you write your Markdown document.
- **Right** — a tabbed panel with Output, Variables, Preview, and (when a variable is opened) View.

Below both panes is an xterm.js console you can hide/show via View → Toggle Console.

### Local development

```
npm install
npm run dev      # Vite dev server at http://localhost:5173/jsdata/
npm test         # vitest (175 tests)
npm run build    # production build to dist/
```

---

## Document Format

Documents are plain Markdown (`.md` or `.qmd`). Prose is standard CommonMark. JavaScript code lives in fenced blocks whose type is determined by the info string:

### Display-only chunk — ` ```js `

```
​```js
const x = aq.from([{a: 1}, {a: 2}])
​```
```

Syntax highlighted. **Never executed.** Appears in the editor with a distinct background. All run commands skip it. Ctrl+Enter inside it is a no-op (falls through to a plain newline).

### Executable chunk — ` ```{js} `

```
​```{js}
const x = aq.from([{a: 1}, {a: 2}])
display(x)
​```
```

Has run buttons ( ⏫ ▶ ⏬ ) on the opening fence line. Execution results appear inline below the closing fence. Ctrl+Enter runs the statement at the cursor. Ctrl+Shift+Enter runs the entire chunk.

---

## Chunk Options

Options are key=value pairs inside the braces, comma-separated:

```
​```{js, eval=false, echo=true, label=loadData}
```

| Option | Type | Default | Effect |
|--------|------|---------|--------|
| `eval` | boolean | `true` | `eval=false` skips the chunk in all run-all paths. Ctrl+Enter and the ▶ button still work as a manual override. |
| `echo` | boolean | `false` | `echo=true` shows the source code above the output in the Preview pane. |
| `label` | string | — | Names the chunk. Parsed and stored; no UI surface yet. |
| `print` | boolean | — | Parsed but **not yet implemented**. |

---

## Running Code

### Run a single statement — Ctrl+Enter

With the cursor inside an executable chunk, Ctrl+Enter evaluates the statement the cursor is on:

- Expands the selection downward until the code forms a complete parse. Multi-line statements (objects, arrays, function bodies) are collected automatically.
- If the cursor is mid-statement, the algorithm walks upward to find the statement's start and then expands to its end.
- After evaluation the cursor advances to the line after the statement's end.
- Inside a display chunk (no braces), Ctrl+Enter inserts a newline normally.

At the top level of the document (outside any chunk), Ctrl+Enter evaluates the statement in the console session.

### Run a chunk — Ctrl+Shift+Enter or ▶ button

Executes all code in the current chunk and renders inline output below its closing fence.

### Run buttons on the opening fence line

| Button | Action |
|--------|--------|
| ⏫ | Run all executable chunks strictly above this chunk |
| ▶ | Run this chunk |
| ⏬ | Run this chunk and all executable chunks below |

### Run All — Ctrl+A

Executes all executable chunks in document order without clearing existing output first.

### Clear + Run All — Ctrl+R

Clears all inline output, the Output tab, and the `chunkOutputs` map, then runs all executable chunks in order.

### eval=false chunks

All run-all paths (`runAll`, `runAllAbove`, `runAllBelow`, Clear+Run All) skip chunks where `eval=false`. Manual execution with ▶ or Ctrl+Shift+Enter still runs them.

---

## Inline Output

Each executable chunk's output is rendered as a block decoration directly below its closing fence line in the editor.

- Output is capped at **400 px** with a vertical scrollbar for taller content.
- A **✕** button appears on hover in the top-right corner to dismiss an individual output block.
- When you edit the document, widget positions are remapped so output stays anchored to its chunk.
- **Inline output is not persisted** to IndexedDB. It disappears on page reload and on file switch; re-run the chunks to restore it.
- `clearOutput()` (or Edit → Clear Session, or Ctrl+R) removes all inline output at once.

---

## Console / REPL

The xterm.js console at the bottom evaluates JavaScript in the same global session as chunks.

| Action | Key |
|--------|-----|
| Submit line | Enter |
| Previous command | ↑ |
| Next command | ↓ |
| Move cursor | ← / → / Home / End |
| Clear current input | Ctrl+C |
| Paste | Ctrl+V |
| Clear terminal buffer | Ctrl+L |

Results appear formatted with ANSI color:

- **Arquero tables** — aligned column display, 10 rows, column type labels.
- **Arrays and objects** — syntax-highlighted tree, up to 20 keys/items shown, depth capped at 3.
- **DOM elements / SVGs** — `[html element]` / `[svg element]` label.
- **Functions** — `[function name]`.
- **Errors** — red, with up to 2 stack frames.
- `undefined` return values are suppressed (no output printed).
- The last expression in a chunk is auto-displayed unless the last statement is an assignment.

---

## Display Functions

These are available on `window` and can be called from any chunk or the console:

| Function | What it renders |
|----------|----------------|
| `display(value)` | Auto-detects: Arquero table → `displayTable`, DOM Element → `displayPlot`, string → `displayText`, anything else → JSON. |
| `displayTable(df)` | Renders an Arquero table as an HTML `<table>` with column headers. |
| `displayPlot(element)` | Appends an SVG or DOM element (e.g. an Observable Plot output). |
| `displayText(str)` | Renders a plain text string. |
| `displayError(err)` | Renders an error message. |
| `clearOutput()` | Clears the Output tab, all inline output, and the preview output cache. |

Output goes to the inline area when called inside a running chunk, or to the Output tab when called from the console.

### CDN globals (no import needed)

| Name | Library |
|------|---------|
| `aq` | [Arquero](https://uwdata.github.io/arquero/) — fast table manipulation |
| `d3` | [D3.js](https://d3js.org/) — scales, shapes, helpers |
| `Plot` | [Observable Plot](https://observablehq.com/plot/) — declarative charts |

---

## Data Loading

Three async helpers are injected into `window` by `createDataIOHelpers`. Call them with `await` inside a chunk or the console.

### `loadCSV(source?)`

```js
const table = await loadCSV()                      // opens a file picker
const table = await loadCSV('https://example.com/data.csv')  // fetch URL
```

- No argument or a non-URL string → shows a file picker dialog.
- A URL string → fetches via `fetch()`.
- Returns an Arquero table with `autoType: true` (numbers and dates are inferred).
- Returns `null` if the user cancels; logs an error and returns `null` on other failures.
- Warns to the console when the file is larger than **10 MB**.

### `loadJSON(source?)`

Same source-selection logic as `loadCSV`. Returns:

- An Arquero table if the JSON is an array of objects.
- A plain JavaScript value for any other JSON shape.

### `loadFile(source?)`

Same source-selection logic. Returns the raw file contents as a string.

---

## Variable Explorer

The **Variables** tab lists every name added to `window` during the current session.

| Column | Content |
|--------|---------|
| Name | Variable name |
| Type | Inferred: `table[r×c]`, `array[n]`, `function`, `null`, `undefined`, `object`, `number`, `string`, `boolean`, or `element` |
| Preview | Truncated value (40 chars) |

- DOM `Element` instances are excluded from the list.
- `updateExplorer()` runs automatically after every `evalInSession()` call and after `clearSession()`.

**Clicking a row** opens the variable in the hidden **View** tab:

- **Arquero tables** render as a sortable HTML table. Click any column header to sort by that column (click again to reverse). Null values always sort last.
- **All other values** render as a collapsible JSON tree with color-coded keys and values. Nodes at depth ≥ 2 collapse by default. Collections with more than 200 children render lazily (a "Load more" link appears).

---

## Preview Pane

The **Preview** tab renders the entire document as clean HTML, combining formatted prose with chunk outputs.

Click **Refresh Preview** (View → Refresh Preview or Ctrl+P) to update it.

### How the preview works

| Segment | Treatment |
|---------|-----------|
| Prose (Markdown) | Rendered by `marked`, sanitized by DOMPurify |
| Display chunk (` ```js `) | Syntax-highlighted code block inside a collapsible `<details open>` |
| Executable chunk — already run | Captured output HTML, sanitized by DOMPurify |
| Executable chunk — not yet run | `▷ Not yet run` placeholder |

### echo=true

Adding `echo=true` to an executable chunk's options shows its source code in a collapsible `<details>` block labeled "source" above its output in the preview.

### Notes

- The preview captures the output HTML **before** the inline ✕ close button is injected, so closing an inline output widget does not affect the preview.
- Preview output is keyed by the chunk's closing fence line number. If you insert or delete lines above a chunk after running it, the preview may show stale or missing output until you re-run that chunk and refresh.

---

## File Management

### Persistence layers

| Layer | When | What |
|-------|------|------|
| IndexedDB autosave | 2 seconds after last keystroke | Document text, file name, `runOnOpen` flag |
| File System Access API (FSAPI) | On explicit Save | Writes to the original file on disk |
| `<a download>` fallback | Save when FSAPI is unavailable | Browser download dialog |

FSAPI is available in Chrome and Edge. Firefox and Safari use the download fallback for Save and a `<input type=file>` dialog for Open.

### File status

| Status | Meaning |
|--------|---------|
| `UNTITLED` | New file, never saved to disk |
| `CLEAN` | No unsaved changes |
| `DIRTY` | Modified since last disk save |
| `SAVING` | Disk write in progress (prevents concurrent saves) |

The window title shows the current file name with a `•` prefix when the file is dirty.

### Actions

| Action | Shortcut | Notes |
|--------|----------|-------|
| New | Ctrl+N | Prompts if current file has unsaved changes |
| Open | Ctrl+O | FSAPI picker or `<input type=file>` fallback; accepts `.md`, `.qmd` |
| Save | Ctrl+S | Saves to disk if a file handle exists; falls back to Save As |
| Save As | Ctrl+Shift+S | Always opens a picker / download dialog |
| Close | File → Close | Prompts (Save / Don't Save / Cancel) if the file is dirty or is an untitled file with content |

### Multiple files

Open files are shown as tabs above the editor. Clicking a tab switches to that file. The switch:

1. Persists the current file to IndexedDB.
2. Clears inline output and the Output tab.
3. Loads the new file's content into the editor.
4. Runs the new file if **Run on Open** is enabled for it.

Closing the last open file creates a blank untitled file automatically.

### Run on Open

A per-file toggle in the Run menu. When enabled, all executable chunks in the file run automatically every time the file is loaded. The state is persisted to IndexedDB.

---

## Menus

### File

| Item | Action |
|------|--------|
| New | Create a blank untitled document |
| Open | Open a file from disk |
| Save | Save the current file to disk |
| Save As | Save to a new location / download |
| Close | Close the current file |

### Edit

| Item | Action |
|------|--------|
| Undo | Undo last editor change |
| Redo | Redo last editor change |
| Insert Chunk | Insert an empty ` ```{js} ` block at the cursor |
| Clear Session | Delete all session variables and clear all output |

### Run

| Item | Action |
|------|--------|
| Run Current Line | Ctrl+Enter — run statement at cursor |
| Run Current Chunk | Ctrl+Shift+Enter — run the whole chunk |
| Run All | Execute all executable chunks in order |
| Clear + Run All | Clear output, then run all |
| Run All Above | Run all executable chunks above the cursor |
| Run All Below | Run this and all executable chunks below |
| Run on Open | Toggle auto-run for the current file (checkbox, per-file) |

### View

| Item | Action |
|------|--------|
| Toggle Console | Show or hide the xterm console panel |
| Toggle Output Pane | Show or hide the entire right pane |
| Refresh Preview | Render the current document into the Preview tab |

### Help

| Item | Action |
|------|--------|
| Keyboard Shortcuts | Opens a reference dialog listing all shortcuts |

---

## Keyboard Shortcuts

### Always active (regardless of focus)

| Action | Shortcut |
|--------|----------|
| New file | Ctrl+N |
| Open file | Ctrl+O |
| Save | Ctrl+S |
| Save As | Ctrl+Shift+S |

### Active when editor or terminal does not have focus

| Action | Shortcut |
|--------|----------|
| Insert chunk | Ctrl+Alt+I |
| Run all | Ctrl+A |
| Clear + Run all | Ctrl+R |
| Refresh preview | Ctrl+P |

### CodeMirror editor shortcuts (editor must have focus)

| Action | Shortcut |
|--------|----------|
| Run statement at cursor | Ctrl+Enter |
| Run current chunk | Ctrl+Shift+Enter |
| Insert chunk | Ctrl+Alt+I |
| Undo | Ctrl+Z |
| Redo | Ctrl+Shift+Z |

### Console shortcuts (console must have focus)

| Action | Shortcut |
|--------|----------|
| Submit input | Enter |
| Previous history | ↑ |
| Next history | ↓ |
| Clear current line | Ctrl+C |
| Paste | Ctrl+V |
| Clear buffer | Ctrl+L |

---

## Known Limitations

**Preview chunk identity** — the preview links outputs to chunks by their closing fence line number. Inserting or deleting lines above a chunk after running it shifts the key, so the preview shows stale or missing output for that chunk. Workaround: re-run affected chunks and refresh the preview.

**Preview syntax highlighting colors** — highlight.js CSS theme is not currently loaded. Syntax class names are present in the HTML but appear unstyled.

**`echo=false` console suppression** — the `echo` option is parsed and controls source display in the preview, but it does not yet suppress the code echo in the xterm console.

**`print` chunk option** — parsed and stored but has no effect. Planned to route a chunk's output to the inline area only, bypassing the console.

**Session isolation** — all chunks and the console share the global `window` scope. There is no isolation between files: a variable defined in one file's chunk is visible in another file's chunk in the same browser tab. Variables persist across file switches but are cleared on page reload.

**`const` / `let` rewriting** — the eval harness rewrites `const` and `let` to `var` via regex so variables persist across calls. Complex destructuring or edge-case declarations may not rewrite correctly.

**Inline output not persisted** — IndexedDB saves the document text only. Inline output must be regenerated by re-running chunks after a page reload.

**File System Access API** — full save-to-disk support requires Chrome or Edge. Firefox and Safari fall back to a browser download, which requires manually placing the downloaded file back in the desired location.
