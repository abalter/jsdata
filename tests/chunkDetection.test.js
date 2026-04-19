/**
 * tests/chunkDetection.test.js
 *
 * Tests for the remark-based chunk detection logic.
 *
 * NOTE: `getChunks` and `parseChunkOptions` are currently embedded in src/main.js
 * and are not exported. These tests reimplement the same logic using the same
 * remark/unified dependencies so they test the behaviour (and catch dependency
 * API regressions) without requiring a DOM or import of main.js.
 *
 * Once these functions are extracted to src/chunkDetection.js, replace the local
 * definitions below with:
 *
 *   import { getChunks, parseChunkOptions } from '../src/chunkDetection.js'
 *
 * and delete the local copies.
 */

import { describe, it, expect } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'

// ── Local copies of the functions under test ──────────────────────────────────
// Copied verbatim from src/main.js.  Any divergence between this copy and the
// main.js originals means these tests no longer catch regressions in the app.

function parseChunkOptions(lang, meta) {
  const raw = ((lang || '') + (meta ? ' ' + meta : '')).trim()
  const inner = raw.replace(/^\{?\s*js\s*,?\s*/, '').replace(/\}$/, '').trim()
  if (!inner) return {}
  const opts = {}
  for (const part of inner.split(/,\s*/)) {
    const m = part.match(/^\s*(\w+)\s*=\s*(.+?)\s*$/)
    if (m) {
      const [, key, val] = m
      if (val === 'true') opts[key] = true
      else if (val === 'false') opts[key] = false
      else if (/^-?\d+(\.\d+)?$/.test(val)) opts[key] = Number(val)
      else opts[key] = val.replace(/^["']|["']$/g, '')
    } else {
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function parse(docText) {
  return unified().use(remarkParse).parse(docText)
}

// ── Single chunk ──────────────────────────────────────────────────────────────

describe('single chunk', () => {
  const doc = `# Title

\`\`\`js
var x = 1
\`\`\``

  it('detects exactly one chunk', () => {
    expect(getChunks(doc)).toHaveLength(1)
  })

  it('chunk code is the content between fences', () => {
    expect(getChunks(doc)[0].code).toBe('var x = 1')
  })

  it('startLine is the 1-based line of the opening fence', () => {
    // Line 1: "# Title", line 2: blank, line 3: ```js
    expect(getChunks(doc)[0].startLine).toBe(3)
  })

  it('endLine is the 1-based line of the closing fence', () => {
    expect(getChunks(doc)[0].endLine).toBe(5)
  })
})

// ── Multiple chunks ───────────────────────────────────────────────────────────

describe('multiple chunks', () => {
  const doc = `# Analysis

\`\`\`js
var a = 1
\`\`\`

Some prose.

\`\`\`js
var b = 2
\`\`\``

  it('detects two chunks', () => {
    expect(getChunks(doc)).toHaveLength(2)
  })

  it('chunks are returned in document order', () => {
    const chunks = getChunks(doc)
    expect(chunks[0].code).toBe('var a = 1')
    expect(chunks[1].code).toBe('var b = 2')
  })

  it('first chunk startLine precedes second chunk startLine', () => {
    const [c1, c2] = getChunks(doc)
    expect(c1.startLine).toBeLessThan(c2.startLine)
  })
})

// ── Chunk with options header ─────────────────────────────────────────────────

describe('parseChunkOptions — options header parsing', () => {
  it('empty header returns empty object', () => {
    expect(parseChunkOptions('js', null)).toEqual({})
  })

  it('{js} syntax returns empty options', () => {
    expect(parseChunkOptions('{js}', null)).toEqual({})
  })

  it('eval=false is parsed as boolean false', () => {
    expect(parseChunkOptions('{js,', ' eval=false}')).toMatchObject({ eval: false })
  })

  it('eval=true is parsed as boolean true', () => {
    expect(parseChunkOptions('{js,', ' eval=true}')).toMatchObject({ eval: true })
  })

  it('label is parsed as a string', () => {
    expect(parseChunkOptions('{js,', ' label=my-chunk}')).toMatchObject({ label: 'my-chunk' })
  })

  it('numeric option is coerced to number', () => {
    expect(parseChunkOptions('{js,', ' rows=10}')).toMatchObject({ rows: 10 })
  })

  it('quoted string value has quotes stripped', () => {
    expect(parseChunkOptions('{js,', ' label="my chunk"}')).toMatchObject({ label: 'my chunk' })
  })

  it('multiple options are all parsed', () => {
    const opts = parseChunkOptions('{js,', ' eval=false, label=foo}')
    expect(opts).toMatchObject({ eval: false, label: 'foo' })
  })
})

describe('getChunks — chunk with options', () => {
  const doc = `\`\`\`{js, eval=false}
var x = 1
\`\`\``

  it('detects the chunk', () => {
    expect(getChunks(doc)).toHaveLength(1)
  })

  it('options.eval is false', () => {
    expect(getChunks(doc)[0].options.eval).toBe(false)
  })
})

// ── SQL chunk is NOT included ─────────────────────────────────────────────────

describe('non-JS chunks', () => {
  const doc = `\`\`\`sql
SELECT * FROM foo
\`\`\`

\`\`\`js
var x = 1
\`\`\``

  it('SQL chunk is not returned by getChunks', () => {
    const chunks = getChunks(doc)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].code).toBe('var x = 1')
  })

  it('plain markdown with no chunks returns empty array', () => {
    expect(getChunks('# Just prose\n\nNo code here.')).toHaveLength(0)
  })
})

// ── Edge positions ────────────────────────────────────────────────────────────

describe('chunk at start of document', () => {
  const doc = `\`\`\`js
var x = 1
\`\`\``

  it('detected correctly', () => {
    expect(getChunks(doc)).toHaveLength(1)
    expect(getChunks(doc)[0].startLine).toBe(1)
  })
})

describe('chunk at end of document', () => {
  const doc = `# Title

Some prose.

\`\`\`js
var x = 1
\`\`\``

  it('detected correctly', () => {
    const chunks = getChunks(doc)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].code).toBe('var x = 1')
  })
})

describe('adjacent chunks with no prose between them', () => {
  const doc = `\`\`\`js
var a = 1
\`\`\`
\`\`\`js
var b = 2
\`\`\``

  it('both chunks are detected', () => {
    expect(getChunks(doc)).toHaveLength(2)
  })

  it('chunks have sequential, non-overlapping line ranges', () => {
    const [c1, c2] = getChunks(doc)
    expect(c1.endLine).toBeLessThan(c2.startLine)
  })
})

// ── Indented/escaped code blocks are not treated as chunks ───────────────────
//
// remark only parses top-level fenced blocks as code nodes.  Fenced blocks
// inside block quotes (> ```js) or inline backticks are not exposed as
// standalone code nodes, so they are correctly excluded.

describe('fenced blocks inside markdown constructs are not detected', () => {
  it('inline code with backticks is not a chunk', () => {
    const doc = 'Use `\`\`\`js` to start a chunk.'
    expect(getChunks(doc)).toHaveLength(0)
  })

  it('four-space-indented block is not a fenced chunk', () => {
    // Indented code blocks in Markdown are not fenced blocks
    const doc = '    var x = 1\n    var y = 2'
    expect(getChunks(doc)).toHaveLength(0)
  })
})
