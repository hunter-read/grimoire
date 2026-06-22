import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LuScroll, LuPlus, LuMailOpen } from 'react-icons/lu'
import { campaigns } from '../api'
import { useAuth } from '../context/AuthContext'
import Spinner from '../components/Spinner'
import CampaignEditor from '../components/campaigns/CampaignEditor'
import CampaignCard from '../components/campaigns/CampaignCard'

const CARD_GRID = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
  gap: 14,
  alignItems: 'start',
}

export default function CampaignsView() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [list, setList] = useState(null)
  const [showEditor, setShowEditor] = useState(false)
  const [error, setError] = useState(null)

  const isGmOrAdmin = user?.role === 'admin' || user?.role === 'gm'
  // campaign_access defaults to enabled when the field is absent (older tokens).
  const canCreate = user?.campaign_access !== false

  const load = () => {
    campaigns
      .list()
      .then(setList)
      .catch((e) => setError(e.message))
  }

  useEffect(() => {
    load()
  }, [])

  // Most recently accessed (by any user) first; campaigns never opened fall last.
  const byRecentAccess = (a, b) =>
    (b.last_accessed_at || '').localeCompare(a.last_accessed_at || '')

  const invitations = list?.filter((c) => c.invitation_status === 'invited') ?? []
  const accepted = (list?.filter((c) => c.invitation_status !== 'invited') ?? []).sort(
    byRecentAccess
  )
  const gmCampaigns = accepted.filter((c) => c.owner_id === user?.id && c.is_gm_campaign)
  const personalCampaigns = accepted.filter((c) => c.owner_id === user?.id && !c.is_gm_campaign)
  const joinedCampaigns = accepted.filter((c) => c.owner_id !== user?.id)

  const respondToInvite = async (campaign, status) => {
    await campaigns.updateMember(campaign.id, user.id, status)
    load()
  }

  return (
    <div className="fade-in" style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
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
        {canCreate ? (
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
        ) : (
          <span
            title={t('campaigns.accessDisabledHint')}
            style={{ fontSize: 13, color: 'var(--text-dim)', fontStyle: 'italic' }}
          >
            {t('campaigns.accessDisabled')}
          </span>
        )}
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
              <div style={CARD_GRID}>
                {gmCampaigns.map((c) => (
                  <CampaignCard
                    key={c.id}
                    campaign={c}
                    userId={user?.id}
                    onClick={() => navigate(`/campaigns/${c.id}`)}
                    onOpenNotes={() => navigate(`/campaigns/${c.id}/notes`)}
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
              <div style={CARD_GRID}>
                {joinedCampaigns.map((c) => (
                  <CampaignCard
                    key={c.id}
                    campaign={c}
                    userId={user?.id}
                    onClick={() => navigate(`/campaigns/${c.id}`)}
                    onOpenNotes={() => navigate(`/campaigns/${c.id}/notes`)}
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
              <div style={CARD_GRID}>
                {personalCampaigns.map((c) => (
                  <CampaignCard
                    key={c.id}
                    campaign={c}
                    userId={user?.id}
                    onClick={() => navigate(`/campaigns/${c.id}`)}
                    onOpenNotes={() => navigate(`/campaigns/${c.id}/notes`)}
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
