import { useTranslation } from 'react-i18next'
import { LuCheck, LuRefreshCw, LuTrash2 } from 'react-icons/lu'
import { goldBtn, iconBtn } from '../../characters/characterStyles'
import { goesFirst, markActed, nextRound, removeCombatant } from '../initiative'
import type { InitiativeState, Side } from '../types'

interface SidesInitiativeProps {
  state: InitiativeState
  sides: Side[]
  onChange: (state: InitiativeState) => void
}

/**
 * The sides take turns. Each combatant is marked once it has gone, so the GM
 * sees who is left this round; the next round clears every mark.
 */
export default function SidesInitiative({ state, sides, onChange }: SidesInitiativeProps) {
  const { t } = useTranslation()
  const everyoneActed = state.entries.length > 0 && state.entries.every((entry) => entry.acted)
  const acting = sides.find((side) => side.key === state.side) ?? sides[0]

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span role="status" style={{ fontSize: 13 }}>
          {everyoneActed
            ? t('gmScreen.initiative.roundOver')
            : t('gmScreen.initiative.sideUp', { side: acting.label })}
        </span>
        <button
          type="button"
          onClick={() => onChange(nextRound(state))}
          style={{ ...goldBtn, padding: '5px 10px', marginLeft: 'auto' }}
        >
          <LuRefreshCw size={14} aria-hidden="true" /> {t('gmScreen.initiative.nextRound')}
        </button>
      </div>
      {sides.map((side) => {
        const members = state.entries.filter((entry) => entry.side === side.key)
        const up = side.key === state.side && !everyoneActed
        return (
          <section key={side.key} aria-label={side.label} style={{ display: 'grid', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <h3
                style={{
                  margin: 0,
                  fontSize: 12,
                  fontFamily: 'inherit',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: up ? 'var(--gold)' : 'var(--text-muted)',
                }}
              >
                {side.label}
              </h3>
              {state.first === side.key ? (
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {t('gmScreen.initiative.goesFirst')}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onChange(goesFirst(state, side.key))}
                  style={{ ...iconBtn, fontSize: 11, padding: '0 4px', color: 'var(--text-muted)' }}
                >
                  {t('gmScreen.initiative.makeFirst')}
                </button>
              )}
            </div>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 2 }}>
              {members.map((entry) => (
                <li key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    type="button"
                    aria-pressed={entry.acted}
                    aria-label={t('gmScreen.initiative.acted', { name: entry.name })}
                    onClick={() => onChange(markActed(state, sides, entry.id, !entry.acted))}
                    style={{
                      ...iconBtn,
                      width: 22,
                      height: 22,
                      padding: 0,
                      border: '1px solid var(--border)',
                      borderRadius: 5,
                      background: entry.acted ? 'var(--gold)' : 'transparent',
                      color: entry.acted ? 'var(--on-accent)' : 'transparent',
                    }}
                  >
                    <LuCheck size={14} aria-hidden="true" />
                  </button>
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      color: entry.acted ? 'var(--text-muted)' : undefined,
                      textDecoration: entry.acted ? 'line-through' : undefined,
                    }}
                  >
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
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
