import { describe, it, expect } from 'vitest'
import { getStatementAtCursor, getStatementInfoAtCursor } from './ctrlEnter.js'

// ── Shared test document ──────────────────────────────────────────────────────
//
// Line numbers (0-indexed):
//  0  # Analysis
//  1  (blank)
//  2  ```js
//  3  const x = 1
//  4  const f = (
//  5    a,
//  6    b
//  7  ) => a + b
//  8  const y = 2
//  9  ```

const doc = `# Analysis

\`\`\`js
const x = 1
const f = (
  a,
  b
) => a + b
const y = 2
\`\`\``

const CHUNK_START = 2
const CHUNK_END   = 9

describe('getStatementAtCursor', () => {
  it('returns a single complete line', () => {
    expect(getStatementAtCursor(doc, 3, CHUNK_START, CHUNK_END)).toBe('const x = 1')
  })

  it('expands downward to complete multi-line statement', () => {
    const result = getStatementAtCursor(doc, 4, CHUNK_START, CHUNK_END)
    expect(result).toBe('const f = (\n  a,\n  b\n) => a + b')
  })

  it('handles cursor on last line of chunk', () => {
    expect(getStatementAtCursor(doc, 8, CHUNK_START, CHUNK_END)).toBe('const y = 2')
  })

  it('returns null when cursor is on the opening fence', () => {
    expect(getStatementAtCursor(doc, 2, CHUNK_START, CHUNK_END)).toBeNull()
  })

  it('returns null when cursor is on the closing fence', () => {
    expect(getStatementAtCursor(doc, 9, CHUNK_START, CHUNK_END)).toBeNull()
  })

  it('returns null when cursor is outside the chunk entirely', () => {
    expect(getStatementAtCursor(doc, 1, CHUNK_START, CHUNK_END)).toBeNull()
  })
})

// ── Syntax error handling ─────────────────────────────────────────────────────

describe('getStatementAtCursor — syntax errors', () => {
  const errDoc = `# Test

\`\`\`js
const ok = 1
const bad = @@@
const after = 2
\`\`\``

  // Line 4 (0-indexed): const bad = @@@
  it('returns just the bad line rather than expanding past it', () => {
    const result = getStatementAtCursor(errDoc, 4, 2, 6)
    expect(result).toBe('const bad = @@@')
  })

  it('lines after a bad line still work on their own', () => {
    expect(getStatementAtCursor(errDoc, 5, 2, 6)).toBe('const after = 2')
  })
})

// ── Object / array literals ───────────────────────────────────────────────────

describe('getStatementAtCursor — object and array literals', () => {
  const objDoc = `# Test

\`\`\`js
var a = {
  x: 1,
  y: 2
}
var b = 3
\`\`\``

  // chunk 2–8, code lines 3-7 (0-indexed)
  it('expands across a multi-line object literal', () => {
    const result = getStatementAtCursor(objDoc, 3, 2, 8)
    expect(result).toBe('var a = {\n  x: 1,\n  y: 2\n}')
  })

  it('stops at statement after object literal', () => {
    expect(getStatementAtCursor(objDoc, 7, 2, 8)).toBe('var b = 3')
  })
})

// ── Never escapes chunk boundary ──────────────────────────────────────────────

describe('getStatementAtCursor — chunk boundary safety', () => {
  const twoChunks = `# Test

\`\`\`js
const a = 1
\`\`\`

\`\`\`js
const b = 2
\`\`\``

  it('does not include code from a second chunk when evaluating a standalone line', () => {
    // cursor on "const a = 1" in first chunk (line 3), chunk 2-4
    const result = getStatementAtCursor(twoChunks, 3, 2, 4)
    expect(result).toBe('const a = 1')
    expect(result).not.toContain('const b')
  })
})

// ── Cursor in the MIDDLE of a multi-line statement ────────────────────────────

describe('getStatementAtCursor — cursor mid-statement', () => {
  // Simulates: var data = aq.from([
  //   { category: "A", value: 10 },   ← cursor here (mid-statement)
  //   { category: "B", value: 25 },
  // ])
  const aqDoc = `# Data

\`\`\`js
var data = aq.from([
  { category: "A", value: 10 },
  { category: "B", value: 25 }
])
var x = 1
\`\`\``
  // chunk 2-9, code lines 3-8
  // line 3: var data = aq.from([
  // line 4: { category: "A", value: 10 },   ← cursor (mid-statement)
  // line 5: { category: "B", value: 25 }
  // line 6: ])
  // line 7: var x = 1

  it('cursor on first interior row expands to the full statement', () => {
    const result = getStatementAtCursor(aqDoc, 4, 2, 9)
    expect(result).toBe('var data = aq.from([\n  { category: "A", value: 10 },\n  { category: "B", value: 25 }\n])')
  })

  it('cursor on last interior row also captures the full statement', () => {
    const result = getStatementAtCursor(aqDoc, 5, 2, 9)
    expect(result).toBe('var data = aq.from([\n  { category: "A", value: 10 },\n  { category: "B", value: 25 }\n])')
  })

  it('cursor on closing bracket line captures the full statement', () => {
    const result = getStatementAtCursor(aqDoc, 6, 2, 9)
    expect(result).toBe('var data = aq.from([\n  { category: "A", value: 10 },\n  { category: "B", value: 25 }\n])')
  })

  it('line after the multi-line statement is unaffected', () => {
    expect(getStatementAtCursor(aqDoc, 7, 2, 9)).toBe('var x = 1')
  })
})

