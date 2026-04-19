# Roadmap

A living document. Entries are brief; detail lives in issues or design sessions.

---

## Near Term

- **Unit tests** — Vitest suite for `ctrlEnter.js`, `formatForConsole`, `getChunks`/`parseChunkOptions`, and `fileManager.js` pure logic. Currently only `ctrlEnter.js` has tests.
- **Toggle inline / side-pane output** — the view mode flag exists in `next_steps.md` but the switch is not yet wired to a UI control.
- **`echo` chunk option** — suppress the code echo in the console for `echo=false` chunks (parsing is already in place via `parseChunkOptions`).
- **`print` chunk option** — route a chunk's console-style output to the inline area rather than the xterm pane.

---

## Medium Term

- **DuckDB-WASM** — integrate `@duckdb/duckdb-wasm` as an optional data layer. Add `loadParquet()` and `sql\`...\`` template tag helpers. Needs a Web Worker bridge so SQL doesn't block the main thread.
- **HTML preview tab** — a fourth tab in the output panel that renders arbitrary HTML strings. Useful for templated reports.
- **Multiple windows / splits** — open the same file in a second editor pane (read-only or live-sync).
- **Export / publish** — render the document to standalone HTML: inline all outputs as static content, strip the IDE chrome. Quarto-compatible metadata block support (`title:`, `author:`, `format:`).
- **Shareable document URLs** — encode small documents in a URL hash for sharing self-contained analyses.

---

## Long Term

- **Execution isolation (Phase 9)** — iframe-based isolated scope so user chunks cannot overwrite IDE globals. Either `<iframe sandbox>` with `postMessage` for eval, or the TC39 Compartment API when available. The `const`→`var` rewrite would no longer be needed.
- **Electron wrapper** — package as a desktop app to get native Node.js `fs` and remove the File System Access API requirement. Enables `loadCSV('/absolute/path/to/file.csv')` without a file picker dialog.
- **Native DuckDB binding** — use the Electron/Node build of DuckDB instead of WASM for full SQL performance on large datasets.
- **Language kernels** — R or Python execution via a local subprocess (Electron-only). Would require a proper kernel protocol, possibly Jupyter-compatible.
- **Collaborative editing** — multiple users in the same document via a CRDT (Yjs + CodeMirror binding exists).
