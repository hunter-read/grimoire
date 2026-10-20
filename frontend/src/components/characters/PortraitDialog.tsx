import { useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { LuImagePlus, LuRefreshCw, LuTrash2 } from 'react-icons/lu'
import { characters as charactersApi } from '../../api'
import CharacterDialog from './CharacterDialog'
import type { PortraitCharacter, PortraitPatch } from './characterMedia'
import { CENTRED, MAX_ZOOM, framedImageStyle, framingOf } from './portraitCrop'
import type { Framing } from './portraitCrop'
import usePortraitUpload, { IMAGE_ACCEPT } from './usePortraitUpload'
import { ghostBtn, goldBtn } from './characterStyles'

interface Props {
  character: PortraitCharacter
  readOnly?: boolean
  onChanged: (patch: PortraitPatch) => void
  onError: (message: string) => void
  onClose: () => void
}

// The frames the art is drawn in elsewhere, previewed side by side so the
// player sees what their framing does before saving it.
const PREVIEWS: { key: string; width: number; height: number; radius: number }[] = [
  { key: 'previewThumbnail', width: 96, height: 96, radius: 12 },
  { key: 'previewSheet', width: 96, height: 128, radius: 8 },
]

const ARROW_STEP = 2

/**
 * A character's art, large - the header's thumbnail is too small to see it.
 *
 * The owner frames it here: a click or drag on the picture sets the point every
 * frame keeps in view, and the zoom magnifies about it, so a full-length
 * portrait can show its face in the square header instead of its belt. A party
 * member sees the picture and nothing else.
 */
export default function PortraitDialog({
  character,
  readOnly = false,
  onChanged,
  onError,
  onClose,
}: Props) {
  const { t } = useTranslation()
  const { inputRef, busy, upload, remove, choose } = usePortraitUpload({
    character,
    onChanged,
    onError,
  })
  const saved = framingOf(character.portrait_crop)
  const [draft, setDraft] = useState<Framing>(saved)
  // A replaced picture starts centred on the server, so the draft follows it
  // rather than offering the old picture's framing as an unsaved change.
  const [shownVersion, setShownVersion] = useState(character.portrait_version)
  if (shownVersion !== character.portrait_version) {
    setShownVersion(character.portrait_version)
    setDraft(saved)
  }
  const [saving, setSaving] = useState(false)
  const imageRef = useRef<HTMLImageElement>(null)
  const dragging = useRef(false)

  const name = character.name || t('characters.untitled')
  const hasArt = Boolean(character.portrait_path)
  const src = hasArt ? charactersApi.portraitUrl(character.id, character.portrait_version) : null
  const changed = draft.x !== saved.x || draft.y !== saved.y || draft.zoom !== saved.zoom
  const editable = !readOnly && hasArt

  const focusAt = (event: PointerEvent<HTMLElement>) => {
    const rect = imageRef.current?.getBoundingClientRect()
    if (!rect || !rect.width || !rect.height) return
    const at = (offset: number, size: number) =>
      Math.round(Math.min(100, Math.max(0, (offset / size) * 100)))
    setDraft((prev) => ({
      ...prev,
      x: at(event.clientX - rect.left, rect.width),
      y: at(event.clientY - rect.top, rect.height),
    }))
  }

  const nudge = (event: KeyboardEvent<HTMLElement>) => {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-ARROW_STEP, 0],
      ArrowRight: [ARROW_STEP, 0],
      ArrowUp: [0, -ARROW_STEP],
      ArrowDown: [0, ARROW_STEP],
    }
    const move = moves[event.key]
    if (!move) return
    event.preventDefault()
    setDraft((prev) => ({
      ...prev,
      x: Math.min(100, Math.max(0, prev.x + move[0])),
      y: Math.min(100, Math.max(0, prev.y + move[1])),
    }))
  }

  const save = async () => {
    setSaving(true)
    try {
      const updated = await charactersApi.update(character.id, { portrait_crop: draft })
      onChanged({ portrait_crop: updated.portrait_crop ?? null })
      onClose()
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const removeArt = async () => {
    if (await remove()) onClose()
  }

  const marker: CSSProperties = {
    position: 'absolute',
    left: `${draft.x}%`,
    top: `${draft.y}%`,
    width: 22,
    height: 22,
    marginLeft: -11,
    marginTop: -11,
    borderRadius: '50%',
    border: '2px solid var(--gold)',
    boxShadow: '0 0 0 2px var(--shadow), inset 0 0 0 2px var(--shadow)',
    pointerEvents: 'none',
  }

  const picture = src ? (
    <div
      // The picture itself is the control: where you press is the focus.
      role={editable ? 'group' : undefined}
      aria-label={editable ? t('characters.framingFocus') : undefined}
      tabIndex={editable ? 0 : undefined}
      onKeyDown={editable ? nudge : undefined}
      onPointerDown={
        editable
          ? (event) => {
              dragging.current = true
              event.currentTarget.setPointerCapture?.(event.pointerId)
              focusAt(event)
            }
          : undefined
      }
      onPointerMove={editable ? (event) => dragging.current && focusAt(event) : undefined}
      onPointerUp={
        editable
          ? () => {
              dragging.current = false
            }
          : undefined
      }
      style={{
        position: 'relative',
        display: 'inline-block',
        maxWidth: '100%',
        cursor: editable ? 'crosshair' : 'default',
        touchAction: editable ? 'none' : undefined,
        lineHeight: 0,
        borderRadius: 8,
      }}
    >
      <img
        ref={imageRef}
        src={src}
        alt={t('characters.portraitOf', { name })}
        draggable={false}
        style={{
          display: 'block',
          maxWidth: '100%',
          maxHeight: '60vh',
          borderRadius: 8,
          userSelect: 'none',
        }}
      />
      {editable ? <span aria-hidden="true" style={marker} /> : null}
    </div>
  ) : (
    <p style={{ color: 'var(--text-muted)', margin: 0 }}>{t('characters.noPortrait')}</p>
  )

  const framing = editable ? (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 220 }}>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
        {t('characters.framingHelp')}
      </p>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
        {t('characters.framingZoom')}
        <input
          type="range"
          min={1}
          max={MAX_ZOOM}
          step={0.1}
          value={draft.zoom}
          onChange={(event) => setDraft((prev) => ({ ...prev, zoom: Number(event.target.value) }))}
          style={{ accentColor: 'var(--gold)' }}
        />
      </label>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
        {PREVIEWS.map((preview) => (
          <figure key={preview.key} style={{ margin: 0, textAlign: 'center' }}>
            <div
              style={{
                width: preview.width,
                height: preview.height,
                borderRadius: preview.radius,
                overflow: 'hidden',
                border: '1px solid var(--border)',
                background: 'var(--bg-deep)',
              }}
            >
              <img src={src || undefined} alt="" style={framedImageStyle(draft)} />
            </div>
            <figcaption style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              {t(`characters.${preview.key}`)}
            </figcaption>
          </figure>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setDraft(CENTRED)} style={ghostBtn}>
          {t('characters.framingReset')}
        </button>
      </div>
    </div>
  ) : null

  const footer = readOnly ? null : (
    <>
      {hasArt ? (
        <button type="button" onClick={removeArt} disabled={busy} style={ghostBtn}>
          <LuTrash2 size={14} aria-hidden="true" />
          {t('characters.removePortrait')}
        </button>
      ) : null}
      <button type="button" onClick={choose} disabled={busy} style={ghostBtn}>
        {hasArt ? (
          <LuRefreshCw size={14} aria-hidden="true" />
        ) : (
          <LuImagePlus size={14} aria-hidden="true" />
        )}
        {hasArt ? t('characters.changePortrait') : t('characters.addPortrait')}
      </button>
      {hasArt ? (
        <button
          type="button"
          onClick={save}
          disabled={!changed || saving}
          style={{ ...goldBtn, opacity: !changed || saving ? 0.6 : 1 }}
        >
          {saving ? t('common.saving') : t('characters.framingSave')}
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
    </>
  )

  return (
    <CharacterDialog
      title={t('characters.portraitTitle', { name })}
      onClose={onClose}
      footer={footer}
      maxWidth={editable ? 980 : 860}
    >
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 320px', minWidth: 0, textAlign: 'center' }}>{picture}</div>
        {framing}
      </div>
    </CharacterDialog>
  )
}
