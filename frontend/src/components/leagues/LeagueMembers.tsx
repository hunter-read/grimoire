import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LuUserMinus } from 'react-icons/lu'
import { armies as armiesApi, leagues as leaguesApi, type Schema } from '../../api'
import {
  card,
  chip,
  errorText,
  iconBtn,
  input,
  muted,
  primaryBtn,
  sectionTitle,
} from '../armies/armyStyles'
import { errorMessage } from '../armies/armyText'

type League = Schema<'LeagueDetail'>

interface LeagueMembersProps {
  league: League
  userId?: string
  /** A fresh league after a change, or null when the caller just left it. */
  onChange: (league: League | null) => void
}

/**
 * A league's members and the armies they play. Each member picks one of their
 * own armies; the organiser adds and removes members.
 */
export default function LeagueMembers({ league, userId, onChange }: LeagueMembersProps) {
  const { t } = useTranslation()
  const [myArmies, setMyArmies] = useState<Schema<'ArmySummary'>[]>([])
  const [eligible, setEligible] = useState<Schema<'EligibleMember'>[]>([])
  const [adding, setAdding] = useState('')
  const [error, setError] = useState('')
  const memberCount = league.members?.length ?? 0

  useEffect(() => {
    if (league.is_member)
      armiesApi
        .list()
        .then(setMyArmies)
        .catch(() => setMyArmies([]))
  }, [league.is_member])

  useEffect(() => {
    if (league.can_manage)
      leaguesApi
        .eligible(league.id)
        .then(setEligible)
        .catch(() => setEligible([]))
  }, [league.id, league.can_manage, memberCount])

  const run = async (action: () => Promise<void>) => {
    setError('')
    try {
      await action()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const add = () =>
    run(async () => {
      if (!adding) return
      onChange(await leaguesApi.addMember(league.id, adding))
      setAdding('')
    })

  const remove = (memberId: string) =>
    run(async () => {
      await leaguesApi.removeMember(league.id, memberId)
      if (memberId === userId && !league.can_manage) onChange(null)
      else onChange(await leaguesApi.get(league.id))
    })

  return (
    <section style={card}>
      <h2 style={sectionTitle}>{t('leagues.members')}</h2>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
        {(league.members ?? []).map((m) => {
          const leaveLabel =
            m.user_id === userId ? t('leagues.leave') : t('leagues.remove', { name: m.name })
          return (
            <li
              key={m.user_id}
              style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}
            >
              <strong style={{ minWidth: 120 }}>
                {m.name}
                {m.is_guest && (
                  <span style={{ ...chip, marginLeft: 6, fontWeight: 400 }}>
                    {t('guests.guest')}
                  </span>
                )}
              </strong>
              {m.user_id === userId ? (
                <select
                  style={{ ...input, minWidth: 200 }}
                  value={m.army?.id ?? ''}
                  aria-label={t('leagues.yourArmy')}
                  onChange={(e) => {
                    const armyId = e.target.value || null
                    void run(async () =>
                      onChange(await leaguesApi.setArmy(league.id, m.user_id, armyId))
                    )
                  }}
                >
                  <option value="">{t('leagues.noArmy')}</option>
                  {myArmies.map((a) => (
                    <option key={a.id} value={a.id}>
                      {t('leagues.armyOption', {
                        name: a.name,
                        points: a.points ?? 0,
                        cost: a.cost_name || 'pts',
                      })}
                    </option>
                  ))}
                </select>
              ) : m.army ? (
                <Link to={`/armies/${m.army.id}`}>
                  {t('leagues.armyOption', {
                    name: m.army.name,
                    points: m.army.points ?? 0,
                    cost: m.army.cost_name || 'pts',
                  })}
                </Link>
              ) : (
                <span style={muted}>{t('leagues.noArmy')}</span>
              )}
              {(league.can_manage || m.user_id === userId) && (
                <button
                  type="button"
                  style={iconBtn}
                  onClick={() => void remove(m.user_id)}
                  aria-label={leaveLabel}
                  title={leaveLabel}
                >
                  <LuUserMinus size={14} aria-hidden="true" />
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {league.can_manage && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <select
            style={{ ...input, minWidth: 200 }}
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            aria-label={t('leagues.choosePlayer')}
          >
            <option value="">{t('leagues.choosePlayer')}</option>
            {eligible.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <button type="button" style={primaryBtn} onClick={() => void add()} disabled={!adding}>
            {t('leagues.addMember')}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" style={errorText}>
          {error}
        </p>
      )}
    </section>
  )
}
