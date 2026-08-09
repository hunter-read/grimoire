import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  LuUsers,
  LuNotebook,
  LuChevronLeft,
  LuSettings,
  LuUserPlus,
  LuUserCheck,
  LuCalendar,
  LuLink,
  LuImagePlus,
  LuLock,
  LuArchive,
  LuLogOut,
} from 'react-icons/lu'
import api, { campaigns } from '../api'
import { useAuth } from '../context/AuthContext'
import { useUISettings } from '../context/UISettingsContext'
import Spinner from '../components/Spinner'
import CampaignEditor from '../components/campaigns/CampaignEditor'
import WikiView from '../components/campaigns/WikiView'
import WikiMarkdown from '../components/campaigns/WikiMarkdown'
import AvailabilityChart from '../components/campaigns/AvailabilityChart'
import ResourcesPanel from '../components/campaigns/ResourcesPanel'
import BannerHero from '../components/campaigns/BannerHero'
import MemberRow from '../components/campaigns/MemberRow'
import InvitePanel from '../components/campaigns/InvitePanel'
import GuestPanel from '../components/campaigns/GuestPanel'
import { utcTimeToLocal, USER_TZ } from '../components/campaigns/_scheduleShared'
import useIsMobile from '../hooks/useIsMobile'
import useLinkProps from '../hooks/useLinkProps'

const CARD = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: '20px 22px',
}

// A fixed-height card whose body scrolls — used so Players and Schedule line up
// at the same height regardless of how many players there are (room for ~4–5,
// scroll past that up to the 8-player cap).
const SCROLL_CARD = {
  ...CARD,
  height: 420,
  display: 'flex',
  flexDirection: 'column',
}

const GROUP_LABEL = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--text-muted)',
  fontWeight: 600,
  margin: '4px 0 6px',
}

const SECTION_HEADING = {
  fontSize: 15,
  fontWeight: 600,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
}

const ROSTER_BTN = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  padding: '5px 10px',
  background: 'var(--bg-deep)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text-dim)',
  cursor: 'pointer',
  fontSize: 12,
}

// Compact one-line schedule summary (e.g. "Weekly — Fri · 7:00 PM") for the meta row.
function scheduleSummary(def, t) {
  if (!def) return null
  const FREQ = {
    weekly: t('schedule.frequency.weekly'),
    biweekly: t('schedule.frequency.biweekly'),
    monthly: t('schedule.frequency.monthly'),
    custom: t('schedule.frequency.custom'),
  }
  const DAY_NAMES = [
    t('schedule.days.monday'),
    t('schedule.days.tuesday'),
    t('schedule.days.wednesday'),
    t('schedule.days.thursday'),
    t('schedule.days.friday'),
    t('schedule.days.saturday'),
    t('schedule.days.sunday'),
  ]
  const freq = FREQ[def.frequency] ?? def.frequency
  let pattern = ''
  if (def.frequency === 'custom') {
    pattern = t('campaignDetail.overview.customDates', { count: def.custom_dates?.length ?? 0 })
  } else if (def.frequency === 'monthly') {
    const WEEKS = {
      1: t('schedule.weeks.1st'),
      2: t('schedule.weeks.2nd'),
      3: t('schedule.weeks.3rd'),
      4: t('schedule.weeks.4th'),
      '-1': t('schedule.weeks.last'),
    }
    pattern = t('schedule.monthlyPattern', {
      week: WEEKS[String(def.monthly_week)] ?? '',
      day: DAY_NAMES[def.days?.[0]] ?? '',
    })
  } else {
    pattern = (def.days ?? []).map((d) => DAY_NAMES[d]).join(' & ')
  }
  const time = utcTimeToLocal(def.time_utc)
  const parts = [pattern ? `${freq} — ${pattern}` : freq]
  if (time) parts.push(`${time} (${USER_TZ})`)
  return parts.join(' · ')
}

