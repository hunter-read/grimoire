import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router-dom'
import { LuBookOpen, LuTrash2, LuChevronRight } from 'react-icons/lu'
import { campaigns, mediaUrl } from '../../api'
import { TYPE_ICONS, RESOURCE_NAV, VISIBILITY_OPTIONS, selectStyle } from './resourcesShared'
import AudioPlayer from '../audio/AudioPlayer'
import LazyImg from '../LazyImg'

/** A single linked campaign resource with owner controls (visibility, category, share). */
export default function ResourceRow({
  campaignId,
  resource,
  isOwner,
  isGmCampaign,
  members,
  categories,
  onRemove,
  onSetVisibility,
  onSetShares,
  onSetCategory,
  onDragStart,
}) {
  const { t } = useTranslation()
  const location = useLocation()
  const [hovered, setHovered] = useState(false)
  const { Icon } = TYPE_ICONS[resource.resource_type] || { Icon: LuBookOpen }
  const isBook = resource.resource_type === 'book'
  const isFile = resource.resource_type === 'file'
  const isAudio = resource.resource_type === 'audio'
  const isImage = isFile && resource.is_image

  // Audio serves folder/embedded artwork from its own endpoint; other media use
  // the standard /<collection>/:id/thumbnail route.
  const thumbUrl = isImage
    ? campaigns.fileUrl(campaignId, resource.resource_id)
    : resource.has_thumbnail && isAudio
      ? mediaUrl(`/audio/${resource.resource_id}/artwork`)
      : resource.has_thumbnail && !isFile
        ? mediaUrl(
            `/${isBook ? 'books' : resource.resource_type + 's'}/${resource.resource_id}/thumbnail`
          )
        : null

  const stop = (e) => e.stopPropagation()

  // Row 1 — title, a real link so middle click / ctrl-click opens the resource
  // in a new tab (issue #313). Uploaded files aren't app routes: they open in
  // their own tab on any click via a plain anchor.
  const titleStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    cursor: 'pointer',
    minWidth: 0,
    color: 'inherit',
    textDecoration: 'none',
  }
  const titleLabel = `Open ${resource.name || resource.resource_id}`
  const titleContent = (
    <>
      <span
        style={{
          flex: 1,
          fontSize: 15,
          fontWeight: 500,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {resource.name || resource.resource_id}
      </span>
      {resource.subtitle && (
        <span style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>
          {resource.subtitle}
        </span>
      )}
      <LuChevronRight size={15} color="var(--text-muted)" style={{ flexShrink: 0 }} />
    </>
  )
  const titleLink = isFile ? (
    <a
      href={campaigns.fileUrl(campaignId, resource.resource_id)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={titleLabel}
      style={titleStyle}
    >
      {titleContent}
    </a>
  ) : (
    <Link
      to={RESOURCE_NAV[resource.resource_type]?.(resource.resource_id) ?? '/'}
      state={{ from: location.pathname }}
      aria-label={titleLabel}
      style={titleStyle}
    >
      {titleContent}
    </Link>
  )

  return (
    <div
      draggable={isOwner}
      onDragStart={(e) => onDragStart?.(e, resource)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: 10,
        padding: '10px 12px',
        background: hovered ? 'var(--bg-card-hover)' : 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        transition: 'background 0.15s',
        marginBottom: 6,
        cursor: isOwner ? 'grab' : 'default',
      }}
    >
      <div
        style={{
          width: isBook ? 36 : 44,
          height: isBook ? 48 : 44,
          borderRadius: 4,
          overflow: 'hidden',
          flexShrink: 0,
          background: 'var(--bg-deep)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {thumbUrl ? (
          <LazyImg
            src={thumbUrl}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <Icon size={16} color="var(--text-muted)" />
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {titleLink}

        {/* Row 2 — options */}
        {isOwner ? (
          <div
            style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}
            onClick={stop}
            role="presentation"
          >
            {isGmCampaign && (
              <select
                value={resource.visibility}
                onChange={(e) => onSetVisibility(resource.id, e.target.value)}
                aria-label={t('resources.visibilityLabel')}
                style={{
                  ...selectStyle,
                  color: resource.visibility === 'public' ? 'var(--gold)' : 'var(--text-dim)',
                }}
              >
                {VISIBILITY_OPTIONS.map((v) => (
                  <option key={v} value={v}>
                    {t(`resources.vis_${v}`)}
                  </option>
                ))}
              </select>
            )}
            {categories?.length > 0 && (
              <select
                value={resource.category_id || ''}
                onChange={(e) => onSetCategory(resource.id, e.target.value)}
                aria-label={t('resources.categoryLabel')}
                style={{ ...selectStyle, maxWidth: 150 }}
              >
                <option value="">{t('resources.typeGroup')}</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
            <button
              onClick={() => onRemove(resource)}
              aria-label={`Remove ${resource.name || resource.resource_id}`}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-muted)',
                padding: 4,
                display: 'flex',
              }}
            >
              <LuTrash2 size={14} aria-hidden="true" />
            </button>
          </div>
        ) : (
          isGmCampaign && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {t(`resources.vis_${resource.visibility}`)}
            </span>
          )
        )}

        {/* Row 3 — private share checkboxes */}
        {isOwner && isGmCampaign && resource.visibility === 'private' && members.length > 0 && (
          <div
            onClick={stop}
            role="presentation"
            style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 2 }}
          >
            {members.map((m) => {
              const checked = (resource.shared_user_ids || []).includes(m.user_id)
              return (
                <label
                  key={m.user_id}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 11,
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...(resource.shared_user_ids || []), m.user_id]
                        : (resource.shared_user_ids || []).filter((id) => id !== m.user_id)
                      onSetShares(resource.id, next)
                    }}
                  />
                  {m.character_name || m.display_name || m.username}
                </label>
              )
            })}
          </div>
        )}
      </div>

      {isAudio && (
        <div
          onClick={stop}
          role="presentation"
          style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
        >
          <AudioPlayer
            track={{
              id: resource.resource_id,
              title: resource.name,
              artwork: resource.has_thumbnail,
            }}
            showPlayNext
            size={34}
          />
        </div>
      )}
    </div>
  )
}
