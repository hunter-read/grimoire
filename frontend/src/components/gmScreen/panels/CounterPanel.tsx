import { useTranslation } from 'react-i18next'
import Pips from '../../characters/Pips'
import { counterConfig } from '../types'
import type { PanelBodyProps } from './panelProps'
import Stepper from './Stepper'

/** One number the GM tracks all session: Fear, Malice, a doom track. */
export default function CounterPanel({ panel, onState }: PanelBodyProps) {
  const { t } = useTranslation()
  const config = counterConfig(panel.config)
  const value = typeof panel.state.value === 'number' ? panel.state.value : config.start
  const label = panel.title || t('gmScreen.kinds.counter')

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
      }}
    >
      {config.style === 'pips' && config.max !== null ? (
        <>
          <Pips
            count={config.max - config.min}
            used={value - config.min}
            label={label}
            onChange={(used) => onState({ value: config.min + used })}
          />
          <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>
            {t('gmScreen.counter.ofMax', { value, max: config.max })}
          </span>
        </>
      ) : (
        <Stepper
          size="large"
          value={value}
          label={label}
          min={config.min}
          max={config.max}
          onChange={(next) => onState({ value: next })}
        />
      )}
      {config.max !== null && config.style !== 'pips' && (
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {t('gmScreen.counter.range', { min: config.min, max: config.max })}
        </span>
      )}
    </div>
  )
}
