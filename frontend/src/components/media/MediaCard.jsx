import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCheck } from 'react-icons/lu'
import { mediaUrl } from '../../api'
import { formatSize } from '../../utils'
import FavoriteButton from '../FavoriteButton'
import DownloadButton from '../DownloadButton'
import AudioPlayer from '../audio/AudioPlayer'
import NowPlayingIndicator from '../audio/NowPlayingIndicator'
import LazyImg from '../LazyImg'
import CardLink from '../CardLink'
import { useAudioPlayer } from '../../context/AudioPlayerContext'

const CORNER_POS = {
  'bottom-left': { bottom: 6, left: 6 },
  'bottom-right': { bottom: 6, right: 6 },
  // Top-left is free on the thumbnail (favorite/download sit top-right); in bulk
  // mode the selection checkbox takes it, so corner badges are hidden there.
  'top-left': { top: 6, left: 6 },
}

/**
 * Generic gallery card for a media item (map, token, …). Behaviour is identical
 * across types; per-type differences (icon, thumbnail shape, badges, font size)
 * come from the `config` entry in mediaConfig.js.
 */
export default function MediaCard({ config, item, bulkMode, selected, onToggle, list }) {
  const { t } = useTranslation()
  const [hovered, setHovered] = useState(false)
  const { isCurrent, isPlayingId } = useAudioPlayer()
  const Icon = config.icon

  // Outside bulk mode the card is a real link (a CardLink overlay), so middle
  // click and ctrl/cmd-click open the detail page in a new tab (issue #313).
  // Bulk mode claims the modifier keys for range and multi-select, so there the
  // card stays a toggle button.
  const toggle = (e) => onToggle({ shift: e.shiftKey, meta: e.metaKey || e.ctrlKey })
  const buttonProps = bulkMode
    ? {
        onClick: toggle,
        onKeyDown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            toggle(e)
          }
        },
        role: 'button',
        tabIndex: 0,
        'aria-label': item.filename,
        'aria-pressed': selected,
      }
    : {}
  const cardLink = !bulkMode && <CardLink to={config.detailPath(item.id)} label={item.filename} />

  // Badges that apply to this item, in config order.
  const activeBadges = config.badges.filter((b) => item[b.flag])

  // Which item field signals an available thumbnail/artwork (audio uses artwork).
  const hasThumbnail = item[config.thumbnailFlag || 'has_thumbnail']

  // Track ref for the global audio player (audio gallery only). Archives in the
  // audio tree (issue #250) are opaque blobs with nothing to play.
  const isAudio = !!config.audioFileUrl && !item.is_archive
  const track = isAudio
    ? { id: item.id, title: item.title || item.filename, artwork: item.has_artwork }
    : null

  // "Active" (this is the loaded track — keeps the row findable even when
  // paused) is a separate signal from "playing" (drives the animation). Gated on
  // audio so map/token rows are untouched.
  const isActiveTrack = isAudio && isCurrent(item.id)
  const isPlayingTrack = isAudio && isPlayingId(item.id)

  if (list) {
    return (
      <div
        {...buttonProps}
        aria-current={isActiveTrack ? 'true' : undefined}
        data-now-playing={isActiveTrack ? 'true' : undefined}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '10px 14px',
          background: selected || isActiveTrack ? 'var(--bg-card-hover)' : 'var(--bg-card)',
          border:
            selected || isActiveTrack ? '1px solid var(--gold-dim)' : '1px solid var(--border)',
          // Left accent bar — a second, non-color-dependent cue for the active row.
          borderLeft: isActiveTrack ? '3px solid var(--gold)' : undefined,
          borderRadius: 8,
          cursor: bulkMode ? 'default' : 'pointer',
          transition: 'border-color 0.15s',
          position: 'relative',
        }}
      >
        {cardLink}
        {bulkMode && (
          <div
            style={{
              width: 20,
              height: 20,
              flexShrink: 0,
              borderRadius: 4,
              background: selected ? 'var(--gold)' : 'transparent',
              border: selected ? 'none' : '2px solid var(--border-light)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {selected && <LuCheck size={12} color="var(--bg-deep)" strokeWidth={3} />}
          </div>
        )}
        <div
          style={{
            width: config.listIcon.width,
            height: config.listIcon.height,
            borderRadius: 4,
            overflow: 'hidden',
            flexShrink: 0,
            background: 'var(--bg-deep)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {hasThumbnail ? (
            <LazyImg
              src={mediaUrl(config.thumbnailUrl(item.id))}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <Icon size={18} color="var(--text-muted)" aria-hidden="true" style={{ opacity: 0.4 }} />
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 15,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: isActiveTrack ? 'var(--gold)' : undefined,
              fontWeight: isActiveTrack ? 600 : undefined,
            }}
          >
            {item.filename}
          </div>
          <div
            style={{
              fontSize: 13,
              color: 'var(--text-muted)',
              display: 'flex',
              gap: 8,
              marginTop: 2,
              alignItems: 'center',
            }}
          >
            <span>{formatSize(item.file_size)}</span>
            {isActiveTrack && (
              <span style={{ color: 'var(--gold)' }}>
                {t(isPlayingTrack ? 'audio.nowPlaying' : 'audio.nowPlayingPaused')}
              </span>
            )}
            {activeBadges.map((b) => (
              <span key={b.flag} style={{ color: b.inlineColor }}>
                {t(b.labelKey || `${config.i18n}.${b.label}`)}
              </span>
            ))}
          </div>
        </div>
        {!bulkMode && (
          // Positioned so the action buttons paint above the CardLink overlay.
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              flexShrink: 0,
              position: 'relative',
            }}
          >
            {/* The row's metadata line already announces the state as text, so
                the bars are decorative here. */}
            {isActiveTrack && (
              <span aria-hidden="true" style={{ display: 'inline-flex', marginRight: 4 }}>
                <NowPlayingIndicator playing={isPlayingTrack} size={14} />
              </span>
            )}
            {isAudio && !item.is_missing && <AudioPlayer track={track} showPlayNext size={30} />}
            <DownloadButton
              type={config.downloadType}
              id={item.id}
              style={{ position: 'static', background: 'transparent', width: 28, height: 28 }}
            />
            <FavoriteButton
              type={config.type}
              id={item.id}
              style={{ position: 'static', background: 'transparent', width: 28, height: 28 }}
            />
          </div>
        )}
      </div>
    )
  }

  const thumbStyle =
    config.thumb.kind === 'square'
      ? { width: '100%', aspectRatio: '1/1' }
      : { width: '100%', height: config.thumb.height }

  return (
    <div
      {...buttonProps}
      style={{
        background: selected ? 'var(--bg-card-hover)' : 'var(--bg-card)',
        border: selected ? '1px solid var(--gold-dim)' : '1px solid var(--border)',
        borderRadius: 8,
        overflow: 'hidden',
        cursor: bulkMode ? 'default' : 'pointer',
        transition: 'border-color 0.15s',
        position: 'relative',
      }}
      onMouseEnter={(e) => {
        setHovered(true)
        if (!bulkMode && !selected) e.currentTarget.style.borderColor = 'var(--border-light)'
      }}
      onMouseLeave={(e) => {
        setHovered(false)
        if (!selected) e.currentTarget.style.borderColor = 'var(--border)'
      }}
    >
      {cardLink}
      {!bulkMode && (
        <DownloadButton type={config.downloadType} id={item.id} cardHovered={hovered} />
      )}
      {!bulkMode && <FavoriteButton type={config.type} id={item.id} cardHovered={hovered} />}
      {bulkMode && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            zIndex: 2,
            width: 20,
            height: 20,
            borderRadius: 4,
            background: selected ? 'var(--gold)' : 'rgba(0,0,0,0.55)',
            border: selected ? 'none' : '2px solid rgba(255,255,255,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
          }}
        >
          {selected && <LuCheck size={12} color="var(--bg-deep)" strokeWidth={3} />}
        </div>
      )}
      {/* Positioned (to anchor the badges and audio overlay), which would paint
          it above the CardLink overlay — pointerEvents:'none' lets clicks fall
          through to the link; the audio overlay re-enables them for itself. */}
      <div
        style={{
          ...thumbStyle,
          background: 'var(--bg-deep)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          pointerEvents: bulkMode ? undefined : 'none',
        }}
      >
        {hasThumbnail ? (
          <LazyImg
            src={mediaUrl(config.thumbnailUrl(item.id))}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <Icon size={32} color="var(--text-muted)" aria-hidden="true" style={{ opacity: 0.4 }} />
        )}
        {isAudio && !item.is_missing && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1,
              pointerEvents: 'auto',
            }}
          >
            <AudioPlayer track={track} />
          </div>
        )}
        {activeBadges
          // In bulk mode the selection checkbox occupies the top-left corner.
          .filter((b) => b.corner && !(bulkMode && b.corner === 'top-left'))
          .map((b) => (
            <div
              key={b.flag}
              style={{
                position: 'absolute',
                ...CORNER_POS[b.corner],
                zIndex: 2,
                fontSize: 11,
                padding: '1px 6px',
                borderRadius: 6,
                background: b.color,
                color: '#fff',
                fontWeight: 600,
              }}
            >
              {t(b.labelKey || `${config.i18n}.${b.label}`)}
            </div>
          ))}
      </div>
      <div style={{ padding: config.thumb.kind === 'square' ? '8px 10px' : '10px 12px' }}>
        <div
          style={{
            fontSize: config.titleFontSize,
            color: 'var(--text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {item.filename}
        </div>
        <div
          style={{
            fontSize: config.thumb.kind === 'square' ? 12 : 13,
            color: 'var(--text-muted)',
            marginTop: 2,
          }}
        >
          {formatSize(item.file_size)}
        </div>
      </div>
    </div>
  )
}
