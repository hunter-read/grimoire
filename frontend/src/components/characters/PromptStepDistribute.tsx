import { useTranslation } from 'react-i18next'
import { LuMinus, LuPlus } from 'react-icons/lu'
import { iconBtn } from './characterStyles'
import { stepOptions, stepPatterns } from './sheetPrompts'
import { optionList } from './promptStepShared'
import type { StepControlProps } from './promptStepShared'

// Points spread over the options in one of the patterns allowed: an ability
// increase of +2 to one or +1 to two.
export default function DistributeStep({
  step,
  value,
  context,
  document,
  onAnswer,
}: StepControlProps) {
  const { t } = useTranslation()
  const spread: Record<string, number> =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, number>)
      : {}
  const patterns = stepPatterns(step)
  const most = Math.max(0, ...patterns.flat())
  const total = Math.max(0, ...patterns.map((pattern) => pattern.reduce((a, b) => a + b, 0)))
  const used = Object.values(spread).reduce((a, b) => a + (Number(b) || 0), 0)
  const options = stepOptions(step, context, document)
  const change = (option: string, delta: number) => {
    const next = { ...spread, [option]: (Number(spread[option]) || 0) + delta }
    if (next[option] <= 0) delete next[option]
    onAnswer(Object.keys(next).length ? next : undefined)
  }
  const shown = (step.patterns || []).map((pattern) =>
    pattern
      .split(',')
      .map((amount) => `+${amount}`)
      .join('/')
  )
  return (
    <>
      <p role="status" style={{ margin: 0, fontSize: 13, color: 'var(--text-dim)' }}>
        {t('characters.promptPatterns', { patterns: shown.join(' · '), count: total - used })}
      </p>
      <ul style={optionList}>
        {options.map((option) => {
          const amount = Number(spread[option.value]) || 0
          return (
            <li
              key={option.value}
              style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}
            >
              <span style={{ flex: 1 }}>{option.label}</span>
              <button
                type="button"
                style={iconBtn}
                aria-label={t('characters.promptLess', { name: option.label })}
                disabled={amount <= 0}
                onClick={() => change(option.value, -1)}
              >
                <LuMinus size={14} />
              </button>
              <span style={{ minWidth: 24, textAlign: 'center' }}>
                {amount ? `+${amount}` : '0'}
              </span>
              <button
                type="button"
                style={iconBtn}
                aria-label={t('characters.promptMore', { name: option.label })}
                disabled={amount >= most || used >= total}
                onClick={() => change(option.value, 1)}
              >
                <LuPlus size={14} />
              </button>
            </li>
          )
        })}
      </ul>
    </>
  )
}
