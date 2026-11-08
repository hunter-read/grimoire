import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { BodyOf } from '../../api'
import GameFactionFields from '../armies/GameFactionFields'
import { card, errorText, input, label, primaryBtn, row, secondaryBtn } from '../armies/armyStyles'
import { errorMessage, numberOrNull } from '../armies/armyText'

interface NewLeagueFormProps {
  onCreate: (league: BodyOf<'/leagues', 'post'>) => Promise<void>
  onCancel: () => void
}

/** Start a league: a name, and optionally its game, points limit and description. */
export default function NewLeagueForm({ onCreate, onCancel }: NewLeagueFormProps) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [systemId, setSystemId] = useState('')
  const [limit, setLimit] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setError('')
    try {
      await onCreate({
        name: name.trim(),
        game_system_id: systemId || null,
        points_limit: numberOrNull(limit),
        description,
      })
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} style={{ ...card, ...row }}>
      <label style={label}>
        {t('leagues.name')}
        <input
          style={input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoFocus
        />
      </label>
      <GameFactionFields
        systemId={systemId}
        onChange={(system) => setSystemId(system)}
        withFaction={false}
      />
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
        <input style={input} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <button type="submit" style={primaryBtn}>
        {t('leagues.create')}
      </button>
      <button type="button" style={secondaryBtn} onClick={onCancel}>
        {t('common.cancel')}
      </button>
      {error && (
        <p role="alert" style={{ ...errorText, width: '100%' }}>
          {error}
        </p>
      )}
    </form>
  )
}
