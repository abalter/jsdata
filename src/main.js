// ── CodeMirror 6 ─────────────────────────────────────────────────────────────
import { EditorView, keymap, Decoration, ViewPlugin, WidgetType } from '@codemirror/view'
import { EditorState, Prec, RangeSet, StateField, StateEffect } from '@codemirror/state'
import { basicSetup } from 'codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { javascript } from '@codemirror/lang-javascript'
import { oneDark } from '@codemirror/theme-one-dark'
import { undo as cmUndo, redo as cmRedo } from '@codemirror/commands'

// ── xterm.js ─────────────────────────────────────────────────────────────────
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import * as FM from './fileManager.js'
import { createDataIOHelpers } from './dataIO.js'
import * as Actions from './actions.js'
import { registerShortcuts } from './shortcuts.js'
import { createCtrlEnterExtension } from './ctrlEnter.js'
import { getChunks, getChunkAtLine, ChunkType } from './chunkDetection.js'
import { renderPreview } from './preview.js'

// ── Shoelace web components ───────────────────────────────────────────────────
import '@shoelace-style/shoelace/dist/components/dropdown/dropdown.js'
import '@shoelace-style/shoelace/dist/components/menu/menu.js'
import '@shoelace-style/shoelace/dist/components/menu-item/menu-item.js'
import '@shoelace-style/shoelace/dist/components/divider/divider.js'
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js'
import { setBasePath } from '@shoelace-style/shoelace/dist/utilities/base-path.js'
setBasePath('https://cdn.jsdelivr.net/npm/@shoelace-style/shoelace@2/dist/')

// ── DOM refs ─────────────────────────────────────────────────────────────────
const outputContent = document.getElementById('output-content')
const editorMount   = document.getElementById('editor-content')

// ── Inline output state ──────────────────────────────────────────────────────
const inlineOutputs = new Map()           // doc position → DOM container
const pendingInlineOutputs = []           // { endLine, dom } awaiting flush

// ── Preview output state ─────────────────────────────────────────────────────
const chunkOutputs = new Map()            // endLine (1-based) → innerHTML
const setInlineOutput = StateEffect.define()
const clearInlineOutputs = StateEffect.define()

// ── Display functions ────────────────────────────────────────────────────────

// Inline output capture: during chunk execution, display calls are captured here
let captureTarget = null  // null = output pane, DOM element = capture into it

function clearOutput() {
  outputContent.innerHTML = ''
  chunkOutputs.clear()
  if (inlineOutputs.size > 0 && typeof editorView !== 'undefined') {
    inlineOutputs.clear()
    editorView.dispatch({ effects: clearInlineOutputs.of(null) })
  }
}

function getDisplayTarget() {
  return captureTarget || outputContent
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
  getDisplayTarget().appendChild(wrapper)
}

function displayPlot(plot) {
  const wrapper = document.createElement('div')
  wrapper.className = 'output-block output-plot'
  wrapper.appendChild(plot)
  getDisplayTarget().appendChild(wrapper)
}

function displayText(str) {
  const wrapper = document.createElement('div')
  wrapper.className = 'output-block output-text'
  wrapper.textContent = String(str)
  getDisplayTarget().appendChild(wrapper)
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
  getDisplayTarget().appendChild(wrapper)
}

Object.assign(window, { display, displayTable, displayPlot, displayText, displayError, clearOutput })

// ── Session state ────────────────────────────────────────────────────────────
const SESSION_VARS = []
const varsContent = document.getElementById('vars-content')

function clearSession() {
  clearOutput()
  for (const key of SESSION_VARS) delete window[key]
  SESSION_VARS.length = 0
  updateExplorer()
  term.writeln('\x1b[90mSession cleared.\x1b[0m')
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
  updateExplorer()
  return result
}

// ── Variable Explorer ────────────────────────────────────────────────────────

function varType(val) {
  if (val === null) return 'null'
  if (val === undefined) return 'undefined'
  if (Array.isArray(val)) return `array[${val.length}]`
  if (typeof val === 'object' && typeof val.columnNames === 'function') {
    const nr = typeof val.numRows === 'function' ? val.numRows() : '?'
    const nc = val.columnNames().length
    return `table[${nr}×${nc}]`
  }
  if (val instanceof Element) return 'element'
  return typeof val
}

