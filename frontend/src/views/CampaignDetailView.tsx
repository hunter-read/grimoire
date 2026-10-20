import { useState, useEffect, useRef } from 'react'
import type { ComponentType, CSSProperties } from 'react'
import type { TFunction } from 'i18next'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  LuUsers,
  LuNotebook,
  LuChevronLeft,
  LuUserPlus,
  LuUserCheck,
  LuCalendar,
  LuLink,
  LuLock,
  LuLogOut,
} from 'react-icons/lu'
import api, { campaigns } from '../api'
import type { ResponseOf } from '../api'
import { useAuth } from '../context/AuthContext'
import { useUISettings } from '../context/UISettingsContext'
import Spinner from '../components/Spinner'
import CampaignEditor from '../components/campaigns/CampaignEditor'
import CampaignActionsMenu from '../components/campaigns/CampaignActionsMenu'
import WikiMarkdown from '../components/campaigns/WikiMarkdown'
import AvailabilityChart from '../components/campaigns/AvailabilityChart'
import CalendarMenuJs from '../components/campaigns/CalendarMenu'
import ResourcesPanel from '../components/campaigns/ResourcesPanel'
import CampaignCharacters from '../components/campaigns/CampaignCharacters'
import BannerHero from '../components/campaigns/BannerHero'
import MemberRow from '../components/campaigns/MemberRow'
import InvitePanel from '../components/campaigns/InvitePanel'
import GuestPanel from '../components/campaigns/GuestPanel'
import AnchoredPopover from '../components/campaigns/AnchoredPopover'
import { formatScheduleTime, USER_TZ } from '../components/campaigns/_scheduleShared'
import useIsMobile from '../hooks/useIsMobile'

// Still JavaScript, so TypeScript would read its optional `style` as required.
const CalendarMenu = CalendarMenuJs as ComponentType<{ campaign: Campaign }>

type Campaign = ResponseOf<'/campaigns/{campaign_id}', 'get'>
type Member = Campaign['members'][number]
type ScheduleState = ResponseOf<'/campaigns/{campaign_id}/schedule', 'get'>
type Availability = ResponseOf<'/campaigns/{campaign_id}/availability', 'get'>

// The schedule definition is stored as free-form JSON; these are the parts the
// one-line summary reads.
interface ScheduleDefinition {
  frequency?: string
  days?: number[]
  custom_dates?: string[]
  monthly_week?: number | string
  time_local?: string
}

const CARD: CSSProperties = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: '20px 22px',
}

// A fixed-height card whose body scrolls — used so Players and Schedule line up
// at the same height regardless of how many players there are (room for ~4–5,
// scroll past that up to the 8-player cap).
const SCROLL_CARD: CSSProperties = {
  ...CARD,
  height: 420,
  display: 'flex',
  flexDirection: 'column',
}

const GROUP_LABEL: CSSProperties = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--text-muted)',
  fontWeight: 600,
  margin: '4px 0 6px',
}

const SECTION_HEADING: CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
}