// ── Plot.plot style nested object/array (the reported breakage) ───────────────
//
// Line numbers (0-indexed):
//  0  # Chart
//  1  (blank)
//  2  ```js                                                   ← chunkStart
//  3  var chart = Plot.plot({
//  4    marginLeft: 50,
//  5    style: { background: "transparent", color: "#cdd6f4", fontSize: "12px" },
//  6    marks: [
//  7      Plot.barY(data.objects(), { x: "category", y: "value", fill: "region" }),
//  8      Plot.ruleY([0]),
//  9    ],
// 10  })
// 11  var x = 1
// 12  ```                                                      ← chunkEnd

const plotDoc = `# Chart

\`\`\`js
var chart = Plot.plot({
  marginLeft: 50,
  style: { background: "transparent", color: "#cdd6f4", fontSize: "12px" },
  marks: [
    Plot.barY(data.objects(), { x: "category", y: "value", fill: "region" }),
    Plot.ruleY([0]),
  ],
})
var x = 1
\`\`\``

const PLOT_CHUNK_START = 2
const PLOT_CHUNK_END   = 12
const FULL_PLOT = 'var chart = Plot.plot({\n  marginLeft: 50,\n  style: { background: "transparent", color: "#cdd6f4", fontSize: "12px" },\n  marks: [\n    Plot.barY(data.objects(), { x: "category", y: "value", fill: "region" }),\n    Plot.ruleY([0]),\n  ],\n})'

describe('getStatementAtCursor — Plot.plot nested object/array', () => {
  it('cursor on the opening line extracts the full statement', () => {
    expect(getStatementAtCursor(plotDoc, 3, PLOT_CHUNK_START, PLOT_CHUNK_END)).toBe(FULL_PLOT)
  })

  it('cursor on an interior marks-array line extracts the full statement', () => {
    expect(getStatementAtCursor(plotDoc, 7, PLOT_CHUNK_START, PLOT_CHUNK_END)).toBe(FULL_PLOT)
  })

  it('cursor on Plot.ruleY line (last array element) extracts the full statement', () => {
    expect(getStatementAtCursor(plotDoc, 8, PLOT_CHUNK_START, PLOT_CHUNK_END)).toBe(FULL_PLOT)
  })

  it('cursor on 2nd-to-last line (],) extracts the full statement', () => {
    expect(getStatementAtCursor(plotDoc, 9, PLOT_CHUNK_START, PLOT_CHUNK_END)).toBe(FULL_PLOT)
  })

  it('cursor on the closing line })', () => {
    expect(getStatementAtCursor(plotDoc, 10, PLOT_CHUNK_START, PLOT_CHUNK_END)).toBe(FULL_PLOT)
  })

  it('line after the Plot.plot block is unaffected', () => {
    expect(getStatementAtCursor(plotDoc, 11, PLOT_CHUNK_START, PLOT_CHUNK_END)).toBe('var x = 1')
  })
})

// ── getStatementInfoAtCursor — endLine (for cursor advancement) ───────────────

describe('getStatementInfoAtCursor — endLine values', () => {
  it('single-line statement: endLine equals the cursor line', () => {
    const r = getStatementInfoAtCursor(plotDoc, 11, PLOT_CHUNK_START, PLOT_CHUNK_END)
    expect(r).toMatchObject({ code: 'var x = 1', endLine: 11 })
  })

  it('cursor at start of multi-line statement: endLine is at closing })', () => {
    const r = getStatementInfoAtCursor(plotDoc, 3, PLOT_CHUNK_START, PLOT_CHUNK_END)
    expect(r).toMatchObject({ code: FULL_PLOT, endLine: 10 })
  })

  it('cursor mid-statement (],): endLine is still at closing })', () => {
    const r = getStatementInfoAtCursor(plotDoc, 9, PLOT_CHUNK_START, PLOT_CHUNK_END)
    expect(r).toMatchObject({ code: FULL_PLOT, endLine: 10 })
  })

  it('cursor on Plot.ruleY line: endLine is still at closing })', () => {
    const r = getStatementInfoAtCursor(plotDoc, 8, PLOT_CHUNK_START, PLOT_CHUNK_END)
    expect(r).toMatchObject({ code: FULL_PLOT, endLine: 10 })
  })

  it('returns null outside a chunk', () => {
    expect(getStatementInfoAtCursor(plotDoc, 0, PLOT_CHUNK_START, PLOT_CHUNK_END)).toBeNull()
  })
})
