import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LuTrash2, LuTriangleAlert } from 'react-icons/lu'

import Spinner from '../Spinner'

/**
 * Confirm deleting one copy of a duplicate pair.
 *
 * A modal rather than an inline panel: deleting is the one irreversible action
 * on the page, and an inline block sitting among the comparison controls reads
 * as just another section of the form. A dialog stops the interaction and makes
 * the choice the only thing on screen.
 *
 * Removing the file from disk is the default here, unlike elsewhere. Someone
 * resolving duplicates has already decided this copy is redundant, and leaving
 * the bytes behind means the next scan proposes the same pair again — the file
 * is gone from the library but still on the disk to be re-indexed. The checkbox
 * stays so the record-only case is still reachable.
 */
export default function ConfirmDelete({
  item,
  busy,
  deleteFile,
  onToggleFile,
  onCancel,
  onConfirm,
}) {
  const { t } = useTranslation()

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onCancel])

  return (
    <div
      style={backdrop}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel()
      }}
    >
      <div
        style={panel}
        role="dialog"
        aria-modal="true"
        aria-label={t('maintenance.dupes.confirmDelete')}
      >
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 12 }}>
          <LuTriangleAlert size={18} style={{ color: 'var(--danger)', flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
              {t('maintenance.dupes.confirmDelete')}
            </div>
            {item && (
              <div style={{ fontSize: 13, color: 'var(--text-dim)', wordBreak: 'break-word' }}>
                {item.relative_path || item.filename}
              </div>
            )}
          </div>
        </div>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          <input
            type="checkbox"
            checked={deleteFile}
            onChange={(e) => onToggleFile(e.target.checked)}
          />
          {t('maintenance.dupes.deleteFile')}
        </label>

        {!deleteFile && <div style={warning}>{t('maintenance.dupes.keepFileWarning')}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              color: 'var(--text)',
              borderRadius: 6,
              padding: '7px 16px',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            style={{
              background: 'rgba(180,60,60,0.15)',
              border: '1px solid rgba(180,60,60,0.5)',
              color: 'var(--danger)',
              borderRadius: 6,
              padding: '7px 16px',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            {busy ? <Spinner size={13} /> : <LuTrash2 size={13} aria-hidden="true" />}{' '}
            {t('common.delete')}
          </button>
        </div>
      </div>
    </div>
  )
}

const backdrop = {
  position: 'fixed',
  inset: 0,
  background: 'var(--scrim)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1100,
  padding: 16,
}

const panel = {
  background: 'var(--bg-panel)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: 20,
  width: 'min(440px, 100%)',
}

const warning = {
  fontSize: 12,
  color: 'var(--text-dim)',
  lineHeight: 1.5,
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '8px 10px',
}
