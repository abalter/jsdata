// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { segmentDocument, renderPreview } from '../src/preview.js'
import { ChunkType } from '../src/chunkDetection.js'

// ── segmentDocument ──────────────────────────────────────────────────────────

describe('segmentDocument', () => {
  it('returns empty array for empty string', () => {
    expect(segmentDocument('')).toEqual([])
  })

  it('returns empty array for whitespace-only string', () => {
    expect(segmentDocument('   \n  ')).toEqual([])
  })

  it('returns single prose segment when there are no chunks', () => {
    const segs = segmentDocument('# Hello\n\nSome text')
    expect(segs).toHaveLength(1)
    expect(segs[0].type).toBe('prose')
    expect(segs[0].text).toBe('# Hello\n\nSome text')
  })

  it('returns single chunk segment when document is only a chunk', () => {
    const doc = '```{js}\nconsole.log(1)\n```'
    const segs = segmentDocument(doc)
    expect(segs).toHaveLength(1)
    expect(segs[0].type).toBe('chunk')
    expect(segs[0].chunk.type).toBe(ChunkType.EXECUTABLE)
  })

  it('identifies display chunks (```js) vs executable chunks (```{js})', () => {
    const doc = '```js\nlet x = 1\n```'
    const segs = segmentDocument(doc)
    expect(segs).toHaveLength(1)
    expect(segs[0].type).toBe('chunk')
    expect(segs[0].chunk.type).toBe(ChunkType.DISPLAY)
  })

  it('produces prose-chunk-prose for a typical document', () => {
    const doc = '# Title\n\nIntro\n\n```{js}\nfoo()\n```\n\nConclusion'
    const segs = segmentDocument(doc)
    expect(segs).toHaveLength(3)
    expect(segs[0].type).toBe('prose')
    expect(segs[1].type).toBe('chunk')
    expect(segs[2].type).toBe('prose')
    expect(segs[2].text).toContain('Conclusion')
  })

  it('handles document starting with a chunk', () => {
    const doc = '```{js}\nfoo()\n```\n\nProse after'
    const segs = segmentDocument(doc)
    expect(segs).toHaveLength(2)
    expect(segs[0].type).toBe('chunk')
    expect(segs[1].type).toBe('prose')
  })

  it('handles document ending with a chunk', () => {
    const doc = 'Prose before\n\n```{js}\nfoo()\n```'
    const segs = segmentDocument(doc)
    expect(segs).toHaveLength(2)
    expect(segs[0].type).toBe('prose')
    expect(segs[1].type).toBe('chunk')
  })

  it('handles multiple chunks with prose between each', () => {
    const doc = '# Title\n\n```{js}\na()\n```\n\nMiddle\n\n```{js}\nb()\n```\n\nEnd'
    const segs = segmentDocument(doc)
    expect(segs).toHaveLength(5)
    const types = segs.map(s => s.type)
    expect(types).toEqual(['prose', 'chunk', 'prose', 'chunk', 'prose'])
  })

  it('handles adjacent chunks with no prose between them', () => {
    const doc = '```{js}\na()\n```\n```{js}\nb()\n```'
    const segs = segmentDocument(doc)
    expect(segs).toHaveLength(2)
    expect(segs.every(s => s.type === 'chunk')).toBe(true)
  })

  it('preserves chunk code content', () => {
    const doc = '```{js}\nvar x = 42\n```'
    const segs = segmentDocument(doc)
    expect(segs[0].chunk.code).toBe('var x = 42')
  })

  it('preserves chunk options', () => {
    const doc = '```{js, eval=false}\nfoo()\n```'
    const segs = segmentDocument(doc)
    expect(segs[0].chunk.options.eval).toBe(false)
  })

  it('preserves chunk line numbers', () => {
    const doc = 'Prose\n\n```{js}\ncode()\n```'
    const segs = segmentDocument(doc)
    const chunk = segs.find(s => s.type === 'chunk').chunk
    expect(chunk.startLine).toBe(3)
    expect(chunk.endLine).toBe(5)
  })
})

// ── renderPreview ────────────────────────────────────────────────────────────

describe('renderPreview', () => {
  it('renders prose as HTML via marked', () => {
    const html = renderPreview('# My Title', new Map())
    expect(html).toContain('<h1>')
    expect(html).toContain('My Title')
  })

  it('renders display chunk as syntax-highlighted code block', () => {
    const doc = '```js\nvar x = 1\n```'
    const html = renderPreview(doc, new Map())
    expect(html).toContain('preview-code')
    expect(html).toContain('hljs')
  })

  it('shows "not yet run" placeholder for unrun executable chunk', () => {
    const doc = '```{js}\nfoo()\n```'
    const html = renderPreview(doc, new Map())
    expect(html).toContain('chunk-not-run')
    expect(html).toContain('Not yet run')
  })

  it('shows captured output for a run executable chunk', () => {
    const doc = '```{js}\nfoo()\n```'
    // chunk endLine = 3
    const outputs = new Map([[3, '<p>Hello output</p>']])
    const html = renderPreview(doc, outputs)
    expect(html).toContain('chunk-output-preview')
    expect(html).toContain('Hello output')
    expect(html).not.toContain('chunk-not-run')
  })

  it('shows code block for echo=true on executable chunk', () => {
    const doc = '```{js, echo=true}\nvar x = 1\n```'
    const outputs = new Map([[3, '<p>Result</p>']])
    const html = renderPreview(doc, outputs)
    expect(html).toContain('preview-code')
    expect(html).toContain('chunk-output-preview')
  })

  it('sanitizes XSS in output HTML', () => {
    const doc = '```{js}\nfoo()\n```'
    const malicious = '<script>alert("xss")</script><p>Safe</p>'
    const outputs = new Map([[3, malicious]])
    const html = renderPreview(doc, outputs)
    expect(html).not.toContain('<script>')
    expect(html).toContain('Safe')
  })

  it('renders mixed document in order', () => {
    const doc = '# Title\n\n```{js}\nfoo()\n```\n\nProse end'
    const html = renderPreview(doc, new Map())
    const titleIdx = html.indexOf('<h1>')
    const chunkIdx = html.indexOf('chunk-not-run')
    const proseIdx = html.indexOf('Prose end')
    expect(titleIdx).toBeLessThan(chunkIdx)
    expect(chunkIdx).toBeLessThan(proseIdx)
  })

  it('does not show code block for executable chunk without echo', () => {
    const doc = '```{js}\nvar secret = 1\n```'
    const html = renderPreview(doc, new Map())
    expect(html).not.toContain('preview-code')
    expect(html).toContain('chunk-not-run')
  })

  it('does not show output placeholder for display chunks', () => {
    const doc = '```js\nvar x = 1\n```'
    const html = renderPreview(doc, new Map())
    expect(html).not.toContain('chunk-not-run')
    expect(html).not.toContain('chunk-output-preview')
  })
})
