import { useTranslation } from 'react-i18next'
import { LuChevronsLeftRight, LuUndo2 } from 'react-icons/lu'

import Spinner from '../Spinner'

/**
 * One dismissed set, as a row that can be put back.
 *
 * A dismissal is otherwise invisible and permanent: it suppresses the pair on
 * every future scan, so a mis-click could hide a real duplicate forever with no
 * way to find out. This row is the record of that decision and the way to undo
 * it.
 *
 * Names come from the server rather than from the group list, because the whole
 * point of a dismissal is that its members are no longer *in* that list. A file
 * deleted since the dismissal was made leaves no name behind, so the id is
 * shown as a last resort rather than an empty row.
 */
export default function DismissedPairRow({ dismissal, onRestore, busy }) {
  const { t } = useTranslation()
  const names = dismissal.member_names || []
  const ids = dismissal.member_ids || []
  // Prefer names, but never render fewer entries than the dismissal actually
  // covers — a missing name would silently shrink the set on screen.
  const labels = ids.map((id, i) => names[i] || id)

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
              color: 'var(--text-dim)',
              background: 'var(--bg-deep)',
              border: '1px solid var(--border)',
            }}
          >
            {dismissal.resource_type}
          </span>
          {dismissal.note && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{dismissal.note}</span>
          )}
        </div>

        {labels.map((label, i) => (
          <div
            key={ids[i] || label}
            style={{
              fontSize: i === 0 ? 14 : 13,
              color: i === 0 ? 'var(--text)' : 'var(--text-dim)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              wordBreak: 'break-word',
            }}
          >
            {i > 0 && <LuChevronsLeftRight size={12} aria-hidden="true" />}
            {label}
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => onRestore(dismissal)}
        disabled={busy}
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          color: 'var(--text)',
          borderRadius: 6,
          padding: '7px 16px',
          cursor: busy ? 'default' : 'pointer',
          fontSize: 13,
          whiteSpace: 'nowrap',
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? <Spinner size={12} /> : <LuUndo2 size={13} aria-hidden="true" />}{' '}
        {t('maintenance.dupes.undismiss')}
      </button>
    </div>
  )
}
