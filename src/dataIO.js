// ── Data I/O helpers ──────────────────────────────────────────────────────────
// Provides loadCSV(), loadJSON(), loadFile() injected into the session scope.
// consolePrint: (str) => void — writes a line to the xterm terminal
// formatForConsole: (value) => string — tibble/JSON formatter from main.js

const SIZE_WARN_BYTES = 10 * 1024 * 1024  // 10 MB

function nameFromUrl(url) {
  try { return new URL(url).pathname.split('/').filter(Boolean).pop() || url }
  catch { return url }
}

export function createDataIOHelpers(consolePrint, formatForConsole) {
  // ── Internal helpers ──────────────────────────────────────────────────────

  function printLoaded(name, table) {
    consolePrint('\x1b[32mLoaded: ' + name + '\x1b[0m')
    const preview = formatForConsole(table)
    if (preview) consolePrint(preview)
  }

  function warnIfLarge(size, name) {
    if (size > SIZE_WARN_BYTES) {
      const mb = (size / 1024 / 1024).toFixed(1)
      consolePrint(`\x1b[33mWarning: large file (${mb}MB), this may be slow\x1b[0m`)
    }
  }

  async function pickFile(accept) {
    const hasNativeFS = typeof window.showOpenFilePicker === 'function'
    if (hasNativeFS) {
      const [handle] = await window.showOpenFilePicker({ types: [accept] })
      const file = await handle.getFile()
      return { name: file.name, size: file.size, text: await file.text() }
    } else {
      // Fallback: promise-wrapped input
      return new Promise((resolve, reject) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = Object.values(accept.accept).flat().join(',')
        input.onchange = async () => {
          const file = input.files[0]
          if (!file) { reject(new DOMException('', 'AbortError')); return }
          resolve({ name: file.name, size: file.size, text: await file.text() })
        }
        input.oncancel = () => reject(new DOMException('', 'AbortError'))
        input.click()
      })
    }
  }

  async function fetchText(url) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`)
    const text = await res.text()
    const size = new Blob([text]).size
    return { name: nameFromUrl(url), size, text }
  }

  // ── loadCSV ───────────────────────────────────────────────────────────────

  async function loadCSV(source) {
    try {
      let info
      if (typeof source === 'string' && (source.startsWith('http') || source.startsWith('/'))) {
        info = await fetchText(source)
      } else {
        info = await pickFile({
          description: 'CSV files',
          accept: { 'text/csv': ['.csv', '.tsv', '.txt'] },
        })
      }
      warnIfLarge(info.size, info.name)
      const table = aq.fromCSV(info.text, { autoType: true })
      printLoaded(info.name, table)
      return table
    } catch (e) {
      if (e.name === 'AbortError') return null
      consolePrint('\x1b[31m' + (e.message || String(e)) + '\x1b[0m')
      return null
    }
  }

  // ── loadJSON ──────────────────────────────────────────────────────────────

  async function loadJSON(source) {
    try {
      let info
      if (typeof source === 'string' && (source.startsWith('http') || source.startsWith('/'))) {
        info = await fetchText(source)
      } else {
        info = await pickFile({
          description: 'JSON files',
          accept: { 'application/json': ['.json'] },
        })
      }
      warnIfLarge(info.size, info.name)
      const parsed = JSON.parse(info.text)
      // Array of objects → Arquero table; anything else → plain JS value
      let result
      if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
        result = aq.from(parsed)
      } else {
        result = parsed
      }
      consolePrint('\x1b[32mLoaded: ' + info.name + '\x1b[0m')
      const preview = formatForConsole(result)
      if (preview) consolePrint(preview)
      return result
    } catch (e) {
      if (e.name === 'AbortError') return null
      consolePrint('\x1b[31m' + (e.message || String(e)) + '\x1b[0m')
      return null
    }
  }

  // ── loadFile ──────────────────────────────────────────────────────────────

  async function loadFile(source) {
    try {
      let info
      if (typeof source === 'string' && (source.startsWith('http') || source.startsWith('/'))) {
        info = await fetchText(source)
      } else {
        info = await pickFile({
          description: 'All files',
          accept: { '*/*': [] },
        })
      }
      warnIfLarge(info.size, info.name)
      consolePrint('\x1b[32mLoaded: ' + info.name + ' (' + info.size.toLocaleString() + ' bytes)\x1b[0m')
      return info.text
    } catch (e) {
      if (e.name === 'AbortError') return null
      consolePrint('\x1b[31m' + (e.message || String(e)) + '\x1b[0m')
      return null
    }
  }

  return { loadCSV, loadJSON, loadFile }
}
