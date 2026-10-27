import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  LuGripVertical,
  LuX,
  LuSettings2,
  LuRepeat,
  LuCircleStop,
  LuTrash2,
  LuSave,
} from 'react-icons/lu'
import {
  useSoundboard,
  MIN_COLS,
  MAX_COLS,
  MIN_ROWS,
  MAX_ROWS,
} from '../../context/SoundboardContext'
import useAudioSets from '../../hooks/useAudioSets'
import SaveAudioSetModal from './SaveAudioSetModal'

const PANEL_MARGIN = 16
const PAD_MIN = 64

const iconBtn = (active = false) => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: active ? 'var(--gold)' : 'var(--text-dim)',
  padding: 5,
})

/**
 * Keep a stored position inside the viewport. A panel dragged to the far edge
 * and then reopened on a smaller window (or a rotated phone) would otherwise be
 * stranded off-screen with no way to grab its drag handle back.
 */
function clampToViewport(pos, size) {
  const maxLeft = Math.max(PANEL_MARGIN, window.innerWidth - size.width - PANEL_MARGIN)
  const maxTop = Math.max(PANEL_MARGIN, window.innerHeight - size.height - PANEL_MARGIN)
  return {
    left: Math.min(Math.max(pos.left, PANEL_MARGIN), maxLeft),
    top: Math.min(Math.max(pos.top, PANEL_MARGIN), maxTop),
  }
}

/**
 * The floating soundboard: a grid of pads that fire one-shot sounds over
 * whatever the main player is doing.
 *
 * Starts pinned to the bottom-right corner and can be dragged anywhere; the
 * position persists (localStorage), as do the pads and the grid size. A single
 * edit toggle opens everything that changes the board's shape — the grid size
 * controls, drag-to-rearrange, and per-pad remove — so configuring it is one
 * mode to enter and leave rather than two overlapping ones, and no destructive
 * control sits on a pad you are tapping mid-session.
 *
 * The title bar's save button names the board and keeps it server-side (issue
 * #422), so it can be reloaded next session from any device. The live board
 * stays in localStorage — saving is explicit, and an existing board is
 * untouched by this.
 */
