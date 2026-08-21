import { useEffect, useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { LuImagePlus } from 'react-icons/lu'
import { campaigns } from '../../api'
import BannerUploadModal from './BannerUploadModal'

const bannerBtnStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  padding: '6px 10px',
  background: 'var(--scrim)',
  border: '1px solid var(--on-media-border)',
  borderRadius: 8,
  color: 'var(--on-media)',
  cursor: 'pointer',
  fontSize: 12,
  backdropFilter: 'blur(2px)',
}

/** Campaign banner image with an owner-only edit control revealed on hover. */
export default function BannerHero({ campaign, isOwner, onChanged }) {
  const { t } = useTranslation()
  const [showModal, setShowModal] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(false)
  // Images already attached to this campaign, offered first in the picker — the
  // banner someone wants is usually art they have already uploaded here (#286).
  const [campaignImages, setCampaignImages] = useState([])
  const hoverTimer = useRef(null)

  // Loaded only when the dialog opens: the hero itself never needs this list,
  // and campaigns with many resources shouldn't pay for it on every render.
  useEffect(() => {
    if (!showModal || !isOwner) return undefined
    let cancelled = false
    campaigns
      .listResources(campaign.id)
      .then((rows) => {
        if (cancelled) return
        setCampaignImages(
          (rows || [])
            .filter((r) => r.resource_type === 'file' && r.is_image)
            .map((r) => ({
              id: r.resource_id,
              name: r.name,
              url: campaigns.fileUrl(campaign.id, r.resource_id),
            }))
        )
      })
      .catch(() => {
        // A failed lookup only costs the campaign tab in the picker; the
        // library sources and upload still work, so this stays silent.
        if (!cancelled) setCampaignImages([])
      })
    return () => {
      cancelled = true
    }
  }, [showModal, isOwner, campaign.id])

  // Reveal the Edit control only after hovering the banner for >1s.
  const onEnter = () => {
    if (!isOwner) return
    hoverTimer.current = setTimeout(() => setControlsVisible(true), 1000)
  }
  const onLeave = () => {
    clearTimeout(hoverTimer.current)
    setControlsVisible(false)
  }

  // Bust the browser cache after a re-upload by keying on updated_at.
  const bannerSrc = campaign.has_banner
    ? campaigns.bannerUrl(campaign.id, campaign.updated_at)
    : null

  if (!campaign.has_banner && !isOwner) return null

  return (
    <div
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{
        position: 'relative',
        // Cap at the 1600×800 (2:1) suggested size, scaling down on narrow screens
        // but never stretching past the aspect ratio.
        width: '100%',
        maxWidth: 800,
        aspectRatio: '2 / 1',
        borderRadius: 12,
        overflow: 'hidden',
        background: 'var(--bg-deep)',
        border: '1px solid var(--border)',
      }}
    >
      {bannerSrc ? (
        <img
          src={bannerSrc}
          alt=""
          style={{
            width: '100%',
            height: '100%',
            // `cover` + a focal point (issue #286): a banner set from a library
            // asset is rarely 2:1, and letterboxing it wastes the hero. The
            // stored focus decides which slice of a tall image stays in frame.
            objectFit: 'cover',
            objectPosition: `50% ${campaign.banner_focus_y ?? 50}%`,
            display: 'block',
          }}
        />
      ) : (
        <button
          onClick={() => setShowModal(true)}
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-muted)',
            gap: 8,
            background: 'none',
            border: 'none',
            cursor: isOwner ? 'pointer' : 'default',
          }}
        >
          <LuImagePlus size={28} style={{ opacity: 0.4 }} />
          <span style={{ fontSize: 13 }}>{t('campaignDetail.banner.empty')}</span>
        </button>
      )}

      {/* Edit control — appears only after a >1s hover (or always when there's
          no banner yet). */}
      {isOwner && campaign.has_banner && controlsVisible && (
        <div style={{ position: 'absolute', top: 10, right: 10 }}>
          <button onClick={() => setShowModal(true)} style={bannerBtnStyle}>
            <LuImagePlus size={13} /> {t('campaignDetail.banner.edit')}
          </button>
        </div>
      )}

      {showModal && (
        <BannerUploadModal
          hasBanner={campaign.has_banner}
          previewSrc={bannerSrc}
          campaignImages={campaignImages}
          focusY={campaign.banner_focus_y ?? 50}
          onPick={async (file) => {
            await campaigns.uploadBanner(campaign.id, file)
            onChanged()
          }}
          onPickSource={async ({ source_type: type, source_id: id }) => {
            await campaigns.setBannerFromSource(campaign.id, type, id)
            onChanged()
          }}
          onFocusChange={async (focusY) => {
            await campaigns.setBannerFocus(campaign.id, focusY)
            onChanged()
          }}
          onRemove={async () => {
            await campaigns.deleteBanner(campaign.id)
            onChanged()
          }}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  )
}
