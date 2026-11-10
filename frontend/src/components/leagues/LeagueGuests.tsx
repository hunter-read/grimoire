import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { LuRefreshCw, LuShare2, LuTrash2, LuUserPlus } from 'react-icons/lu'
import { leagues as leaguesApi, type Schema } from '../../api'
import GuestIconBtn from '../campaigns/GuestIconBtn'
import GuestShareDialog from '../campaigns/GuestShareDialog'
import { card, errorText, input, muted, primaryBtn, sectionTitle } from '../armies/armyStyles'
import { errorMessage } from '../armies/armyText'

type Guest = Schema<'LeagueGuest'>

export interface LeagueGuestsProps {
  leagueId: string
  /** Called after a guest joins or leaves, so the members list can refresh. */
  onChanged: () => void
}

/**
 * The organiser's guests: people without an account, invited with a code.
 *
 * A guest reaches this league and their own armies. Removing one leaves them
 * their armies, so it is not the account deletion it is for a campaign's
 * guest. A guest an admin merged across other organisers' leagues has no code
 * shown here: an admin manages it.
 */
export default function LeagueGuests({ leagueId, onChanged }: LeagueGuestsProps) {
  const { t } = useTranslation()
  const [guests, setGuests] = useState<Guest[] | null>(null)
  const [nickname, setNickname] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [share, setShare] = useState<Schema<'GuestShareTemplate'> | null>(null)

  const reload = useCallback(
    () =>
      leaguesApi
        .listGuests(leagueId)
        .then(setGuests)
        .catch(() => setGuests([])),
    [leagueId]
  )

  useEffect(() => {
    void reload()
  }, [reload])

  const run = async (work: () => Promise<unknown>, changed = false) => {
    setBusy(true)
    setError('')
    try {
      await work()
      await reload()
      if (changed) onChanged()
    } catch (e) {
      setError(errorMessage(e, t('leagues.guests.failed')))
    } finally {
      setBusy(false)
    }
  }

  const create = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      await leaguesApi.createGuest(leagueId, nickname.trim())
      setNickname('')
    }, true)
  }

  const remove = (userId: string) => {
    if (!window.confirm(t('leagues.guests.confirmRemove'))) return
    void run(() => leaguesApi.removeGuest(leagueId, userId), true)
  }

  const openShare = async (userId: string) => {
    setError('')
    try {
      setShare(await leaguesApi.guestShareTemplate(leagueId, userId))
    } catch (e) {
      setError(errorMessage(e, t('leagues.guests.failed')))
    }
  }

  return (
    <section style={card} aria-labelledby="league-guests-title">
      <h2 id="league-guests-title" style={sectionTitle}>
        {t('leagues.guests.title')}
      </h2>
      <p style={{ ...muted, marginTop: 0 }}>{t('leagues.guests.hint')}</p>
      <form onSubmit={create} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          type="text"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          aria-label={t('guests.nicknamePlaceholder')}
          placeholder={t('guests.nicknamePlaceholder')}
          maxLength={100}
          style={{ ...input, flex: 1 }}
        />
        <button type="submit" style={primaryBtn} disabled={busy}>
          <LuUserPlus size={14} aria-hidden="true" /> {t('leagues.guests.invite')}
        </button>
      </form>
      {guests === null ? null : guests.length === 0 ? (
        <p style={muted}>{t('guests.none')}</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
          {guests.map((g) => {
            const name = g.nickname || t('guests.guest')
            return (
              <li key={g.user_id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  {name}
                  {g.guest_code ? (
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
                  ) : (
                    <span style={{ ...muted, marginLeft: 8 }}>
                      {t('leagues.guests.codeHidden')}
                    </span>
                  )}
                </span>
                {g.guest_code && (
                  <>
                    <GuestIconBtn
                      title={t('guests.share')}
                      label={t('a11y.campaign.shareGuest', { name })}
                      onClick={() => void openShare(g.user_id)}
                    >
                      <LuShare2 size={13} />
                    </GuestIconBtn>
                    <GuestIconBtn
                      title={t('guests.regenerate')}
                      label={t('a11y.campaign.regenerateGuest', { name })}
                      onClick={() =>
                        void run(() => leaguesApi.regenerateGuestCode(leagueId, g.user_id))
                      }
                      disabled={busy}
                    >
                      <LuRefreshCw size={13} />
                    </GuestIconBtn>
                  </>
                )}
                <GuestIconBtn
                  title={t('guests.remove')}
                  label={t('a11y.campaign.removeGuest', { name })}
                  onClick={() => remove(g.user_id)}
                  disabled={busy}
                >
                  <LuTrash2 size={13} />
                </GuestIconBtn>
              </li>
            )
          })}
        </ul>
      )}
      {error && (
        <p role="alert" style={errorText}>
          {error}
        </p>
      )}
      {share && <GuestShareDialog share={share} onClose={() => setShare(null)} />}
    </section>
  )
}
