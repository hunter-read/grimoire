import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  LuPlay,
  LuPause,
  LuSkipBack,
  LuSkipForward,
  LuRepeat1,
  LuListMusic,
  LuX,
  LuMusic,
} from 'react-icons/lu'
import { mediaUrl } from '../../api'
import { formatDuration } from '../../utils'
import { useAudioPlayer } from '../../context/AudioPlayerContext'
import AudioQueuePanel from './AudioQueuePanel'

const PLAYER_HEIGHT = 72

const iconBtn = (active = false) => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: active ? 'var(--gold)' : 'var(--text-dim)',
  padding: 6,
})

/**
 * The single app-wide audio element plus a docked control bar. Mounted once in
 * AppShell (outside <Routes>) so playback survives navigation. Renders nothing
 * when the queue is empty.
 */
export default function GlobalAudioPlayer({ isMobile = false, sidebarWidth = 0 }) {
  const { t } = useTranslation()
  const player = useAudioPlayer()
  const {
    audioRef,
    playRequested,
    queue,
    currentIndex,
    currentTrack,
    isPlaying,
    setIsPlaying,
    currentTime,
    setCurrentTime,
    duration,
    setDuration,
    repeatOne,
    expanded,
    togglePlay,
    toggleRepeat,
    next,
    prev,
    seek,
    clear,
    toggleExpanded,
  } = player

  const src = currentTrack ? mediaUrl(`/audio/${currentTrack.id}/file`) : null

  // When the source changes and playback was requested (play/skip/jump), start
  // playing once the element has the new src.
  useEffect(() => {
    const el = audioRef.current
    if (!el || !src) return
    if (playRequested.current) {
      playRequested.current = false
      el.play().catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src])

  // Prefetch the next track in the queue so skipping forward (or a track ending)
  // starts without a fetch stall. A <link rel="prefetch"> lets the browser pull
  // the file at idle priority; repeat-one has no "next", so skip it then.
  const nextTrack = !repeatOne && currentIndex >= 0 ? queue[currentIndex + 1] : null
  const nextSrc = nextTrack ? mediaUrl(`/audio/${nextTrack.id}/file`) : null
  useEffect(() => {
    if (!nextSrc) return
    const link = document.createElement('link')
    link.rel = 'prefetch'
    link.as = 'audio'
    link.href = nextSrc
    document.head.appendChild(link)
    return () => {
      document.head.removeChild(link)
    }
  }, [nextSrc])

  if (!currentTrack) return null

  const onEnded = () => {
    const el = audioRef.current
    if (repeatOne && el) {
      el.currentTime = 0
      el.play().catch(() => {})
      return
    }
    next()
  }

  const bottom = isMobile ? 64 : 0
  // On desktop, start the bar at the sidebar's right edge so it doesn't cover
  // the sidebar (and its logout button). On mobile the sidebar is a bottom bar.
  const left = isMobile ? 0 : sidebarWidth

  return (
    <>
      {expanded && <AudioQueuePanel bottom={bottom + PLAYER_HEIGHT} left={left} />}

      <div
        style={{
          position: 'fixed',
          left,
          right: 0,
          bottom,
          height: PLAYER_HEIGHT,
          zIndex: 95,
          background: 'var(--bg-panel)',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '0 16px',
          boxShadow: '0 -2px 12px var(--shadow)',
        }}
      >
        <audio
          ref={audioRef}
          src={src}
          preload="metadata"
          autoPlay={false}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={onEnded}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
          data-testid="global-audio-element"
        />

        {/* Artwork + title */}
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: '0 1 220px' }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 6,
              flexShrink: 0,
              overflow: 'hidden',
              background: 'var(--bg-deep)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {currentTrack.artwork ? (
              <img
                src={mediaUrl(`/audio/${currentTrack.id}/artwork`)}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <LuMusic size={20} color="var(--text-muted)" style={{ opacity: 0.5 }} />
            )}
          </div>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 500,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={currentTrack.title}
            >
              {currentTrack.title || t('audio.player.untitled')}
            </div>
            <div
              style={{
                fontSize: 11,
                color: 'var(--text-muted)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {currentTrack.artist || t('audio.player.title')}
            </div>
          </div>
        </div>

        {/* Transport controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
          <button onClick={prev} aria-label={t('audio.player.previous')} style={iconBtn()}>
            <LuSkipBack size={18} />
          </button>
          <button
            onClick={togglePlay}
            aria-label={isPlaying ? t('audio.pause') : t('audio.play')}
            style={{
              ...iconBtn(),
              background: 'var(--gold)',
              color: 'var(--bg-deep)',
              borderRadius: '50%',
              width: 36,
              height: 36,
            }}
          >
            {isPlaying ? <LuPause size={18} /> : <LuPlay size={18} style={{ marginLeft: 2 }} />}
          </button>
          <button onClick={next} aria-label={t('audio.player.next')} style={iconBtn()}>
            <LuSkipForward size={18} />
          </button>
          <button
            onClick={toggleRepeat}
            aria-label={repeatOne ? t('audio.player.repeatOn') : t('audio.player.repeatOff')}
            aria-pressed={repeatOne}
            style={iconBtn(repeatOne)}
          >
            <LuRepeat1 size={17} />
          </button>
        </div>

        {/* Seek bar */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            minWidth: 0,
            color: 'var(--text-muted)',
            fontSize: 11,
          }}
        >
          <span style={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
            {formatDuration(currentTime)}
          </span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step="any"
            value={Math.min(currentTime, duration || 0)}
            onChange={(e) => seek(parseFloat(e.target.value))}
            aria-label={t('audio.player.seek')}
            style={{ flex: 1, accentColor: 'var(--gold)', cursor: 'pointer', minWidth: 40 }}
          />
          <span style={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
            {formatDuration(duration)}
          </span>
        </div>

        {/* Queue + close */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
          <button
            onClick={toggleExpanded}
            aria-label={t('audio.player.toggleQueue')}
            aria-pressed={expanded}
            style={iconBtn(expanded)}
          >
            <LuListMusic size={18} />
          </button>
          <button onClick={clear} aria-label={t('audio.player.close')} style={iconBtn()}>
            <LuX size={18} />
          </button>
        </div>
      </div>
    </>
  )
}

export { PLAYER_HEIGHT }