function varPreview(val) {
  if (val === null) return 'null'
  if (val === undefined) return 'undefined'
  if (typeof val === 'string') return val.length > 40 ? `"${val.slice(0, 37)}…"` : `"${val}"`
  if (typeof val === 'number' || typeof val === 'boolean') return String(val)
  if (Array.isArray(val)) return `[${val.slice(0, 3).join(', ')}${val.length > 3 ? ', …' : ''}]`
  if (typeof val === 'object' && typeof val.columnNames === 'function') {
    return val.columnNames().join(', ')
  }
  if (val instanceof Element) return `<${val.tagName.toLowerCase()}>`
  if (typeof val === 'function') return `ƒ ${val.name || 'anon'}()`
  try { const s = JSON.stringify(val); return s.length > 40 ? s.slice(0, 37) + '…' : s }
  catch { return '{…}' }
}

function updateExplorer() {
  const vars = SESSION_VARS.filter(name => !(window[name] instanceof Element))
  if (vars.length === 0) {
    varsContent.innerHTML = '<div style="color:var(--text-dim);padding:12px;font-size:11px;">No variables in session</div>'
    return
  }
  const rows = vars.map(name => {
    const val = window[name]
    return `<tr data-var="${name}">
      <td class="var-name">${name}</td>
      <td class="var-type">${varType(val)}</td>
      <td class="var-preview">${varPreview(val)}</td>
    </tr>`
  }).join('')
  varsContent.innerHTML = `<table class="vars-table">
    <thead><tr><th>Name</th><th>Type</th><th>Preview</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`
  // Click row to open in View tab
  varsContent.querySelectorAll('tr[data-var]').forEach(tr => {
    tr.addEventListener('click', () => viewVariable(tr.dataset.var))
  })
}

// ── View tab ─────────────────────────────────────────────────────────────────
const viewContent = document.getElementById('view-content')
const viewTabBtn = document.getElementById('view-tab-btn')

function viewVariable(name) {
  const val = window[name]
  viewContent.innerHTML = ''

  // Show the View tab button and switch to it
  viewTabBtn.style.display = ''
  viewTabBtn.textContent = `View: ${name}`
  viewTabBtn.click()

  if (val && typeof val.columnNames === 'function' && typeof val.objects === 'function') {
    renderSortableTable(name, val)
  } else {
    renderJsonTree(name, val)
  }
}

// ── Sortable table for Arquero ───────────────────────────────────────────────

function renderSortableTable(name, df) {
  const cols = df.columnNames()
  const rows = df.objects()
  const nr = typeof df.numRows === 'function' ? df.numRows() : rows.length

  const header = document.createElement('div')
  header.className = 'view-header'
  header.innerHTML = `<span class="view-name">${name}</span><span class="view-dims">${nr} rows × ${cols.length} cols</span>`

  const wrap = document.createElement('div')
  wrap.className = 'view-table-wrap'

  const table = document.createElement('table')
  table.className = 'view-table'

  let sortCol = null
  let sortAsc = true

  function render(data) {
    table.innerHTML = ''
    const thead = table.createTHead()
    const hr = thead.insertRow()
    for (const col of cols) {
      const th = document.createElement('th')
      let arrow = ''
      if (col === sortCol) arrow = `<span class="sort-arrow">${sortAsc ? '▲' : '▼'}</span>`
      th.innerHTML = col + arrow
      th.addEventListener('click', () => {
        if (sortCol === col) { sortAsc = !sortAsc } else { sortCol = col; sortAsc = true }
        const sorted = [...data].sort((a, b) => {
          const av = a[col], bv = b[col]
          if (av == null && bv == null) return 0
          if (av == null) return 1
          if (bv == null) return -1
          if (typeof av === 'number' && typeof bv === 'number') return sortAsc ? av - bv : bv - av
          return sortAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av))
        })
        render(sorted)
      })
      hr.appendChild(th)
    }
    const tbody = table.createTBody()
    for (const row of data) {
      const tr = tbody.insertRow()
      for (const col of cols) {
        const td = tr.insertCell()
        td.textContent = row[col] == null ? '' : row[col]
      }
    }
  }

  render(rows)
  viewContent.append(header, wrap)
  wrap.appendChild(table)
}

// ── JSON tree viewer ─────────────────────────────────────────────────────────

function renderJsonTree(name, val) {
  const header = document.createElement('div')
  header.className = 'view-header'
  header.innerHTML = `<span class="view-name">${name}</span><span class="view-dims">${typeof val}</span>`

  const tree = document.createElement('div')
  tree.className = 'json-tree'
  const ul = document.createElement('ul')
  buildJsonNode(ul, val, 0)
  tree.appendChild(ul)

  viewContent.append(header, tree)
}

