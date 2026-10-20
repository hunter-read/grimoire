import { useTranslation } from 'react-i18next'
import { LuImagePlus } from 'react-icons/lu'
import { characters as charactersApi } from '../../api'
import { useCharacterMedia } from './characterMedia'
import { framedImageStyle } from './portraitCrop'
import usePortraitUpload, { IMAGE_ACCEPT } from './usePortraitUpload'

interface Props {
  className?: string
}

/**
 * The character's portrait, placed on the sheet by a layout's `<g-portrait>`.
 *
 * The header's thumbnail is too small to see the art; a sheet with room to
 * spare can draw it properly. It is framed as the player chose, and pressing
 * it opens the art large, where the owner reframes or replaces it. Its size
 * is the sheet's: the `gc-portrait` class has a default the sheet's
 * stylesheet can override.
 *
 * With no art the owner gets a place to add some; a party member's sheet
 * shows nothing, rather than an empty frame they can do nothing with.
 */
export default function SheetPortrait({ className }: Props) {
  const { t } = useTranslation()
  const media = useCharacterMedia()
  // Hooks run unconditionally; with no character the upload is never offered.
  const { inputRef, busy, upload, choose } = usePortraitUpload({
    character: media?.character || { id: '' },
    onChanged: (patch) => media?.onPortraitChanged(patch),
    onError: (message) => media?.onError(message),
  })
  if (!media) return null

  const { character, readOnly, openPortrait } = media
  const name = character.name || t('characters.untitled')
  const classes = ['gc-portrait', className].filter(Boolean).join(' ')

  if (!character.portrait_path) {
    if (readOnly) return null
    return (
      <figure className={`${classes} gc-portrait-empty`}>
        <button
          type="button"
          onClick={choose}
          disabled={busy}
          className="gc-portrait-add"
          aria-label={t('characters.addPortrait')}
        >
          <LuImagePlus size={28} aria-hidden="true" />
          <span>{t('characters.addPortrait')}</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={IMAGE_ACCEPT}
          aria-label={t('characters.addPortrait')}
          tabIndex={-1}
          onChange={(event) => upload(event.target.files?.[0])}
          style={{ display: 'none' }}
        />
      </figure>
    )
  }

  return (
    <figure className={classes}>
      <button
        type="button"
        onClick={openPortrait}
        className="gc-portrait-open"
        aria-label={t('characters.viewPortrait')}
        title={t('characters.viewPortrait')}
      >
        <img
          src={charactersApi.portraitUrl(character.id, character.portrait_version)}
          alt={t('characters.portraitOf', { name })}
          style={framedImageStyle(character.portrait_crop)}
        />
      </button>
    </figure>
  )
}
