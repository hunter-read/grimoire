import { useState, type ChangeEvent, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { Schema } from '../../api'
import { card, errorText, input, label, primaryBtn, row, secondaryBtn } from '../armies/armyStyles'
import { errorMessage, numberOrNull } from '../armies/armyText'

type GameIn = Schema<'GameIn'>
type Result = '' | 'a' | 'b' | 'draw'

interface FormState {
  player_a_id: string
  player_b_id: string
  score_a: string
  score_b: string
  result: Result
  mission: string
  played_on: string
  notes: string
}

const today = () => new Date().toISOString().slice(0, 10)

const empty = (userId: string): FormState => ({
  player_a_id: userId,
  player_b_id: '',
  score_a: '',
  score_b: '',
  result: '',
  mission: '',
  played_on: today(),
  notes: '',
})

function fromGame(game: Schema<'LeagueGameOut'>): FormState {
  const scored = game.score_a != null && game.score_b != null
  return {
    player_a_id: game.player_a.id,
    player_b_id: game.player_b.id,
    score_a: game.score_a == null ? '' : String(game.score_a),
    score_b: game.score_b == null ? '' : String(game.score_b),
    // With both scores the result follows from them; otherwise it was given.
    result: scored ? '' : (game.result as Result),
    mission: game.mission ?? '',
    played_on: game.played_on ?? '',
    notes: game.notes ?? '',
  }
}

interface GameFormProps {
  members: Schema<'LeagueMemberOut'>[]
  /** Who is logging: pre-selected as the player. Empty for an organiser who is not playing. */
  userId?: string
  game?: Schema<'LeagueGameOut'>
  onSubmit: (game: GameIn) => Promise<void>
  onCancel: () => void
}

/**
 * Log (or edit) a game between two members. Give both scores and the result
 * follows from them; without scores, say who won.
 */
export default function GameForm({
  members,
  userId = '',
  game,
  onSubmit,
  onCancel,
}: GameFormProps) {
  const { t } = useTranslation()
  const [form, setForm] = useState<FormState>(() => (game ? fromGame(game) : empty(userId)))
  const [error, setError] = useState('')
  const set = (field: keyof FormState) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      await onSubmit({
        player_a_id: form.player_a_id,
        player_b_id: form.player_b_id,
        score_a: numberOrNull(form.score_a),
        score_b: numberOrNull(form.score_b),
        result: form.result || null,
        mission: form.mission,
        played_on: form.played_on || null,
        notes: form.notes,
      })
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const playerSelect = (field: 'player_a_id' | 'player_b_id', labelKey: string) => (
    <label style={label}>
      {t(labelKey)}
      <select style={input} value={form[field]} onChange={set(field)} required>
        <option value="">{t('leagues.choosePlayer')}</option>
        {members.map((m) => (
          <option key={m.user_id} value={m.user_id}>
            {m.name}
          </option>
        ))}
      </select>
    </label>
  )
  const scoreInput = (field: 'score_a' | 'score_b', labelKey: string) => (
    <label style={label}>
      {t(labelKey)}
      <input
        style={{ ...input, width: 80 }}
        type="number"
        min="0"
        value={form[field]}
        onChange={set(field)}
      />
    </label>
  )

  return (
    <form onSubmit={(e) => void submit(e)} style={{ ...card, display: 'grid', gap: 12 }}>
      <div style={row}>
        {playerSelect('player_a_id', 'leagues.game.playerA')}
        {scoreInput('score_a', 'leagues.game.scoreA')}
        {playerSelect('player_b_id', 'leagues.game.playerB')}
        {scoreInput('score_b', 'leagues.game.scoreB')}
        <label style={label}>
          {t('leagues.game.result')}
          <select style={input} value={form.result} onChange={set('result')}>
            <option value="">{t('leagues.game.fromScores')}</option>
            <option value="a">{t('leagues.game.aWon')}</option>
            <option value="b">{t('leagues.game.bWon')}</option>
            <option value="draw">{t('leagues.game.draw')}</option>
          </select>
        </label>
      </div>
      <div style={row}>
        <label style={label}>
          {t('leagues.game.date')}
          <input style={input} type="date" value={form.played_on} onChange={set('played_on')} />
        </label>
        <label style={{ ...label, flex: 1, minWidth: 180 }}>
          {t('leagues.game.mission')}
          <input style={input} value={form.mission} onChange={set('mission')} />
        </label>
        <label style={{ ...label, flex: 2, minWidth: 220 }}>
          {t('leagues.game.notes')}
          <input style={input} value={form.notes} onChange={set('notes')} />
        </label>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" style={primaryBtn}>
          {game ? t('common.save') : t('leagues.game.log')}
        </button>
        <button type="button" style={secondaryBtn} onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
      {error && (
        <p role="alert" style={errorText}>
          {error}
        </p>
      )}
    </form>
  )
}