function buildJsonNode(parent, val, depth) {
  if (val === null || val === undefined || typeof val !== 'object') {
    const li = document.createElement('li')
    li.className = 'json-node'
    li.innerHTML = formatPrimitive(val)
    parent.appendChild(li)
    return
  }

  const isArr = Array.isArray(val)
  const entries = isArr ? val.map((v, i) => [i, v]) : Object.entries(val)
  const openBr = isArr ? '[' : '{'
  const closeBr = isArr ? ']' : '}'

  for (const [key, child] of entries) {
    const li = document.createElement('li')
    li.className = 'json-node'

    if (child !== null && child !== undefined && typeof child === 'object') {
      const childEntries = Array.isArray(child) ? child : Object.keys(child)
      const count = childEntries.length
      const childOpen = Array.isArray(child) ? '[' : '{'
      const childClose = Array.isArray(child) ? ']' : '}'

      const toggle = document.createElement('span')
      toggle.className = 'json-toggle'
      toggle.textContent = '▼'

      const keySpan = isArr
        ? `<span class="json-num">${key}</span>: `
        : `<span class="json-key">"${key}"</span>: `

      li.innerHTML = ''
      li.appendChild(toggle)
      const label = document.createElement('span')
      label.innerHTML = `${keySpan}<span class="json-bracket">${childOpen}</span>`
      li.appendChild(label)

      const ellipsis = document.createElement('span')
      ellipsis.className = 'json-ellipsis'
      ellipsis.textContent = ` ${count} items… `
      li.appendChild(ellipsis)

      const ul = document.createElement('ul')
      // Lazy: only build children if fewer than 200, otherwise build on first expand
      if (count <= 200) {
        buildJsonNode(ul, child, depth + 1)
      } else {
        let built = false
        toggle.addEventListener('click', () => {
          if (!built) { buildJsonNode(ul, child, depth + 1); built = true }
        }, { once: true })
      }
      li.appendChild(ul)

      const closeLi = document.createElement('span')
      closeLi.innerHTML = `<span class="json-bracket">${childClose}</span>`
      li.appendChild(closeLi)

      // Collapse by default beyond depth 2
      if (depth >= 2) li.classList.add('json-collapsed')

      toggle.addEventListener('click', () => {
        li.classList.toggle('json-collapsed')
        toggle.textContent = li.classList.contains('json-collapsed') ? '▶' : '▼'
      })
    } else {
      const keySpan = isArr
        ? `<span class="json-num">${key}</span>: `
        : `<span class="json-key">"${key}"</span>: `
      li.innerHTML = `<span style="display:inline-block;width:14px"></span>${keySpan}${formatPrimitive(child)}`
    }
    parent.appendChild(li)
  }
}

