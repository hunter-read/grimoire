import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { LuPencil, LuTrash2 } from 'react-icons/lu'
import type { Schema } from '../../api'
import GameForm from './GameForm'
import { card, errorText, iconBtn, muted } from '../armies/armyStyles'
import { errorMessage } from '../armies/armyText'

type Game = Schema<'LeagueGameOut'>

function outcome(game: Game, t: TFunction): string {
  if (game.result === 'draw') return t('leagues.game.drawn')
  const winner = game.result === 'a' ? game.player_a.name : game.player_b.name
  return t('leagues.game.won', { name: winner })
}

interface GameListProps {
  games: Game[]
  members: Schema<'LeagueMemberOut'>[]
  userId?: string
  onUpdate: (gameId: string, game: Schema<'GameIn'>) => Promise<void>
  onDelete: (gameId: string) => Promise<void>
}

/** The games played, newest first, each editable by its players or the organiser. */
export default function GameList({ games, members, userId, onUpdate, onDelete }: GameListProps) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState<string | null>(null)
  const [error, setError] = useState('')

  if (!games.length) return <p style={muted}>{t('leagues.noGames')}</p>

  const remove = async (gameId: string) => {
    setError('')
    try {
      await onDelete(gameId)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <>
      {error && (
        <p role="alert" style={errorText}>
          {error}
        </p>
      )}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
        {games.map((game) =>
          editing === game.id ? (
            <li key={game.id}>
              <GameForm
                members={members}
                userId={userId}
                game={game}
                onSubmit={async (data) => {
                  await onUpdate(game.id, data)
                  setEditing(null)
                }}
                onCancel={() => setEditing(null)}
              />
            </li>
          ) : (
            <li
              key={game.id}
              style={{ ...card, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}
            >
              <div style={{ flex: 1, minWidth: 220 }}>
                <strong>
                  {t('leagues.game.line', {
                    a: game.player_a.name,
                    b: game.player_b.name,
                    scoreA: game.score_a ?? '-',
                    scoreB: game.score_b ?? '-',
                  })}
                </strong>
                <div style={muted}>
                  {[game.played_on, game.mission, outcome(game, t)].filter(Boolean).join(' · ')}
                </div>
                {game.notes && <div style={{ ...muted, marginTop: 4 }}>{game.notes}</div>}
              </div>
              {game.can_edit && (
                <>
                  <button
                    type="button"
                    style={iconBtn}
                    onClick={() => setEditing(game.id)}
                    aria-label={t('leagues.game.edit')}
                    title={t('leagues.game.edit')}
                  >
                    <LuPencil size={14} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    style={iconBtn}
                    onClick={() => void remove(game.id)}
                    aria-label={t('leagues.game.delete')}
                    title={t('leagues.game.delete')}
                  >
                    <LuTrash2 size={14} aria-hidden="true" />
                  </button>
                </>
              )}
            </li>
          )
        )}
      </ul>
    </>
  )
}
