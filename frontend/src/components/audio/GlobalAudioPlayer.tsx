import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import {
  LuPlay,
  LuPause,
  LuSkipBack,
  LuSkipForward,
  LuRepeat1,
  LuListMusic,
  LuListOrdered,
  LuX,
  LuMusic,
} from 'react-icons/lu'
import { mediaUrl } from '../../api'
import { formatDuration } from '../../utils'
import { useAudioPlayer } from '../../context/AudioPlayerContext'
import useTrackChapters, { chapterIndexAt, chapterLabel } from '../../hooks/useTrackChapters'
import AudioQueuePanel from './AudioQueuePanel'
import AudioChaptersPanel from './AudioChaptersPanel'
import { spokenDuration } from './spokenDuration'

const PLAYER_HEIGHT = 72

const iconBtn = (active = false): CSSProperties => ({
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
export interface GlobalAudioPlayerProps {
  isMobile?: boolean
  sidebarWidth?: number
}

export default function GlobalAudioPlayer({
  isMobile = false,
  sidebarWidth = 0,
}: GlobalAudioPlayerProps) {
  const { t, i18n } = useTranslation()
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

  // Audiobooks carry chapter markers (issue #564). A lone chapter is no
  // navigation, so the chapter controls only appear from two up.
  const chapters = useTrackChapters(currentTrack?.id)
  const hasChapters = chapters.length > 1
  const [showChapters, setShowChapters] = useState(false)

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

  // "Now playing: …" for a screen reader, said when the track changes - a skip,
  // a jump in the queue, or the next track starting on its own. The region is
  // rendered even with nothing playing, so the first track is announced too (a
  // live region only speaks for changes after it is in the page).
  const [announcement, setAnnouncement] = useState('')
  const announcedId = useRef<string | null>(null)
  const trackTitle = currentTrack ? currentTrack.title || t('audio.player.untitled') : ''
  useEffect(() => {
    const id = currentTrack?.id ?? null
    if (id === announcedId.current) return
    announcedId.current = id
    setAnnouncement(id ? t('a11y.audio.nowPlaying', { title: trackTitle }) : '')
  }, [currentTrack?.id, trackTitle, t])

  const liveRegion = (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {announcement}
    </div>
  )

  if (!currentTrack) return liveRegion

  const onEnded = () => {
    const el = audioRef.current
    if (repeatOne && el) {
      el.currentTime = 0
      el.play().catch(() => {})
      return
    }
    next()
  }

  const chapterIndex = hasChapters ? chapterIndexAt(chapters, currentTime) : -1

  // The chapter list and the queue share the slot above the bar, so opening
  // one closes the other.
  const onToggleChapters = () => {
    if (!showChapters && expanded) toggleExpanded()
    setShowChapters((open) => !open)
  }
  const onToggleQueue = () => {
    if (!expanded) setShowChapters(false)
    toggleExpanded()
  }
  const onSelectChapter = (start: number) => {
    seek(start)
    if (!isPlaying) togglePlay()
  }

  const bottom = isMobile ? 64 : 0
  // On desktop, start the bar at the sidebar's right edge so it doesn't cover
  // the sidebar (and its logout button). On mobile the sidebar is a bottom bar.
  const left = isMobile ? 0 : sidebarWidth

  // Spoken position for the seek slider, which otherwise reads a raw number of
  // seconds; the visible `1:05` beside it is hidden as a duplicate.
  const timeText = t('a11y.audio.timeOf', {
    current: spokenDuration(Math.min(currentTime, duration || 0), i18n.language),
    total: spokenDuration(duration, i18n.language),
  })

  return (
    <>
      {liveRegion}
      {/* A named landmark, so a screen reader can jump to the player from
          anywhere in the app. */}
      <section
        aria-label={t('a11y.audio.player')}
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
          src={src ?? undefined}
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
              {chapterIndex >= 0
                ? chapterLabel(t, chapters, chapterIndex)
                : currentTrack.artist || t('audio.player.title')}
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
            // The label says on or off, so no aria-pressed as well: a reader
            // would announce "on, pressed" or "off, not pressed".
            aria-label={repeatOne ? t('audio.player.repeatOn') : t('audio.player.repeatOff')}
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
          <span aria-hidden="true" style={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
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
            aria-valuetext={timeText}
            style={{ flex: 1, accentColor: 'var(--gold)', cursor: 'pointer', minWidth: 40 }}
          />
          <span aria-hidden="true" style={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
            {formatDuration(duration)}
          </span>
        </div>

        {/* Queue + close */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
          {hasChapters && (
            <button
              onClick={onToggleChapters}
              aria-label={t('audio.player.toggleChapters')}
              aria-expanded={showChapters}
              aria-controls={showChapters ? 'audio-chapters-panel' : undefined}
              style={iconBtn(showChapters)}
            >
              <LuListOrdered size={18} />
            </button>
          )}
          <button
            onClick={onToggleQueue}
            aria-label={t('audio.player.toggleQueue')}
            aria-expanded={expanded}
            aria-controls={expanded ? 'audio-queue-panel' : undefined}
            style={iconBtn(expanded)}
          >
            <LuListMusic size={18} />
          </button>
          <button onClick={clear} aria-label={t('audio.player.close')} style={iconBtn()}>
            <LuX size={18} />
          </button>
        </div>
      </section>

      {/* After the bar in the DOM (both are fixed, so this does not move them):
          tabbing on from the toggle that opened a panel reaches its contents. */}
      {expanded && <AudioQueuePanel bottom={bottom + PLAYER_HEIGHT} left={left} />}
      {!expanded && showChapters && hasChapters && (
        <AudioChaptersPanel
          chapters={chapters}
          currentIndex={chapterIndex}
          onSelect={onSelectChapter}
          bottom={bottom + PLAYER_HEIGHT}
          left={left}
        />
      )}
    </>
  )
}

export { PLAYER_HEIGHT }
