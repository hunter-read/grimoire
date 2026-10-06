import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuImagePlus, LuX } from 'react-icons/lu'
import { characters as charactersApi } from '../../api'

const SIZE = 64

/**
 * A character's art, in the sheet's header: a thumbnail that is also the
 * button to change it, with a small button beside it to remove it.
 *
 * It lives in the header rather than above the sheet, so adding art never
 * pushes the sheet down the page. Without art the thumbnail is an "add art"
 * prompt. A party member's character shows its art but offers neither button.
 */
export default function CharacterPortrait({ character, readOnly, onChanged, onError }) {
  const { t } = useTranslation()
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const name = character.name || t('characters.untitled')
  const hasArt = Boolean(character.portrait_path)
  const src = hasArt ? charactersApi.portraitUrl(character.id, character.portrait_version) : null

  const upload = async (file) => {
    if (!file) return
    setBusy(true)
    try {
      const result = await charactersApi.uploadPortrait(character.id, file)
      onChanged({
        portrait_path: result.portrait_path,
        // A version the browser has never cached, even if the server sent none.
        portrait_version: result.portrait_version || Date.now(),
      })
    } catch (e) {
      onError(e.message)
    } finally {
      setBusy(false)
      // Cleared, so picking the same file again still uploads it.
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const remove = async () => {
    if (!window.confirm(t('characters.confirmRemovePortrait', { name }))) return
    setBusy(true)
    try {
      await charactersApi.deletePortrait(character.id)
      onChanged({ portrait_path: null, portrait_version: null })
    } catch (e) {
      onError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const frame = {
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
      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
    />
  ) : null

  if (readOnly) {
    return src ? <div style={frame}>{image}</div> : null
  }

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        aria-label={hasArt ? t('characters.changePortrait') : t('characters.addPortrait')}
        title={hasArt ? t('characters.changePortrait') : t('characters.addPortrait')}
        style={{
          ...frame,
          cursor: busy ? 'progress' : 'pointer',
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
        accept="image/png,image/jpeg,image/webp,image/gif"
        aria-label={hasArt ? t('characters.changePortrait') : t('characters.addPortrait')}
        tabIndex={-1}
        onChange={(event) => upload(event.target.files?.[0])}
        style={{ display: 'none' }}
      />
    </div>
  )
}
