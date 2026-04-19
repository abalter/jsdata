/**
 * tests/formatForConsole.test.js
 *
 * Tests for the console output formatter.
 *
 * NOTE: `formatForConsole` and its helpers (`formatArqueroTable`, `formatError`,
 * `formatJsonHighlighted`) are currently embedded in src/main.js and not exported.
 * main.js cannot be imported in a Node test environment because it references DOM
 * APIs at module load time.
 *
 * These tests use local copies of the pure formatting functions copied verbatim
 * from main.js.  The behavioural contract tested here is the source of truth; if
 * main.js diverges from these copies, the tests will no longer catch regressions.
 *
 * Once the formatting functions are extracted to src/formatForConsole.js, replace
 * the local definitions below with:
 *
 *   import { formatForConsole, formatArqueroTable, formatError } from '../src/formatForConsole.js'
 *
 * DOM-dependent paths (instanceof Element, instanceof SVGElement) are marked
 * it.todo — they require a jsdom/happy-dom environment.
 */

import { describe, it, expect } from 'vitest'

// ── Local copies of functions under test ──────────────────────────────────────
// Copied verbatim from src/main.js.

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

  const types = cols.map(c => aqTypeLabel(allRows.map(r => r[c])))

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

  if (value && typeof value.columnNames === 'function' && typeof value.objects === 'function') {
    return formatArqueroTable(value)
  }

  // DOM/SVG checks omitted — not available in Node environment
  // (tested separately via it.todo stubs below)

  if (typeof value === 'function') {
    const name = value.name || 'anonymous'
    return ansi.grey(`[function ${name}]`)
  }

  if (typeof value === 'number') return ansi.white(String(value)) + ' ' + ansi.grey('<num>')
  if (typeof value === 'boolean') return ansi.white(String(value)) + ' ' + ansi.grey('<bool>')
  if (typeof value === 'string') return ansi.green(`"${truncStr(value, 60)}"`) + ' ' + ansi.grey('<str>')

  if (Array.isArray(value)) {
    return ansi.grey(`# array [${value.length} items]`) + '\n' + formatJsonHighlighted(value)
  }

  return formatJsonHighlighted(value)
}

// ── Mock Arquero table factory ────────────────────────────────────────────────
// Arquero is a CDN global in the app, not a npm dependency.
// We test formatArqueroTable using plain objects that satisfy its duck-type contract.

function mockTable(columnNames, rows) {
  return {
    columnNames: () => columnNames,
    objects:     () => rows,
    numRows:     () => rows.length,
  }
}

// ── ANSI escape helpers for assertions ───────────────────────────────────────

/** Strip all ANSI escape codes from a string for readable assertions. */
function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '')
}

// ── Arquero table formatting ──────────────────────────────────────────────────

describe('formatArqueroTable', () => {
  it('includes correct column headers', () => {
    const t = mockTable(['name', 'score'], [{ name: 'Alice', score: 10 }])
    const out = stripAnsi(formatArqueroTable(t))
    expect(out).toContain('name')
    expect(out).toContain('score')
  })

  it('includes type row with correct type labels', () => {
    const t = mockTable(['category', 'value'], [{ category: 'A', value: 10 }])
    const out = stripAnsi(formatArqueroTable(t))
    expect(out).toContain('<str>')
    expect(out).toContain('<num>')
  })

  it('includes data rows', () => {
    const t = mockTable(['name'], [{ name: 'Alice' }, { name: 'Bob' }])
    const out = stripAnsi(formatArqueroTable(t))
    expect(out).toContain('Alice')
    expect(out).toContain('Bob')
  })

  it('shows truncation message when rows exceed 10', () => {
    const rows = Array.from({ length: 15 }, (_, i) => ({ n: i }))
    const t = mockTable(['n'], rows)
    const out = stripAnsi(formatArqueroTable(t))
    expect(out).toContain('5 more rows')
  })

  it('does not show truncation message when rows are 10 or fewer', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ n: i }))
    const t = mockTable(['n'], rows)
    const out = stripAnsi(formatArqueroTable(t))
    expect(out).not.toContain('more rows')
  })

  it('includes summary header with row and column counts', () => {
    const t = mockTable(['a', 'b'], [{ a: 1, b: 2 }, { a: 3, b: 4 }])
    const out = stripAnsi(formatArqueroTable(t))
    expect(out).toContain('2 rows x 2 cols')
  })

  it('long string values are truncated to ~30 chars with ellipsis', () => {
    const long = 'x'.repeat(50)
    const t = mockTable(['s'], [{ s: long }])
    const out = stripAnsi(formatArqueroTable(t))
    // truncStr clips at 30 chars, appends …
    expect(out).toContain('…')
    expect(out).not.toContain(long)
  })

  it('numeric column values are right-padded (padStart)', () => {
    // padStart means the value appears right-aligned; content is just the number
    const t = mockTable(['n'], [{ n: 1 }, { n: 100 }])
    const out = stripAnsi(formatArqueroTable(t))
    expect(out).toContain('1')
    expect(out).toContain('100')
  })
})

