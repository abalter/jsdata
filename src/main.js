// ── CodeMirror 6 ─────────────────────────────────────────────────────────────
import { EditorView, keymap } from '@codemirror/view'
import { EditorState, Prec } from '@codemirror/state'
import { basicSetup } from 'codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { javascript } from '@codemirror/lang-javascript'
import { oneDark } from '@codemirror/theme-one-dark'

// ── Remark (markdown AST) ────────────────────────────────────────────────────
import { unified } from 'unified'
import remarkParse from 'remark-parse'

// ── xterm.js ─────────────────────────────────────────────────────────────────
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

// ── DOM refs ─────────────────────────────────────────────────────────────────
const outputContent = document.getElementById('output-content')
const editorMount   = document.getElementById('editor-content')

// ── Display functions ────────────────────────────────────────────────────────

function clearOutput() {
  outputContent.innerHTML = ''
}

function displayTable(df) {
  const names = df.columnNames()
  const rows  = df.objects()
  const wrapper = document.createElement('div')
  wrapper.className = 'output-block output-table'
  const table = document.createElement('table')
  const thead = table.createTHead()
  const headerRow = thead.insertRow()
  for (const name of names) {
    const th = document.createElement('th')
    th.textContent = name
    headerRow.appendChild(th)
  }
  const tbody = table.createTBody()
  for (const row of rows) {
    const tr = tbody.insertRow()
    for (const name of names) {
      const td = tr.insertCell()
      td.textContent = row[name] == null ? '' : row[name]
    }
  }
  wrapper.appendChild(table)
  outputContent.appendChild(wrapper)
}

function displayPlot(plot) {
  const wrapper = document.createElement('div')
  wrapper.className = 'output-block output-plot'
  wrapper.appendChild(plot)
  outputContent.appendChild(wrapper)
}

function displayText(str) {
  const wrapper = document.createElement('div')
  wrapper.className = 'output-block output-text'
  wrapper.textContent = String(str)
  outputContent.appendChild(wrapper)
}

function display(value) {
  if (value == null) return
  if (typeof value.columnNames === 'function' && typeof value.objects === 'function') {
    displayTable(value)
  } else if (value instanceof Element) {
    displayPlot(value)
  } else if (typeof value === 'string') {
    displayText(value)
  } else {
    displayText(JSON.stringify(value, null, 2))
  }
}

function displayError(err) {
  const wrapper = document.createElement('div')
  wrapper.className = 'output-block output-error'
  wrapper.textContent = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
  outputContent.appendChild(wrapper)
}

Object.assign(window, { display, displayTable, displayPlot, displayText, displayError, clearOutput })

// ── Session state ────────────────────────────────────────────────────────────
const SESSION_VARS = []

function clearSession() {
  clearOutput()
  for (const key of SESSION_VARS) delete window[key]
  SESSION_VARS.length = 0
}

function evalInSession(code) {
  const beforeKeys = new Set(Object.keys(window))
  const transformed = code.replace(/\bconst\b/g, 'var').replace(/\blet\b/g, 'var')
  const result = (0, eval)(transformed)
  for (const key of Object.keys(window)) {
    if (!beforeKeys.has(key) && !SESSION_VARS.includes(key)) {
      SESSION_VARS.push(key)
    }
  }
  return result
}

window.clearSession = clearSession

// ── Chunk detection via remark ───────────────────────────────────────────────

function getChunks(docText) {
  const tree = unified().use(remarkParse).parse(docText)
  return tree.children
    .filter(node => node.type === 'code' && node.lang === 'js')
    .map(node => ({
      code: node.value,
      startLine: node.position.start.line,   // 1-based
      endLine: node.position.end.line,
    }))
}

function getChunkAtLine(docText, line) {
  return getChunks(docText).find(c => line >= c.startLine && line <= c.endLine)
}

// ── Run functions ────────────────────────────────────────────────────────────

function runCode(code, echo = false) {
  let err = null
  try {
    evalInSession(code)
  } catch (e) {
    err = e
    displayError(e)
  }
  if (echo) consoleAppend(code, err)
}

function runChunkAtCursor() {
  const docText = editorView.state.doc.toString()
  const cursorLine = editorView.state.doc.lineAt(editorView.state.selection.main.head).number
  const chunk = getChunkAtLine(docText, cursorLine)
  if (chunk) runCode(chunk.code, true)
}

