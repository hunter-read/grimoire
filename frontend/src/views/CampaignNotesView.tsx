import { useState, useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LuChevronLeft } from 'react-icons/lu'
import { campaigns, type Schema } from '../api'
import { useAuth } from '../context/AuthContext'
import usePageTitle from '../hooks/usePageTitle'
import Spinner from '../components/Spinner'
import WikiView from '../components/campaigns/WikiView'

// Full-page campaign notes/worldbuilding wiki — no banner, maximum space for notes.
export default function CampaignNotesView() {
  const { t } = useTranslation()
  const { campaignId } = useParams()
  const { user } = useAuth()!
  const [campaign, setCampaign] = useState<Schema<'CampaignOut'> | null>(null)
  const [error, setError] = useState<string | null>(null)
  // On mobile the notes wiki takes over the screen when a note is open, so hide
  // this page's own header (campaign title / back-to-overview) to give it room.
  const [viewingNote, setViewingNote] = useState(false)

  usePageTitle(campaign ? t('a11y.campaignNotes.pageTitle', { name: campaign.name }) : null)

  useEffect(() => {
    campaigns
      .get(campaignId!)
      .then(setCampaign)
      .catch((e: Error) => setError(e.message))
  }, [campaignId])

  if (error) {
    return (
      <div role="alert" style={{ padding: 40, textAlign: 'center', color: 'var(--danger)' }}>
        {error}
      </div>
    )
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
  // Only the /auth/me shape carries campaign_access; absent reads as enabled.
  const canManage =
    isOwner &&
    !campaign.locked &&
    (user as { campaign_access?: boolean } | null)?.campaign_access !== false

  return (
    <div className="fade-in" style={{ padding: 24 }}>
      {/* On a phone an open note hides this header to make room, but the page
          still needs its h1. */}
      {viewingNote && <h1 className="sr-only">{campaign.name}</h1>}
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
          {/* A link, since it goes somewhere. */}
          <Link
            to={`/campaigns/${campaignId}/overview`}
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
              textDecoration: 'none',
            }}
          >
            <LuChevronLeft size={14} /> {t('campaignNotes.backToOverview')}
          </Link>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{campaign.name}</h1>
        </div>
      )}

      <WikiView campaign={campaign} isOwner={canManage} onViewingNoteChange={setViewingNote} />
    </div>
  )
}
