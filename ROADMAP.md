# Roadmap

A living document. Entries are brief; detail lives in issues or design sessions.

---

## Near Term

- **Preview: stable chunk identity** — the current preview uses `endLine` as the `chunkOutputs` key, so inserting lines above a chunk causes its key to shift and the preview shows stale or no output. Replace with a content hash or a stable chunk ID assigned at run time.
- **Preview: highlight.js CSS theme** — the preview code blocks use `hljs` class names but no style sheet is loaded; syntax highlighting colors are invisible. Load a highlight.js theme matching the dark IDE palette.
- **`echo` chunk option** — suppress the code echo in the console for `echo=false` chunks (parsing already in place via `parseChunkOptions`; only the console path needs the guard).
- **`print` chunk option** — route a chunk's console-style output to the inline area rather than the xterm pane.
- **Toggle inline / side-pane output** — the view mode flag exists in `next_steps.md` but the switch is not yet wired to a UI control.

---

## Medium Term

- **DuckDB-WASM** — integrate `@duckdb/duckdb-wasm` as an optional data layer. Add `loadParquet()` and `sql\`...\`` template tag helpers. Needs a Web Worker bridge so SQL doesn't block the main thread.
- **Export / publish** — render the document to standalone HTML: inline all outputs as static content, strip the IDE chrome. Preview pane (`renderPreview`) is already the rendering engine; the export path adds CSS inlining and `<script>`-less output. Quarto-compatible metadata block support (`title:`, `author:`, `format:`).
- **Multiple windows / splits** — open the same file in a second editor pane (read-only or live-sync).
- **Shareable document URLs** — encode small documents in a URL hash for sharing self-contained analyses.

---

## Long Term

- **Execution isolation (Phase 9)** — iframe-based isolated scope so user chunks cannot overwrite IDE globals. Either `<iframe sandbox>` with `postMessage` for eval, or the TC39 Compartment API when available. The `const`→`var` rewrite would no longer be needed.
- **Electron wrapper** — package as a desktop app to get native Node.js `fs` and remove the File System Access API requirement. Enables `loadCSV('/absolute/path/to/file.csv')` without a file picker dialog.
- **Native DuckDB binding** — use the Electron/Node build of DuckDB instead of WASM for full SQL performance on large datasets.
- **Language kernels** — R or Python execution via a local subprocess (Electron-only). Would require a proper kernel protocol, possibly Jupyter-compatible.
- **Collaborative editing** — multiple users in the same document via a CRDT (Yjs + CodeMirror binding exists).
