import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuUpload, LuTrash2 } from 'react-icons/lu'
import api, { mediaUrl } from '../../api'

/**
 * Upload (or remove) a cover image for a game system.
 *
 * Complements `CoverPicker`, which can only choose among the thumbnails of books
 * the system already contains. A container folder (issues #261, #262) holds no
 * books of its own, so an upload is the only way to give it art short of
 * dropping a `cover.*` file in its library folder.
 *
 * A folder cover found by the scanner takes precedence over an upload, so the
 * note below tells the user when that's what they're seeing.
 */
export default function CoverUpload({ system, onChange }) {
  const { t } = useTranslation()
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Cache-buster so a replaced cover isn't served from the browser cache.
  const [version, setVersion] = useState(0)

  const hasUpload = Boolean(system.cover_image)
  const hasFolderCover = Boolean(system.has_cover) && !hasUpload

  const pick = () => inputRef.current?.click()

  const handleFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const res = await api.upload(`/systems/${system.id}/cover`, file)
      setVersion((v) => v + 1)
      onChange?.({ cover_image: res.cover_image, has_cover: true })
    } catch (err) {
      setError(err?.message || t('systemEditor.coverUploadFailed'))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    setError('')
    try {
      await api.delete(`/systems/${system.id}/cover`)
      setVersion((v) => v + 1)
      onChange?.({ cover_image: '', has_cover: false })
    } catch (err) {
      setError(err?.message || t('systemEditor.coverUploadFailed'))
    } finally {
      setBusy(false)
    }
  }

  const previewUrl = system.has_cover
    ? mediaUrl(`/systems/${system.id}/cover`, version ? { v: version } : {})
    : null

  return (
    <div style={{ marginTop: 8, marginBottom: 8 }}>
      <label
        style={{
          fontSize: 14,
          color: 'var(--text-muted)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 10,
        }}
      >
        <LuUpload size={14} /> {t('systemEditor.uploadCover')}
      </label>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {previewUrl && (
          <img
            src={previewUrl}
            alt=""
            data-testid="cover-preview"
            style={{
              width: 60,
              height: 80,
              objectFit: 'cover',
              borderRadius: 6,
              border: '1px solid var(--border)',
              display: 'block',
            }}
          />
        )}
        <button
          type="button"
          onClick={pick}
          disabled={busy}
          style={{
            padding: '6px 14px',
            borderRadius: 6,
            background: 'none',
            border: '1px solid var(--border)',
            color: 'var(--text-dim)',
            fontSize: 13,
            cursor: busy ? 'default' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >
          {hasUpload ? t('systemEditor.replaceCover') : t('systemEditor.chooseImage')}
        </button>
        {hasUpload && (
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '6px 12px',
              borderRadius: 6,
              background: 'none',
              border: '1px solid var(--border)',
              color: 'var(--text-muted)',
              fontSize: 13,
              cursor: busy ? 'default' : 'pointer',
            }}
          >
            <LuTrash2 size={13} /> {t('systemEditor.removeCover')}
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={handleFile}
          style={{ display: 'none' }}
          data-testid="cover-upload-input"
        />
      </div>

      {hasFolderCover && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 8 }}>
          {t('systemEditor.folderCoverInUse')}
        </div>
      )}
      {error && (
        <div style={{ fontSize: 13, color: 'var(--danger)', marginTop: 8 }} role="alert">
          {error}
        </div>
      )}
    </div>
  )
}
