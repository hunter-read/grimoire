import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { LuMinus, LuPlus } from 'react-icons/lu'
import { iconBtn } from '../../characters/characterStyles'

interface StepperProps {
  value: number
  label: string
  min?: number
  max?: number | null
  onChange: (value: number) => void
  size?: 'large' | 'small'
}

const step: CSSProperties = { ...iconBtn, border: '1px solid var(--border)', borderRadius: 6 }

/** A number stepped down and up - Fear spent and gained, a pool's tokens. */
export default function Stepper({
  value,
  label,
  min,
  max,
  onChange,
  size = 'small',
}: StepperProps) {
  const { t } = useTranslation()
  const atMin = typeof min === 'number' && value <= min
  const atMax = typeof max === 'number' && value >= max
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <button
        type="button"
        aria-label={t('gmScreen.stepper.decrease', { label })}
        disabled={atMin}
        onClick={() => onChange(value - 1)}
        style={step}
      >
        <LuMinus size={size === 'large' ? 18 : 13} aria-hidden="true" />
      </button>
      <output
        aria-label={label}
        aria-live="polite"
        style={{
          minWidth: size === 'large' ? 56 : 28,
          textAlign: 'center',
          fontSize: size === 'large' ? 36 : 15,
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </output>
      <button
        type="button"
        aria-label={t('gmScreen.stepper.increase', { label })}
        disabled={atMax}
        onClick={() => onChange(value + 1)}
        style={step}
      >
        <LuPlus size={size === 'large' ? 18 : 13} aria-hidden="true" />
      </button>
    </span>
  )
}
