import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  LuScroll,
  LuUsers,
  LuUser,
  LuLink,
  LuCalendar,
  LuNotebook,
  LuArchive,
} from 'react-icons/lu'
import { campaigns } from '../../api'
import WikiMarkdown from './WikiMarkdown'
import CampaignRoleBadge from './CampaignRoleBadge'
import LazyImg from '../LazyImg'
import CardLink from '../CardLink'

function formatSessionDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

/**
 * A campaign summary card for the campaigns grid. The card is a real link to
 * the campaign overview (a CardLink overlay), and the Open Notes button is a
 * link of its own, so both support middle click / ctrl-click into a new tab
 * (issue #313).
 */
export default function CampaignCard({ campaign, userId, badgeLabel, subtitle }) {
  const { t } = useTranslation()
  const [hovered, setHovered] = useState(false)
  const acceptedCount =
    campaign.members?.filter((m) => m.status === 'accepted' && !m.is_owner).length ?? 0
  const isOwner = campaign.owner_id === userId
  // Cache-bust the banner with updated_at so a re-upload shows without a stale image.
  const bannerSrc = campaign.has_banner
    ? campaigns.bannerUrl(campaign.id, campaign.updated_at)
    : null

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? 'var(--bg-card-hover)' : 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        cursor: 'pointer',
        transition: 'all 0.15s',
        transform: hovered ? 'translateY(-1px)' : 'none',
        boxShadow: hovered ? '0 4px 16px var(--shadow)' : 'none',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <CardLink
        to={`/campaigns/${campaign.id}/overview`}
        label={`Open campaign ${campaign.name}`}
      />
      {/* Banner header — 2:1 (wide:tall) aspect ratio. Positioned (which would
          paint it above the CardLink overlay), so pointerEvents:'none' lets
          clicks fall through to the link. */}
      <div
        style={{
          aspectRatio: '2 / 1',
          background: 'var(--bg-deep)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          pointerEvents: 'none',
        }}
      >
        {bannerSrc ? (
          <LazyImg
            src={bannerSrc}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
          />
        ) : (
          <LuScroll size={28} color="var(--gold)" style={{ opacity: 0.5 }} />
        )}
      </div>

      {/* Content */}
      <div style={{ padding: '16px 18px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 6,
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              fontSize: 17,
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {campaign.name}
          </span>
          {badgeLabel && <CampaignRoleBadge label={badgeLabel} />}
          {campaign.is_archived && (
            <span
              style={{
                fontSize: 11,
                color: 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <LuArchive size={11} aria-hidden="true" /> {t('campaigns.archivedBadge')}
            </span>
          )}
          {campaign.parent_campaign_id && (
            <span
              style={{
                fontSize: 11,
                color: 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <LuLink size={11} aria-hidden="true" /> {t('campaigns.linkedToGmCampaign')}
            </span>
          )}
        </div>

        {/* Description, full width above the info + notes row. */}
        {campaign.description && (
          <div
            // Scrollable markdown preview, capped near the banner height so a
            // long description doesn't push the meta row (type/system/schedule)
            // out of view. Positioned so it sits above the CardLink overlay:
            // clicks and wheel-scrolling inside don't open the campaign.
            style={{
              fontSize: 13,
              color: 'var(--text-dim)',
              lineHeight: 1.5,
              maxHeight: 96,
              overflowY: 'auto',
              marginBottom: 10,
              position: 'relative',
            }}
          >
            <WikiMarkdown body={campaign.description} />
          </div>
        )}

        {/* Info (type/system/schedule) on the left, Notes button on the right.
            The row never wraps: the info block flexes/wraps internally so the
            button stays pinned right rather than dropping to the next line. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div
            style={{
              display: 'flex',
              gap: 16,
              fontSize: 12,
              color: 'var(--text-muted)',
              flexWrap: 'wrap',
              flex: 1,
              minWidth: 0,
            }}
          >
            {subtitle && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <LuUser size={12} aria-hidden="true" />
                {subtitle}
              </span>
            )}
            {isOwner && campaign.is_gm_campaign && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <LuUsers size={12} aria-hidden="true" />
                {t('campaigns.players', { count: acceptedCount })}
              </span>
            )}
            {campaign.next_session && (
              <span
                style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--gold)' }}
                title={t('campaigns.nextSession')}
              >
                <LuCalendar size={12} aria-hidden="true" />
                {formatSessionDate(campaign.next_session)}
              </span>
            )}
          </div>

          {/* Jump straight to this campaign's notes without opening the overview.
              Matches the gold "Open Notes" action on the campaign overview page.
              Positioned so it paints above the CardLink overlay. */}
          <Link
            to={`/campaigns/${campaign.id}/notes`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '7px 14px',
              background: 'var(--gold)',
              borderRadius: 8,
              color: 'var(--on-accent)',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
              flexShrink: 0,
              textDecoration: 'none',
              position: 'relative',
            }}
          >
            <LuNotebook size={15} aria-hidden="true" /> {t('campaigns.openNotes')}
          </Link>
        </div>
      </div>
    </div>
  )
}
