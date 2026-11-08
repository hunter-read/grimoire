import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { BodyOf, Schema } from '../../api'
import GameFactionFields from './GameFactionFields'
import { card, errorText, input, label, primaryBtn, row, secondaryBtn } from './armyStyles'
import { errorMessage, numberOrNull } from './armyText'

interface ArmyDetailsFormProps {
  army: Schema<'ArmyDetail'>
  onSave: (patch: BodyOf<'/armies/{army_id}', 'patch'>) => Promise<void>
  onCancel: () => void
}

/** The owner's edit of an army's name, game and faction, points limit and notes. */
export default function ArmyDetailsForm({ army, onSave, onCancel }: ArmyDetailsFormProps) {
  const { t } = useTranslation()
  const [name, setName] = useState(army.name)
  const [limit, setLimit] = useState(army.points_limit == null ? '' : String(army.points_limit))
  const [notes, setNotes] = useState(army.notes ?? '')
  const [systemId, setSystemId] = useState(army.game_system_id ?? '')
  const [factionId, setFactionId] = useState(army.faction?.id ?? '')
  const [error, setError] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      // The game and faction are sent only when changed, so saving a rename
      // never re-matches an army the picker could not show the game of.
      const matchChanged =
        systemId !== (army.game_system_id ?? '') || factionId !== (army.faction?.id ?? '')
      await onSave({
        name: name.trim() || army.name,
        points_limit: numberOrNull(limit),
        notes,
        ...(matchChanged
          ? { game_system_id: systemId || null, faction_id: factionId || null }
          : {}),
      })
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} style={{ ...card, ...row }}>
      <label style={label}>
        {t('armies.name')}
        <input style={input} value={name} onChange={(e) => setName(e.target.value)} />
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
      <label style={{ ...label, flex: 1, minWidth: 220 }}>
        {t('armies.notes')}
        <input style={input} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <button type="submit" style={primaryBtn}>
        {t('common.save')}
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
