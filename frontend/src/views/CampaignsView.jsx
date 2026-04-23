import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  LuScroll,
  LuPlus,
  LuUsers,
  LuUser,
  LuLink,
  LuChevronRight,
  LuMailOpen,
} from 'react-icons/lu'
import { campaigns } from '../api'
import { useAuth } from '../context/AuthContext'
import Spinner from '../components/Spinner'
import CampaignEditor from '../components/campaigns/CampaignEditor'

function RoleBadge({ label }) {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: 20,
        background: 'var(--bg-panel)',
        color: 'var(--text-muted)',
        border: '1px solid var(--border)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
      }}
    >
      {label}
    </span>
  )
}

function CampaignCard({ campaign, onClick, userId, badgeLabel, subtitle }) {
  const { t } = useTranslation()
  const [hovered, setHovered] = useState(false)
  const acceptedCount =
    campaign.members?.filter((m) => m.status === 'accepted' && !m.is_owner).length ?? 0
  const isOwner = campaign.owner_id === userId

  return (
    <div
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`Open campaign ${campaign.name}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? 'var(--bg-card-hover)' : 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        cursor: 'pointer',
        transition: 'all 0.15s',
        transform: hovered ? 'translateY(-1px)' : 'none',
        boxShadow: hovered ? '0 4px 16px rgba(0,0,0,0.25)' : 'none',
        padding: '20px 22px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 16,
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 10,
          flexShrink: 0,
          background: 'var(--bg-deep)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '1px solid var(--border)',
        }}
      >
        <LuScroll size={20} color="var(--gold)" />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
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
          {badgeLabel && <RoleBadge label={badgeLabel} />}
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

        {campaign.description && (
          <p
            style={{
              fontSize: 13,
              color: 'var(--text-dim)',
              lineHeight: 1.5,
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              marginBottom: 10,
            }}
          >
            {campaign.description}
          </p>
        )}

        <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-muted)' }}>
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
        </div>
      </div>

      <LuChevronRight size={18} color="var(--text-muted)" style={{ flexShrink: 0, marginTop: 4 }} />
    </div>
  )
}

export default function CampaignsView() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [list, setList] = useState(null)
  const [showEditor, setShowEditor] = useState(false)
  const [error, setError] = useState(null)

  const isGmOrAdmin = user?.role === 'admin' || user?.role === 'gm'

  const load = () => {
    campaigns
      .list()
      .then(setList)
      .catch((e) => setError(e.message))
  }

  useEffect(() => {
    load()
  }, [])

  const invitations = list?.filter((c) => c.invitation_status === 'invited') ?? []
  const accepted = list?.filter((c) => c.invitation_status !== 'invited') ?? []
  const gmCampaigns = accepted.filter((c) => c.owner_id === user?.id && c.is_gm_campaign)
  const personalCampaigns = accepted.filter((c) => c.owner_id === user?.id && !c.is_gm_campaign)
  const joinedCampaigns = accepted.filter((c) => c.owner_id !== user?.id)

  const respondToInvite = async (campaign, status) => {
    await campaigns.updateMember(campaign.id, user.id, status)
    load()
  }

  return (
    <div className="fade-in" style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 28,
        }}
      >
        <h2
          style={{ fontSize: 22, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 10 }}
        >
          <LuScroll size={20} color="var(--gold)" /> {t('campaigns.title')}
        </h2>
        <button
          onClick={() => setShowEditor(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 16px',
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            color: 'var(--text-dim)',
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          <LuPlus size={16} /> {t('campaigns.newCampaign')}
        </button>
      </div>

      {error && (
        <div
          style={{
            color: 'var(--danger)',
            background: 'var(--bg-card)',
            border: '1px solid var(--danger)',
            borderRadius: 8,
            padding: '12px 16px',
            marginBottom: 20,
          }}
        >
          {error}
        </div>
      )}

      {list === null ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <Spinner size={28} />
        </div>
      ) : list.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
          <LuScroll size={40} style={{ marginBottom: 16, opacity: 0.3 }} />
          <div style={{ fontSize: 18, fontWeight: 500, marginBottom: 8 }}>
            {t('campaigns.noCampaigns')}
          </div>
          <div style={{ fontSize: 14 }}>{t('campaigns.noCampaignsHint')}</div>
        </div>
      ) : (
        <>
          {invitations.length > 0 && (
            <section style={{ marginBottom: 32 }}>
              <h3
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  marginBottom: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <LuMailOpen size={13} /> {t('campaigns.invitations')}
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {invitations.map((c) => (
                  <div
                    key={c.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 14,
                      padding: '14px 18px',
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border)',
                      borderRadius: 12,
                    }}
                  >
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 9,
                        flexShrink: 0,
                        background: 'var(--bg-deep)',
                        border: '1px solid var(--border)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <LuScroll size={18} color="var(--gold)" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 16,
                          fontWeight: 600,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {c.name}
                      </div>
                      {c.description && (
                        <div
                          style={{
                            fontSize: 13,
                            color: 'var(--text-dim)',
                            marginTop: 2,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {c.description}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                      <button
                        onClick={() => respondToInvite(c, 'accepted')}
                        style={{
                          padding: '7px 16px',
                          borderRadius: 7,
                          background: 'var(--gold-dim)',
                          border: 'none',
                          color: 'var(--bg-deep)',
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        {t('campaigns.accept')}
                      </button>
                      <button
                        onClick={() => respondToInvite(c, 'declined')}
                        style={{
                          padding: '7px 16px',
                          borderRadius: 7,
                          background: 'var(--bg-deep)',
                          border: '1px solid var(--border)',
                          color: 'var(--text-muted)',
                          fontSize: 13,
                          cursor: 'pointer',
                        }}
                      >
                        {t('campaigns.decline')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
          {gmCampaigns.length > 0 && (
            <section style={{ marginBottom: 32 }}>
              <h3
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  marginBottom: 12,
                }}
              >
                {t('campaigns.gmCampaigns')}
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {gmCampaigns.map((c) => (
                  <CampaignCard
                    key={c.id}
                    campaign={c}
                    userId={user?.id}
                    onClick={() => navigate(`/campaigns/${c.id}`)}
                    subtitle={c.gm_title}
                  />
                ))}
              </div>
            </section>
          )}

          {joinedCampaigns.length > 0 && (
            <section style={{ marginBottom: 32 }}>
              <h3
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  marginBottom: 12,
                }}
              >
                {t('campaigns.joinedCampaigns')}
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {joinedCampaigns.map((c) => (
                  <CampaignCard
                    key={c.id}
                    campaign={c}
                    userId={user?.id}
                    onClick={() => navigate(`/campaigns/${c.id}`)}
                    subtitle={t('campaigns.gm', {
                      name: c.owner_display_name || t('campaigns.unknownGm'),
                    })}
                  />
                ))}
              </div>
            </section>
          )}

          {personalCampaigns.length > 0 && (
            <section style={{ marginBottom: 32 }}>
              <h3
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  marginBottom: 12,
                }}
              >
                {t('campaigns.personalCampaigns')}
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {personalCampaigns.map((c) => (
                  <CampaignCard
                    key={c.id}
                    campaign={c}
                    userId={user?.id}
                    onClick={() => navigate(`/campaigns/${c.id}`)}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {showEditor && (
        <CampaignEditor
          isGmOrAdmin={isGmOrAdmin}
          onClose={() => setShowEditor(false)}
          onSaved={(c) => {
            setShowEditor(false)
            navigate(`/campaigns/${c.id}`)
          }}
        />
      )}
    </div>
  )
}
