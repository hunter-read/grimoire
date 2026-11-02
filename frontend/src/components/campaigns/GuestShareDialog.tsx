import { useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { LuCopy, LuMail } from 'react-icons/lu'
import type { Schema } from '../../api'
import useDialogFocus from '../../hooks/useDialogFocus'
import ShareBtn from './ShareBtn'

export interface GuestShareDialogProps {
  share: Schema<'GuestShareTemplateOut'>
  onClose: () => void
}

/**
 * The guest-invite message, ready to copy or email.
 *
 * Portalled to the body and stacked above the guest popover: rendered in place,
 * it would sit beneath the popover and be clipped by its stacking context.
 * Focus moves in when it opens, Tab stays inside, Esc closes it, and focus goes
 * back to the Share button that opened it.
 */
export default function GuestShareDialog({ share, onClose }: GuestShareDialogProps) {
  const { t } = useTranslation()
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useDialogFocus(dialogRef, { onClose })
  const [copied, setCopied] = useState('')

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied(''), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--shadow)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2100,
        padding: 20,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: 24,
          maxWidth: 460,
          width: '100%',
        }}
      >
        <h2 id={titleId} style={{ marginTop: 0, marginBottom: 12, fontSize: 18 }}>
          {t('guests.shareTitle')}
        </h2>
        <textarea
          readOnly
          aria-label={t('guests.shareTitle')}
          value={share.message}
          rows={6}
          style={{ width: '100%', resize: 'vertical', fontSize: 13, marginBottom: 12 }}
        />
        {/* The button's label flips to "Copied"; this says it aloud. */}
        <div className="sr-only" role="status" aria-live="polite">
          {copied ? t('guests.copied') : ''}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <ShareBtn onClick={() => copy(share.message, 'msg')}>
            <LuCopy size={13} /> {copied === 'msg' ? t('guests.copied') : t('guests.copyMessage')}
          </ShareBtn>
          <ShareBtn onClick={() => copy(share.discord_message, 'discord')}>
            <LuCopy size={13} />{' '}
            {copied === 'discord' ? t('guests.copied') : t('guests.copyForDiscord')}
          </ShareBtn>
          <a href={share.mailto_url} style={{ textDecoration: 'none' }}>
            <ShareBtn as="span">
              <LuMail size={13} /> {t('guests.email')}
            </ShareBtn>
          </a>
        </div>
        <button
          onClick={onClose}
          style={{
            marginTop: 16,
            padding: '6px 14px',
            background: 'var(--bg-deep)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            color: 'var(--text-dim)',
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          {t('common.close')}
        </button>
      </div>
    </div>,
    document.body
  )
}
