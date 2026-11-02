import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuX, LuMusic, LuGripVertical, LuSave } from 'react-icons/lu'
import { mediaUrl } from '../../api'
import { useAudioPlayer } from '../../context/AudioPlayerContext'
import useAudioSets from '../../hooks/useAudioSets'
import LazyImg from '../LazyImg'
import NowPlayingIndicator from './NowPlayingIndicator'
import SaveAudioSetModal from './SaveAudioSetModal'

/**
 * The expandable "upcoming tracks" list shown above the global player bar.
 * The currently-playing track is highlighted; clicking a row jumps to it, each
 * row can be removed, and rows can be dragged by their handle to reorder the
 * queue (without interrupting playback).
 *
 * The header's save button names the queue and keeps it server-side (issue
 * #422), so a scene built here can be reloaded next session from any device.
 * The live queue itself stays in sessionStorage — saving is explicit.
 */
export interface AudioQueuePanelProps {
  bottom?: number
  left?: number
}

export default function AudioQueuePanel({ bottom = 72, left = 0 }: AudioQueuePanelProps) {
  const { t } = useTranslation()
  const { queue, currentIndex, isPlaying, jumpTo, removeAt, moveTrack } = useAudioPlayer()
  const { sets, save } = useAudioSets()

  const dragFrom = useRef<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  // Keyboard reordering: the grip is a button that moves its track with the
  // up/down arrows, the drag-only alternative WCAG 2.5.7 asks for. Focus follows
  // the track to its new row, and the new position is read out.
  const gripRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [focusRow, setFocusRow] = useState<number | null>(null)
  const [moved, setMoved] = useState('')
  useEffect(() => {
    if (focusRow === null) return
    gripRefs.current[focusRow]?.focus()
    setFocusRow(null)
  }, [focusRow, queue])
  const moveWithKeys = (from: number, key: string) => {
    const to = key === 'ArrowUp' ? from - 1 : key === 'ArrowDown' ? from + 1 : from
    if (to === from || to < 0 || to >= queue.length) return false
    moveTrack(from, to)
    setFocusRow(to)
    setMoved(t('a11y.audio.moved', { position: to + 1, total: queue.length }))
    return true
  }

  const onDrop = (to: number) => {
    const from = dragFrom.current
    dragFrom.current = null
    setDragOver(null)
    if (from != null && from !== to) moveTrack(from, to)
  }

  return (
    <section
      id="audio-queue-panel"
      aria-labelledby="audio-queue-heading"
      style={{
        position: 'fixed',
        left,
        right: 0,
        bottom,
        zIndex: 94,
        maxHeight: '40vh',
        overflowY: 'auto',
        background: 'var(--bg-panel)',
        borderTop: '1px solid var(--border)',
        boxShadow: '0 -2px 12px var(--shadow)',
      }}
    >
      <div
        style={{
          padding: '10px 16px',
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.07em',
          borderBottom: '1px solid var(--border)',
          position: 'sticky',
          top: 0,
          background: 'var(--bg-panel)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <h2
          id="audio-queue-heading"
          style={{
            flex: 1,
            margin: 0,
            font: 'inherit',
            color: 'inherit',
            letterSpacing: 'inherit',
          }}
        >
          {t('audio.player.queue')} ({queue.length})
        </h2>
        {queue.length > 0 && (
          <button
            type="button"
            onClick={() => setSaving(true)}
            aria-label={t('audioSets.savePlaylist')}
            title={t('audioSets.savePlaylist')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              padding: 2,
            }}
          >
            <LuSave size={14} />
          </button>
        )}
      </div>

      {queue.length === 0 ? (
        <div style={{ padding: '16px', fontSize: 13, color: 'var(--text-muted)' }}>
          {t('audio.player.emptyQueue')}
        </div>
      ) : (
        <ul role="list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {queue.map((track, i) => {
            const isCurrent = i === currentIndex
            const title = track.title || t('audio.player.untitled')
            return (
              <li
                key={`${track.id}-${i}`}
                onDragOver={(e) => {
                  e.preventDefault()
                  if (dragOver !== i) setDragOver(i)
                }}
                onDrop={() => onDrop(i)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 16px',
                  background: isCurrent ? 'var(--bg-card-hover)' : 'transparent',
                  borderTop: dragOver === i ? '2px solid var(--gold)' : '2px solid transparent',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <button
                  type="button"
                  ref={(el) => {
                    gripRefs.current[i] = el
                  }}
                  draggable
                  onKeyDown={(e) => {
                    if (moveWithKeys(i, e.key)) e.preventDefault()
                  }}
                  aria-label={t('a11y.audio.reorderTrack', { title })}
                  aria-describedby="audio-queue-reorder-hint"
                  title={t('audio.player.reorder')}
                  onDragStart={(e) => {
                    dragFrom.current = i
                    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragEnd={() => {
                    dragFrom.current = null
                    setDragOver(null)
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    color: 'var(--text-muted)',
                    cursor: 'grab',
                    flexShrink: 0,
                    background: 'none',
                    border: 'none',
                    padding: 0,
                  }}
                >
                  <LuGripVertical size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => jumpTo(i)}
                  aria-current={isCurrent ? 'true' : undefined}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--text)',
                    textAlign: 'left',
                    padding: 0,
                    font: 'inherit',
                  }}
                >
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 4,
                      flexShrink: 0,
                      overflow: 'hidden',
                      background: 'var(--bg-deep)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {track.artwork ? (
                      <LazyImg
                        src={mediaUrl(`/audio/${track.id}/artwork`)}
                        alt=""
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <LuMusic size={14} color="var(--text-muted)" style={{ opacity: 0.5 }} />
                    )}
                  </div>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        display: 'block',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: 14,
                        color: isCurrent ? 'var(--gold)' : 'var(--text)',
                      }}
                    >
                      {track.title || t('audio.player.untitled')}
                    </span>
                    {track.artist && (
                      <span
                        style={{
                          display: 'block',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          fontSize: 12,
                          color: 'var(--text-muted)',
                        }}
                      >
                        {track.artist}
                      </span>
                    )}
                  </span>
                  {isCurrent && <NowPlayingIndicator playing={isPlaying} size={14} />}
                </button>
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  aria-label={t('a11y.audio.removeFromQueue', { title })}
                  title={t('audio.player.removeFromQueue')}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--text-muted)',
                    padding: 4,
                    flexShrink: 0,
                  }}
                >
                  <LuX size={15} />
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <span id="audio-queue-reorder-hint" className="sr-only">
        {t('a11y.audio.reorderHint')}
      </span>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {moved}
      </div>

      {saving && (
        <SaveAudioSetModal
          kind="playlist"
          count={queue.length}
          existing={sets.filter((s) => s.kind === 'playlist').map((s) => s.name)}
          onSave={(name: string) =>
            save(
              'playlist',
              name,
              queue.map((tr) => ({ audio_id: tr.id }))
            )
          }
          onClose={() => setSaving(false)}
        />
      )}
    </section>
  )
}
