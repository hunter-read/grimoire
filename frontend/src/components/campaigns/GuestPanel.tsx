import { useState, useEffect, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { LuUserPlus, LuRefreshCw, LuTrash2, LuShare2 } from 'react-icons/lu'
import { campaigns, type Schema } from '../../api'
import Spinner from '../Spinner'
import GuestIconBtn from './GuestIconBtn'
import GuestShareDialog from './GuestShareDialog'

/** GM-only management of a campaign's code-based guests. */
type Guest = Awaited<ReturnType<typeof campaigns.listGuests>>[number]

export interface GuestPanelProps {
  campaignId: string
  onChanged?: () => void
}

export default function GuestPanel({ campaignId, onChanged }: GuestPanelProps) {
  const { t } = useTranslation()
  const [guests, setGuests] = useState<Guest[] | null>(null)
  const [nickname, setNickname] = useState('')
  const [busy, setBusy] = useState(false)
  const [share, setShare] = useState<Schema<'GuestShareTemplateOut'> | null>(null) // { ...template } for the share modal

  const reload = () =>
    campaigns
      .listGuests(campaignId)
      .then(setGuests)
      .catch(() => setGuests([]))

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId])

  const create = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await campaigns.createGuest(campaignId, nickname.trim())
      setNickname('')
      await reload()
      onChanged?.()
    } catch (err) {
      alert((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const regenerate = async (memberId: string) => {
    setBusy(true)
    try {
      await campaigns.regenerateGuestCode(campaignId, memberId)
      await reload()
    } catch (err) {
      alert((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (memberId: string) => {
    if (!window.confirm(t('guests.confirmRemove'))) return
    setBusy(true)
    try {
      await campaigns.removeGuest(campaignId, memberId)
      await reload()
      onChanged?.()
    } catch (err) {
      alert((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const openShare = async (memberId: string) => {
    try {
      const tpl = await campaigns.guestShareTemplate(campaignId, memberId)
      setShare(tpl)
    } catch (err) {
      alert((err as Error).message)
    }
  }

  if (!guests) return <Spinner size={16} />

  return (
    // Rendered inside an anchored popover, which supplies the padding and framing.
    <div>
      <form onSubmit={create} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          type="text"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          aria-label={t('guests.nicknamePlaceholder')}
          placeholder={t('guests.nicknamePlaceholder')}
          maxLength={100}
          style={{ flex: 1 }}
        />
        <button
          type="submit"
          disabled={busy}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '6px 12px',
            background: 'var(--bg-deep)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            color: 'var(--text-dim)',
            cursor: busy ? 'default' : 'pointer',
            fontSize: 12,
          }}
        >
          <LuUserPlus size={12} /> {t('guests.add')}
        </button>
      </form>

      {guests.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', paddingBottom: 4 }}>
          {t('guests.none')}
        </div>
      ) : (
        // Capped like the invite list (~10 rows) so a long guest roster scrolls
        // inside the popover.
        <ul
          role="list"
          className="card-list"
          style={{ maxHeight: 'min(330px, 60vh)', overflowY: 'auto' }}
        >
          {guests.map((g) => (
            <li
              key={g.id}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}
            >
              <span style={{ flex: 1, fontSize: 14, minWidth: 0 }}>
                {g.nickname || t('guests.guest')}
                <code
                  style={{
                    marginLeft: 8,
                    fontSize: 12,
                    color: 'var(--gold)',
                    letterSpacing: '0.1em',
                  }}
                >
                  {g.guest_code}
                </code>
              </span>
              <GuestIconBtn
                title={t('guests.share')}
                label={t('a11y.campaign.shareGuest', { name: g.nickname || t('guests.guest') })}
                onClick={() => openShare(g.id)}
              >
                <LuShare2 size={13} />
              </GuestIconBtn>
              <GuestIconBtn
                title={t('guests.regenerate')}
                label={t('a11y.campaign.regenerateGuest', {
                  name: g.nickname || t('guests.guest'),
                })}
                onClick={() => regenerate(g.id)}
                disabled={busy}
              >
                <LuRefreshCw size={13} />
              </GuestIconBtn>
              <GuestIconBtn
                title={t('guests.remove')}
                label={t('a11y.campaign.removeGuest', { name: g.nickname || t('guests.guest') })}
                onClick={() => remove(g.id)}
                disabled={busy}
              >
                <LuTrash2 size={13} />
              </GuestIconBtn>
            </li>
          ))}
        </ul>
      )}

      {share && <GuestShareDialog share={share} onClose={() => setShare(null)} />}
    </div>
  )
}