function formatPrimitive(val) {
  if (val === null) return '<span class="json-null">null</span>'
  if (val === undefined) return '<span class="json-null">undefined</span>'
  if (typeof val === 'string') return `<span class="json-str">"${escapeHtml(val)}"</span>`
  if (typeof val === 'number') return `<span class="json-num">${val}</span>`
  if (typeof val === 'boolean') return `<span class="json-bool">${val}</span>`
  if (typeof val === 'function') return `<span class="json-null">ƒ ${val.name || 'anon'}()</span>`
  return `<span class="json-null">${escapeHtml(String(val))}</span>`
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

window.clearSession = clearSession

// ── Run functions ────────────────────────────────────────────────────────────

function runCode(code, echo = false, endLine = null) {
  let container = null
  if (endLine !== null) {
    container = document.createElement('div')
    container.className = 'chunk-output'
    captureTarget = container
  }

  let err = null
  let result
  try {
    result = evalInSession(code)
  } catch (e) {
    err = e
    displayError(e)
  }

  // Auto-display last expression value if no explicit output was produced
  // Skip assignments — the value is stored in the variable; showing it implicitly
  // would be noisy and could be huge (e.g. a 10 000-element array).
  if (container && container.children.length === 0 && err === null &&
      result !== undefined && !isAssignment(code)) {
    display(result)
  }

  captureTarget = null

  if (container && container.children.length > 0) {
    // Capture output for preview pane (before close button is prepended)
    chunkOutputs.set(endLine, container.innerHTML)

    // Add close button to clear this inline output
    const closeBtn = document.createElement('button')
    closeBtn.className = 'chunk-output-close'
    closeBtn.title = 'Clear output'
    closeBtn.textContent = '✕'
    closeBtn.onclick = () => {
      const pos = [...inlineOutputs.entries()].find(([, dom]) => dom === container)?.[0]
      if (pos !== undefined) {
        inlineOutputs.delete(pos)
        editorView.dispatch({ effects: setInlineOutput.of({ pos, dom: null }) })
      }
    }
    container.prepend(closeBtn)
    pendingInlineOutputs.push({ endLine, dom: container })
  }

  if (echo) consoleAppend(code, err, result)
}

function flushInlineOutputs() {
  if (pendingInlineOutputs.length === 0) return
  const effects = pendingInlineOutputs.map(({ endLine, dom }) => {
    const pos = editorView.state.doc.line(endLine).to
    return setInlineOutput.of({ pos, dom })
  })
  pendingInlineOutputs.length = 0
  editorView.dispatch({ effects })
  editorView.requestMeasure()
}

function runChunkAtCursor() {
  const docText = editorView.state.doc.toString()
  const cursorLine = editorView.state.doc.lineAt(editorView.state.selection.main.head).number
  const chunk = getChunkAtLine(docText, cursorLine)
  if (chunk && chunk.type === ChunkType.EXECUTABLE && chunk.options.eval !== false)
    runCode(chunk.code, true, chunk.endLine)
  flushInlineOutputs()
}

function runNextChunk() {
  const doc = editorView.state.doc
  const docText = doc.toString()
  const cursorLine = doc.lineAt(editorView.state.selection.main.head).number
  // Only consider executable chunks for navigation and execution
  const chunks = getChunks(docText).filter(c => c.type === ChunkType.EXECUTABLE)
  const currentChunk = chunks.find(c => cursorLine >= c.startLine && cursorLine <= c.endLine)
  let nextChunk
  if (currentChunk) {
    nextChunk = chunks.find(c => c.startLine > currentChunk.endLine)
  } else {
    nextChunk = chunks.find(c => c.startLine > cursorLine)
  }
  if (!nextChunk) return
  const targetLine = doc.line(Math.min(nextChunk.startLine + 1, doc.lines))
  editorView.dispatch({ selection: { anchor: targetLine.from }, scrollIntoView: true })
  if (nextChunk.options.eval !== false) runCode(nextChunk.code, true, nextChunk.endLine)
  flushInlineOutputs()
}

function runAll() {
  clearOutput()
  const docText = editorView.state.doc.toString()
  for (const chunk of getChunks(docText)) {
    if (chunk.type === ChunkType.EXECUTABLE && chunk.options.eval !== false)
      runCode(chunk.code, false, chunk.endLine)
  }
  flushInlineOutputs()
}

function runChunkByLine(startLine) {
  const docText = editorView.state.doc.toString()
  const chunk = getChunkAtLine(docText, startLine)
  if (chunk && chunk.type === ChunkType.EXECUTABLE && chunk.options.eval !== false)
    runCode(chunk.code, true, chunk.endLine)
  flushInlineOutputs()
}

function runAllAbove(startLine) {
  const docText = editorView.state.doc.toString()
  for (const chunk of getChunks(docText)) {
    if (chunk.startLine >= startLine) break
    if (chunk.type === ChunkType.EXECUTABLE && chunk.options.eval !== false)
      runCode(chunk.code, false, chunk.endLine)
  }
  flushInlineOutputs()
}

function runAllBelow(startLine) {
  const docText = editorView.state.doc.toString()
  for (const chunk of getChunks(docText)) {
    if (chunk.startLine >= startLine &&
        chunk.type === ChunkType.EXECUTABLE &&
        chunk.options.eval !== false)
      runCode(chunk.code, false, chunk.endLine)
  }
  flushInlineOutputs()
}

function runAllAboveCursor() {
  const line = editorView.state.doc.lineAt(editorView.state.selection.main.head).number
  runAllAbove(line)
}

function runAllBelowCursor() {
  const line = editorView.state.doc.lineAt(editorView.state.selection.main.head).number
  runAllBelow(line)
}

window.runAll = runAll
window.clearOutput = clearOutput

// ── Chunk widget decorations ─────────────────────────────────────────────────

class ChunkButtonsWidget extends WidgetType {
  constructor(startLine) { super(); this.startLine = startLine }

  eq(other) { return this.startLine === other.startLine }

  toDOM() {
    const wrap = document.createElement('span')
    wrap.className = 'chunk-buttons'
    wrap.setAttribute('aria-hidden', 'true')

    const runAbove = document.createElement('button')
    runAbove.className = 'chunk-btn'
    runAbove.title = 'Run all above'
    runAbove.textContent = '⏫'
    runAbove.onmousedown = (e) => { e.preventDefault(); runAllAbove(this.startLine) }

    const run = document.createElement('button')
    run.className = 'chunk-btn chunk-btn-run'
    run.title = 'Run chunk'
    run.textContent = '▶'
    run.onmousedown = (e) => { e.preventDefault(); runChunkByLine(this.startLine) }

    const runBelow = document.createElement('button')
    runBelow.className = 'chunk-btn'
    runBelow.title = 'Run this and below'
    runBelow.textContent = '⏬'
    runBelow.onmousedown = (e) => { e.preventDefault(); runAllBelow(this.startLine) }

    wrap.append(runAbove, run, runBelow)
    return wrap
  }

  ignoreEvent() { return true }
}

// Executable chunk: run-button widget on the opening fence line.
function buildChunkButtonDecorations(view) {
  const docText = view.state.doc.toString()
  const widgets = []
  for (const chunk of getChunks(docText)) {
    if (chunk.type !== ChunkType.EXECUTABLE) continue
    const line = view.state.doc.line(chunk.startLine)
    widgets.push(Decoration.widget({
      widget: new ChunkButtonsWidget(chunk.startLine),
      side: 1,
    }).range(line.to))
  }
  return RangeSet.of(widgets)
}

const chunkDecorationsPlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = buildChunkButtonDecorations(view) }
  update(update) {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = buildChunkButtonDecorations(update.view)
    }
  }
}, { decorations: v => v.decorations })

