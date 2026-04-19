/**
 * tests/ctrlEnter.test.js
 *
 * Pure string-in / string-out tests for the Ctrl+Enter statement extraction logic.
 * No CodeMirror, no browser APIs, no app state.
 *
 * The functions under test are fully exported from src/ctrlEnter.js, so this file
 * tests the real implementation code directly.
 */

import { describe, it, expect } from 'vitest'
import {
  getStatementAtCursor,
  getStatementInfoAtCursor,
  findChunkAtLine,
} from '../src/ctrlEnter.js'

// ── Shared document fixture ───────────────────────────────────────────────────
//
// 0: # Analysis
// 1: (blank)
// 2: ```js         ← chunk start (fence)
// 3: const x = 1
// 4: const f = (
// 5:   a,
// 6:   b
// 7: ) => a + b
// 8: const y = 2
// 9: ```           ← chunk end (fence)

const DOC = `# Analysis

\`\`\`js
const x = 1
const f = (
  a,
  b
) => a + b
const y = 2
\`\`\``

const CS = 2   // chunkStart (0-indexed)
const CE = 9   // chunkEnd   (0-indexed)

// ── Single complete line ──────────────────────────────────────────────────────

describe('single complete line', () => {
  it('returns the line text verbatim', () => {
    expect(getStatementAtCursor(DOC, 3, CS, CE)).toBe('const x = 1')
  })

  it('returns the last line in the chunk', () => {
    expect(getStatementAtCursor(DOC, 8, CS, CE)).toBe('const y = 2')
  })
})

// ── Multi-line statement — cursor at start ────────────────────────────────────

describe('multi-line statement, cursor at the opening line', () => {
  it('expands downward to completion', () => {
    const result = getStatementAtCursor(DOC, 4, CS, CE)
    expect(result).toBe('const f = (\n  a,\n  b\n) => a + b')
  })
})

// ── Cursor in the middle of an already-open statement ────────────────────────

const MID_DOC = `# Chart

\`\`\`js
var data = aq.from([
  { category: "A", value: 10 },
  { category: "B", value: 25 }
])
var x = 1
\`\`\``
// chunk 2-9: code lines 3-8
// line 3: var data = aq.from([       ← statement start
// line 4: { category: "A", ... },    ← mid-statement
// line 5: { category: "B", ... }
// line 6: ])                         ← statement end
// line 7: var x = 1

const MID_FULL = 'var data = aq.from([\n  { category: "A", value: 10 },\n  { category: "B", value: 25 }\n])'

describe('cursor mid-statement (object/array literals)', () => {
  it('cursor on first interior row returns full statement', () => {
    expect(getStatementAtCursor(MID_DOC, 4, 2, 9)).toBe(MID_FULL)
  })

  it('cursor on last interior row returns full statement', () => {
    expect(getStatementAtCursor(MID_DOC, 5, 2, 9)).toBe(MID_FULL)
  })

  it('cursor on closing bracket line returns full statement', () => {
    expect(getStatementAtCursor(MID_DOC, 6, 2, 9)).toBe(MID_FULL)
  })

  it('the line after the multi-line block is unaffected', () => {
    expect(getStatementAtCursor(MID_DOC, 7, 2, 9)).toBe('var x = 1')
  })
})

// ── Deeply nested object like Plot.plot (the regressions case) ───────────────

const PLOT_DOC = `# Chart

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
// chunk 2-12, code lines 3-11
const PLOT_FULL = 'var chart = Plot.plot({\n' +
  '  marginLeft: 50,\n' +
  '  style: { background: "transparent", color: "#cdd6f4", fontSize: "12px" },\n' +
  '  marks: [\n' +
  '    Plot.barY(data.objects(), { x: "category", y: "value", fill: "region" }),\n' +
  '    Plot.ruleY([0]),\n' +
  '  ],\n' +
  '})'

describe('cursor mid-statement — deeply nested (Plot.plot)', () => {
  it('cursor on opening line returns full statement', () => {
    expect(getStatementAtCursor(PLOT_DOC, 3, 2, 12)).toBe(PLOT_FULL)
  })

  it('cursor on interior marks-array line returns full statement', () => {
    expect(getStatementAtCursor(PLOT_DOC, 7, 2, 12)).toBe(PLOT_FULL)
  })

  it('cursor on Plot.ruleY line returns full statement', () => {
    expect(getStatementAtCursor(PLOT_DOC, 8, 2, 12)).toBe(PLOT_FULL)
  })

  it('cursor on 2nd-to-last line (],) returns full statement', () => {
    expect(getStatementAtCursor(PLOT_DOC, 9, 2, 12)).toBe(PLOT_FULL)
  })

  it('cursor on closing }) returns full statement', () => {
    expect(getStatementAtCursor(PLOT_DOC, 10, 2, 12)).toBe(PLOT_FULL)
  })

  it('line after the block is not contaminated', () => {
    expect(getStatementAtCursor(PLOT_DOC, 11, 2, 12)).toBe('var x = 1')
  })
})

// ── Incomplete statement that hits chunk boundary ─────────────────────────────

const UNCLOSED_DOC = `# Test

