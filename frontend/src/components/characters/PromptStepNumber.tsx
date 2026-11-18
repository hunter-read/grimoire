import { useTranslation } from 'react-i18next'
import { fieldInput, ghostBtn } from './characterStyles'
import { clampNumber, numberAverage } from './sheetPrompts'
import type { StepControlProps } from './promptStepShared'

// A number, from its default; «Use average» puts the average in.
export default function NumberStep({ step, value, context, onAnswer }: StepControlProps) {
  const { t } = useTranslation()
  const average = numberAverage(step, context)
  const current = typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <input
        type="number"
        inputMode="numeric"
        value={current}
        min={step.min}
        max={step.max}
        aria-label={step.label || step.key}
        onChange={(event) => {
          const raw = event.target.value
          if (raw === '') return onAnswer(undefined)
          const number = Number(raw)
          onAnswer(Number.isFinite(number) ? clampNumber(step, number) : undefined)
        }}
        style={{ ...fieldInput, maxWidth: 120 }}
      />
      {average !== undefined ? (
        <button type="button" style={ghostBtn} onClick={() => onAnswer(average)}>
          {t('characters.promptUseAverage', { value: average })}
        </button>
      ) : null}
    </div>
  )
}
