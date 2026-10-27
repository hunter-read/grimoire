import { useTranslation } from 'react-i18next'
import { LuTrash2, LuEyeOff } from 'react-icons/lu'
import { ghostBtn } from './wikiShared'

// Confirms a multiselect action over the note tree.
//
// A selection routinely mixes notes the user wrote with notes they didn't, and
// the two get different treatment: their own are deleted, everyone else's can
// only be hidden from their view (delete is author-only, issue #232). Rather
// than refusing the whole action or silently skipping the ones it can't delete,
// the dialog states both halves — "delete 5, hide 5" — so the outcome is known
// before it happens. Hiding a parent takes its subtree along, which is counted
// separately because it is the part a user won't have predicted.
export default function WikiBulkActionDialog({
  deleteCount,
  hideCount,
  hiddenChildCount,
  onConfirm,
  onCancel,
}) {
  const { t } = useTranslation()

  // The confirm button names whichever halves are actually in play, so a
  // delete-only selection doesn't offer to "delete and hide".
  const confirmLabel =
    deleteCount && hideCount
      ? t('wiki.bulkConfirm')
      : deleteCount
        ? t('wiki.bulkConfirmDeleteOnly')
        : t('wiki.bulkConfirmHideOnly')

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--scrim-strong)',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('wiki.bulkTitle')}
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: 24,
          width: '100%',
          maxWidth: 440,
        }}
      >
        <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 12px' }}>{t('wiki.bulkTitle')}</h3>

        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: '0 0 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            fontSize: 13,
            color: 'var(--text-dim)',
            lineHeight: 1.5,
          }}
        >
          {deleteCount > 0 && (
            <li style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <LuTrash2
                size={14}
                aria-hidden="true"
                style={{ flexShrink: 0, marginTop: 2, color: 'var(--danger)' }}
              />
              <span>{t('wiki.bulkDeleteLine', { count: deleteCount })}</span>
            </li>
          )}
          {hideCount > 0 && (
            <li style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <LuEyeOff
                size={14}
                aria-hidden="true"
                style={{ flexShrink: 0, marginTop: 2, color: 'var(--text-muted)' }}
              />
              <span>
                {t('wiki.bulkHideLine', { count: hideCount })}
                {hiddenChildCount > 0 && (
                  <> {t('wiki.bulkHideChildren', { count: hiddenChildCount })}</>
                )}
              </span>
            </li>
          )}
        </ul>

        {deleteCount > 0 && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 18px' }}>
            {t('wiki.bulkIrreversible')}
          </p>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button onClick={onCancel} style={ghostBtn}>
            {t('common.cancel')}
          </button>
          <button
            onClick={onConfirm}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              // Destructive only when something is actually deleted; a
              // hide-only confirmation isn't a red-button moment.
              background: deleteCount > 0 ? 'var(--danger)' : 'var(--gold)',
              border: 'none',
              borderRadius: 8,
              color: 'var(--on-accent)',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