const ROSTER_BTN: CSSProperties = {
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
function scheduleSummary(def: ScheduleDefinition | null | undefined, t: TFunction) {
  if (!def) return null
  const FREQ: Record<string, string> = {
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
  const freq = FREQ[def.frequency ?? ''] ?? def.frequency
  let pattern = ''
  if (def.frequency === 'custom') {
    pattern = t('campaignDetail.overview.customDates', { count: def.custom_dates?.length ?? 0 })
  } else if (def.frequency === 'monthly') {
    const WEEKS: Record<string, string> = {
      1: t('schedule.weeks.1st'),
      2: t('schedule.weeks.2nd'),
      3: t('schedule.weeks.3rd'),
      4: t('schedule.weeks.4th'),
      '-1': t('schedule.weeks.last'),
    }
    pattern = t('schedule.monthlyPattern', {
      week: WEEKS[String(def.monthly_week)] ?? '',
      day: DAY_NAMES[def.days?.[0] ?? -1] ?? '',
    })
  } else {
    pattern = (def.days ?? []).map((d) => DAY_NAMES[d]).join(' & ')
  }
  const time = formatScheduleTime(def.time_local)
  const parts = [pattern ? `${freq} — ${pattern}` : freq]
  if (time) parts.push(`${time} (${USER_TZ})`)
  return parts.join(' · ')
}

export default function CampaignDetailView() {
  const { t } = useTranslation()
  const { campaignId = '' } = useParams()
  const navigate = useNavigate()
  const user = useAuth()?.user
  // Only /auth/me carries it; the shorter login block leaves it out.
  const campaignAccess = user && 'campaign_access' in user ? user.campaign_access : undefined
  const isMobile = useIsMobile()
  const { guest_access_enabled } = useUISettings()
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [systems, setSystems] = useState<{ id: string; name: string }[]>([])
  const [schedule, setSchedule] = useState<ScheduleState | null>(null)
  const [showEditor, setShowEditor] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  const [showGuests, setShowGuests] = useState(false)
  // Anchors for the invite/guest popovers.
  const inviteBtnRef = useRef<HTMLButtonElement>(null)
  const guestBtnRef = useRef<HTMLButtonElement>(null)
  const [error, setError] = useState<string | null>(null)

  const load = () => {
    campaigns
      .get(campaignId)
      .then(setCampaign)
      .catch((e: Error) => setError(e.message))
  }

  const [availability, setAvailability] = useState<Availability | null>(null)

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
    // Reload when the campaign changes. The loaders are rebuilt every render,
    // so depending on them would refetch in a loop.
  }, [campaignId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSetAvailability = async (date: string, status: string) => {
    await campaigns.setAvailability(campaignId, date, { status })
    loadAvailability()
  }
  const handleCancelDate = async (date: string) => {
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
  const selfDisabled = campaignAccess === false
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
  const isAcceptedMember = campaign.members?.some(
    (m: Member) => m.user_id === user?.id && m.status === 'accepted' && !m.is_owner
  )
  const canLeave = !isOwner && isAcceptedMember

  // Bringing a character to the table is for the people at it - the owner and
  // accepted players, not an admin looking in - and not while it is read-only.
  const canAddCharacter =
    (campaign.owner_id === user?.id || isAcceptedMember) &&
    !campaign.locked &&
    !isArchived &&
    !selfDisabled

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

  const handleUpdateMember = async (userId: string, status: string) => {
    await campaigns.updateMember(campaignId, userId, status)
    load()
  }

  const handleRemoveMember = async (userId: string) => {
    if (!confirm(t('common.delete') + '?')) return
    await campaigns.removeMember(campaignId, userId)
    load()
  }

  const handleSetCharacterName = async (userId: string, character_name: string) => {
    await campaigns.setCharacterName(campaignId, userId, character_name)
    load()
  }

  const leaveCampaign = async () => {
    if (!confirm(t('campaignDetail.leaveConfirm', { name: campaign.name }))) return
    await campaigns.removeMember(campaignId, user?.id ?? '')
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
                    {scheduleSummary(schedule.definition as ScheduleDefinition, t)}
                  </span>
                </span>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
            {/* A real link, so middle click opens the notes in a new tab (#313). */}
            <Link
              to={`/campaigns/${campaignId}/notes`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 14px',
                background: 'var(--gold)',
                borderRadius: 8,
                color: 'var(--on-accent)',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              <LuNotebook size={15} /> {t('campaignDetail.openNotes')}
            </Link>
            {/* Edit / Convert / Archive share one kebab menu so the header keeps
                a single primary action (Open notes). Convert is personal ->
                group promotion: one-way, so it drops out once the campaign is a
                group one. Delete stays inside the edit modal — the extra click
                is the safety. */}
            <CampaignActionsMenu
              onEdit={canManage ? () => setShowEditor(true) : undefined}
              onConvert={canManage && !isGmCampaign ? convertToGroup : undefined}
              onArchive={canArchive ? toggleArchived : undefined}
              isArchived={isArchived}
            />
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
            const gmMember = campaign.members?.find((m: Member) => m.is_owner)
            const playerMembers =
              campaign.members?.filter((m: Member) => !m.is_owner && !m.is_guest) ?? []
            const guestMembers = campaign.members?.filter((m: Member) => m.is_guest) ?? []
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
                        ref={inviteBtnRef}
                        onClick={() => {
                          setShowInvite(!showInvite)
                          setShowGuests(false)
                        }}
                        aria-haspopup="dialog"
                        aria-expanded={showInvite}
                        style={ROSTER_BTN}
                      >
                        <LuUserPlus size={12} /> {t('campaignDetail.overview.invite')}
                      </button>
                      {guest_access_enabled && (
                        <button
                          ref={guestBtnRef}
                          onClick={() => {
                            setShowGuests(!showGuests)
                            setShowInvite(false)
                          }}
                          aria-haspopup="dialog"
                          aria-expanded={showGuests}
                          style={ROSTER_BTN}
                        >
                          <LuUserCheck size={12} /> {t('guests.guests')}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Both panels float over the roster rather than pushing it down, so
                    the player list stays put while you invite. */}
                {showInvite && (
                  <AnchoredPopover anchorRef={inviteBtnRef} onClose={() => setShowInvite(false)}>
                    <InvitePanel
                      campaignId={campaign.id}
                      onInvited={() => {
                        setShowInvite(false)
                        load()
                      }}
                    />
                  </AnchoredPopover>
                )}

                {showGuests && canManage && guest_access_enabled && (
                  <AnchoredPopover
                    anchorRef={guestBtnRef}
                    width={380}
                    onClose={() => setShowGuests(false)}
                  >
                    <GuestPanel campaignId={campaign.id} onChanged={load} />
                  </AnchoredPopover>
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
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                marginBottom: 14,
                flexShrink: 0,
              }}
            >
              <h3 style={SECTION_HEADING}>
                <LuCalendar size={15} /> {t('campaignDetail.overview.availability')}
              </h3>
              {/* Export/subscribe sits with the schedule it exports. */}
              <CalendarMenu campaign={campaign} />
            </div>
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

      {/* Characters — every sheet played in the campaign, under its player. */}
      <CampaignCharacters
        campaignId={campaign.id}
        ownerId={campaign.owner_id}
        viewerId={user?.id}
        canAdd={canAddCharacter}
        style={{ ...CARD, marginBottom: 20 }}
      />

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
          onSaved={(updated: Partial<Campaign>) => {
            setCampaign((prev) => (prev ? { ...prev, ...updated } : prev))
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
