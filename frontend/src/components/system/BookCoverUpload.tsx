import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuImage, LuTrash2 } from 'react-icons/lu'
import { bookThumbUrl, imageSources } from '../../api'
import type { Schema } from '../../api'
import ImagePickerModal from '../images/ImagePickerModal'

/** The cover fields a change reports, to merge into the book. */
export interface BookCoverChange {
  has_custom_cover: boolean
  cover_version: string | null
  has_thumbnail: boolean
}

export interface BookCoverUploadProps {
  book: {
    id: string
    has_thumbnail?: boolean | null
    has_custom_cover?: boolean | null
    cover_version?: string | null
  }
  onChange?: (cover: BookCoverChange) => void
}

/**
 * Upload (or remove) a custom cover for one book, in the book editor.
 *
 * A book's cover is normally rendered from its first page, which goes wrong for
 * a fixed-layout EPUB (blank) or a PDF that opens on a wraparound dust jacket.
 * A custom cover replaces it everywhere - grids, OPDS, Grimoire Codex DB - and a
 * rescan leaves it alone. Removing it brings the generated cover back.
 *
 * Follows the system `CoverUpload`: the shared picker takes a file from the
 * device, the clipboard, or an image Grimoire already holds.
 */
export default function BookCoverUpload({ book, onChange }: BookCoverUploadProps) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [showPicker, setShowPicker] = useState(false)
  // Held here as well as reported up, so the editor reflects a change even
  // where the parent does not pass the merged book back down.
  const [custom, setCustom] = useState(Boolean(book.has_custom_cover))
  const [version, setVersion] = useState<string | null>(book.cover_version ?? null)
  const [hasCover, setHasCover] = useState(Boolean(book.has_thumbnail || book.has_custom_cover))

  const applied = (res: Schema<'BookCoverResponse'>) => {
    const next = {
      has_custom_cover: res.has_custom_cover,
      cover_version: res.cover_version ?? null,
      has_thumbnail: res.has_thumbnail,
    }
    setCustom(next.has_custom_cover)
    setVersion(next.cover_version)
    setHasCover(next.has_thumbnail)
    onChange?.(next)
  }

  const handleFile = async (file: File) => {
    applied(await imageSources.uploadBookCover(book.id, file))
  }

  const handleSource = async ({
    source_type: type,
    source_id: id,
  }: Schema<'BookCoverSourceIn'>) => {
    applied(await imageSources.setBookCover(book.id, type, id))
  }

  // `rethrow` is set by the picker, which needs the rejection to stay open and
  // show the failure. The inline button handles it here instead - an unhandled
  // rejection out of an onClick has nowhere to go.
  const remove = async ({ rethrow = false } = {}) => {
    setBusy(true)
    setError('')
    try {
      applied(await imageSources.deleteBookCover(book.id))
    } catch (err) {
      setError((err as { message?: string } | null)?.message || t('bookEditor.coverUpdateFailed'))
      if (rethrow) throw err
    } finally {
      setBusy(false)
    }
  }

  const previewUrl = hasCover ? bookThumbUrl(book.id, version) : null

  return (
    <div style={{ marginBottom: 10 }}>
      <span style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }}>
        {t('bookEditor.coverLabel')}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {previewUrl && (
          <img
            src={previewUrl}
            alt=""
            data-testid="book-cover-preview"
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
          onClick={() => setShowPicker(true)}
          disabled={busy}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
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
          <LuImage size={13} />
          {custom ? t('bookEditor.replaceCover') : t('bookEditor.uploadCover')}
        </button>
        {custom && (
          <button
            type="button"
            onClick={() => remove()}
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
            <LuTrash2 size={13} /> {t('bookEditor.removeCustomCover')}
          </button>
        )}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
        {custom ? t('bookEditor.customCoverInUse') : t('bookEditor.coverHint')}
      </div>
      {error && (
        <div style={{ fontSize: 13, color: 'var(--danger)', marginTop: 6 }} role="alert">
          {error}
        </div>
      )}

      {showPicker && (
        <ImagePickerModal
          title={t('bookEditor.coverLabel')}
          hasImage={custom}
          previewSrc={previewUrl}
          aspectRatio="3 / 4"
          formatsText={t('imagePicker.formats')}
          onUpload={handleFile}
          onPickSource={handleSource}
          onRemove={custom ? () => remove({ rethrow: true }) : undefined}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  )
}