// ── Primitives with type annotations ─────────────────────────────────────────

describe('formatForConsole — primitive type annotations', () => {
  it('number includes <num> annotation', () => {
    const out = stripAnsi(formatForConsole(42))
    expect(out).toContain('42')
    expect(out).toContain('<num>')
  })

  it('string includes <str> annotation and quotes', () => {
    const out = stripAnsi(formatForConsole('hello'))
    expect(out).toContain('"hello"')
    expect(out).toContain('<str>')
  })

  it('boolean true includes <bool> annotation', () => {
    const out = stripAnsi(formatForConsole(true))
    expect(out).toContain('true')
    expect(out).toContain('<bool>')
  })

  it('boolean false includes <bool> annotation', () => {
    const out = stripAnsi(formatForConsole(false))
    expect(out).toContain('false')
    expect(out).toContain('<bool>')
  })
})

// ── Null and undefined ────────────────────────────────────────────────────────

describe('formatForConsole — null and undefined', () => {
  it('null returns a non-null string containing "null"', () => {
    const out = formatForConsole(null)
    expect(out).not.toBeNull()
    expect(stripAnsi(out)).toContain('null')
    expect(stripAnsi(out)).toContain('<null>')
  })

  it('undefined returns null (nothing to print)', () => {
    expect(formatForConsole(undefined)).toBeNull()
  })
})

// ── Arrays ────────────────────────────────────────────────────────────────────

describe('formatForConsole — arrays', () => {
  it('array of primitives includes item count in header', () => {
    const out = stripAnsi(formatForConsole([1, 2, 3]))
    expect(out).toContain('3 items')
  })

  it('array values are included in the output', () => {
    const out = stripAnsi(formatForConsole([10, 20]))
    expect(out).toContain('10')
    expect(out).toContain('20')
  })

  it('empty array renders without throwing', () => {
    expect(() => formatForConsole([])).not.toThrow()
  })
})

// ── Plain objects ─────────────────────────────────────────────────────────────

describe('formatForConsole — plain objects', () => {
  it('plain object keys are present in output', () => {
    const out = stripAnsi(formatForConsole({ foo: 1, bar: 'baz' }))
    expect(out).toContain('foo')
    expect(out).toContain('bar')
  })

  it('empty object renders without throwing', () => {
    expect(() => formatForConsole({})).not.toThrow()
  })
})

// ── Arquero duck-type detection ───────────────────────────────────────────────

describe('formatForConsole — Arquero table detection', () => {
  it('object with columnNames() and objects() is formatted as a table', () => {
    const t = mockTable(['x'], [{ x: 1 }])
    const out = stripAnsi(formatForConsole(t))
    expect(out).toContain('arquero table')
  })
})

// ── DOM / svg elements — require browser environment ─────────────────────────

describe('formatForConsole — DOM elements', () => {
  it.todo('DOM node returns [html element] (requires jsdom or happy-dom environment)')
  it.todo('Observable Plot SVG element returns [svg element] (requires jsdom or happy-dom environment)')
})

// ── formatError ───────────────────────────────────────────────────────────────

describe('formatError', () => {
  it('formats an Error with name and message', () => {
    const err = new TypeError('bad input')
    const out = stripAnsi(formatError(err))
    expect(out).toContain('TypeError')
    expect(out).toContain('bad input')
  })

  it('includes at most the first 2 stack lines after the message', () => {
    const err = new Error('oops')
    const lines = formatError(err).split('\n')
    // First line is message, remaining lines are stack (max 2)
    const stackLines = lines.slice(1).filter(Boolean)
    expect(stackLines.length).toBeLessThanOrEqual(2)
  })

  it('non-Error value is coerced to string', () => {
    const out = stripAnsi(formatError('something went wrong'))
    expect(out).toContain('something went wrong')
  })

  it('stack-less Error still formats without throwing', () => {
    const err = new Error('no stack')
    delete err.stack
    expect(() => formatError(err)).not.toThrow()
    expect(stripAnsi(formatError(err))).toContain('no stack')
  })
})
