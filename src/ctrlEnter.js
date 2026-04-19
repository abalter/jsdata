// ── ctrlEnter.js ──────────────────────────────────────────────────────────────
// Self-contained Ctrl+Enter handler for the JSAnalyst editor.
//
// External dependencies: acorn, @codemirror/view, @codemirror/state
// Internal dependencies: NONE — evalFn is the only connection to the rest of
// the app, injected at creation time via createCtrlEnterExtension(evalFn).

import { parse } from 'acorn'
import { keymap } from '@codemirror/view'
import { Prec } from '@codemirror/state'

// ── Acorn completeness test ───────────────────────────────────────────────────

/**
 * @returns {{ complete: boolean, invalid: boolean }}
 *   complete=true  → valid, finished statement
 *   complete=false, invalid=false → valid so far but cut off ("unexpected end")
 *   complete=false, invalid=true  → genuine syntax error mid-code
 */
function isComplete(code) {
  try {
    parse(code, { ecmaVersion: 2020, sourceType: 'module' })
    return { complete: true, invalid: false }
  } catch (e) {
    const msg = e.message || ''
    // acorn sets e.pos at the character position where parsing failed.
    // If that position is at or past the trimmed end of the code, the fragment
    // is valid so far but was cut off — it needs more input.
    const trimmedLen = code.trimEnd().length
    const errorPos   = e.pos ?? e.raisedAt ?? null
    const atEnd = (errorPos != null && errorPos >= trimmedLen)

    if (atEnd || msg.includes('Unexpected end of input')) {
      return { complete: false, invalid: false }
    }
    return { complete: false, invalid: true }
  }
}

// ── Chunk finder (pure, uses only the document text string) ──────────────────

// Matches the opening fence of an EXECUTABLE JS chunk only: ```{js}, ```{js, ...}, ```{js ...}
// Display-only blocks (```js without braces) do NOT match — Ctrl+Enter is a no-op inside them.
const FENCE_OPEN  = /^```\s*\{\s*js[\s,}]/
const FENCE_CLOSE = /^```\s*$/

/**
 * Find the executable chunk that contains cursorLine (0-indexed).
 * Returns { startLine, endLine } (both 0-indexed, pointing at the fence lines)
 * or null if the cursor is not inside an executable chunk.
 * Display chunks (```js without braces) always return null.
 */
export function findChunkAtLine(docText, cursorLine) {
  const lines = docText.split('\n')
  let openLine = null

  for (let i = 0; i < lines.length; i++) {
    if (openLine === null) {
      if (FENCE_OPEN.test(lines[i])) {
        openLine = i
      }
    } else {
      if (FENCE_CLOSE.test(lines[i])) {
        const closeL = i
        // cursor must be strictly inside the fences (not on the fences themselves)
        if (cursorLine > openLine && cursorLine < closeL) {
          return { startLine: openLine, endLine: closeL }
        }
        openLine = null
      }
    }
  }
  return null
}

// ── Pure statement-at-cursor extraction ──────────────────────────────────────

/**
 * Internal: returns { code, endLine } where endLine is the 0-indexed *document*
 * line of the last line of the statement, or null if cursor is outside a chunk.
 */
