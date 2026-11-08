import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LuPlus, LuTrophy } from 'react-icons/lu'
import { leagues as leaguesApi, type BodyOf, type Schema } from '../api'
import { useAuth } from '../context/AuthContext'
import Spinner from '../components/Spinner'
import LeagueCard from '../components/leagues/LeagueCard'
import NewLeagueForm from '../components/leagues/NewLeagueForm'
import {
  errorText,
  grid,
  header,
  muted,
  page,
  primaryBtn,
  title,
} from '../components/armies/armyStyles'
import { errorMessage } from '../components/armies/armyText'
import usePageTitle from '../hooks/usePageTitle'

/**
 * The leagues you organise or play in. GMs and admins start them; a league's
 * page holds its members, games and standings.
 */
export default function LeaguesView() {
  const { t } = useTranslation()
  const user = useAuth()?.user
  const navigate = useNavigate()
  const [list, setList] = useState<Schema<'LeagueSummary'>[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const canCreate = user?.role === 'admin' || user?.role === 'gm'
  usePageTitle(t('leagues.title'))

  useEffect(() => {
    leaguesApi
      .list()
      .then(setList)
      .catch((e: unknown) => setError(errorMessage(e, t('leagues.loadFailed'))))
  }, [t])

  const create = async (data: BodyOf<'/leagues', 'post'>) => {
    const league = await leaguesApi.create(data)
    void navigate(`/leagues/${league.id}`)
  }

  return (
    <div className="fade-in" style={page}>
      <div style={header}>
        <h1 style={title}>
          <LuTrophy size={20} color="var(--gold)" aria-hidden="true" /> {t('leagues.title')}
        </h1>
        {canCreate && (
          <button type="button" style={primaryBtn} onClick={() => setCreating(true)}>
            <LuPlus size={14} aria-hidden="true" /> {t('leagues.new')}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" style={{ ...errorText, fontSize: 14 }}>
          {error}
        </p>
      )}
      {creating && (
        <div style={{ marginBottom: 20 }}>
          <NewLeagueForm onCreate={create} onCancel={() => setCreating(false)} />
        </div>
      )}
      {list === null ? (
        !error && <Spinner size={24} />
      ) : list.length ? (
        <div style={grid}>
          {list.map((league) => (
            <LeagueCard key={league.id} league={league} />
          ))}
        </div>
      ) : (
        <p style={muted}>{canCreate ? t('leagues.emptyOrganiser') : t('leagues.empty')}</p>
      )}
    </div>
  )
}