export default function CampaignDetailView() {
  const { t } = useTranslation()
  const { campaignId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const isMobile = useIsMobile()
  const { guest_access_enabled } = useUISettings()
  const [campaign, setCampaign] = useState(null)
  const [systems, setSystems] = useState([])
  const [schedule, setSchedule] = useState(null)
  const [showEditor, setShowEditor] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  const [showGuests, setShowGuests] = useState(false)
  const [error, setError] = useState(null)
  // Open Notes behaves like a link, so middle click opens it in a new tab (#313).
  const notesLinkProps = useLinkProps(`/campaigns/${campaignId}/notes`, () =>
    navigate(`/campaigns/${campaignId}/notes`)
  )

  const load = () => {
    campaigns
      .get(campaignId)
      .then(setCampaign)
      .catch((e) => setError(e.message))
  }

  const [availability, setAvailability] = useState(null)

  const loadSchedule = () => {
    campaigns
      .getSchedule(campaignId)
      .then(setSchedule)
      .catch(() => setSchedule(null))
  }

  const loadAvailability = () => {
    campaigns
      .getAvailability(campaignId)
      .then(setAvailability)
      .catch(() => setAvailability(null))
  }

  useEffect(() => {
    load()
    loadSchedule()
    loadAvailability()
    // include_children so a campaign set to a container child ("Dungeons &
    // Dragons 5e") resolves to a name here instead of falling back to "—".
    api
      .get('/systems?include_children=true')
      .then(setSystems)
      .catch(() => {})
  }, [campaignId])

  const handleSetAvailability = async (date, status) => {
    await campaigns.setAvailability(campaignId, date, { status })
    loadAvailability()
  }
  const handleCancelDate = async (date) => {
    await campaigns.cancelDate(campaignId, date)
    loadAvailability()
  }

  if (error) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--danger)' }}>
        {error}
        <div style={{ marginTop: 12 }}>
          <button
            onClick={() => navigate('/campaigns')}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--gold)',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            ← {t('campaignDetail.backToCampaigns')}
          </button>
        </div>
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
  const isGmCampaign = campaign.is_gm_campaign

  // The campaign is locked (read-only for everyone) when it's archived or when
  // the owner's campaign access is disabled. The current user also loses
  // management when their own access is disabled. Backend enforces this; the UI
  // only reflects it. Archiving is checked first so the notice names the cause
  // the owner can actually act on.
  const selfDisabled = user?.campaign_access === false
  const isArchived = !!campaign.is_archived
  const canManage = isOwner && !campaign.locked && !selfDisabled
  const readOnlyNotice = isArchived
    ? t('campaigns.readOnlyArchived')
    : campaign.locked
      ? t('campaigns.readOnlyLocked')
      : selfDisabled && isOwner
        ? t('campaigns.readOnlySelf')
        : null

  // Archiving stays available to the owner while archived — it's the only way
  // back out — so it deliberately does not use `canManage` (which is false for
  // an archived campaign).
  const canArchive = isOwner && !selfDisabled && campaign.owner_has_campaign_access !== false

  // Leaving is always the member's own call — archiving must not trap anyone in
  // a campaign — so this ignores `locked` too. Owners leave by deleting instead.
  const canLeave =
    !isOwner && campaign.members?.some((m) => m.user_id === user?.id && m.status === 'accepted')

  const deleteCampaign = async () => {
    if (!confirm(t('campaignDetail.deleteConfirm', { name: campaign.name }))) return
    await campaigns.delete(campaign.id)
    navigate('/campaigns')
  }

  const toggleArchived = async () => {
    if (!isArchived && !confirm(t('campaignDetail.archiveConfirm', { name: campaign.name }))) return
    await campaigns.setArchived(campaign.id, !isArchived)
    load()
  }

  const convertToGroup = async () => {
    if (!confirm(t('campaignDetail.convertConfirm', { name: campaign.name }))) return
    await campaigns.convertToGroup(campaign.id)
    load()
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

  const leaveCampaign = async () => {
    if (!confirm(t('campaignDetail.leaveConfirm', { name: campaign.name }))) return
    await campaigns.removeMember(campaignId, user.id)
    navigate('/campaigns')
  }

  return (
    <div className="fade-in" style={{ padding: 24 }}>
      {/* Back link */}
      <button
        onClick={() => navigate('/campaigns')}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--text-muted)',
          cursor: 'pointer',
          fontSize: 13,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: 0,
          marginBottom: 12,
        }}
      >
        <LuChevronLeft size={14} /> {t('campaignDetail.backToCampaigns')}
      </button>

      {readOnlyNotice && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            marginBottom: 16,
            background: 'var(--bg-deep)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            color: 'var(--text-dim)',
            fontSize: 13,
          }}
        >
          <LuLock size={15} aria-hidden="true" /> {readOnlyNotice}
        </div>
      )}

      {/* Banner + header — banner on the left, title/details/actions fill the space
          to its right; wraps to stacked on narrow screens. */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 20,
          alignItems: 'flex-start',
          marginBottom: 24,
        }}
      >
        <div style={{ flex: '1 1 360px', minWidth: isMobile ? 0 : 280, maxWidth: 800 }}>
          <BannerHero campaign={campaign} isOwner={canManage} onChanged={load} />
        </div>

        <div
          style={{
            flex: '1 1 320px',
            minWidth: isMobile ? 0 : 280,
            display: 'flex',
            // On phones stack the title/description above the actions so the
            // description gets the full page width instead of a cramped column.
            flexDirection: isMobile ? 'column' : 'row',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          <div style={{ minWidth: 0, width: isMobile ? '100%' : undefined }}>
            <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>{campaign.name}</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {!isGmCampaign && (
                <span
                  style={{
                    fontSize: 12,
                    color: 'var(--text-muted)',
                    background: 'var(--bg-deep)',
                    padding: '2px 8px',
                    borderRadius: 20,
                    border: '1px solid var(--border)',
                  }}
                >
                  {t('campaignDetail.personalCampaign')}
                </span>
              )}
              {campaign.parent_campaign_id && (
                <span
                  style={{
                    fontSize: 12,
                    color: 'var(--text-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <LuLink size={12} aria-hidden="true" /> {t('campaignDetail.linkedToGmCampaign')}
                </span>
              )}
            </div>
            {campaign.description && (
              <div
                style={{
                  fontSize: 16,
                  color: 'var(--text-dim)',
                  marginTop: 10,
                  maxWidth: 700,
                }}
              >
                <WikiMarkdown body={campaign.description} />
              </div>
            )}

            {/* Details — sits beside the banner under the title. */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '8px 24px',
                marginTop: 16,
                fontSize: 15,
                color: 'var(--text-muted)',
              }}
            >
              <span>
                {t('campaignDetail.overview.type')}:{' '}
                <span style={{ color: 'var(--text-dim)' }}>
                  {campaign.is_gm_campaign
                    ? t('campaignDetail.overview.gmCampaignType')
                    : t('campaignDetail.overview.personalCampaignType')}
                </span>
              </span>
              {campaign.system_id ? (
                <span>
                  {t('campaignDetail.overview.system')}:{' '}
                  <Link
                    to={`/library/system/${campaign.system_id}`}
                    style={{ color: 'var(--gold)', textDecoration: 'none' }}
                    onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
                    onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
                  >
                    {systems.find((s) => s.id === campaign.system_id)?.name ?? '—'}
                  </Link>
                </span>
              ) : (
                campaign.system_name && (
                  <span>
                    {t('campaignDetail.overview.system')}:{' '}
                    <span style={{ color: 'var(--text-dim)' }}>{campaign.system_name}</span>
                  </span>
                )
              )}
              {isGmCampaign && schedule?.definition && (
                <span>
                  {t('campaignDetail.tabs.schedule')}:{' '}
                  <span style={{ color: 'var(--text-dim)' }}>
                    {scheduleSummary(schedule.definition, t)}
                  </span>
                </span>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
            <button
              {...notesLinkProps}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 14px',
                background: 'var(--gold)',
                border: 'none',
                borderRadius: 8,
                color: '#1a1209',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              <LuNotebook size={15} /> {t('campaignDetail.openNotes')}
            </button>
            {canManage && (
              <button
                onClick={() => setShowEditor(true)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '7px 12px',
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  color: 'var(--text-dim)',
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                <LuSettings size={14} /> {t('campaignDetail.edit')}
              </button>
            )}
            {/* Personal -> group promotion. One-way, so it disappears once the
                campaign is a group one. */}
            {canManage && !isGmCampaign && (
              <button
                onClick={convertToGroup}
                title={t('campaignDetail.convertHint')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '7px 12px',
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  color: 'var(--text-dim)',
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                <LuUsers size={14} /> {t('campaignDetail.convertToGroup')}
              </button>
            )}
            {canArchive && (
              <button
                onClick={toggleArchived}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '7px 12px',
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  color: 'var(--text-dim)',
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                <LuArchive size={14} />
                {isArchived ? t('campaignDetail.unarchive') : t('campaignDetail.archive')}
              </button>
            )}
            {canLeave && (
              <button
                onClick={leaveCampaign}
                title={t('campaignDetail.leaveHint')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '7px 12px',
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  color: 'var(--danger)',
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                <LuLogOut size={14} /> {t('campaignDetail.leave')}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Players + Schedule: two equal-height columns that scroll internally. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: 20,
          alignItems: 'start',
          marginBottom: 20,
        }}
      >
        {/* Players (GM listed separately above the player list) */}
        {isGmCampaign &&
          (() => {
            const gmMember = campaign.members?.find((m) => m.is_owner)
            const playerMembers = campaign.members?.filter((m) => !m.is_owner && !m.is_guest) ?? []
            const guestMembers = campaign.members?.filter((m) => m.is_guest) ?? []
            return (
              <div style={SCROLL_CARD}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 14,
                  }}
                >
                  <h3 style={SECTION_HEADING}>
                    <LuUsers size={15} /> {t('campaignDetail.overview.members')}
                  </h3>
                  {canManage && (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => {
                          setShowInvite(!showInvite)
                          setShowGuests(false)
                        }}
                        style={ROSTER_BTN}
                      >
                        <LuUserPlus size={12} /> {t('campaignDetail.overview.invite')}
                      </button>
                      {guest_access_enabled && (
                        <button
                          onClick={() => {
                            setShowGuests(!showGuests)
                            setShowInvite(false)
                          }}
                          style={ROSTER_BTN}
                        >
                          <LuUserCheck size={12} /> {t('guests.guests')}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {showInvite && (
                  <InvitePanel
                    campaignId={campaign.id}
                    onInvited={() => {
                      setShowInvite(false)
                      load()
                    }}
                  />
                )}

                {showGuests && canManage && guest_access_enabled && (
                  <GuestPanel campaignId={campaign.id} onChanged={load} />
                )}

                <div style={{ overflowY: 'auto', flex: 1, marginRight: -8, paddingRight: 8 }}>
                  {/* Game Master — kept distinct from the player roster. */}
                  {gmMember && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={GROUP_LABEL}>{t('campaignDetail.overview.gameMaster')}</div>
                      <MemberRow
                        member={gmMember}
                        isOwner={isOwner}
                        canManage={canManage}
                        currentUserId={user?.id}
                        campaignId={campaign.id}
                        onRemove={handleRemoveMember}
                        onUpdateStatus={handleUpdateMember}
                        onSetCharacterName={handleSetCharacterName}
                        onMediaChanged={load}
                      />
                    </div>
                  )}

                  <div style={GROUP_LABEL}>
                    {t('campaignDetail.overview.players')} ({playerMembers.length})
                  </div>
                  {playerMembers.length === 0 ? (
                    <div style={{ fontSize: 13, color: 'var(--text-muted)', paddingTop: 4 }}>
                      {t('campaignDetail.overview.noMembers')}
                    </div>
                  ) : (
                    playerMembers.map((m) => (
                      <MemberRow
                        key={m.user_id}
                        member={m}
                        isOwner={isOwner}
                        canManage={canManage}
                        currentUserId={user?.id}
                        campaignId={campaign.id}
                        onRemove={handleRemoveMember}
                        onUpdateStatus={handleUpdateMember}
                        onSetCharacterName={handleSetCharacterName}
                        onMediaChanged={load}
                      />
                    ))
                  )}

                  {guestMembers.length > 0 && (
                    <>
                      <div style={{ ...GROUP_LABEL, marginTop: 12 }}>
                        {t('guests.guests')} ({guestMembers.length})
                      </div>
                      {guestMembers.map((m) => (
                        <MemberRow
                          key={m.user_id}
                          member={m}
                          isOwner={isOwner}
                          canManage={canManage}
                          currentUserId={user?.id}
                          campaignId={campaign.id}
                          onRemove={handleRemoveMember}
                          onUpdateStatus={handleUpdateMember}
                          onSetCharacterName={handleSetCharacterName}
                          onMediaChanged={load}
                        />
                      ))}
                    </>
                  )}
                </div>
              </div>
            )
          })()}

        {/* Availability — players mark upcoming sessions. Schedule setup lives in
            the edit modal; here we only show the chart when a schedule exists. */}
        {isGmCampaign && schedule?.definition && schedule?.enabled && (
          <div style={SCROLL_CARD}>
            <h3 style={{ ...SECTION_HEADING, marginBottom: 14, flexShrink: 0 }}>
              <LuCalendar size={15} /> {t('campaignDetail.overview.availability')}
            </h3>
            {/* Single section: the chart fills the card, scrolls internally with a
                pinned date header, and keeps its legend at the bottom. */}
            <AvailabilityChart
              availability={availability}
              userId={user?.id}
              isOwner={canManage}
              onSetAvailability={handleSetAvailability}
              onCancelDate={handleCancelDate}
            />
          </div>
        )}
      </div>

      {/* Resources — full width below the two-column row. ResourcesPanel renders
          its own single title + action buttons. */}
      <div style={CARD}>
        <ResourcesPanel campaign={campaign} isOwner={canManage} onRefresh={load} />
      </div>

      {showEditor && (
        <CampaignEditor
          campaign={campaign}
          isGmOrAdmin={user?.role === 'admin' || user?.role === 'gm'}
          onClose={() => setShowEditor(false)}
          onSaved={(updated) => {
            setCampaign((prev) => ({ ...prev, ...updated }))
            setShowEditor(false)
          }}
          onDelete={deleteCampaign}
          onScheduleChanged={() => {
            loadSchedule()
            loadAvailability()
          }}
        />
      )}
    </div>
  )
}
