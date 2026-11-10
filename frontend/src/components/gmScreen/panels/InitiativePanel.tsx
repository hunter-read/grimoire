import { useTranslation } from 'react-i18next'
import { addCombatant } from '../initiative'
import { initiativeConfig, initiativeState, type InitiativeState } from '../types'
import AddCombatantForm from './AddCombatantForm'
import OrderedInitiative from './OrderedInitiative'
import type { PanelBodyProps } from './panelProps'
import SidesInitiative from './SidesInitiative'

/** The turn order, by score or by sides taking turns, with the round count. */
export default function InitiativePanel({ panel, onState }: PanelBodyProps) {
  const { t } = useTranslation()
  const config = initiativeConfig(panel.config)
  const state = initiativeState(panel.state, config)
  const save = (next: InitiativeState) => onState({ ...next })

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>
        {t('gmScreen.initiative.round', { round: state.round })}
      </div>
      {config.mode === 'sides' ? (
        <SidesInitiative state={state} sides={config.sides} onChange={save} />
      ) : (
        <OrderedInitiative state={state} onChange={save} />
      )}
      {state.entries.length === 0 && (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
          {t('gmScreen.initiative.empty')}
        </p>
      )}
      <AddCombatantForm
        config={config}
        entries={state.entries}
        onAdd={(combatants) =>
          save(combatants.reduce((next, combatant) => addCombatant(next, combatant), state))
        }
      />
    </div>
  )
}