function runNextChunk() {
  const doc = editorView.state.doc
  const docText = doc.toString()
  const cursorLine = doc.lineAt(editorView.state.selection.main.head).number
  const chunks = getChunks(docText)
  // Find the first chunk that starts after the current cursor line
  const currentChunk = chunks.find(c => cursorLine >= c.startLine && cursorLine <= c.endLine)
  let nextChunk
  if (currentChunk) {
    nextChunk = chunks.find(c => c.startLine > currentChunk.endLine)
  } else {
    nextChunk = chunks.find(c => c.startLine > cursorLine)
  }
  if (!nextChunk) return
  // Move cursor into the next chunk and run it
  const targetLine = doc.line(Math.min(nextChunk.startLine + 1, doc.lines))
  editorView.dispatch({ selection: { anchor: targetLine.from }, scrollIntoView: true })
  runCode(nextChunk.code, true)
}

function runCurrentLine() {
  const doc = editorView.state.doc
  const docText = doc.toString()
  const cursorLine = doc.lineAt(editorView.state.selection.main.head).number
  const chunk = getChunkAtLine(docText, cursorLine)
  if (!chunk) return

  // Lines of code inside the chunk (1-based; chunk fence lines excluded)
  const codeStartLine = chunk.startLine + 1
  const codeLines = chunk.code.split('\n')

  // Cursor position relative to the code lines (0-based index)
  const cursorIdx = cursorLine - codeStartLine
  if (cursorIdx < 0 || cursorIdx >= codeLines.length) return

  // Distinguish incomplete JS (needs more input) from invalid JS (real error).
  // "Unexpected end of input" / "Unexpected token }" at EOI = incomplete.
  function parseStatus(code) {
    try {
      new Function(code)
      return 'complete'
    } catch (e) {
      const msg = e.message.toLowerCase()
      // Incomplete indicators across engines:
      // V8/Chrome: "unexpected end of input"
      // SpiderMonkey/Firefox: "expected expression, got end of script"
      //                       "expected '}'" / "expected ']'" / "expected ')'"
      //                       "unterminated string literal"
      // All engines: "unterminated" anything
      if (
        /unexpected end of input/.test(msg) ||
        /got end of script/.test(msg) ||
        /expected.*[}\])]/.test(msg) ||
        /unterminated/.test(msg)
      ) {
        return 'incomplete'
      }
      return 'invalid'
    }
  }

  // Expand upward from cursor to find statement start
  let startIdx = cursorIdx
  while (startIdx > 0) {
    const candidate = codeLines.slice(startIdx, cursorIdx + 1).join('\n')
    const status = parseStatus(candidate)
    if (status !== 'invalid') break  // complete or incomplete — good start
    startIdx--
  }

  // Expand downward only if the code is incomplete (not invalid)
  let endIdx = cursorIdx
  while (endIdx < codeLines.length - 1) {
    const candidate = codeLines.slice(startIdx, endIdx + 1).join('\n')
    const status = parseStatus(candidate)
    if (status === 'complete') break
    if (status === 'invalid') break  // real error — don't keep expanding
    endIdx++
  }

  const statement = codeLines.slice(startIdx, endIdx + 1).join('\n')
  runCode(statement, true)

  // Move cursor to the next line after the executed statement (within chunk)
  const nextLineNum = codeStartLine + endIdx + 1
  const chunkCodeEndLine = chunk.endLine - 1  // last code line (before closing fence)
  if (nextLineNum <= chunkCodeEndLine) {
    const nextLine = doc.line(nextLineNum)
    editorView.dispatch({
      selection: { anchor: nextLine.from },
      scrollIntoView: true,
    })
  }
}

function runAll() {
  clearOutput()
  const docText = editorView.state.doc.toString()
  for (const chunk of getChunks(docText)) {
    runCode(chunk.code)
  }
}

window.runAll = runAll
window.clearOutput = clearOutput

// ── xterm Console ────────────────────────────────────────────────────────────
const replHistory = []
let historyIdx = -1
let draftText = ''
let currentLine = ''
let cursorPos = 0

const term = new Terminal({
  fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
  fontSize: 13,
  theme: {
    background: '#1e1e2e',
    foreground: '#cdd6f4',
    cursor: '#f5e0dc',
    selectionBackground: '#585b7066',
    green: '#a6e3a1',
    red: '#f38ba8',
    yellow: '#f9e2af',
    cyan: '#94e2d5',
  },
  cursorBlink: true,
  convertEol: true,
})

const fitAddon = new FitAddon()
term.loadAddon(fitAddon)
term.open(document.getElementById('terminal'))
fitAddon.fit()

