import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuArrowDown, LuArrowUp, LuPlus, LuTrash2 } from 'react-icons/lu'
import {
  fieldInput,
  fieldLabel,
  ghostBtn,
  helpText,
  iconBtn,
} from '../../characters/characterStyles'
import type { SettingsProps } from '../GmPanelFrame'
import { useGmScreenContext } from '../gmScreenContext'
import { partyConfig, type PartyStat } from '../types'

const MAX_STATS = 12

/**
 * Which stats each party card shows, in order. A stat reads a field or a
 * computed value from the sheets; drawn as boxes, it needs a second value -
 * or a number - for how many.
 */
export default function PartySettings({ config, onChange }: SettingsProps) {
  const { t } = useTranslation()
  const { party } = useGmScreenContext()
  const current = partyConfig(config)
  const [adding, setAdding] = useState('')
  const set = (patch: Partial<typeof current>) => onChange({ ...current, ...patch })
  const setStats = (stats: PartyStat[]) => set({ stats })
  const updateStat = (index: number, patch: Partial<PartyStat>) =>
    setStats(current.stats.map((stat, i) => (i === index ? { ...stat, ...patch } : stat)))
  const move = (index: number, by: number) => {
    const stats = [...current.stats]
    const [stat] = stats.splice(index, 1)
    stats.splice(index + by, 0, stat)
    setStats(stats)
  }
  const numberFields = party.fields.filter((field) => field.type === 'number')

  if (!party.fields.length) {
    return <p style={helpText}>{t('gmScreen.party.noFields')}</p>
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
        {current.stats.map((stat, index) => (
          <li
            key={`${stat.value}-${index}`}
            style={{
              display: 'grid',
              gap: 6,
              gridTemplateColumns: '1fr 1fr auto',
              alignItems: 'end',
            }}
          >
            <label style={fieldLabel}>
              {t('gmScreen.party.statLabel')}
              <input
                value={stat.label}
                maxLength={60}
                onChange={(event) => updateStat(index, { label: event.target.value })}
                style={fieldInput}
              />
            </label>
            <label style={fieldLabel}>
              {t('gmScreen.party.statStyle')}
              <select
                value={stat.style === 'pips' ? `pips:${stat.max ?? ''}` : 'number'}
                onChange={(event) => {
                  const [style, max] = event.target.value.split(':')
                  updateStat(
                    index,
                    style === 'pips'
                      ? { style: 'pips', max: max || null }
                      : { style: 'number', max: null }
                  )
                }}
                style={fieldInput}
              >
                <option value="number">{t('gmScreen.party.styleNumber')}</option>
                {numberFields
                  .filter((field) => field.name !== stat.value)
                  .map((field) => (
                    <option key={field.name} value={`pips:${field.name}`}>
                      {t('gmScreen.party.stylePipsOf', { field: field.label })}
                    </option>
                  ))}
              </select>
            </label>
            <span style={{ display: 'flex' }}>
              <button
                type="button"
                disabled={index === 0}
                onClick={() => move(index, -1)}
                aria-label={t('gmScreen.party.moveUp', { stat: stat.label })}
                style={iconBtn}
              >
                <LuArrowUp size={14} aria-hidden="true" />
              </button>
              <button
                type="button"
                disabled={index === current.stats.length - 1}
                onClick={() => move(index, 1)}
                aria-label={t('gmScreen.party.moveDown', { stat: stat.label })}
                style={iconBtn}
              >
                <LuArrowDown size={14} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setStats(current.stats.filter((_, i) => i !== index))}
                aria-label={t('gmScreen.party.removeStat', { stat: stat.label })}
                style={iconBtn}
              >
                <LuTrash2 size={14} aria-hidden="true" />
              </button>
            </span>
          </li>
        ))}
      </ol>
      {current.stats.length < MAX_STATS && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'end' }}>
          <label style={{ ...fieldLabel, flex: 1 }}>
            {t('gmScreen.party.addStat')}
            <select
              value={adding}
              onChange={(event) => setAdding(event.target.value)}
              style={fieldInput}
            >
              <option value="">{t('gmScreen.party.pickField')}</option>
              {party.fields.map((field) => (
                <option key={field.name} value={field.name}>
                  {field.label}
                  {field.source === 'computed' ? ` (${t('gmScreen.party.computed')})` : ''}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!adding}
            onClick={() => {
              const field = party.fields.find((one) => one.name === adding)
              if (!field) return
              setStats([
                ...current.stats,
                { label: field.label, value: field.name, max: null, style: 'number' },
              ])
              setAdding('')
            }}
            style={{ ...ghostBtn, padding: '7px 10px' }}
          >
            <LuPlus size={14} aria-hidden="true" /> {t('gmScreen.party.add')}
          </button>
        </div>
      )}
      <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
        <input
          type="checkbox"
          checked={current.include_inactive}
          onChange={(event) => set({ include_inactive: event.target.checked })}
        />
        {t('gmScreen.party.includeInactive')}
      </label>
    </div>
  )
}
