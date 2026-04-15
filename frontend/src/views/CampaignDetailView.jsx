import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  LuScroll, LuUsers, LuCalendar, LuNotebook, LuChevronLeft,
  LuSettings, LuTrash2, LuUserPlus, LuBookOpen, LuLink,
} from 'react-icons/lu'
import api, { campaigns } from '../api'
import { useAuth } from '../context/AuthContext'
import Spinner from '../components/Spinner'
import CampaignEditor from '../components/campaigns/CampaignEditor'
import SessionList from '../components/campaigns/SessionList'
import SessionNoteView from '../components/campaigns/SessionNoteView'
import ScheduleTab from '../components/campaigns/ScheduleTab'
import ResourcesPanel from '../components/campaigns/ResourcesPanel'
import { MemberRow, InvitePanel } from '../components/campaigns/CampaignMembers'

const TAB_STYLE = (active) => ({
  padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: active ? 600 : 400,
  background: active ? 'var(--bg-card)' : 'transparent',
  border: active ? '1px solid var(--border)' : '1px solid transparent',
  color: active ? 'var(--gold)' : 'var(--text-dim)',
  display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', flexShrink: 0,
})

export default function CampaignDetailView() {
  const { t } = useTranslation()
  const { campaignId, tab = 'overview', sessionId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [campaign, setCampaign] = useState(null)
  const [systems, setSystems] = useState([])
  const [showEditor, setShowEditor] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  const [error, setError] = useState(null)

  const load = () => {
    campaigns.get(campaignId)
      .then(setCampaign)
      .catch(e => setError(e.message))
  }

  useEffect(() => {
    load()
    api.get('/systems').then(setSystems).catch(() => {})
  }, [campaignId])

  if (error) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--danger)' }}>
        {error}
        <div style={{ marginTop: 12 }}>
          <button onClick={() => navigate('/campaigns')} style={{ background: 'none', border: 'none', color: 'var(--gold)', cursor: 'pointer', fontSize: 14 }}>
            ← {t('campaignDetail.backToCampaigns')}
          </button>
        </div>
      </div>
    )
  }

  if (!campaign) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spinner size={28} /></div>
  }

  const isOwner = campaign.owner_id === user?.id || user?.role === 'admin'
  const isGmCampaign = campaign.is_gm_campaign

  const deleteCampaign = async () => {
    if (!confirm(t('campaignDetail.deleteConfirm', { name: campaign.name }))) return
    await campaigns.delete(campaign.id)
    navigate('/campaigns')
  }

  const handleUpdateMember = async (userId, status) => {
    await campaigns.updateMember(campaignId, userId, status)
    load()
  }

  const handleRemoveMember = async (userId) => {
    if (!confirm(t('common.delete') + '?')) return
    await campaigns.removeMember(campaignId, userId)
    load()
  }

  const handleSetCharacterName = async (userId, character_name) => {
    await campaigns.setCharacterName(campaignId, userId, character_name)
    load()
  }

  if (sessionId) {
    return (
      <SessionNoteView
        campaign={campaign}
        sessionId={sessionId}
        isOwner={isOwner}
        userId={user?.id}
        onBack={() => navigate(-1)}
      />
    )
  }

  return (
    <div className="fade-in" style={{ padding: 24, maxWidth: 1000, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <button
          onClick={() => navigate('/campaigns')}
          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4, padding: 0, marginBottom: 12 }}
        >
          <LuChevronLeft size={14} /> {t('campaignDetail.backToCampaigns')}
        </button>

        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>{campaign.name}</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {!isGmCampaign && (
                <span style={{ fontSize: 12, color: 'var(--text-muted)', background: 'var(--bg-deep)', padding: '2px 8px', borderRadius: 20, border: '1px solid var(--border)' }}>
                  {t('campaignDetail.personalCampaign')}
                </span>
              )}
              {campaign.parent_campaign_id && (
                <span style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <LuLink size={12} aria-hidden="true" /> {t('campaignDetail.linkedToGmCampaign')}
                </span>
              )}
            </div>
            {campaign.description && (
              <p style={{ fontSize: 14, color: 'var(--text-dim)', marginTop: 8, lineHeight: 1.6, maxWidth: 600 }}>
                {campaign.description}
              </p>
            )}
          </div>

          {isOwner && (
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button
                onClick={() => setShowEditor(true)}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-dim)', cursor: 'pointer', fontSize: 13 }}
              >
                <LuSettings size={14} /> {t('campaignDetail.edit')}
              </button>
              <button
                onClick={deleteCampaign}
                aria-label={t('campaignDetail.deleteAriaLabel')}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--danger)', cursor: 'pointer', fontSize: 13 }}
              >
                <LuTrash2 size={14} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <button style={TAB_STYLE(tab === 'overview')} onClick={() => navigate(`/campaigns/${campaignId}/overview`)}>
          <LuUsers size={14} /> {t('campaignDetail.tabs.overview')}
        </button>
        <button style={TAB_STYLE(tab === 'sessions')} onClick={() => navigate(`/campaigns/${campaignId}/sessions`)}>
          <LuNotebook size={14} /> {t('campaignDetail.tabs.sessionNotes')}
        </button>
        {isGmCampaign && (isOwner || campaign.has_schedule) && (
          <button style={TAB_STYLE(tab === 'schedule')} onClick={() => navigate(`/campaigns/${campaignId}/schedule`)}>
            <LuCalendar size={14} /> {t('campaignDetail.tabs.schedule')}
          </button>
        )}
        <button style={TAB_STYLE(tab === 'resources')} onClick={() => navigate(`/campaigns/${campaignId}/resources`)}>
          <LuBookOpen size={14} /> {t('campaignDetail.tabs.resources')}
        </button>
      </div>

      {/* Overview tab */}
      {tab === 'overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 22px' }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <LuScroll size={15} /> {t('campaignDetail.overview.details')}
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>{t('campaignDetail.overview.type')}</span>
                <span>{campaign.is_gm_campaign ? t('campaignDetail.overview.gmCampaignType') : t('campaignDetail.overview.personalCampaignType')}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>{t('campaignDetail.overview.created')}</span>
                <span>{new Date(campaign.created_at).toLocaleDateString()}</span>
              </div>
              {campaign.system_id && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>{t('campaignDetail.overview.system')}</span>
                  <Link
                    to={`/library/system/${campaign.system_id}`}
                    style={{ color: 'var(--gold)', textDecoration: 'none', fontSize: 14 }}
                    onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                    onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
                  >
                    {systems.find(s => s.id === campaign.system_id)?.name ?? '—'}
                  </Link>
                </div>
              )}
            </div>
          </div>

          {isGmCampaign && (
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 22px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <h3 style={{ fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <LuUsers size={15} /> {t('campaignDetail.overview.members')}
                </h3>
                {isOwner && (
                  <button
                    onClick={() => setShowInvite(!showInvite)}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', background: 'var(--bg-deep)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-dim)', cursor: 'pointer', fontSize: 12 }}
                  >
                    <LuUserPlus size={12} /> {t('campaignDetail.overview.invite')}
                  </button>
                )}
              </div>

              {showInvite && (
                <InvitePanel
                  campaignId={campaign.id}
                  onInvited={() => { setShowInvite(false); load() }}
                />
              )}

              <div>
                {campaign.members?.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', paddingTop: 8 }}>{t('campaignDetail.overview.noMembers')}</div>
                ) : (
                  campaign.members.map(m => (
                    <MemberRow
                      key={m.user_id}
                      member={m}
                      isOwner={isOwner}
                      canManage={isOwner}
                      currentUserId={user?.id}
                      onRemove={handleRemoveMember}
                      onUpdateStatus={handleUpdateMember}
                      onSetCharacterName={handleSetCharacterName}
                    />
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'sessions' && (
        <SessionList
          campaign={campaign}
          isOwner={isOwner}
          onSelectSession={(sid) => navigate(`/campaigns/${campaignId}/sessions/${sid}`)}
          userId={user?.id}
        />
      )}

      {tab === 'schedule' && isGmCampaign && (
        <ScheduleTab campaign={campaign} isOwner={isOwner} userId={user?.id} />
      )}

      {tab === 'resources' && (
        <ResourcesPanel campaign={campaign} isOwner={isOwner} onRefresh={load} />
      )}

      {showEditor && (
        <CampaignEditor
          campaign={campaign}
          isGmOrAdmin={user?.role === 'admin' || user?.role === 'gm'}
          onClose={() => setShowEditor(false)}
          onSaved={(updated) => {
            setCampaign(prev => ({ ...prev, ...updated }))
            setShowEditor(false)
          }}
        />
      )}
    </div>
  )
}
