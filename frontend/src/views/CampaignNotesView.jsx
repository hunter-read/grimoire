import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LuChevronLeft } from 'react-icons/lu'
import { campaigns } from '../api'
import { useAuth } from '../context/AuthContext'
import Spinner from '../components/Spinner'
import WikiView from '../components/campaigns/WikiView'

// Full-page campaign notes/worldbuilding wiki — no banner, maximum space for notes.
export default function CampaignNotesView() {
  const { t } = useTranslation()
  const { campaignId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [campaign, setCampaign] = useState(null)
  const [error, setError] = useState(null)
  // On mobile the notes wiki takes over the screen when a note is open, so hide
  // this page's own header (campaign title / back-to-overview) to give it room.
  const [viewingNote, setViewingNote] = useState(false)

  useEffect(() => {
    campaigns
      .get(campaignId)
      .then(setCampaign)
      .catch((e) => setError(e.message))
  }, [campaignId])

  if (error) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--danger)' }}>{error}</div>
  }
  if (!campaign) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
        <Spinner size={28} />
      </div>
    )
  }

  const isOwner = campaign.owner_id === user?.id || user?.role === 'admin'
  // Read-only when the owner's access is locked or the viewer's own access is off.
  const canManage = isOwner && !campaign.locked && user?.campaign_access !== false

  return (
    <div className="fade-in" style={{ padding: 24 }}>
      {!viewingNote && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            marginBottom: 20,
            flexWrap: 'wrap',
          }}
        >
          <button
            onClick={() => navigate(`/campaigns/${campaignId}/overview`)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              color: 'var(--text-dim)',
              cursor: 'pointer',
              fontSize: 13,
              padding: '7px 12px',
            }}
          >
            <LuChevronLeft size={14} /> {t('campaignNotes.backToOverview')}
          </button>
          <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{campaign.name}</h2>
        </div>
      )}

      <WikiView campaign={campaign} isOwner={canManage} onViewingNoteChange={setViewingNote} />
    </div>
  )
}
