import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { BodyOf } from '../../api'
import GameFactionFields from './GameFactionFields'
import { card, errorText, input, label, primaryBtn, row, secondaryBtn } from './armyStyles'
import { errorMessage, numberOrNull } from './armyText'

interface NewArmyFormProps {
  onCreate: (army: BodyOf<'/armies', 'post'>) => Promise<void>
  onCancel: () => void
}

/** Start a hand-built army: a name and, optionally, a game, faction and points limit. */
export default function NewArmyForm({ onCreate, onCancel }: NewArmyFormProps) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [limit, setLimit] = useState('')
  const [systemId, setSystemId] = useState('')
  const [factionId, setFactionId] = useState('')
  const [error, setError] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setError('')
    try {
      await onCreate({
        name: name.trim(),
        points_limit: numberOrNull(limit),
        game_system_id: systemId || null,
        faction_id: factionId || null,
      })
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} style={{ ...card, ...row }}>
      <label style={label}>
        {t('armies.name')}
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
        factionId={factionId}
        onChange={(system, faction) => {
          setSystemId(system)
          setFactionId(faction)
        }}
      />
      <label style={label}>
        {t('armies.pointsLimit')}
        <input
          style={{ ...input, width: 110 }}
          type="number"
          min="0"
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
        />
      </label>
      <button type="submit" style={primaryBtn}>
        {t('armies.create')}
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
