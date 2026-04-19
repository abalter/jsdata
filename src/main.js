// ── CodeMirror 6 ─────────────────────────────────────────────────────────────
import { EditorView, keymap } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { basicSetup } from 'codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { javascript } from '@codemirror/lang-javascript'
import { oneDark } from '@codemirror/theme-one-dark'

// ── Remark (markdown AST) ────────────────────────────────────────────────────
import { unified } from 'unified'
import remarkParse from 'remark-parse'

// ── DOM refs ─────────────────────────────────────────────────────────────────
const outputContent = document.getElementById('output-content')
const consoleOutput = document.getElementById('console-output')
const consoleInput  = document.getElementById('console-input')
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

function runCode(code) {
  try {
    evalInSession(code)
  } catch (err) {
    displayError(err)
  }
}

function runChunkAtCursor() {
  const docText = editorView.state.doc.toString()
  const cursorLine = editorView.state.doc.lineAt(editorView.state.selection.main.head).number
  const chunk = getChunkAtLine(docText, cursorLine)
  if (chunk) runCode(chunk.code)
}

function runCurrentLine() {
  const line = editorView.state.doc.lineAt(editorView.state.selection.main.head)
  runCode(line.text)
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

// ── REPL ─────────────────────────────────────────────────────────────────────
const replHistory = []
let historyIdx = -1
let drafText = ''

function consoleAppend(code, err) {
  const entry = document.createElement('div')
  entry.className = 'console-entry'
  const inputLine = document.createElement('div')
  inputLine.className = 'console-entry-input'
  inputLine.textContent = code.trim()
  entry.appendChild(inputLine)
  if (err) {
    const errLine = document.createElement('div')
    errLine.className = 'console-entry-error'
    errLine.textContent = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    entry.appendChild(errLine)
  } else {
    const okLine = document.createElement('div')
    okLine.className = 'console-entry-ok'
    okLine.textContent = '✓'
    entry.appendChild(okLine)
  }
  consoleOutput.appendChild(entry)
  consoleOutput.scrollTop = consoleOutput.scrollHeight
}

function replRun() {
  const code = consoleInput.value
  if (!code.trim()) return
  replHistory.push(code)
  historyIdx = -1
  drafText = ''
  let err = null
  try { evalInSession(code) } catch (e) { err = e; displayError(e) }
  consoleAppend(code, err)
  consoleInput.value = ''
  consoleInput.focus()
}

window.replRun = replRun

consoleInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); replRun(); return }
  if (e.key === 'ArrowUp') {
    if (replHistory.length === 0) return
    e.preventDefault()
    if (historyIdx === -1) { drafText = consoleInput.value; historyIdx = replHistory.length - 1 }
    else if (historyIdx > 0) { historyIdx-- }
    consoleInput.value = replHistory[historyIdx]
    consoleInput.selectionStart = consoleInput.selectionEnd = consoleInput.value.length
    return
  }
  if (e.key === 'ArrowDown') {
    if (historyIdx === -1) return
    e.preventDefault()
    if (historyIdx < replHistory.length - 1) { historyIdx++; consoleInput.value = replHistory[historyIdx] }
    else { historyIdx = -1; consoleInput.value = drafText }
    consoleInput.selectionStart = consoleInput.selectionEnd = consoleInput.value.length
    return
  }
  historyIdx = -1
})

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

// ── CodeMirror 6 editor ─────────────────────────────────────────────────────

const jsAnalystKeymap = keymap.of([
  {
    key: 'Ctrl-Enter',
    run() { runCurrentLine(); return true },
  },
  {
    key: 'Ctrl-Shift-Enter',
    run() { runChunkAtCursor(); return true },
  },
])

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

// Run all on load
runAll()