function _getStatementInfo(docText, cursorLine, chunkStart, chunkEnd) {
  if (cursorLine <= chunkStart || cursorLine >= chunkEnd) return null

  const lines     = docText.split('\n')
  const codeLines = lines.slice(chunkStart + 1, chunkEnd)  // lines between fences
  const cursorIdx = cursorLine - (chunkStart + 1)           // 0-indexed within codeLines

  if (cursorIdx < 0 || cursorIdx >= codeLines.length) return null

  // endLine in doc coords from a codeLines index
  const docLine = idx => chunkStart + 1 + idx

  // Phase 1: try expanding downward from the cursor line.
  let foundInvalidInPhase1 = false
  for (let endIdx = cursorIdx; endIdx < codeLines.length; endIdx++) {
    const candidate = codeLines.slice(cursorIdx, endIdx + 1).join('\n')
    const { complete, invalid } = isComplete(candidate)

    if (complete) return { code: candidate, endLine: docLine(endIdx) }

    if (invalid) {
      foundInvalidInPhase1 = true
      break
    }
  }

  if (!foundInvalidInPhase1) {
    // Phase 1 ran out of lines without completing — return cursor-to-end.
    return { code: codeLines.slice(cursorIdx).join('\n'), endLine: docLine(codeLines.length - 1) }
  }

  // Phase 2: cursor is mid-statement — walk upward to find the statement start.
  for (let startIdx = cursorIdx - 1; startIdx >= 0; startIdx--) {
    const toHere = codeLines.slice(startIdx, cursorIdx + 1).join('\n')
    const { complete: c, invalid: inv } = isComplete(toHere)

    if (inv) continue  // still broken going this far up; keep searching

    if (c) return { code: toHere, endLine: docLine(cursorIdx) }

    // Incomplete but not invalid: try expanding downward from this start.
    // If expansion hits 'invalid' before completing, this startIdx is a false positive
    // (e.g. acorn sees "marks: [...]" as a LabeledStatement fragment while it's actually
    // an object property interior).  In that case, continue searching further upward.
    let hitInvalidOnExpand = false
    for (let endIdx = cursorIdx + 1; endIdx < codeLines.length; endIdx++) {
      const candidate = codeLines.slice(startIdx, endIdx + 1).join('\n')
      const { complete, invalid } = isComplete(candidate)
      if (complete) return { code: candidate, endLine: docLine(endIdx) }
      if (invalid) { hitInvalidOnExpand = true; break }
    }

    if (!hitInvalidOnExpand) {
      // Inner loop ran out of lines without finding invalid — statement is genuinely
      // unclosed at the chunk boundary.  Return everything from here to chunk end.
      return { code: codeLines.slice(startIdx).join('\n'), endLine: docLine(codeLines.length - 1) }
    }
    // hitInvalidOnExpand — false positive; continue the upward search.
  }

  // No valid start found — genuinely broken line; return it alone for a useful error.
  return { code: codeLines[cursorIdx], endLine: docLine(cursorIdx) }
}

/**
 * Returns the complete JS statement at `cursorLine` as a plain string,
 * or null if the cursor is outside a chunk.  All line numbers are 0-indexed.
 */
export function getStatementAtCursor(docText, cursorLine, chunkStart, chunkEnd) {
  const result = _getStatementInfo(docText, cursorLine, chunkStart, chunkEnd)
  return result ? result.code : null
}

/**
 * Like getStatementAtCursor but also returns the statement's last doc line.
 * @returns {{ code: string, endLine: number } | null}
 *   endLine is 0-indexed document line of the last line of the statement.
 */
export function getStatementInfoAtCursor(docText, cursorLine, chunkStart, chunkEnd) {
  return _getStatementInfo(docText, cursorLine, chunkStart, chunkEnd)
}

// ── CodeMirror extension ──────────────────────────────────────────────────────

/**
 * Create the Ctrl+Enter CodeMirror extension.
 *
 * @param {(code: string, endLine: number|null) => void} evalFn
 *   Called with the statement text and the 1-indexed document line of the
 *   chunk's closing fence (for inline output anchoring).  Pass null when the
 *   statement originates from a selection rather than a located chunk.
 *
 * @returns A CodeMirror extension — add it once to the editor, never recreate.
 */
export function createCtrlEnterExtension(evalFn) {
  return Prec.highest(keymap.of([{
    key: 'Ctrl-Enter',
    run(view) {
      const doc     = view.state.doc
      const sel     = view.state.selection.main
      const docText = doc.toString()

      // ── Selection mode ────────────────────────────────────────────────────
      if (!sel.empty) {
        const code    = doc.sliceString(sel.from, sel.to)
        const selLine = doc.lineAt(sel.to).number - 1  // 0-indexed
        const chunk   = findChunkAtLine(docText, selLine)
        evalFn(code, chunk ? chunk.endLine + 1 : null)  // endLine → 1-indexed for caller
        return true
      }

      // ── Cursor mode ───────────────────────────────────────────────────────
      const cursorLine = doc.lineAt(sel.head).number - 1  // 0-indexed
      const chunk      = findChunkAtLine(docText, cursorLine)
      if (!chunk) return false  // not in a chunk — let other handlers proceed

      const result = getStatementInfoAtCursor(docText, cursorLine, chunk.startLine, chunk.endLine)
      if (!result) return false

      const { code: statement, endLine: statementEndLine } = result

      evalFn(statement, chunk.endLine + 1)  // chunk.endLine+1 is 1-indexed fence line

      // Advance cursor to the line *after* the statement actually ends.
      // Using statementEndLine (not cursorLine) handles mid-statement cursors correctly.
      const nextDocLine0     = statementEndLine + 1       // 0-indexed next line
      const chunkLastCode0   = chunk.endLine - 1          // 0-indexed last code line before fence
      if (nextDocLine0 <= chunkLastCode0) {
        const nextLine = doc.line(nextDocLine0 + 1)       // doc.line uses 1-indexed
        view.dispatch({ selection: { anchor: nextLine.from }, scrollIntoView: true })
      }

      return true
    },
  }]))
}
