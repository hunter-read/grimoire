import { useRef, useState } from 'react'
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
export default function AudioQueuePanel({ bottom = 72, left = 0 }) {
  const { t } = useTranslation()
  const { queue, currentIndex, isPlaying, jumpTo, removeAt, moveTrack } = useAudioPlayer()
  const { sets, save } = useAudioSets()

  const dragFrom = useRef(null)
  const [dragOver, setDragOver] = useState(null)
  const [saving, setSaving] = useState(false)

  const onDrop = (to) => {
    const from = dragFrom.current
    dragFrom.current = null
    setDragOver(null)
    if (from != null && from !== to) moveTrack(from, to)
  }

  return (
    <div
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
        <span style={{ flex: 1 }}>
          {t('audio.player.queue')} ({queue.length})
        </span>
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
        queue.map((track, i) => {
          const isCurrent = i === currentIndex
          return (
            <div
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
              <span
                draggable
                onDragStart={(e) => {
                  dragFrom.current = i
                  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
                }}
                onDragEnd={() => {
                  dragFrom.current = null
                  setDragOver(null)
                }}
                aria-label={t('audio.player.reorder')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  color: 'var(--text-muted)',
                  cursor: 'grab',
                  flexShrink: 0,
                }}
              >
                <LuGripVertical size={15} />
              </span>
              <button
                type="button"
                onClick={() => jumpTo(i)}
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
                aria-label={t('audio.player.removeFromQueue')}
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
            </div>
          )
        })
      )}

      {saving && (
        <SaveAudioSetModal
          kind="playlist"
          count={queue.length}
          existing={sets.filter((s) => s.kind === 'playlist').map((s) => s.name)}
          onSave={(name) =>
            save(
              'playlist',
              name,
              queue.map((tr) => ({ audio_id: tr.id }))
            )
          }
          onClose={() => setSaving(false)}
        />
      )}
    </div>
  )
}
