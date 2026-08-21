import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ImagePickerModal from '../images/ImagePickerModal'
import BannerFocusPreview from '../images/BannerFocusPreview'

/**
 * Campaign banner dialog.
 *
 * A thin wrapper over the shared `ImagePickerModal` (issue #286): the banner
 * adds the campaign's own images as a browse source and a drag-to-reposition
 * preview, since a banner picked from a library map is rarely 2:1 and would
 * otherwise be cropped through the middle.
 *
 * The focal point is committed alongside the image — and on its own when only
 * the position changed, so nudging an existing banner doesn't re-upload it.
 */
export default function BannerUploadModal({
  hasBanner,
  previewSrc,
  campaignImages,
  focusY = 50,
  onPick,
  onPickSource,
  onFocusChange,
  onRemove,
  onClose,
  busy,
}) {
  const { t } = useTranslation()
  const [focus, setFocus] = useState(focusY)
  const [savingFocus, setSavingFocus] = useState(false)

  // Only write the focal point when it actually moved.
  const commitFocus = async () => {
    if (focus !== focusY) await onFocusChange(focus)
  }

  // Repositioning an existing banner is a change on its own, with no new image
  // to save — so the dialog offers an explicit save for it rather than writing
  // on close, which would also fire on cancel.
  const saveFocusOnly = async () => {
    setSavingFocus(true)
    try {
      await commitFocus()
      onClose()
    } finally {
      setSavingFocus(false)
    }
  }

  const focusMoved = focus !== focusY

  return (
    <ImagePickerModal
      title={t('campaignDetail.banner.modalTitle')}
      hasImage={hasBanner}
      previewSrc={previewSrc}
      campaignImages={campaignImages}
      helpText={t('campaignDetail.banner.suggestedSize')}
      formatsText={t('campaignDetail.banner.allowedFormats')}
      busy={busy}
      renderPreview={({ src }) => (
        <>
          <BannerFocusPreview src={src} focusY={focus} onChange={setFocus} disabled={busy} />
          {hasBanner && focusMoved && (
            <button
              type="button"
              onClick={saveFocusOnly}
              disabled={savingFocus}
              style={{
                display: 'block',
                width: '100%',
                marginBottom: 16,
                padding: '8px 12px',
                borderRadius: 8,
                background: 'var(--bg-card)',
                border: '1px solid var(--gold)',
                color: 'var(--text)',
                fontSize: 13,
                cursor: savingFocus ? 'default' : 'pointer',
              }}
            >
              {t('campaignDetail.banner.savePosition')}
            </button>
          )}
        </>
      )}
      onUpload={async (file) => {
        await onPick(file)
        await commitFocus()
      }}
      onPickSource={async (source) => {
        await onPickSource(source)
        await commitFocus()
      }}
      onRemove={onRemove}
      onClose={onClose}
    />
  )
}
