import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuX, LuImagePlus, LuTrash2 } from 'react-icons/lu'

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'

// Reusable banner upload dialog. The caller provides handlers; this modal owns
// the file input, the suggested-size / allowed-formats guidance, and a preview.
export default function BannerUploadModal({
  hasBanner,
  previewSrc,
  onPick,
  onRemove,
  onClose,
  busy,
}) {
  const { t } = useTranslation()
  const inputRef = useRef(null)
  const [localBusy, setLocalBusy] = useState(false)
  const working = busy || localBusy

  const pick = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setLocalBusy(true)
    try {
      await onPick(file)
      onClose()
    } catch (err) {
      alert(err.message)
    } finally {
      setLocalBusy(false)
    }
  }

  const remove = async () => {
    setLocalBusy(true)
    try {
      await onRemove()
      onClose()
    } finally {
      setLocalBusy(false)
    }
  }

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
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: 24,
          width: '100%',
          maxWidth: 480,
          position: 'relative',
        }}
      >
        <button
          onClick={onClose}
          aria-label={t('common.close')}
          style={{
            position: 'absolute',
            top: 14,
            right: 14,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-muted)',
          }}
        >
          <LuX size={18} />
        </button>
        <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 16px' }}>
          {t('campaignDetail.banner.modalTitle')}
        </h3>

        {previewSrc && (
          <div
            style={{
              width: '100%',
              aspectRatio: '2 / 1',
              borderRadius: 10,
              overflow: 'hidden',
              background: 'var(--bg-deep)',
              border: '1px solid var(--border)',
              marginBottom: 16,
            }}
          >
            <img
              src={previewSrc}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
            />
          </div>
        )}

        <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: '0 0 6px', lineHeight: 1.6 }}>
          {t('campaignDetail.banner.suggestedSize')}
        </p>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 18px' }}>
          {t('campaignDetail.banner.allowedFormats')}
        </p>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          {hasBanner && (
            <button onClick={remove} disabled={working} style={dangerBtn}>
              <LuTrash2 size={14} /> {t('campaignDetail.banner.remove')}
            </button>
          )}
          <button onClick={() => inputRef.current?.click()} disabled={working} style={goldBtn}>
            <LuImagePlus size={14} />{' '}
            {hasBanner ? t('campaignDetail.banner.replace') : t('campaignDetail.banner.upload')}
          </button>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          onChange={pick}
          style={{ display: 'none' }}
        />
      </div>
    </div>
  )
}

const goldBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '9px 16px',
  background: 'var(--gold)',
  border: 'none',
  borderRadius: 8,
  color: 'var(--on-accent)',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
}
const dangerBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '9px 16px',
  background: 'var(--bg-card)',
  border: '1px solid var(--danger)',
  borderRadius: 8,
  color: 'var(--danger)',
  cursor: 'pointer',
  fontSize: 13,
}
