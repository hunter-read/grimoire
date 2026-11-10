import { useTranslation } from 'react-i18next'
import { LuArrowDownWideNarrow, LuChevronLeft, LuChevronRight, LuTrash2 } from 'react-icons/lu'
import CompactNumber from '../../characters/CompactNumber'
import { ghostBtn, goldBtn, iconBtn } from '../../characters/characterStyles'
import {
  nextTurn,
  previousTurn,
  removeCombatant,
  sortByScore,
  updateCombatant,
} from '../initiative'
import type { InitiativeState } from '../types'

interface OrderedInitiativeProps {
  state: InitiativeState
  onChange: (state: InitiativeState) => void
}

/** One combatant after another, highest score first. */
export default function OrderedInitiative({ state, onChange }: OrderedInitiativeProps) {
  const { t } = useTranslation()
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => onChange(previousTurn(state))}
          style={{ ...ghostBtn, padding: '5px 10px' }}
          disabled={!state.entries.length}
        >
          <LuChevronLeft size={14} aria-hidden="true" /> {t('gmScreen.initiative.previous')}
        </button>
        <button
          type="button"
          onClick={() => onChange(nextTurn(state))}
          style={{ ...goldBtn, padding: '5px 10px' }}
          disabled={!state.entries.length}
        >
          {t('gmScreen.initiative.next')} <LuChevronRight size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => onChange(sortByScore(state))}
          style={{ ...ghostBtn, padding: '5px 10px' }}
          disabled={state.entries.length < 2}
        >
          <LuArrowDownWideNarrow size={14} aria-hidden="true" /> {t('gmScreen.initiative.sort')}
        </button>
      </div>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
        {state.entries.map((entry, index) => {
          const current = index === state.turn
          return (
            <li
              key={entry.id}
              aria-current={current ? 'step' : undefined}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 6px',
                borderRadius: 6,
                background: current ? 'var(--bg-deep)' : undefined,
                borderLeft: `3px solid ${current ? 'var(--gold)' : 'transparent'}`,
              }}
            >
              <CompactNumber
                value={entry.score}
                onChange={(score) => onChange(updateCombatant(state, entry.id, { score }))}
                style={{ width: 44, padding: '2px 6px', fontSize: 13 }}
              />
              <span style={{ flex: 1, fontWeight: current ? 700 : 400, minWidth: 0 }}>
                {entry.name}
              </span>
              <button
                type="button"
                onClick={() => onChange(removeCombatant(state, entry.id))}
                aria-label={t('gmScreen.initiative.remove', { name: entry.name })}
                style={iconBtn}
              >
                <LuTrash2 size={14} aria-hidden="true" />
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
