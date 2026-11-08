import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LuArrowLeft, LuPlus, LuTrophy } from 'react-icons/lu'
import { leagues as leaguesApi, type Schema } from '../api'
import { useAuth } from '../context/AuthContext'
import Spinner from '../components/Spinner'
import StandingsTable from '../components/leagues/StandingsTable'
import LeagueMembers from '../components/leagues/LeagueMembers'
import GameForm from '../components/leagues/GameForm'
import GameList from '../components/leagues/GameList'
import LeagueSettings from '../components/leagues/LeagueSettings'
import {
  chip,
  header,
  muted,
  page,
  primaryBtn,
  sectionTitle,
  title,
} from '../components/armies/armyStyles'
import { errorMessage } from '../components/armies/armyText'
import usePageTitle from '../hooks/usePageTitle'

/**
 * One league: its standings, members and their armies, and the games played.
 * Members log their own games; the organiser runs the rest.
 */
export default function LeagueDetailView() {
  const { leagueId = '' } = useParams()
  const { t } = useTranslation()
  const user = useAuth()?.user
  const navigate = useNavigate()
  const [league, setLeague] = useState<Schema<'LeagueDetail'> | null>(null)
  const [error, setError] = useState('')
  const [logging, setLogging] = useState(false)
  usePageTitle(league?.name)

  const load = useCallback(
    () =>
      leaguesApi
        .get(leagueId)
        .then(setLeague)
        .catch((e: unknown) => setError(errorMessage(e, t('leagues.loadFailed')))),
    [leagueId, t]
  )

  useEffect(() => {
    void load()
  }, [load])

  if (error) return <p style={{ ...page, color: 'var(--danger)' }}>{error}</p>
  if (!league) return <Spinner size={28} />

  const members = league.members ?? []

  return (
    <div className="fade-in" style={page}>
      <Link to="/leagues" style={{ ...muted, display: 'inline-flex', gap: 6, marginBottom: 12 }}>
        <LuArrowLeft size={14} aria-hidden="true" /> {t('leagues.back')}
      </Link>
      <div style={header}>
        <div>
          <h1 style={title}>
            <LuTrophy size={20} color="var(--gold)" aria-hidden="true" /> {league.name}{' '}
            {league.status === 'finished' && <span style={chip}>{t('leagues.finished')}</span>}
          </h1>
          <div style={{ ...muted, marginTop: 4 }}>
            {[
              league.game_system_name,
              t('leagues.organiser', { name: league.organizer_name }),
              league.points_limit ? t('leagues.limit', { limit: league.points_limit }) : '',
              t('leagues.scoring', {
                win: league.points_win,
                draw: league.points_draw,
                loss: league.points_loss,
              }),
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>
          {league.description && <p style={{ marginTop: 8 }}>{league.description}</p>}
        </div>
        {(league.is_member || league.can_manage) && !logging && (
          <button type="button" style={primaryBtn} onClick={() => setLogging(true)}>
            <LuPlus size={14} aria-hidden="true" /> {t('leagues.game.log')}
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gap: 16 }}>
        {logging && (
          <GameForm
            members={members}
            userId={league.is_member ? user?.id : ''}
            onSubmit={async (game) => {
              setLeague(await leaguesApi.logGame(league.id, game))
              setLogging(false)
            }}
            onCancel={() => setLogging(false)}
          />
        )}
        <StandingsTable rows={league.standings ?? []} />
        <section>
          <h2 style={sectionTitle}>{t('leagues.games')}</h2>
          <GameList
            games={league.games ?? []}
            members={members}
            userId={user?.id}
            onUpdate={async (gameId, game) =>
              setLeague(await leaguesApi.updateGame(league.id, gameId, game))
            }
            onDelete={async (gameId) => {
              await leaguesApi.removeGame(league.id, gameId)
              await load()
            }}
          />
        </section>
        <LeagueMembers
          league={league}
          userId={user?.id}
          onChange={(next) => (next ? setLeague(next) : void navigate('/leagues'))}
        />
        {league.can_manage && (
          <LeagueSettings
            league={league}
            onSave={async (patch) => setLeague(await leaguesApi.update(league.id, patch))}
            onDelete={async () => {
              await leaguesApi.remove(league.id)
              void navigate('/leagues')
            }}
          />
        )}
      </div>
    </div>
  )
}
