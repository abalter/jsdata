// ── chunkDetection.js ─────────────────────────────────────────────────────────
// Remark-based detection of JS code blocks in a Markdown document.
//
// Convention (matches Quarto):
//   ```js        → display only.  Syntax highlighted, never executed.
//   ```{js}      → executable chunk.  Runs with inline output and control buttons.
//   ```{js, ...} → executable chunk with options (eval, label, etc.)
//
// The distinction is purely syntactic: curly braces around the lang = executable.

import { unified }   from 'unified'
import remarkParse   from 'remark-parse'

// ── Chunk type ────────────────────────────────────────────────────────────────

export const ChunkType = {
  EXECUTABLE: 'executable',
  DISPLAY:    'display',
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Returns true for remark code nodes whose lang is JS (display or executable).
 * Matches: js, {js}, {js, ...}, {js ...}
 */
function isJsNode(node) {
  const lang = (node.lang || '').trim()
  return /^\{?\s*js[\s,}]?/.test(lang) || lang === 'js'
}

/**
 * Returns true if the lang string is an executable (braced) chunk.
 * Braces are the Quarto/Knitr convention: ```{js}
 *
 * Remark splits the info string at the first space, so:
 *   ```{js, eval=false}  → node.lang = "{js,"    — trailing comma present
 *   ```{js label=foo}    → node.lang = "{js"      — string ends after "js"
 *   ```{js}              → node.lang = "{js}"     — trailing brace present
 *
 * We match `{js` optionally followed by [\s,}] to cover the first two cases,
 * plus end-of-string for the third.
 */
function isExecutableLang(lang) {
  return /^\{\s*js([\s,}]|$)/.test((lang || '').trim())
}

// ── parseChunkOptions ─────────────────────────────────────────────────────────

/**
 * Parse key=value option pairs from an executable chunk's info string.
 *
 * Remark splits the info string on the first space:
 *   ```{js, eval=false, label=foo}  →  lang="{js,"  meta="eval=false, label=foo}"
 *   ```{js}                          →  lang="{js}"  meta=null
 *
 * We recombine lang+meta then strip the outer braces and the language name.
 *
 * Supported option types:
 *   true/false  → boolean
 *   integers    → number
 *   bare words  → string (treated as .label if no key= prefix)
 *   "strings"   → string with quotes stripped
 */
export function parseChunkOptions(lang, meta) {
  const raw   = ((lang || '') + (meta ? ' ' + meta : '')).trim()
  const inner = raw.replace(/^\{?\s*js\s*,?\s*/, '').replace(/\}$/, '').trim()
  if (!inner) return {}

  const opts = {}
  for (const part of inner.split(/,\s*/)) {
    const m = part.match(/^\s*(\w+)\s*=\s*(.+?)\s*$/)
    if (m) {
      const [, key, val] = m
      if      (val === 'true')                    opts[key] = true
      else if (val === 'false')                   opts[key] = false
      else if (/^-?\d+(\.\d+)?$/.test(val))       opts[key] = Number(val)
      else                                         opts[key] = val.replace(/^["']|["']$/g, '')
    } else {
      const trimmed = part.trim()
      if (trimmed) opts.label = trimmed
    }
  }
  return opts
}

// ── getChunks ─────────────────────────────────────────────────────────────────

/**
 * Returns all JS code blocks in the document in document order.
 *
 * Each entry:
 *   {
 *     type:      'executable' | 'display'
 *     lang:      'js'
 *     code:      string              — content between fences
 *     options:   {}                  — parsed from ```{js, key=val}; always {} for display
 *     startLine: number              — 1-based line of opening fence
 *     endLine:   number              — 1-based line of closing fence
 *   }
 */
export function getChunks(docText) {
  const tree = unified().use(remarkParse).parse(docText)
  return tree.children
    .filter(node => node.type === 'code' && isJsNode(node))
    .map(node => {
      const executable = isExecutableLang(node.lang)
      return {
        type:      executable ? ChunkType.EXECUTABLE : ChunkType.DISPLAY,
        lang:      'js',
        code:      node.value,
        options:   executable ? parseChunkOptions(node.lang, node.meta) : {},
        startLine: node.position.start.line,   // 1-based
        endLine:   node.position.end.line,
      }
    })
}

// ── getChunkAtLine ────────────────────────────────────────────────────────────

/**
 * Returns the JS chunk that contains the given 1-based line, or null.
 * Includes both display and executable chunks.
 */
export function getChunkAtLine(docText, line) {
  return getChunks(docText).find(c => line >= c.startLine && line <= c.endLine) ?? null
}