\`\`\`js
var a = [
  1, 2, 3,
\`\`\``
// chunk 2-5, code lines 3-4 (closing bracket is missing)

describe('incomplete statement at chunk boundary', () => {
  it('returns content from cursor to end of chunk code', () => {
    const result = getStatementAtCursor(UNCLOSED_DOC, 3, 2, 5)
    // Never completes, but should not throw and should return something
    expect(typeof result).toBe('string')
    expect(result).toContain('var a = [')
  })
})

// ── Genuine syntax error ──────────────────────────────────────────────────────

const ERR_DOC = `# Test

\`\`\`js
const ok = 1
const bad = @@@
const after = 2
\`\`\``
// chunk 2-6

describe('genuine syntax error', () => {
  it('returns the bad line alone (not the following lines)', () => {
    expect(getStatementAtCursor(ERR_DOC, 4, 2, 6)).toBe('const bad = @@@')
  })

  it('lines after bad line still work independently', () => {
    expect(getStatementAtCursor(ERR_DOC, 5, 2, 6)).toBe('const after = 2')
  })
})

// ── Cursor outside a chunk ───────────────────────────────────────────────────

describe('cursor outside a chunk', () => {
  it('returns null when cursor is on the opening fence', () => {
    expect(getStatementAtCursor(DOC, 2, CS, CE)).toBeNull()
  })

  it('returns null when cursor is on the closing fence', () => {
    expect(getStatementAtCursor(DOC, 9, CS, CE)).toBeNull()
  })

  it('returns null when cursor is before the chunk', () => {
    expect(getStatementAtCursor(DOC, 0, CS, CE)).toBeNull()
  })

  it('returns null when cursor is after the chunk', () => {
    expect(getStatementAtCursor(DOC, 15, CS, CE)).toBeNull()
  })
})

// ── Never expands past chunk end ─────────────────────────────────────────────

const TWO_CHUNKS_DOC = `# Test

\`\`\`js
const a = 1
\`\`\`

\`\`\`js
const b = 2
\`\`\``

describe('chunk boundary safety', () => {
  it('does not include code from a later chunk', () => {
    const result = getStatementAtCursor(TWO_CHUNKS_DOC, 3, 2, 4)
    expect(result).toBe('const a = 1')
    expect(result).not.toContain('const b')
  })
})

// ── getStatementInfoAtCursor — endLine values ─────────────────────────────────

describe('getStatementInfoAtCursor — endLine for cursor advancement', () => {
  it('single-line statement: endLine equals the cursor line', () => {
    const info = getStatementInfoAtCursor(PLOT_DOC, 11, 2, 12)
    expect(info).toMatchObject({ code: 'var x = 1', endLine: 11 })
  })

  it('cursor at statement start: endLine is the actual closing line', () => {
    const info = getStatementInfoAtCursor(PLOT_DOC, 3, 2, 12)
    expect(info).toMatchObject({ code: PLOT_FULL, endLine: 10 })
  })

  it('cursor mid-statement: endLine is still the closing line (not the cursor line)', () => {
    // Cursor is on line 9 (],) but statement ends on line 10 (})
    const info = getStatementInfoAtCursor(PLOT_DOC, 9, 2, 12)
    expect(info?.endLine).toBe(10)
    expect(info?.code).toBe(PLOT_FULL)
  })

  it('returns null when cursor is outside the chunk', () => {
    expect(getStatementInfoAtCursor(PLOT_DOC, 0, 2, 12)).toBeNull()
  })
})

// ── findChunkAtLine — display vs. executable ──────────────────────────────────
//
// findChunkAtLine only locates EXECUTABLE (braced) chunks.
// Cursor inside a display chunk (```js without braces) returns null.

const MIXED_DOC = `# Mixed

\`\`\`js
var display = 1
\`\`\`

\`\`\`{js}
var exec = 2
\`\`\``
// display chunk: 0-indexed lines 2-4
// executable chunk: 0-indexed lines 6-8

describe('findChunkAtLine — display vs executable', () => {
  it('returns null for a cursor inside a display chunk (```js)', () => {
    expect(findChunkAtLine(MIXED_DOC, 3)).toBeNull()
  })

  it('returns bounds for a cursor inside an executable chunk (```{js})', () => {
    const chunk = findChunkAtLine(MIXED_DOC, 7)
    expect(chunk).not.toBeNull()
    expect(chunk.startLine).toBe(6)
    expect(chunk.endLine).toBe(8)
  })

  it('returns null for a cursor on the prose between chunks', () => {
    expect(findChunkAtLine(MIXED_DOC, 5)).toBeNull()
  })

  it('returns null when the cursor is outside any chunk', () => {
    expect(findChunkAtLine(MIXED_DOC, 0)).toBeNull()
  })

  it('returns null when cursor is on the opening fence of a display chunk', () => {
    expect(findChunkAtLine(MIXED_DOC, 2)).toBeNull()
  })

  it('returns null when cursor is on the opening fence of an executable chunk', () => {
    // cursor on the fence line itself — not strictly inside
    expect(findChunkAtLine(MIXED_DOC, 6)).toBeNull()
  })
})
