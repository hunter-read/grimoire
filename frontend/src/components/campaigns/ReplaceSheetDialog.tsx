import { useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import useDialogFocus from '../../hooks/useDialogFocus'
import { LuDownload } from 'react-icons/lu'
import { smallBtn } from './memberStyles'

// Warns that re-uploading replaces the current sheet, offering to download it first.
interface ReplaceSheetDialogProps {
  downloadUrl: string
  onCancel: () => void
  onReplace: () => void
}

export default function ReplaceSheetDialog({
  downloadUrl,
  onCancel,
  onReplace,
}: ReplaceSheetDialogProps) {
  const { t } = useTranslation()
  // Focus moves into the dialog, Tab stays inside, Esc closes, and focus goes
  // back to whatever opened it.
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useDialogFocus(dialogRef, { onClose: onCancel })
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
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: 24,
          width: '100%',
          maxWidth: 420,
        }}
      >
        <h2 id={titleId} style={{ fontSize: 16, fontWeight: 600, margin: '0 0 12px' }}>
          {t('members.replaceSheet')}
        </h2>
        <p style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6, margin: '0 0 18px' }}>
          {t('members.replaceSheetWarning')}
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button onClick={onCancel} style={{ ...smallBtn('var(--text)'), padding: '8px 14px' }}>
            {t('members.cancel')}
          </button>
          <a
            href={downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              ...smallBtn('var(--text)'),
              padding: '8px 14px',
              textDecoration: 'none',
              gap: 6,
            }}
          >
            <LuDownload size={13} aria-hidden="true" /> {t('members.downloadCurrent')}
          </a>
          <button
            onClick={onReplace}
            style={{
              padding: '8px 14px',
              background: 'var(--gold)',
              border: 'none',
              borderRadius: 6,
              color: 'var(--on-accent)',
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            {t('members.replace')}
          </button>
        </div>
      </div>
    </div>
  )
}