// Display chunk: line-level class applied to every line of the fenced block.
function buildDisplayChunkDecorations(view) {
  const docText = view.state.doc.toString()
  const decos = []
  for (const chunk of getChunks(docText)) {
    if (chunk.type !== ChunkType.DISPLAY) continue
    for (let ln = chunk.startLine; ln <= chunk.endLine; ln++) {
      try {
        const line = view.state.doc.line(ln)
        decos.push(Decoration.line({ class: 'cm-display-chunk' }).range(line.from))
      } catch { /* line out of range — skip */ }
    }
  }
  return Decoration.set(decos)
}

const displayChunkPlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = buildDisplayChunkDecorations(view) }
  update(update) {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = buildDisplayChunkDecorations(update.view)
    }
  }
}, { decorations: v => v.decorations })

// ── Inline output decorations ────────────────────────────────────────────────

class OutputWidget extends WidgetType {
  constructor(dom) { super(); this.dom = dom }
  eq(other) { return this.dom === other.dom }
  toDOM() { return this.dom }
  get estimatedHeight() { return 100 }
  ignoreEvent() { return true }
}

function buildInlineOutputDecorations(state) {
  const widgets = []
  for (const [pos, dom] of inlineOutputs) {
    if (pos >= 0 && pos <= state.doc.length) {
      widgets.push(Decoration.widget({
        widget: new OutputWidget(dom),
        block: true,
        side: 1,
      }).range(pos))
    }
  }
  widgets.sort((a, b) => a.from - b.from)
  return Decoration.set(widgets)
}

const inlineOutputField = StateField.define({
  create() { return Decoration.none },
  update(deco, tr) {
    let rebuild = false
    for (const e of tr.effects) {
      if (e.is(clearInlineOutputs)) {
        inlineOutputs.clear()
        rebuild = true
      }
      if (e.is(setInlineOutput)) {
        if (e.value.dom === null) {
          inlineOutputs.delete(e.value.pos)
        } else {
          inlineOutputs.set(e.value.pos, e.value.dom)
        }
        rebuild = true
      }
    }
    if (rebuild) return buildInlineOutputDecorations(tr.state)
    if (tr.docChanged) {
      const remapped = new Map()
      for (const [pos, dom] of inlineOutputs) {
        try { remapped.set(tr.changes.mapPos(pos), dom) }
        catch { /* position deleted */ }
      }
      inlineOutputs.clear()
      for (const [p, d] of remapped) inlineOutputs.set(p, d)
      return buildInlineOutputDecorations(tr.state)
    }
    return deco
  },
  provide: f => EditorView.decorations.from(f),
})

// ── Console formatting ───────────────────────────────────────────────────────

const ansi = {
  cyan:  s => `\x1b[36m${s}\x1b[0m`,
  grey:  s => `\x1b[90m${s}\x1b[0m`,
  red:   s => `\x1b[31m${s}\x1b[0m`,
  white: s => `\x1b[37m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
}

function aqTypeLabel(values) {
  for (const v of values) {
    if (v == null) continue
    if (v instanceof Date) return '<date>'
    switch (typeof v) {
      case 'number': return '<num>'
      case 'boolean': return '<bool>'
      default: return '<str>'
    }
  }
  return '<???>'
}

function truncStr(s, max = 30) {
  s = String(s == null ? '' : s)
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

function formatArqueroTable(df) {
  const cols = df.columnNames()
  const allRows = df.objects()
  const maxRows = 10
  const show = allRows.slice(0, maxRows)
  const totalRows = allRows.length

  // Compute type labels from first non-null values
  const types = cols.map(c => aqTypeLabel(allRows.map(r => r[c])))

  // Build string columns: header, type, then values
  const strCols = cols.map((c, ci) => {
    const isNum = types[ci] === '<num>'
    const vals = show.map(r => r[c] == null ? '' : isNum ? String(r[c]) : truncStr(r[c]))
    const widths = [c.length, types[ci].length, ...vals.map(v => v.length)]
    const w = Math.max(...widths)
    const pad = isNum ? (s => s.padStart(w)) : (s => s.padEnd(w))
    return { header: pad(c), type: pad(types[ci]), vals: vals.map(pad), isNum }
  })

  const lines = []
  lines.push(ansi.grey(`# arquero table [${totalRows} rows x ${cols.length} cols]`))
  lines.push('  ' + strCols.map(c => ansi.cyan(c.header)).join('  '))
  lines.push('  ' + strCols.map(c => ansi.grey(c.type)).join('  '))
  for (let i = 0; i < show.length; i++) {
    lines.push('  ' + strCols.map(c => ansi.white(c.vals[i])).join('  '))
  }
  if (totalRows > maxRows) {
    lines.push(ansi.grey(`  ... ${totalRows - maxRows} more rows`))
  }
  return lines.join('\n')
}

