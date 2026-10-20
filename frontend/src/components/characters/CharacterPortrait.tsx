import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { LuImagePlus, LuX } from 'react-icons/lu'
import { characters as charactersApi } from '../../api'
import type { PortraitCharacter, PortraitPatch } from './characterMedia'
import { framedImageStyle } from './portraitCrop'
import usePortraitUpload, { IMAGE_ACCEPT } from './usePortraitUpload'

const SIZE = 64

interface Props {
  character: PortraitCharacter
  readOnly?: boolean
  onChanged: (patch: PortraitPatch) => void
  onError: (message: string) => void
  /** Opens the large view of the art. Without it the art is not clickable. */
  onOpen?: () => void
}

/**
 * A character's art, in the sheet's header: a thumbnail that opens the art
 * large - where the owner frames, replaces or removes it - with a small button
 * beside it to remove it.
 *
 * It lives in the header rather than above the sheet, so adding art never
 * pushes the sheet down the page. Without art the thumbnail is an "add art"
 * prompt that goes straight to the file picker. A party member's character
 * shows its art, which opens large, but offers no way to change it.
 */
export default function CharacterPortrait({
  character,
  readOnly,
  onChanged,
  onError,
  onOpen,
}: Props) {
  const { t } = useTranslation()
  const { inputRef, busy, upload, remove, choose } = usePortraitUpload({
    character,
    onChanged,
    onError,
  })
  const name = character.name || t('characters.untitled')
  const hasArt = Boolean(character.portrait_path)
  const src = hasArt ? charactersApi.portraitUrl(character.id, character.portrait_version) : null

  const frame: CSSProperties = {
    width: SIZE,
    height: SIZE,
    flexShrink: 0,
    borderRadius: 12,
    overflow: 'hidden',
    border: '1px solid var(--border)',
    background: 'var(--bg-deep)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  }
  const image = src ? (
    <img
      src={src}
      alt={t('characters.portraitOf', { name })}
      style={framedImageStyle(character.portrait_crop)}
    />
  ) : null

  if (readOnly) {
    if (!src) return null
    if (!onOpen) return <div style={frame}>{image}</div>
    return (
      <button
        type="button"
        onClick={onOpen}
        aria-label={t('characters.viewPortrait')}
        title={t('characters.viewPortrait')}
        style={{ ...frame, cursor: 'zoom-in' }}
      >
        {image}
      </button>
    )
  }

  // With art, the thumbnail opens it large; the dialog is where it is changed.
  const opens = hasArt && Boolean(onOpen)
  const label = opens
    ? t('characters.viewPortrait')
    : hasArt
      ? t('characters.changePortrait')
      : t('characters.addPortrait')

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        onClick={opens ? onOpen : choose}
        disabled={busy}
        aria-label={label}
        title={label}
        style={{
          ...frame,
          cursor: busy ? 'progress' : opens ? 'zoom-in' : 'pointer',
          borderStyle: hasArt ? 'solid' : 'dashed',
          color: 'var(--text-muted)',
        }}
      >
        {image || <LuImagePlus size={22} aria-hidden="true" />}
      </button>
      {hasArt ? (
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          aria-label={t('characters.removePortrait')}
          title={t('characters.removePortrait')}
          style={{
            position: 'absolute',
            top: -8,
            right: -8,
            width: 24,
            height: 24,
            borderRadius: '50%',
            border: '1px solid var(--border)',
            background: 'var(--bg-panel)',
            color: 'var(--text-dim)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            cursor: 'pointer',
          }}
        >
          <LuX size={12} aria-hidden="true" />
        </button>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        aria-label={hasArt ? t('characters.changePortrait') : t('characters.addPortrait')}
        tabIndex={-1}
        onChange={(event) => upload(event.target.files?.[0])}
        style={{ display: 'none' }}
      />
    </div>
  )
}
