import { marked } from 'marked'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import { getChunks, ChunkType } from './chunkDetection.js'

hljs.registerLanguage('javascript', javascript)

/**
 * Split a document into alternating prose and chunk segments.
 * @param {string} docText
 * @returns {Array<{type:'prose',text:string}|{type:'chunk',chunk:object}>}
 */
export function segmentDocument(docText) {
  const chunks = getChunks(docText)
  const lines = docText.split('\n')
  const segments = []
  let lineIdx = 1  // 1-based current position

  for (const chunk of chunks) {
    if (chunk.startLine > lineIdx) {
      const text = lines.slice(lineIdx - 1, chunk.startLine - 1).join('\n')
      if (text.trim()) segments.push({ type: 'prose', text })
    }
    segments.push({ type: 'chunk', chunk })
    lineIdx = chunk.endLine + 1
  }

  // Trailing prose after last chunk
  if (lineIdx <= lines.length) {
    const text = lines.slice(lineIdx - 1).join('\n')
    if (text.trim()) segments.push({ type: 'prose', text })
  }

  return segments
}

function highlightCode(code) {
  try {
    return hljs.highlight(code, { language: 'javascript' }).value
  } catch {
    return code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
}

/**
 * Render a preview HTML string from document text and captured chunk outputs.
 * @param {string} docText
 * @param {Map<number,string>} chunkOutputs  endLine (1-based) → innerHTML
 * @returns {string} sanitized HTML ready to set as innerHTML
 */
export function renderPreview(docText, chunkOutputs) {
  const segments = segmentDocument(docText)
  const parts = []

  for (const seg of segments) {
    if (seg.type === 'prose') {
      const html = marked.parse(seg.text)
      parts.push(DOMPurify.sanitize(html))
    } else {
      const { chunk } = seg
      let html = ''

      // Show source code for display chunks or when echo=true
      if (chunk.type === ChunkType.DISPLAY || chunk.options.echo === true) {
        const highlighted = highlightCode(chunk.code)
        const summaryText = chunk.type === ChunkType.DISPLAY
          ? `${chunk.lang || 'js'} code`
          : 'source'
        html += `<details class="preview-code-block" open>
  <summary>${summaryText}</summary>
  <pre><code class="hljs language-javascript">${highlighted}</code></pre>
</details>`
      }

      // Show output (or placeholder) for executable chunks
      if (chunk.type === ChunkType.EXECUTABLE) {
        if (chunkOutputs.has(chunk.endLine)) {
          const raw = chunkOutputs.get(chunk.endLine)
          const sanitized = DOMPurify.sanitize(raw, { FORCE_BODY: true })
          html += `<div class="chunk-output-preview">${sanitized}</div>`
        } else {
          html += `<div class="chunk-not-run">&#9657; Not yet run</div>`
        }
      }

      if (html) parts.push(html)
    }
  }

  return parts.join('\n')
}
