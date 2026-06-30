import { useTranslation } from 'react-i18next'
import { LuPlay, LuPause, LuListPlus } from 'react-icons/lu'
import { useAudioPlayer } from '../../context/AudioPlayerContext'

/**
 * A thin controller for the global audio player. Given a `track`
 * ({ id, title?, artwork? }), the overlay button plays/pauses that track in the
 * single app-wide player; the optional "Play Next" button queues it after the
 * current track without interrupting playback.
 *
 * This replaces the old self-contained <audio> element — there is now exactly
 * one audio element app-wide (see GlobalAudioPlayer), so playback survives
 * navigation and multiple controls stay in sync.
 */
export default function AudioPlayer({ track, showPlayNext = false, size = 44 }) {
  const { t } = useTranslation()
  const { playQueue, playNext, togglePlay, isCurrent, isPlayingId } = useAudioPlayer()

  if (!track || !track.id) return null

  const playing = isPlayingId(track.id)

  const onToggle = (e) => {
    e.stopPropagation()
    if (isCurrent(track.id)) {
      togglePlay()
    } else {
      playQueue([track])
    }
  }

  const onPlayNext = (e) => {
    e.stopPropagation()
    playNext(track)
  }

  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        aria-label={playing ? t('audio.pause') : t('audio.play')}
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          border: 'none',
          background: 'rgba(0,0,0,0.6)',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
          flexShrink: 0,
        }}
      >
        {playing ? (
          <LuPause size={size * 0.45} />
        ) : (
          <LuPlay size={size * 0.45} style={{ marginLeft: 2 }} />
        )}
      </button>
      {showPlayNext && (
        <button
          type="button"
          onClick={onPlayNext}
          aria-label={t('audio.player.playNext')}
          title={t('audio.player.playNext')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 30,
            height: 30,
            borderRadius: '50%',
            border: '1px solid var(--border)',
            background: 'var(--bg-card)',
            color: 'var(--text-dim)',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <LuListPlus size={15} />
        </button>
      )}
    </>
  )
}
