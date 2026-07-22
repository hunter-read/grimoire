import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCheck } from 'react-icons/lu'
import { mediaUrl } from '../../api'
import { formatSize } from '../../utils'
import FavoriteButton from '../FavoriteButton'
import DownloadButton from '../DownloadButton'
import AudioPlayer from '../audio/AudioPlayer'
import LazyImg from '../LazyImg'

const CORNER_POS = {
  'bottom-left': { bottom: 6, left: 6 },
  'bottom-right': { bottom: 6, right: 6 },
}

/**
 * Generic gallery card for a media item (map, token, …). Behaviour is identical
 * across types; per-type differences (icon, thumbnail shape, badges, font size)
 * come from the `config` entry in mediaConfig.js.
 */
export default function MediaCard({ config, item, onClick, bulkMode, selected, onToggle, list }) {
  const { t } = useTranslation()
  const [hovered, setHovered] = useState(false)
  const Icon = config.icon

  const handleClick = (e) => {
    if (bulkMode) {
      e.stopPropagation()
      onToggle({ shift: e.shiftKey, meta: e.metaKey || e.ctrlKey })
      return
    }
    onClick()
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleClick(e)
    }
  }

  // Badges that apply to this item, in config order.
  const activeBadges = config.badges.filter((b) => item[b.flag])

  // Which item field signals an available thumbnail/artwork (audio uses artwork).
  const hasThumbnail = item[config.thumbnailFlag || 'has_thumbnail']

  // Track ref for the global audio player (audio gallery only).
  const isAudio = !!config.audioFileUrl
  const track = isAudio
    ? { id: item.id, title: item.title || item.filename, artwork: item.has_artwork }
    : null

  if (list) {
    return (
      <div
        onClick={handleClick}
        onKeyDown={onKeyDown}
        role="button"
        tabIndex={0}
        aria-label={item.filename}
        aria-pressed={bulkMode ? selected : undefined}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '10px 14px',
          background: selected ? 'var(--bg-card-hover)' : 'var(--bg-card)',
          border: selected ? '1px solid var(--gold-dim)' : '1px solid var(--border)',
          borderRadius: 8,
          cursor: bulkMode ? 'default' : 'pointer',
          transition: 'border-color 0.15s',
          position: 'relative',
        }}
      >
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
            {activeBadges.map((b) => (
              <span key={b.flag} style={{ color: b.inlineColor }}>
                {t(`${config.i18n}.${b.label}`)}
              </span>
            ))}
          </div>
        </div>
        {!bulkMode && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
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
      onClick={handleClick}
      onKeyDown={onKeyDown}
      role="button"
      tabIndex={0}
      aria-label={item.filename}
      aria-pressed={bulkMode ? selected : undefined}
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
      <div
        style={{
          ...thumbStyle,
          background: 'var(--bg-deep)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
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
            }}
          >
            <AudioPlayer track={track} />
          </div>
        )}
        {activeBadges
          .filter((b) => b.corner)
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
              {t(`${config.i18n}.${b.label}`)}
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
