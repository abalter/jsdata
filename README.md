# JSAnalyst

A browser-based data analysis IDE in the RMarkdown/Quarto style. Write prose and executable JavaScript in the same Markdown document, run code statement-by-statement or in bulk, and see results rendered inline — tables, charts, and text anchored directly below each code chunk.

**[Live demo → https://abalter.github.io/jsdata/](https://abalter.github.io/jsdata/)**

---

## Features

- **Markdown-first source** — documents are plain `.md` files, readable without the IDE
- **Shared session** — variables defined in one chunk are available in all subsequent chunks
- **Inline output** — tables and charts appear below each chunk, like a notebook, with close buttons and position remapping as you edit
- **Ctrl+Enter multi-line execution** — runs the complete statement at the cursor (acorn-powered), even when the cursor is mid-statement inside a large object or array literal
- **RMarkdown-style chunk options** — `` ```{js, eval=false} `` skips a chunk in Run All; manual Ctrl+Enter still works
- **xterm.js console** — real terminal with ANSI colors, command history, cursor editing, Ctrl+C/V/L
- **Variable explorer** — live table of session variables with sortable data view and collapsible JSON tree
- **Multi-file tabs** — IndexedDB autosave, File System Access API save-to-disk, Run on Open per file
- **Shoelace menubar** — File / Edit / Run / View / Help menus with keyboard shortcuts modal
- **No install required** — runs entirely in the browser; data layer (Arquero, D3, Observable Plot) loaded from CDN

---

## Quick Start

Just visit **[https://abalter.github.io/jsdata/](https://abalter.github.io/jsdata/)** — no install, no account, no server.

The demo document runs automatically and shows what the IDE can do. Open a local `.md` file with File → Open (or Ctrl+O), or start a new one with File → New (Ctrl+N).

---

## Local Development

```bash
git clone https://github.com/abalter/jsdata
cd jsdata
npm install
npm run dev
```

Then open `http://localhost:5173` (Vite's default port).

### Running tests

```bash
npm test
```

Tests use [Vitest](https://vitest.dev/) and run entirely in Node — no browser, no build step needed.

### Building

```bash
npm run build
```

Output goes to `dist/`. The build is what GitHub Actions deploys to GitHub Pages.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Build | [Vite 8](https://vite.dev/) |
| Editor | [CodeMirror 6](https://codemirror.net/) with Markdown + JS syntax |
| Terminal | [xterm.js](https://xtermjs.org/) with FitAddon |
| Data layer | [Arquero](https://uwdata.github.io/arquero/) (CDN) |
| Visualization | [Observable Plot](https://observablehq.com/plot/) + [D3](https://d3js.org/) (CDN) |
| UI components | [Shoelace](https://shoelace.style/) web components |
| Keyboard shortcuts | [tinykeys](https://github.com/jamiebuilds/tinykeys) |
| JS parser | [acorn](https://github.com/acornjs/acorn) (Ctrl+Enter statement detection) |
| Markdown parser | [remark](https://remark.js.org/) (chunk detection) |
| Tests | [Vitest](https://vitest.dev/) |

---

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for a full module inventory, data-flow diagram, and explanation of key design decisions.

---

## Repository

`https://github.com/abalter/jsdata`