import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuPlus, LuUsers } from 'react-icons/lu'
import { fieldInput, ghostBtn } from '../../characters/characterStyles'
import { useGmScreenContext } from '../gmScreenContext'
import type { Combatant, InitiativeConfig } from '../types'

interface AddCombatantFormProps {
  config: InitiativeConfig
  entries: Combatant[]
  onAdd: (combatants: Array<Partial<Combatant> & { name: string; side: string }>) => void
}

/** Adding to the turn order: one foe at a time, or the whole party at once. */
export default function AddCombatantForm({ config, entries, onAdd }: AddCombatantFormProps) {
  const { t } = useTranslation()
  const { party } = useGmScreenContext()
  const [name, setName] = useState('')
  const [score, setScore] = useState('')
  const [side, setSide] = useState(config.sides[config.sides.length - 1].key)

  const present = new Set(entries.map((entry) => entry.character_id).filter(Boolean))
  const missing = party.characters.filter(
    (character) => character.status === 'active' && !present.has(character.id)
  )

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (!name.trim()) return
          onAdd([
            {
              name: name.trim(),
              side: config.mode === 'sides' ? side : config.sides[0].key,
              score: score === '' ? null : Number(score),
            },
          ])
          setName('')
          setScore('')
        }}
        style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}
      >
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-label={t('gmScreen.initiative.newName')}
          placeholder={t('gmScreen.initiative.newName')}
          maxLength={120}
          style={{ ...fieldInput, flex: '1 1 110px', padding: '5px 8px' }}
        />
        {config.mode === 'ordered' ? (
          <input
            value={score}
            inputMode="numeric"
            onChange={(event) => /^-?\d*$/.test(event.target.value) && setScore(event.target.value)}
            aria-label={t('gmScreen.initiative.score')}
            placeholder={t('gmScreen.initiative.score')}
            style={{ ...fieldInput, width: 70, padding: '5px 8px' }}
          />
        ) : (
          <select
            value={side}
            onChange={(event) => setSide(event.target.value)}
            aria-label={t('gmScreen.initiative.side')}
            style={{ ...fieldInput, width: 'auto', padding: '5px 8px' }}
          >
            {config.sides.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        )}
        <button
          type="submit"
          style={{ ...ghostBtn, padding: '5px 10px' }}
          disabled={entries.length >= 100}
        >
          <LuPlus size={14} aria-hidden="true" /> {t('gmScreen.initiative.add')}
        </button>
      </form>
      {missing.length > 0 && (
        <button
          type="button"
          onClick={() =>
            onAdd(
              missing.map((character) => ({
                name: character.name,
                side: config.sides[0].key,
                character_id: character.id,
              }))
            )
          }
          style={{ ...ghostBtn, padding: '5px 10px', justifySelf: 'start' }}
        >
          <LuUsers size={14} aria-hidden="true" />{' '}
          {t('gmScreen.initiative.addParty', { count: missing.length })}
        </button>
      )}
    </div>
  )
}