// Refit on resize
const termContainer = document.getElementById('terminal')
const resizeObs = new ResizeObserver(() => { try { fitAddon.fit() } catch {} })
resizeObs.observe(termContainer)

const PROMPT = '\x1b[36m> \x1b[0m'  // cyan prompt

function writePrompt() {
  term.write(PROMPT)
}

function refreshLine() {
  // Clear current line and rewrite
  term.write('\r' + PROMPT + currentLine + '\x1b[K')
  // Move cursor to correct position
  const back = currentLine.length - cursorPos
  if (back > 0) term.write(`\x1b[${back}D`)
}

function consoleAppend(code, err) {
  const lines = code.trim().split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (i === 0) {
      term.writeln('\x1b[36m> \x1b[0m' + lines[i])
    } else {
      term.writeln('\x1b[36m  \x1b[0m' + lines[i])
    }
  }
  if (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    term.writeln('\x1b[31m' + msg + '\x1b[0m')
  } else {
    term.writeln('\x1b[32m✓\x1b[0m')
  }
  writePrompt()
}

function replRun() {
  const code = currentLine
  currentLine = ''
  cursorPos = 0
  term.write('\r\n')
  if (!code.trim()) { writePrompt(); return }
  replHistory.push(code)
  historyIdx = -1
  draftText = ''
  let err = null
  try { evalInSession(code) } catch (e) { err = e; displayError(e) }
  if (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    term.writeln('\x1b[31m' + msg + '\x1b[0m')
  } else {
    term.writeln('\x1b[32m✓\x1b[0m')
  }
  writePrompt()
}

window.replRun = replRun

term.onData((data) => {
  for (let i = 0; i < data.length; i++) {
    const ch = data[i]
    const code = ch.charCodeAt(0)

    if (ch === '\r' || ch === '\n') {
      // Enter
      replRun()
    } else if (code === 127 || code === 8) {
      // Backspace
      if (cursorPos > 0) {
        currentLine = currentLine.slice(0, cursorPos - 1) + currentLine.slice(cursorPos)
        cursorPos--
        refreshLine()
      }
    } else if (ch === '\x1b' && data[i + 1] === '[') {
      // Escape sequence
      const seq = data[i + 2]
      if (seq === 'A') {
        // Arrow Up - history
        if (replHistory.length > 0) {
          if (historyIdx === -1) { draftText = currentLine; historyIdx = replHistory.length - 1 }
          else if (historyIdx > 0) { historyIdx-- }
          currentLine = replHistory[historyIdx]
          cursorPos = currentLine.length
          refreshLine()
        }
        i += 2
      } else if (seq === 'B') {
        // Arrow Down - history
        if (historyIdx !== -1) {
          if (historyIdx < replHistory.length - 1) { historyIdx++; currentLine = replHistory[historyIdx] }
          else { historyIdx = -1; currentLine = draftText }
          cursorPos = currentLine.length
          refreshLine()
        }
        i += 2
      } else if (seq === 'C') {
        // Arrow Right
        if (cursorPos < currentLine.length) { cursorPos++; term.write('\x1b[C') }
        i += 2
      } else if (seq === 'D') {
        // Arrow Left
        if (cursorPos > 0) { cursorPos--; term.write('\x1b[D') }
        i += 2
      } else if (seq === '3' && data[i + 3] === '~') {
        // Delete key
        if (cursorPos < currentLine.length) {
          currentLine = currentLine.slice(0, cursorPos) + currentLine.slice(cursorPos + 1)
          refreshLine()
        }
        i += 3
      } else {
        i += 2  // skip unknown escape sequences
      }
    } else if (code === 3) {
      // Ctrl+C — copy selection, or clear input if nothing selected
      const sel = term.getSelection()
      if (sel) {
        navigator.clipboard.writeText(sel)
        term.clearSelection()
      } else {
        currentLine = ''
        cursorPos = 0
        term.write('^C\r\n')
        writePrompt()
      }
    } else if (code === 22) {
      // Ctrl+V — paste from clipboard
      navigator.clipboard.readText().then(text => {
        if (!text) return
        const clean = text.replace(/[\r\n]+/g, ' ')
        currentLine = currentLine.slice(0, cursorPos) + clean + currentLine.slice(cursorPos)
        cursorPos += clean.length
        refreshLine()
      })
    } else if (code === 12) {
      // Ctrl+L — clear terminal
      term.clear()
      writePrompt()
      term.write(currentLine)
    } else if (code >= 32) {
      // Printable character
      currentLine = currentLine.slice(0, cursorPos) + ch + currentLine.slice(cursorPos)
      cursorPos++
      refreshLine()
    }
  }
})

