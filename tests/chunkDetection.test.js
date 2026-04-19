/**
 * tests/chunkDetection.test.js
 *
 * Tests for the remark-based chunk detection logic in src/chunkDetection.js.
 *
 * Convention (matches Quarto):
 *   ```js     → display only (type: 'display'). Never executed.
 *   ```{js}   → executable chunk (type: 'executable').
 */

import { describe, it, expect } from 'vitest'
import {
  getChunks,
  getChunkAtLine,
  parseChunkOptions,
  ChunkType,
} from '../src/chunkDetection.js'

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

// ── display vs. executable type ───────────────────────────────────────────────

describe('chunk type: display vs. executable', () => {
  it('```js  (no braces) is type display', () => {
    const doc = '```js\nvar x = 1\n```'
    expect(getChunks(doc)[0].type).toBe(ChunkType.DISPLAY)
  })

  it('```{js}  (braces) is type executable', () => {
    const doc = '```{js}\nvar x = 1\n```'
    expect(getChunks(doc)[0].type).toBe(ChunkType.EXECUTABLE)
  })

  it('```{js, eval=false}  is type executable', () => {
    const doc = '```{js, eval=false}\nvar x = 1\n```'
    expect(getChunks(doc)[0].type).toBe(ChunkType.EXECUTABLE)
  })

  it('```{js, eval=false}  has options parsed', () => {
    const doc = '```{js, eval=false}\nvar x = 1\n```'
    expect(getChunks(doc)[0].options.eval).toBe(false)
  })

  it('display chunk has empty options', () => {
    const doc = '```js\nvar x = 1\n```'
    expect(getChunks(doc)[0].options).toEqual({})
  })

  it('```{js label=my-chunk}  is executable with label option', () => {
    const doc = '```{js label=my-chunk}\nvar x = 1\n```'
    const chunk = getChunks(doc)[0]
    expect(chunk.type).toBe(ChunkType.EXECUTABLE)
    expect(chunk.options.label).toBe('my-chunk')
  })

  it('all chunks have lang: "js"', () => {
    const doc = '```js\nvar a = 1\n```\n\n```{js}\nvar b = 2\n```'
    for (const chunk of getChunks(doc)) {
      expect(chunk.lang).toBe('js')
    }
  })
})

// ── mixed document ────────────────────────────────────────────────────────────

describe('mixed document — display and executable chunks', () => {
  const doc = `# Analysis

This is a display example:

\`\`\`js
var note = "this is display only"
\`\`\`

This runs:

\`\`\`{js}
var result = 42
\`\`\`

Another display:

\`\`\`js
// reference code, not run
\`\`\`

Another executable:

\`\`\`{js, eval=false}
var skipped = true
\`\`\``

  it('detects 4 chunks total', () => {
    expect(getChunks(doc)).toHaveLength(4)
  })

  it('first chunk is display', () => {
    expect(getChunks(doc)[0].type).toBe(ChunkType.DISPLAY)
  })

  it('second chunk is executable', () => {
    expect(getChunks(doc)[1].type).toBe(ChunkType.EXECUTABLE)
  })

  it('third chunk is display', () => {
    expect(getChunks(doc)[2].type).toBe(ChunkType.DISPLAY)
  })

  it('fourth chunk is executable', () => {
    expect(getChunks(doc)[3].type).toBe(ChunkType.EXECUTABLE)
  })

  it('executable chunks with eval=false are still type executable', () => {
    const exec = getChunks(doc).filter(c => c.type === ChunkType.EXECUTABLE)
    expect(exec).toHaveLength(2)
    expect(exec[1].options.eval).toBe(false)
  })

  it('Run All skips display chunks and eval=false chunks', () => {
    // Simulate the runAll filter used in main.js
    const runnable = getChunks(doc).filter(
      c => c.type === ChunkType.EXECUTABLE && c.options.eval !== false
    )
    expect(runnable).toHaveLength(1)
    expect(runnable[0].code).toBe('var result = 42')
  })
})

// ── getChunkAtLine ────────────────────────────────────────────────────────────

describe('getChunkAtLine', () => {
  const doc = `# Title

\`\`\`js
var x = 1
\`\`\`

\`\`\`{js}
var y = 2
\`\`\``
  // display chunk: lines 3-5, executable chunk: lines 7-9

  it('returns the chunk containing the given line', () => {
    const chunk = getChunkAtLine(doc, 4)
    expect(chunk).not.toBeNull()
    expect(chunk.code).toBe('var x = 1')
  })

  it('returns null for a line between chunks', () => {
    expect(getChunkAtLine(doc, 6)).toBeNull()
  })

  it('getChunkAtLine on a display chunk returns type display', () => {
    const chunk = getChunkAtLine(doc, 4)
    expect(chunk?.type).toBe(ChunkType.DISPLAY)
  })

  it('getChunkAtLine on an executable chunk returns type executable', () => {
    const chunk = getChunkAtLine(doc, 8)
    expect(chunk?.type).toBe(ChunkType.EXECUTABLE)
  })
})
