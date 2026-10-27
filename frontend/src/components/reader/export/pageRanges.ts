/**
 * Page lists for the export panel (issue #207).
 *
 * Mirrors the server's parser (backend/services/page_export/spec.py) so the
 * panel can count pages and flag a mistake while the user types, instead of
 * after a round trip. The server still validates; this is for feedback only.
 */

const RANGE = /^(\d+)\s*(?:-\s*(\d+))?$/

/**
 * Parse "12-15, 20". Returns `{ pages }` or `{ error: { key, params } }`, where
 * `key` is an i18n key under `pageExport.errors`.
 */
export function parsePageSpec(spec, total) {
  const text = (spec || '').replace(/[\u2013\u2014]/g, '-').trim()
  if (!text) return { error: { key: 'empty' } }
  const pages = []
  const seen = new Set()
  for (const raw of text.split(',')) {
    const part = raw.trim()
    if (!part) continue
    const m = part.match(RANGE)
    if (!m) return { error: { key: 'notAPage', params: { part } } }
    let start = Number(m[1])
    let end = Number(m[2] ?? m[1])
    if (start > end) [start, end] = [end, start]
    if (start < 1) return { error: { key: 'fromOne' } }
    if (total && end > total) return { error: { key: 'pastEnd', params: { page: end, total } } }
    for (let p = start; p <= end; p++) {
      if (!seen.has(p)) {
        seen.add(p)
        pages.push(p)
      }
    }
  }
  if (!pages.length) return { error: { key: 'empty' } }
  return { pages }
}

/** "12", or "12-13" for a run of consecutive pages. */
export function formatPageSpec(pages) {
  if (!pages.length) return ''
  const first = pages[0]
  const last = pages[pages.length - 1]
  return first === last ? String(first) : `${first}-${last}`
}

/** "p12" or "p12-13", as the server names files after their pages. */
export function pageLabel(pages) {
  const first = Math.min(...pages)
  const last = Math.max(...pages)
  return first === last ? `p${first}` : `p${first}-${last}`
}

/**
 * A filename stem with reserved characters removed - the server's `safe_stem`,
 * so a default name shown in the panel is the name the file is saved under.
 */
export function safeStem(text, fallback = 'export') {
  const stem = (text || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, ' ')
    .split(/\s+/)
    .join(' ')
    .replace(/^[ .]+|[ .]+$/g, '')
  return stem.slice(0, 150).replace(/[ .]+$/, '') || fallback
}

/** Whether `page` opens a spread under the reader's pairing (see SpreadPage). */
export const isLeftPage = (page, spreadOffset) =>
  spreadOffset === 1 ? page % 2 === 1 : page % 2 === 0

/** How many images joined spreads make of `pages` - the server's pairing rule. */
export function countSpreadImages(pages, spreadOffset) {
  let count = 0
  for (let i = 0; i < pages.length; i++) {
    if (pages[i + 1] === pages[i] + 1 && isLeftPage(pages[i], spreadOffset)) i++
    count++
  }
  return count
}

/**
 * The table-of-contents section `page` falls in: the last entry starting at or
 * before it, running until the next entry at the same or a shallower level.
 * A character sheet at the back of a book is usually exactly such a section.
 */
export function findSection(toc, page, total) {
  const flat = []
  const walk = (nodes, depth) => {
    for (const n of nodes || []) {
      if (n.page > 0) flat.push({ title: n.title, page: n.page, depth })
      walk(n.children, depth + 1)
    }
  }
  walk(toc, 0)
  let idx = -1
  flat.forEach((e, i) => {
    if (e.page <= page) idx = i
  })
  if (idx < 0) return null
  const entry = flat[idx]
  const next = flat.slice(idx + 1).find((e) => e.depth <= entry.depth && e.page > entry.page)
  const end = next ? next.page - 1 : total
  return { title: entry.title, start: entry.page, end: Math.max(entry.page, end) }
}