function formatJsonHighlighted(value, indent = 0, maxDepth = 3) {
  if (indent > maxDepth) return ansi.grey('...')
  const pad = '  '.repeat(indent)
  const pad1 = '  '.repeat(indent + 1)

  if (value === null) return ansi.grey('null')
  if (value === undefined) return ansi.grey('undefined')
  if (typeof value === 'string') return ansi.green(`"${truncStr(value, 60)}"`)
  if (typeof value === 'number' || typeof value === 'boolean') return ansi.white(String(value))

  if (Array.isArray(value)) {
    if (value.length === 0) return ansi.grey('[]')
    const items = value.slice(0, 20)
    const lines = items.map(v => pad1 + formatJsonHighlighted(v, indent + 1, maxDepth))
    if (value.length > 20) lines.push(pad1 + ansi.grey(`... ${value.length - 20} more items`))
    return ansi.grey('[') + '\n' + lines.join(',\n') + '\n' + pad + ansi.grey(']')
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value)
    if (keys.length === 0) return ansi.grey('{}')
    const show = keys.slice(0, 20)
    const lines = show.map(k => {
      const v = formatJsonHighlighted(value[k], indent + 1, maxDepth)
      return pad1 + ansi.cyan(k) + ansi.grey(': ') + v
    })
    if (keys.length > 20) lines.push(pad1 + ansi.grey(`... ${keys.length - 20} more keys`))
    return ansi.grey('{') + '\n' + lines.join(',\n') + '\n' + pad + ansi.grey('}')
  }

  return ansi.white(String(value))
}

function formatError(err) {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
  let out = ansi.red(msg)
  if (err instanceof Error && err.stack) {
    const stackLines = err.stack.split('\n').filter(l => l.trim().startsWith('at '))
    if (stackLines.length > 0) {
      out += '\n' + stackLines.slice(0, 2).map(l => ansi.grey('  ' + l.trim())).join('\n')
    }
  }
  return out
}

function formatForConsole(value) {
  if (value === undefined) return null
  if (value === null) return ansi.grey('null') + ' ' + ansi.grey('<null>')

  // Arquero table
  if (value && typeof value.columnNames === 'function' && typeof value.objects === 'function') {
    return formatArqueroTable(value)
  }

  // DOM elements / plots
  if (value instanceof Element) return ansi.grey('[html element]')
  if (value instanceof SVGElement) return ansi.grey('[svg element]')

  // Functions
  if (typeof value === 'function') {
    const name = value.name || 'anonymous'
    return ansi.grey(`[function ${name}]`)
  }

  // Primitives with type annotation
  if (typeof value === 'number') return ansi.white(String(value)) + ' ' + ansi.grey('<num>')
  if (typeof value === 'boolean') return ansi.white(String(value)) + ' ' + ansi.grey('<bool>')
  if (typeof value === 'string') return ansi.green(`"${truncStr(value, 60)}"`) + ' ' + ansi.grey('<str>')

  // Arrays and objects
  if (Array.isArray(value)) {
    return ansi.grey(`# array [${value.length} items]`) + '\n' + formatJsonHighlighted(value)
  }

  return formatJsonHighlighted(value)
}

function isAssignment(code) {
  const t = code.trim()
  if (/^(var|let|const)\s/.test(t)) return true
  // identifier = ... but not == or ===
  if (/^[a-zA-Z_$][a-zA-Z0-9_$.\[\]]*\s*=[^=]/.test(t)) return true
  return false
}

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

// Let browser handle Ctrl+C (copy) and Ctrl+V (paste) natively
term.attachCustomKeyEventHandler((e) => {
  if (e.type === 'keydown' && (e.ctrlKey || e.metaKey)) {
    if (e.key === 'c' && term.hasSelection()) return false  // let browser copy
    if (e.key === 'v') return false  // let browser paste
  }
  return true
})

// Refit on resize
const termContainer = document.getElementById('terminal')
const resizeObs = new ResizeObserver(() => { try { fitAddon.fit() } catch {} })
resizeObs.observe(termContainer)