export default function SoundboardPanel({ bottomOffset = 0 }) {
  const { t } = useTranslation()
  const {
    pads,
    layout,
    position,
    editing,
    setEditing,
    setPosition,
    updateLayout,
    setOpen,
    toggle,
    stopAll,
    removePad,
    clearPads,
    movePad,
    setPadLoop,
    isPadPlaying,
  } = useSoundboard()

  const { sets, save } = useAudioSets()

  const panelRef = useRef(null)
  const dragRef = useRef(null)
  const [dragging, setDragging] = useState(false)
  const [dragIndex, setDragIndex] = useState(null)
  const [overIndex, setOverIndex] = useState(null)
  const [savingSet, setSavingSet] = useState(false)

  // Pointer-driven move of the whole panel. Pointer events (not mouse) so a
  // touch drag works the same, with capture so the drag survives the pointer
  // leaving the handle.
  const onHandleDown = (e) => {
    const el = panelRef.current
    if (!el) return
    // The title bar's own buttons live inside the drag handle. Capturing the
    // pointer here would redirect their pointerup to the handle, so the button
    // never sees one and the browser never synthesizes a click — and
    // preventDefault would suppress it outright. A press that starts on a
    // control is that control's, not the start of a drag.
    if (e.target.closest('button, input, label')) return
    const rect = el.getBoundingClientRect()
    dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top }
    setDragging(true)
    e.currentTarget.setPointerCapture?.(e.pointerId)
    e.preventDefault()
  }

  const onHandleMove = (e) => {
    if (!dragging || !dragRef.current) return
    const el = panelRef.current
    const rect = el?.getBoundingClientRect()
    const size = { width: rect?.width || 0, height: rect?.height || 0 }
    setPosition(
      clampToViewport(
        { left: e.clientX - dragRef.current.dx, top: e.clientY - dragRef.current.dy },
        size
      )
    )
  }

  const endDrag = (e) => {
    if (!dragging) return
    setDragging(false)
    dragRef.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  }

  // Re-clamp a stored position when the window resizes, so the panel can't be
  // left off-screen after a resize or rotation.
  useEffect(() => {
    if (!position) return
    const onResize = () => {
      const rect = panelRef.current?.getBoundingClientRect()
      if (!rect) return
      setPosition((prev) =>
        prev ? clampToViewport(prev, { width: rect.width, height: rect.height }) : prev
      )
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [position, setPosition])

  // Unplaced panels sit in the bottom-right corner, above the global player bar.
  const placement = position
    ? { left: position.left, top: position.top }
    : { right: PANEL_MARGIN, bottom: bottomOffset + PANEL_MARGIN }

  const onPadDrop = (index) => {
    if (dragIndex !== null && dragIndex !== index) movePad(dragIndex, index)
    setDragIndex(null)
    setOverIndex(null)
  }

  const gridWidth = layout.cols * PAD_MIN + (layout.cols - 1) * 8
  // Only `rows` worth of pads are shown at once; the rest scroll.
  const gridMaxHeight = layout.rows * PAD_MIN + (layout.rows - 1) * 8

  return (
    <div
      ref={panelRef}
      data-testid="soundboard-panel"
      style={{
        position: 'fixed',
        ...placement,
        zIndex: 96,
        width: Math.min(gridWidth + 24, window.innerWidth - PANEL_MARGIN * 2),
        maxWidth: `calc(100vw - ${PANEL_MARGIN * 2}px)`,
        background: 'var(--bg-panel)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        boxShadow: '0 6px 24px var(--shadow)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Title bar doubles as the drag handle. */}
      <div
        onPointerDown={onHandleDown}
        onPointerMove={onHandleMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        data-testid="soundboard-handle"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '6px 6px 6px 8px',
          borderBottom: '1px solid var(--border)',
          cursor: dragging ? 'grabbing' : 'grab',
          touchAction: 'none',
          background: 'var(--bg-card)',
        }}
      >
        <LuGripVertical size={14} color="var(--text-muted)" aria-hidden="true" />
        <span style={{ fontSize: 12, fontWeight: 500, flex: 1, minWidth: 0 }}>
          {t('soundboard.title')}
        </span>
        {pads.length > 0 && (
          <button
            type="button"
            onClick={() => setSavingSet(true)}
            aria-label={t('audioSets.saveBoard')}
            title={t('audioSets.saveBoard')}
            style={iconBtn()}
          >
            <LuSave size={15} />
          </button>
        )}
        <button
          type="button"
          onClick={stopAll}
          aria-label={t('soundboard.stopAll')}
          title={t('soundboard.stopAll')}
          style={iconBtn()}
        >
          <LuCircleStop size={15} />
        </button>
        <button
          type="button"
          onClick={() => setEditing(!editing)}
          aria-label={editing ? t('soundboard.doneEditing') : t('soundboard.edit')}
          title={editing ? t('soundboard.doneEditing') : t('soundboard.edit')}
          aria-pressed={editing}
          style={iconBtn(editing)}
        >
          <LuSettings2 size={15} />
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={t('soundboard.close')}
          title={t('soundboard.close')}
          style={iconBtn()}
        >
          <LuX size={15} />
        </button>
      </div>

      {editing && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            rowGap: 6,
            padding: '8px 10px',
            borderBottom: '1px solid var(--border)',
            fontSize: 12,
            color: 'var(--text-dim)',
            flexWrap: 'wrap',
          }}
        >
          <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            {t('soundboard.columns')}
            <input
              type="number"
              min={MIN_COLS}
              max={MAX_COLS}
              value={layout.cols}
              onChange={(e) => updateLayout({ cols: e.target.value })}
              style={{ width: 52, fontSize: 12, padding: '2px 4px' }}
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            {t('soundboard.rows')}
            <input
              type="number"
              min={MIN_ROWS}
              max={MAX_ROWS}
              value={layout.rows}
              onChange={(e) => updateLayout({ rows: e.target.value })}
              style={{ width: 52, fontSize: 12, padding: '2px 4px' }}
            />
          </label>
          {pads.length > 0 && (
            <button
              type="button"
              onClick={clearPads}
              aria-label={t('soundboard.clear')}
              title={t('soundboard.clear')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '3px 8px',
                borderRadius: 6,
                fontSize: 12,
                cursor: 'pointer',
                border: '1px solid var(--border)',
                background: 'var(--bg-card)',
                color: 'var(--text-dim)',
              }}
            >
              <LuTrash2 size={12} />
              {t('soundboard.clear')}
            </button>
          )}
          {pads.length > 0 && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)', flexBasis: '100%' }}>
              {t('soundboard.editHint')}
            </span>
          )}
        </div>
      )}

      {pads.length === 0 ? (
        <p
          style={{
            margin: 0,
            padding: '20px 14px',
            fontSize: 12,
            color: 'var(--text-muted)',
            textAlign: 'center',
          }}
        >
          {t('soundboard.empty')}
        </p>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`,
            gap: 8,
            padding: 12,
            maxHeight: gridMaxHeight + 24,
            overflowY: 'auto',
          }}
        >
          {pads.map((pad, index) => {
            const playing = isPadPlaying(pad.id)
            const isOver = overIndex === index && dragIndex !== null && dragIndex !== index
            return (
              <div
                key={pad.id}
                draggable={editing}
                onDragStart={() => setDragIndex(index)}
                onDragOver={(e) => {
                  if (dragIndex === null) return
                  e.preventDefault()
                  setOverIndex(index)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  onPadDrop(index)
                }}
                onDragEnd={() => {
                  setDragIndex(null)
                  setOverIndex(null)
                }}
                style={{ position: 'relative', minWidth: 0 }}
              >
                <button
                  type="button"
                  onClick={() => !editing && toggle(pad)}
                  title={pad.title || t('soundboard.untitled')}
                  aria-label={pad.title || t('soundboard.untitled')}
                  aria-pressed={playing}
                  style={{
                    width: '100%',
                    height: PAD_MIN,
                    borderRadius: 8,
                    padding: 4,
                    fontSize: 10,
                    lineHeight: 1.2,
                    overflow: 'hidden',
                    wordBreak: 'break-word',
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                    textAlign: 'center',
                    cursor: editing ? 'grab' : 'pointer',
                    border: `1px solid ${isOver ? 'var(--gold)' : 'var(--border)'}`,
                    background: playing ? 'var(--gold-dim)' : 'var(--bg-card)',
                    color: playing ? 'var(--bg-deep)' : 'var(--text-dim)',
                    opacity: dragIndex === index ? 0.4 : 1,
                  }}
                >
                  {pad.title || t('soundboard.untitled')}
                </button>

                {/* Loop toggle lives on the pad itself; the issue asks for a
                    per-sound loop, and it is not a destructive control so it
                    stays available outside edit mode. */}
                <button
                  type="button"
                  onClick={() => setPadLoop(pad.id, !pad.loop)}
                  aria-label={
                    pad.loop
                      ? t('soundboard.loopOn', { name: pad.title || t('soundboard.untitled') })
                      : t('soundboard.loopOff', { name: pad.title || t('soundboard.untitled') })
                  }
                  aria-pressed={!!pad.loop}
                  style={{
                    position: 'absolute',
                    left: 2,
                    bottom: 2,
                    display: 'inline-flex',
                    padding: 2,
                    border: 'none',
                    borderRadius: 4,
                    background: 'transparent',
                    cursor: 'pointer',
                    color: pad.loop ? 'var(--gold)' : 'var(--text-muted)',
                    opacity: pad.loop ? 1 : 0.5,
                  }}
                >
                  <LuRepeat size={11} />
                </button>

                {editing && (
                  <button
                    type="button"
                    onClick={() => removePad(pad.id)}
                    aria-label={t('soundboard.remove', {
                      name: pad.title || t('soundboard.untitled'),
                    })}
                    style={{
                      position: 'absolute',
                      top: -6,
                      right: -6,
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      border: '1px solid var(--border)',
                      background: 'var(--bg-panel)',
                      color: 'var(--danger, #c0392b)',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 0,
                    }}
                  >
                    <LuX size={12} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {savingSet && (
        <SaveAudioSetModal
          kind="soundboard"
          count={pads.length}
          existing={sets.filter((s) => s.kind === 'soundboard').map((s) => s.name)}
          onSave={(name) =>
            save(
              'soundboard',
              name,
              pads.map((p) => ({ audio_id: p.id, loop: !!p.loop })),
              layout
            )
          }
          onClose={() => setSavingSet(false)}
        />
      )}
    </div>
  )
}
