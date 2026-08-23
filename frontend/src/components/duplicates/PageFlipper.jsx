import { useTranslation } from 'react-i18next'
import { LuChevronLeft, LuChevronRight } from 'react-icons/lu'

/**
 * Synced page flip across both copies, bounded by the shorter of the two.
 *
 * Bounded rather than per-file because the comparison is the point: page 40 of
 * one next to page 40 of the other is what reveals a reprint's shifted
 * pagination, and letting one side run past the other's end would break the
 * pairing exactly where it stops being informative.
 *
 * Buttons rather than a slider: a slider is for scrubbing a long range, but
 * comparing copies is a page-at-a-time job where you want to land on a specific
 * page and know which one it is. Centred between the two columns so it reads as
 * belonging to both.
 */
export default function PageFlipper({ page, maxPage, onChange }) {
  const { t } = useTranslation()
  const go = (next) => onChange(Math.min(maxPage, Math.max(1, next)))

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        marginBottom: 20,
        fontSize: 13,
        color: 'var(--text-dim)',
      }}
    >
      <button
        type="button"
        onClick={() => go(page - 1)}
        disabled={page <= 1}
        aria-label={t('maintenance.dupes.prevPage')}
        style={{ ...stepBtn, opacity: page <= 1 ? 0.4 : 1 }}
      >
        <LuChevronLeft size={16} aria-hidden="true" />
      </button>

      <span style={{ minWidth: 110, textAlign: 'center' }}>
        {t('maintenance.dupes.syncedPage')} {page} {t('maintenance.dupes.of')} {maxPage}
      </span>

      <button
        type="button"
        onClick={() => go(page + 1)}
        disabled={page >= maxPage}
        aria-label={t('maintenance.dupes.nextPage')}
        style={{ ...stepBtn, opacity: page >= maxPage ? 0.4 : 1 }}
      >
        <LuChevronRight size={16} aria-hidden="true" />
      </button>
    </div>
  )
}

const stepBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 34,
  height: 34,
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg-card)',
  color: 'var(--text)',
  cursor: 'pointer',
}
