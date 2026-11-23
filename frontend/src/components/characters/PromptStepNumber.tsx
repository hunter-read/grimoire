import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fieldInput, ghostBtn } from './characterStyles'
import { clampNumber, numberAverage } from './sheetPrompts'
import type { StepControlProps } from './promptStepShared'

// A number, from its default; «Use average» puts the average in.
export default function NumberStep({ step, value, context, onAnswer }: StepControlProps) {
  const { t } = useTranslation()
  const average = numberAverage(step, context)
  const current = typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
  // What is being typed, kept as typed until the input loses focus: clamping
  // each keystroke would turn the "1" of "12" into a `min` of 10 at once.
  // The answer is always the clamped number, so confirming reads a valid one.
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <input
        type="number"
        inputMode="numeric"
        value={draft ?? current}
        min={step.min}
        max={step.max}
        aria-label={step.label || step.key}
        onChange={(event) => {
          const raw = event.target.value
          setDraft(raw)
          if (raw === '') return onAnswer(undefined)
          const number = Number(raw)
          onAnswer(Number.isFinite(number) ? clampNumber(step, number) : undefined)
        }}
        onBlur={() => setDraft(null)}
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
