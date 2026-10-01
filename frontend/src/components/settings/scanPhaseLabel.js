/**
 * The one-line description of a running scan ("Scanning… 42%", "Indexing PDFs
 * 3 / 10", …) shown in place of a rescan button's label while it runs. Shared
 * by the Maintenance rescan section and the settings header quick action so
 * the two never describe the same scan differently.
 */
export default function scanPhaseLabel(t, status) {
  const { phase, indexed, to_index, total_ocr, ocr_done, total_thumbs, thumbs_done } = status

  if (phase === 'indexing') return t('maintenance.rescan.indexing', { indexed, total: to_index })
  if (phase === 'ocr') return t('maintenance.rescan.ocr', { done: ocr_done, total: total_ocr })
  if (phase === 'thumbnails') {
    return t('maintenance.rescan.thumbnails', { done: thumbs_done, total: total_thumbs })
  }

  const pct = phase === 'scanning' ? scanPercent(status) : null
  return pct !== null
    ? t('maintenance.rescan.scanningPercent', { pct })
    : t('maintenance.rescan.scanning')
}

const COLLECTIONS = ['books', 'maps', 'tokens', 'audio', 'models']

/**
 * Overall progress of the scanning phase across every collection, or null
 * before any totals are known. Counters are coalesced because a status payload
 * from a backend that predates a collection omits them entirely, and a single
 * undefined would turn the whole sum into NaN.
 */
export function scanTotals(status) {
  let total = 0
  let scanned = 0
  for (const c of COLLECTIONS) {
    total += status[`total_${c}`] || 0
    scanned += status[`scanned_${c}`] || 0
  }
  return { total, scanned }
}

export function scanPercent(status) {
  const { total, scanned } = scanTotals(status)
  return total > 0 ? Math.round((scanned / total) * 100) : null
}
