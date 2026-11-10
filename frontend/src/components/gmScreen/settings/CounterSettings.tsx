import { useTranslation } from 'react-i18next'
import { fieldInput, fieldLabel } from '../../characters/characterStyles'
import type { SettingsProps } from '../GmPanelFrame'
import { counterConfig } from '../types'
import NumberSetting from './NumberSetting'
import ResetSelect from './ResetSelect'

/** A counter's range, where it starts, how it is drawn and when it resets. */
export default function CounterSettings({ config, onChange }: SettingsProps) {
  const { t } = useTranslation()
  const current = counterConfig(config)
  const set = (patch: Partial<typeof current>) => onChange({ ...current, ...patch })
  return (
    <div
      style={{
        display: 'grid',
        gap: 10,
        gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
      }}
    >
      <NumberSetting
        label={t('gmScreen.counter.min')}
        value={current.min}
        onChange={(min) => set({ min: min ?? 0 })}
      />
      <NumberSetting
        label={t('gmScreen.counter.max')}
        value={current.max}
        optional
        placeholder={t('gmScreen.counter.noMax')}
        onChange={(max) => set({ max })}
      />
      <NumberSetting
        label={t('gmScreen.counter.start')}
        value={current.start}
        onChange={(start) => set({ start: start ?? 0 })}
      />
      <label style={fieldLabel}>
        {t('gmScreen.counter.style')}
        <select
          value={current.style}
          onChange={(event) => set({ style: event.target.value === 'pips' ? 'pips' : 'number' })}
          style={fieldInput}
        >
          <option value="number">{t('gmScreen.counter.styleNumber')}</option>
          <option value="pips">{t('gmScreen.counter.stylePips')}</option>
        </select>
      </label>
      <ResetSelect value={current.resets} onChange={(resets) => set({ resets })} />
    </div>
  )
}