// Initial prompt
writePrompt()

// ── Demo document ────────────────────────────────────────────────────────────

const DEMO_DOC = `# Sales Analysis

Explore regional sales data using Arquero and Observable Plot.

\`\`\`js
var data = aq.from([
  { category: "A", value: 10, region: "North" },
  { category: "B", value: 25, region: "South" },
  { category: "C", value: 15, region: "North" },
  { category: "D", value: 30, region: "East"  },
  { category: "E", value: 18, region: "West"  },
])

display(data)
\`\`\`

## Summary by Region

\`\`\`js
var summary = data
  .groupby("region")
  .rollup({ total: aq.op.sum("value") })
  .orderby("region")

display(summary)
\`\`\`

## Visualization

\`\`\`js
var chart = Plot.plot({
  marginLeft: 50,
  style: { background: "transparent", color: "#cdd6f4", fontSize: "12px" },
  marks: [
    Plot.barY(data.objects(), { x: "category", y: "value", fill: "region" }),
    Plot.ruleY([0]),
  ],
})

displayPlot(chart)
\`\`\`
`

function insertChunk() {
  const pos = editorView.state.selection.main.head
  const template = '\n```js\n\n```\n'
  editorView.dispatch({
    changes: { from: pos, insert: template },
    selection: { anchor: pos + 5 },  // cursor inside the empty chunk
  })
  editorView.focus()
}

window.insertChunk = insertChunk

// ── CodeMirror 6 editor ─────────────────────────────────────────────────────

const jsAnalystKeymap = Prec.highest(keymap.of([
  {
    key: 'Ctrl-Enter',
    run() { runCurrentLine(); return true },
  },
  {
    key: 'Ctrl-Shift-Enter',
    run() { runChunkAtCursor(); return true },
  },
  {
    key: 'Ctrl-Shift-n',
    run() { runNextChunk(); return true },
  },
  {
    key: 'Ctrl-Alt-i',
    run() { insertChunk(); return true },
  },
]))

const editorView = new EditorView({
  state: EditorState.create({
    doc: DEMO_DOC,
    extensions: [
      basicSetup,
      markdown({ defaultCodeLanguage: javascript() }),
      oneDark,
      jsAnalystKeymap,
      EditorView.theme({
        '&': { height: '100%', fontSize: '12.5px' },
        '.cm-scroller': { overflow: 'auto', fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace" },
        '.cm-content': { padding: '8px 0' },
      }),
    ],
  }),
  parent: editorMount,
})

// Expose for toolbar buttons
window.runChunkAtCursor = runChunkAtCursor

// ── File I/O ─────────────────────────────────────────────────────────────────

let fileHandle = null
let currentFilename = 'demo.md'
const filenameEl = document.getElementById('filename')

function setFilename(name) {
  currentFilename = name
  filenameEl.textContent = name
  document.title = `${name} — JSAnalyst`
}

const hasNativeFS = typeof window.showOpenFilePicker === 'function'

async function openFile() {
  try {
    if (hasNativeFS) {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.qmd'] } }],
      })
      fileHandle = handle
      const file = await handle.getFile()
      const text = await file.text()
      editorView.dispatch({ changes: { from: 0, to: editorView.state.doc.length, insert: text } })
      setFilename(handle.name)
    } else {
      // Fallback: hidden file input
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.md,.qmd,text/markdown'
      input.onchange = async () => {
        const file = input.files[0]
        if (!file) return
        const text = await file.text()
        editorView.dispatch({ changes: { from: 0, to: editorView.state.doc.length, insert: text } })
        setFilename(file.name)
      }
      input.click()
    }
  } catch (e) {
    if (e.name !== 'AbortError') displayError(e)
  }
}

async function saveFile() {
  try {
    if (hasNativeFS) {
      if (!fileHandle) {
        fileHandle = await window.showSaveFilePicker({
          suggestedName: currentFilename,
          types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.qmd'] } }],
        })
      }
      const writable = await fileHandle.createWritable()
      await writable.write(editorView.state.doc.toString())
      await writable.close()
      setFilename(fileHandle.name)
    } else {
      // Fallback: download
      const blob = new Blob([editorView.state.doc.toString()], { type: 'text/markdown' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = currentFilename
      a.click()
      URL.revokeObjectURL(a.href)
    }
  } catch (e) {
    if (e.name !== 'AbortError') displayError(e)
  }
}

window.openFile = openFile
window.saveFile = saveFile

// Run all on load
runAll()
