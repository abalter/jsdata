// ── CodeMirror 6 ─────────────────────────────────────────────────────────────
import { EditorView, keymap, Decoration, ViewPlugin, WidgetType } from '@codemirror/view'
import { EditorState, Prec, RangeSet, StateField, StateEffect } from '@codemirror/state'
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

// ── Inline output state ──────────────────────────────────────────────────────
const inlineOutputs = new Map()           // doc position → DOM container
const pendingInlineOutputs = []           // { endLine, dom } awaiting flush
const setInlineOutput = StateEffect.define()
const clearInlineOutputs = StateEffect.define()

// ── Display functions ────────────────────────────────────────────────────────

// Inline output capture: during chunk execution, display calls are captured here
let captureTarget = null  // null = output pane, DOM element = capture into it

function clearOutput() {
  outputContent.innerHTML = ''
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

// ── Chunk detection via remark ───────────────────────────────────────────────

function parseChunkOptions(lang, meta) {
  // Combine lang + meta back into the full info string, then strip `{` `}` and language
  const raw = ((lang || '') + (meta ? ' ' + meta : '')).trim()
  // Match both ```js and ```{js, ...}
  const inner = raw.replace(/^\{?\s*js\s*,?\s*/, '').replace(/\}$/, '').trim()
  if (!inner) return {}
  const opts = {}
  // Parse key=value pairs (values can be bare words, quoted strings, or boolean)
  for (const part of inner.split(/,\s*/)) {
    const m = part.match(/^\s*(\w+)\s*=\s*(.+?)\s*$/)
    if (m) {
      const [, key, val] = m
      // Coerce booleans and numbers
      if (val === 'true') opts[key] = true
      else if (val === 'false') opts[key] = false
      else if (/^-?\d+(\.\d+)?$/.test(val)) opts[key] = Number(val)
      else opts[key] = val.replace(/^["']|["']$/g, '')  // strip quotes
    } else {
      // Bare word — treat as label
      const trimmed = part.trim()
      if (trimmed) opts.label = trimmed
    }
  }
  return opts
}

function isJsChunk(node) {
  const lang = (node.lang || '').trim()
  return /^\{?\s*js[\s,}]?/.test(lang) || lang === 'js'
}

function getChunks(docText) {
  const tree = unified().use(remarkParse).parse(docText)
  return tree.children
    .filter(node => node.type === 'code' && isJsChunk(node))
    .map(node => ({
      code: node.value,
      startLine: node.position.start.line,   // 1-based
      endLine: node.position.end.line,
      options: parseChunkOptions(node.lang, node.meta),
    }))
}

function getChunkAtLine(docText, line) {
  return getChunks(docText).find(c => line >= c.startLine && line <= c.endLine)
}

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
  if (container && container.children.length === 0 && err === null && result !== undefined) {
    display(result)
  }

  captureTarget = null

  if (container && container.children.length > 0) {
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
  if (chunk && chunk.options.eval !== false) runCode(chunk.code, true, chunk.endLine)
  flushInlineOutputs()
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
  // Move cursor into the next chunk
  const targetLine = doc.line(Math.min(nextChunk.startLine + 1, doc.lines))
  editorView.dispatch({ selection: { anchor: targetLine.from }, scrollIntoView: true })
  if (nextChunk.options.eval !== false) runCode(nextChunk.code, true, nextChunk.endLine)
  flushInlineOutputs()
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
        /expected ['"][}\])]/.test(msg) ||
        /unterminated/.test(msg) ||
        /expected.*got end/.test(msg)
      ) {
        return 'incomplete'
      }
      // Heuristic: trailing chars that imply continuation
      const trimmed = code.trimEnd()
      if (/[{(\[,+\-=>&|?:]$/.test(trimmed) || /=>$/.test(trimmed)) {
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
  runCode(statement, true, chunk.endLine)
  flushInlineOutputs()

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
    if (chunk.options.eval !== false) runCode(chunk.code, false, chunk.endLine)
  }
  flushInlineOutputs()
}

function runChunkByLine(startLine) {
  const docText = editorView.state.doc.toString()
  const chunk = getChunkAtLine(docText, startLine)
  if (chunk && chunk.options.eval !== false) runCode(chunk.code, true, chunk.endLine)
  flushInlineOutputs()
}

function runAllAbove(startLine) {
  const docText = editorView.state.doc.toString()
  for (const chunk of getChunks(docText)) {
    if (chunk.startLine >= startLine) break
    if (chunk.options.eval !== false) runCode(chunk.code, false, chunk.endLine)
  }
  flushInlineOutputs()
}

function runAllBelow(startLine) {
  const docText = editorView.state.doc.toString()
  for (const chunk of getChunks(docText)) {
    if (chunk.startLine >= startLine && chunk.options.eval !== false) runCode(chunk.code, false, chunk.endLine)
  }
  flushInlineOutputs()
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

function buildChunkDecorations(view) {
  const docText = view.state.doc.toString()
  const chunks = getChunks(docText)
  const widgets = []
  for (const chunk of chunks) {
    const line = view.state.doc.line(chunk.startLine)
    widgets.push(Decoration.widget({
      widget: new ChunkButtonsWidget(chunk.startLine),
      side: 1,
    }).range(line.to))
  }
  return RangeSet.of(widgets)
}

const chunkDecorationsPlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = buildChunkDecorations(view) }
  update(update) {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = buildChunkDecorations(update.view)
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
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    term.writeln('\x1b[31m' + msg + '\x1b[0m')
  } else if (result !== undefined) {
    term.writeln(String(result))
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
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    term.writeln('\x1b[31m' + msg + '\x1b[0m')
  } else if (result !== undefined) {
    // Rich display: tables, plots, elements → output pane; primitives → terminal
    if (result && (typeof result === 'object' || typeof result === 'function')) {
      display(result)
      // Switch to Output tab so user sees it
      const outBtn = document.querySelector('[data-tab="output-content"]')
      if (outBtn) switchTab(outBtn)
      term.writeln('\x1b[36m→ [displayed in Output pane]\x1b[0m')
    } else {
      term.writeln('\x1b[32m' + String(result) + '\x1b[0m')
    }
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

## Chunk Options Demo

This chunk won't run automatically (\`eval=false\`):

\`\`\`{js, eval=false}
displayText("This only runs when you manually execute it!")
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
      chunkDecorationsPlugin,
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
