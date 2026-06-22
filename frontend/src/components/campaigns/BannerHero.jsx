import { useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { LuImagePlus } from 'react-icons/lu'
import { campaigns } from '../../api'
import BannerUploadModal from './BannerUploadModal'

const bannerBtnStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  padding: '6px 10px',
  background: 'rgba(0,0,0,0.55)',
  border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: 8,
  color: '#fff',
  cursor: 'pointer',
  fontSize: 12,
  backdropFilter: 'blur(2px)',
}

/** Campaign banner image with an owner-only edit control revealed on hover. */
export default function BannerHero({ campaign, isOwner, onChanged }) {
  const { t } = useTranslation()
  const [showModal, setShowModal] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(false)
  const hoverTimer = useRef(null)

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
    ? `${campaigns.bannerUrl(campaign.id)}&v=${encodeURIComponent(campaign.updated_at)}`
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
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
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
          onPick={async (file) => {
            await campaigns.uploadBanner(campaign.id, file)
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
