import { describe, it, expect } from 'vitest'
import type { TFunction } from 'i18next'
import scanPhaseLabel, { scanPercent, scanTotals, stepPercent } from './scanPhaseLabel'

const t = ((key: string, vars?: object) =>
  vars ? `${key} ${JSON.stringify(vars)}` : key) as unknown as TFunction

describe('scanPhaseLabel', () => {
  it('shows the overall percentage while scanning once totals are known', () => {
    const status = { phase: 'scanning', total_books: 3, scanned_books: 1, total_maps: 1 }
    expect(scanPhaseLabel(t, status)).toBe('maintenance.rescan.scanningPercent {"pct":25}')
  })

  it('falls back to a plain scanning label before totals arrive', () => {
    expect(scanPhaseLabel(t, { phase: 'scanning' })).toBe('maintenance.rescan.scanning')
  })

  it('falls back to a plain scanning label for an unknown phase', () => {
    expect(scanPhaseLabel(t, { phase: null, total_books: 4, scanned_books: 2 })).toBe(
      'maintenance.rescan.scanning'
    )
  })

  it('describes the indexing, OCR, and thumbnail phases', () => {
    expect(scanPhaseLabel(t, { phase: 'indexing', indexed: 2, to_index: 5 })).toBe(
      'maintenance.rescan.indexing {"indexed":2,"total":5}'
    )
    expect(scanPhaseLabel(t, { phase: 'ocr', ocr_done: 1, total_ocr: 4 })).toBe(
      'maintenance.rescan.ocr {"done":1,"total":4}'
    )
    expect(scanPhaseLabel(t, { phase: 'thumbnails', thumbs_done: 3, total_thumbs: 9 })).toBe(
      'maintenance.rescan.thumbnails {"done":3,"total":9}'
    )
  })

  it('describes the missing-file sweep and system pruning after the walk', () => {
    expect(scanPhaseLabel(t, { phase: 'reconciling', step_done: 1, step_total: 4 })).toBe(
      'maintenance.rescan.reconciling {"pct":25}'
    )
    expect(scanPhaseLabel(t, { phase: 'pruning', step_done: 3, step_total: 7 })).toBe(
      'maintenance.rescan.pruning {"done":3,"total":7}'
    )
    expect(scanPhaseLabel(t, { phase: 'pruning' })).toBe(
      'maintenance.rescan.pruning {"done":0,"total":0}'
    )
  })
})

describe('stepPercent', () => {
  it('is 0 until a total is known', () => {
    expect(stepPercent({})).toBe(0)
    expect(stepPercent({ step_done: 2, step_total: 8 })).toBe(25)
  })
})

describe('scanTotals / scanPercent', () => {
  it('sums every collection and tolerates missing counters', () => {
    const status = { total_books: 2, scanned_books: 2, total_models: 2 }
    expect(scanTotals(status)).toEqual({ total: 4, scanned: 2 })
    expect(scanPercent(status)).toBe(50)
  })

  it('is null when nothing has been counted yet', () => {
    expect(scanPercent({})).toBeNull()
  })
})
