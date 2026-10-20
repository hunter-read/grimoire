import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuImagePlus, LuRefreshCw, LuTrash2 } from 'react-icons/lu'
import { characters as charactersApi } from '../../api'
import { useCharacterMedia } from './characterMedia'
import { IMAGE_ACCEPT } from './usePortraitUpload'
import { fieldLabel, iconBtn } from './characterStyles'

interface Props {
  name: string
  label: string
  /** The stored file's name, which is also the URL's cache-buster. */
  value?: unknown
  readOnly?: boolean
  hideLabel?: boolean
}

/**
 * A sheet's `image` field: a coat of arms, a ship, a familiar.
 *
 * The picture is uploaded straight to the character rather than saved with
 * the sheet's other edits - its value names a file only the server writes -
 * so this reports the new value back through the sheet's media context
 * instead of `onChange`. The whole picture is shown (`contain`), since an
 * emblem cut to fit a box is no longer the emblem.
 */
export default function ImageField({ name, label, value, readOnly = false, hideLabel }: Props) {
  const { t } = useTranslation()
  const media = useCharacterMedia()
  const inputRef = useRef<HTMLInputElement>(null)
  const labelId = useId()
  const [busy, setBusy] = useState(false)
  const stored = typeof value === 'string' && value ? value : null
  const editable = Boolean(media) && !readOnly && !media?.readOnly

  const upload = async (file?: File | null) => {
    if (!file || !media) return
    setBusy(true)
    try {
      const result = await charactersApi.uploadImage(media.character.id, name, file)
      media.onImageChanged(name, result.value)
    } catch (e) {
      media.onError((e as Error).message)
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const remove = async () => {
    if (!media || !window.confirm(t('characters.confirmRemoveImage', { label }))) return
    setBusy(true)
    try {
      await charactersApi.deleteImage(media.character.id, name)
      media.onImageChanged(name, null)
    } catch (e) {
      media.onError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const src = stored && media ? charactersApi.imageUrl(media.character.id, name, stored) : null

  return (
    <div className="gc-field gc-image-field" role="group" aria-labelledby={labelId}>
      <span id={labelId} style={hideLabel ? { display: 'none' } : fieldLabel}>
        {label}
      </span>
      <div className="gc-image">
        {src ? (
          <img src={src} alt={label} />
        ) : editable ? (
          <button
            type="button"
            className="gc-image-add"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
          >
            <LuImagePlus size={22} aria-hidden="true" />
            <span>{t('characters.addImage')}</span>
          </button>
        ) : (
          <span className="gc-image-empty">{t('characters.noImage')}</span>
        )}
      </div>
      {editable && src ? (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 4, marginTop: 4 }}>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            aria-label={t('characters.changeImage', { label })}
            title={t('characters.changeImage', { label })}
            style={iconBtn}
          >
            <LuRefreshCw size={14} />
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            aria-label={t('characters.removeImage', { label })}
            title={t('characters.removeImage', { label })}
            style={iconBtn}
          >
            <LuTrash2 size={14} />
          </button>
        </div>
      ) : null}
      {editable ? (
        <input
          ref={inputRef}
          type="file"
          accept={IMAGE_ACCEPT}
          aria-label={t('characters.chooseImage', { label })}
          tabIndex={-1}
          onChange={(event) => upload(event.target.files?.[0])}
          style={{ display: 'none' }}
        />
      ) : null}
    </div>
  )
}
