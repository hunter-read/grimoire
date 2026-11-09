import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { BodyOf, Schema } from '../../api'
import {
  card,
  dangerBtn,
  errorText,
  input,
  label,
  primaryBtn,
  row,
  secondaryBtn,
  sectionTitle,
} from '../armies/armyStyles'
import { errorMessage, numberOrNull } from '../armies/armyText'

type Patch = BodyOf<'/leagues/{league_id}', 'patch'>
const SCORING = ['points_win', 'points_draw', 'points_loss'] as const

interface LeagueSettingsProps {
  league: Schema<'LeagueDetail'>
  onSave: (patch: Patch) => Promise<void>
  onDelete: () => Promise<void>
}

/**
 * The organiser's controls: the name, description and points limit, league
 * points for a win, draw and loss, finishing the league, and deleting it.
 */
export default function LeagueSettings({ league, onSave, onDelete }: LeagueSettingsProps) {
  const { t } = useTranslation()
  const [name, setName] = useState(league.name)
  const [description, setDescription] = useState(league.description ?? '')
  const [limit, setLimit] = useState(league.points_limit == null ? '' : String(league.points_limit))
  const [scoring, setScoring] = useState({
    points_win: String(league.points_win ?? 3),
    points_draw: String(league.points_draw ?? 1),
    points_loss: String(league.points_loss ?? 0),
  })
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState('')
  const finished = league.status === 'finished'

  const run = async (action: () => Promise<void>) => {
    setError('')
    try {
      await action()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const save = () =>
    run(() =>
      onSave({
        name: name.trim() || league.name,
        description,
        points_limit: numberOrNull(limit),
        points_win: Math.trunc(Number(scoring.points_win) || 0),
        points_draw: Math.trunc(Number(scoring.points_draw) || 0),
        points_loss: Math.trunc(Number(scoring.points_loss) || 0),
      })
    )

  return (
    <section style={{ ...card, display: 'grid', gap: 12 }}>
      <h2 style={{ ...sectionTitle, margin: 0 }}>{t('leagues.settings.title')}</h2>
      <div style={row}>
        <label style={label}>
          {t('leagues.name')}
          <input style={input} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label style={label}>
          {t('leagues.pointsLimit')}
          <input
            style={{ ...input, width: 110 }}
            type="number"
            min="0"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
          />
        </label>
        <label style={{ ...label, flex: 1, minWidth: 220 }}>
          {t('leagues.description')}
          <input
            style={input}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
      </div>
      <div style={row}>
        {SCORING.map((key) => (
          <label key={key} style={label}>
            {t(`leagues.settings.${key}`)}
            <input
              style={{ ...input, width: 80 }}
              type="number"
              value={scoring[key]}
              onChange={(e) => setScoring((s) => ({ ...s, [key]: e.target.value }))}
            />
          </label>
        ))}
        <button type="button" style={primaryBtn} onClick={() => void save()}>
          {t('common.save')}
        </button>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          style={secondaryBtn}
          onClick={() => void run(() => onSave({ status: finished ? 'active' : 'finished' }))}
        >
          {finished ? t('leagues.settings.reopen') : t('leagues.settings.finish')}
        </button>
        {confirm ? (
          <>
            <button type="button" style={dangerBtn} onClick={() => void run(onDelete)}>
              {t('leagues.settings.confirmDelete')}
            </button>
            <button type="button" style={secondaryBtn} onClick={() => setConfirm(false)}>
              {t('common.cancel')}
            </button>
          </>
        ) : (
          <button type="button" style={dangerBtn} onClick={() => setConfirm(true)}>
            {t('leagues.settings.delete')}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" style={errorText}>
          {error}
        </p>
      )}
    </section>
  )
}
