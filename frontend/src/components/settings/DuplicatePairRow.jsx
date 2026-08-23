import { useTranslation } from 'react-i18next'
import { LuArrowRight, LuChevronsLeftRight } from 'react-icons/lu'

function formatSize(bytes) {
  if (!bytes) return '—'
  const mb = bytes / 1048576
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/**
 * One parent-vs-child pair, as a skimmable row.
 *
 * The list is for triage, not decisions: enough to recognise a pair you already
 * know the answer to, with Compare for the ones that need looking at. Both
 * filenames show in full because the difference between two duplicates is
 * usually a suffix — "(1)", "-printable" — and truncating would hide exactly
 * the part that distinguishes them.
 */
export default function DuplicatePairRow({ pair, onCompare }) {
  const { t } = useTranslation()
  const { parent, child } = pair

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '12px 14px',
        marginBottom: 10,
        background: 'var(--bg-card)',
      }}
    >
      <div style={{ flex: '1 1 320px', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span
            style={{
              fontSize: 11,
              padding: '1px 7px',
              borderRadius: 8,
              color: 'var(--variant)',
              background: 'rgba(79,209,197,0.12)',
              border: '1px solid rgba(79,209,197,0.35)',
            }}
          >
            {pair.reasonText}
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {t('maintenance.dupes.confidence')}: {Math.round((pair.confidence || 0) * 100)}%
          </span>
        </div>

        <div style={{ fontSize: 14, wordBreak: 'break-word' }}>
          {parent.title || parent.filename}
          <span style={{ color: 'var(--text-muted)' }}> · {formatSize(parent.file_size)}</span>
        </div>
        <div
          style={{
            fontSize: 13,
            color: 'var(--text-dim)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            wordBreak: 'break-word',
          }}
        >
          <LuChevronsLeftRight size={12} aria-hidden="true" />
          {child.title || child.filename}
          <span style={{ color: 'var(--text-muted)' }}>· {formatSize(child.file_size)}</span>
        </div>
      </div>

      <button
        type="button"
        onClick={() => onCompare(pair)}
        style={{
          background: 'var(--gold-dim)',
          color: 'var(--bg-deep)',
          border: 'none',
          borderRadius: 6,
          padding: '7px 16px',
          cursor: 'pointer',
          fontSize: 13,
          whiteSpace: 'nowrap',
        }}
      >
        {t('maintenance.dupes.compare')} <LuArrowRight size={13} aria-hidden="true" />
      </button>
    </div>
  )
}
