import { useTranslation } from 'react-i18next'
import { LuPlus, LuTrash2 } from 'react-icons/lu'
import { fieldInput, fieldLabel, ghostBtn, iconBtn } from '../../characters/characterStyles'
import type { SettingsProps } from '../GmPanelFrame'
import { initiativeConfig, type Side } from '../types'
import ResetSelect from './ResetSelect'

const MAX_SIDES = 4

const keyFor = (label: string, taken: Set<string>) => {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 24) || 'side'
  let key = base
  for (let n = 2; taken.has(key); n += 1) key = `${base}-${n}`
  return key
}

/** Taking turns by score, or by sides - and which sides there are. */
export default function InitiativeSettings({ config, onChange }: SettingsProps) {
  const { t } = useTranslation()
  const current = initiativeConfig(config)
  const set = (patch: Partial<typeof current>) => onChange({ ...current, ...patch })
  const setSides = (sides: Side[]) => set({ sides })

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <label style={fieldLabel}>
        {t('gmScreen.initiative.mode')}
        <select
          value={current.mode}
          onChange={(event) => set({ mode: event.target.value === 'sides' ? 'sides' : 'ordered' })}
          style={fieldInput}
        >
          <option value="ordered">{t('gmScreen.initiative.modeOrdered')}</option>
          <option value="sides">{t('gmScreen.initiative.modeSides')}</option>
        </select>
      </label>
      {current.mode === 'sides' && (
        <fieldset style={{ border: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
          <legend style={fieldLabel}>{t('gmScreen.initiative.sides')}</legend>
          {current.sides.map((side, index) => (
            <div key={side.key} style={{ display: 'flex', gap: 6 }}>
              <input
                value={side.label}
                maxLength={60}
                aria-label={t('gmScreen.initiative.sideName', { number: index + 1 })}
                onChange={(event) =>
                  setSides(
                    current.sides.map((other) =>
                      other.key === side.key ? { ...other, label: event.target.value } : other
                    )
                  )
                }
                style={{ ...fieldInput, flex: 1 }}
              />
              <button
                type="button"
                disabled={current.sides.length <= 2}
                onClick={() => setSides(current.sides.filter((other) => other.key !== side.key))}
                aria-label={t('gmScreen.initiative.removeSide', { side: side.label })}
                style={iconBtn}
              >
                <LuTrash2 size={14} aria-hidden="true" />
              </button>
            </div>
          ))}
          {current.sides.length < MAX_SIDES && (
            <button
              type="button"
              onClick={() => {
                const label = t('gmScreen.initiative.newSide')
                const taken = new Set(current.sides.map((side) => side.key))
                setSides([...current.sides, { key: keyFor(label, taken), label }])
              }}
              style={{ ...ghostBtn, justifySelf: 'start', padding: '5px 10px' }}
            >
              <LuPlus size={14} aria-hidden="true" /> {t('gmScreen.initiative.addSide')}
            </button>
          )}
        </fieldset>
      )}
      <ResetSelect
        label={t('gmScreen.initiative.resets')}
        value={current.resets}
        onChange={(resets) => set({ resets })}
      />
    </div>
  )
}