const PROMPT = '\x1b[36m> \x1b[0m'  // cyan prompt

// Handle browser paste events (from Ctrl+V bypass)
termContainer.addEventListener('paste', (e) => {
  const text = e.clipboardData.getData('text')
  if (!text) return
  const clean = text.replace(/[\r\n]+/g, ' ')
  currentLine = currentLine.slice(0, cursorPos) + clean + currentLine.slice(cursorPos)
  cursorPos += clean.length
  refreshLine()
})

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

function consoleAppend(code, err, result) {
  // Clear the current prompt line before writing echoed code
  term.write('\r\x1b[K')
  const lines = code.trim().split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (i === 0) {
      term.writeln('\x1b[36m> \x1b[0m' + lines[i])
    } else {
      term.writeln('\x1b[36m  \x1b[0m' + lines[i])
    }
  }
  if (err) {
    term.writeln(formatError(err))
  } else if (result !== undefined && !isAssignment(code)) {
    const formatted = formatForConsole(result)
    if (formatted) term.writeln(formatted)
  }
  // Add to history so arrow keys can recall editor-executed code
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed) replHistory.push(trimmed)
  }
  historyIdx = -1
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
  let result
  try { result = evalInSession(code) } catch (e) { err = e; displayError(e) }
  if (err) {
    term.writeln(formatError(err))
  } else if (result !== undefined && !isAssignment(code)) {
    // Plots and DOM elements also go to output pane for rich display
    if (result instanceof Element) {
      display(result)
      const outBtn = document.querySelector('[data-tab="output-content"]')
      if (outBtn) switchTab(outBtn)
    }
    const formatted = formatForConsole(result)
    if (formatted) term.writeln(formatted)
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
      // Ctrl+C — clear current input (copy handled by customKeyEventHandler)
      currentLine = ''
      cursorPos = 0
      term.write('^C\r\n')
      writePrompt()
    } else if (code === 22) {
      // Ctrl+V handled by customKeyEventHandler; fallback for terminals that send \x16
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

// ── Data I/O helpers (loadCSV, loadJSON, loadFile) ───────────────────────────
const { loadCSV, loadJSON, loadFile } = createDataIOHelpers(
  (str) => term.writeln(str),
  formatForConsole,
)
Object.assign(window, { loadCSV, loadJSON, loadFile })

// ── Demo document ────────────────────────────────────────────────────────────

const DEMO_DOC = `# Sales Analysis

Explore regional sales data using Arquero and Observable Plot.

\`\`\`{js}
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

\`\`\`{js}
var summary = data
  .groupby("region")
  .rollup({ total: aq.op.sum("value") })
  .orderby("region")

display(summary)
\`\`\`

## Visualization

\`\`\`{js}
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

## Chunk Options Demo

This chunk won't run automatically (\`eval=false\`):

\`\`\`{js, eval=false}
displayText("This only runs when you manually execute it!")
\`\`\`
`

function insertChunk() {
  const pos = editorView.state.selection.main.head
  const template = '\n```{js}\n\n```\n'
  editorView.dispatch({
    changes: { from: pos, insert: template },
    selection: { anchor: pos + 9 },  // cursor on the blank line inside the chunk
  })
  editorView.focus()
}

window.insertChunk = insertChunk

function insertLoadCSVChunk() {
  const pos = editorView.state.selection.main.head
  const template = '\n```{js}\nvar data = await loadCSV()\ndisplay(data)\n```\n'
  editorView.dispatch({
    changes: { from: pos, insert: template },
    selection: { anchor: pos + 18 },  // cursor on the variable name
  })
  editorView.focus()
}

window.insertLoadCSVChunk = insertLoadCSVChunk

// ── Preview ──────────────────────────────────────────────────────────────────

function refreshPreview() {
  const container = document.getElementById('preview-content')
  if (!container) return
  const docText = editorView.state.doc.toString()
  container.innerHTML = renderPreview(docText, chunkOutputs)
  const previewBtn = document.querySelector('[data-tab="preview-content"]')
  if (previewBtn) switchTab(previewBtn)
}

// ── View toggle helpers ───────────────────────────────────────────────────────

function toggleConsole() {
  const app  = document.getElementById('app')
  const pane = document.getElementById('console-pane')
  const hidden = pane.style.display === 'none'
  pane.style.display = hidden ? '' : 'none'
  app.style.gridTemplateRows = hidden
    ? 'auto auto 1fr 220px'
    : 'auto auto 1fr 0'
  if (hidden) try { fitAddon.fit() } catch {}
}

function toggleOutputPane() {
  const pane = document.getElementById('output-pane')
  const hidden = pane.style.display === 'none'
  pane.style.display = hidden ? '' : 'none'
  document.getElementById('main').style.gridTemplateColumns = hidden ? '1fr 1fr' : '1fr 0'
}

// ── File tab rendering ────────────────────────────────────────────────────────

function renderFileTabs() {
  const bar     = document.getElementById('file-tabs')
  if (!bar) return
  const files   = FM.getAllFiles()
  const current = FM.getCurrentFile()

  bar.innerHTML = ''
  for (const f of files) {
    const tab = document.createElement('button')
    tab.className = 'file-tab' +
      (f.id === current?.id ? ' active' : '') +
      (f.status === 'dirty' ? ' dirty' : '')
    tab.dataset.id = f.id

    const name = document.createElement('span')
    name.className = 'tab-name'
    name.textContent = f.name

    const close = document.createElement('button')
    close.className = 'tab-close'
    close.title = 'Close'
    close.textContent = '×'
    close.addEventListener('click', async e => {
      e.stopPropagation()
      await FM.closeFile(f.id)
    })

    tab.append(name, close)
    tab.addEventListener('click', () => FM.switchToId(f.id))
    bar.appendChild(tab)
  }

  // + new tab button
  const newBtn = document.createElement('button')
  newBtn.className = 'new-tab-btn'
  newBtn.title = 'New file'
  newBtn.textContent = '+'
  newBtn.addEventListener('click', () => FM.newFile())
  bar.appendChild(newBtn)

  // Sync Run on Open checkbox state to current file
  const runOnOpenItem = document.querySelector('[data-action="toggleRunOnOpen"]')
  if (runOnOpenItem) runOnOpenItem.checked = current?.runOnOpen ?? false
}


const jsAnalystKeymap = Prec.highest(keymap.of([
  {
    key: 'Ctrl-Shift-Enter',
    run() { runChunkAtCursor(); return true },
  },
  {
    key: 'Ctrl-Shift-n',
    run() { runNextChunk(); return true },
  },
]))

// Ctrl+Enter is handled by the isolated ctrlEnterExtension (created below,
// added to the editor once, never recreated).
// evalFn receives (code, endLine1) where endLine1 is the 1-indexed closing-fence
// line used to anchor inline output, or null for selection-mode runs.
const ctrlEnterExtension = createCtrlEnterExtension((code, endLine1) => {
  runCode(code, true, endLine1 ?? null)
  flushInlineOutputs()
})

const editorView = new EditorView({
  state: EditorState.create({
    doc: DEMO_DOC,
    extensions: [
      basicSetup,
      markdown({ defaultCodeLanguage: javascript() }),
      oneDark,
      ctrlEnterExtension,
      jsAnalystKeymap,
      chunkDecorationsPlugin,
      displayChunkPlugin,
      inlineOutputField,
      EditorView.theme({
        '&': { height: '100%', fontSize: '12.5px' },
        '.cm-scroller': { overflow: 'auto', fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace" },
        '.cm-content': { padding: '8px 0' },
      }),
    ],
  }),
  parent: editorMount,
})

// ── File management ───────────────────────────────────────────────────────────

// Wire editor change listener for autosave + dirty flag
const updateListenerExt = EditorView.updateListener.of((update) => {
  if (update.docChanged) FM.onEditorChange()
})
editorView.dispatch({
  effects: StateEffect.appendConfig.of(updateListenerExt),
})

// ── Actions init ─────────────────────────────────────────────────────────────

Actions.initActions({
  FM,
  editorView,
  runChunkAtCursor,
  runNextChunk,
  runAll,
  runAllAboveCursor,
  runAllBelowCursor,
  clearOutput,
  clearSession,
  insertChunk,
  toggleConsole,
  toggleOutputPane,
  refreshPreview,
  displayError,
  undo: () => cmUndo(editorView),
  redo: () => cmRedo(editorView),
})

registerShortcuts(Actions)

// ── Delegated menu handler ────────────────────────────────────────────────────

document.querySelector('.menubar').addEventListener('sl-select', e => {
  const action = e.detail.item.dataset.action
  if (action && Actions[action]) Actions[action]()
})

// Sync Run on Open checkbox before the Run menu opens
document.getElementById('run-dropdown').addEventListener('sl-show', () => {
  const item = document.querySelector('[data-action="toggleRunOnOpen"]')
  if (item) item.checked = FM.getCurrentFile()?.runOnOpen ?? false
})

// ── File manager init ─────────────────────────────────────────────────────────

FM.init(editorView, document.getElementById('filename'), {
  clearOutput,
  runAll,
  consolePrint: str => term.writeln(str),
  onFilesChanged:  renderFileTabs,
}).then(() => {
  renderFileTabs()
  runAll()
})

