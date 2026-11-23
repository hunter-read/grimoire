import { useTranslation } from 'react-i18next'
import { chooseTarget, ownedValues, stepOptions } from './sheetPrompts'
import { optionLabel, optionList } from './promptStepShared'
import type { StepControlProps } from './promptStepShared'

// `count` values, leaving out those the target already has: the `choose` of
// an `on_pick` rule, as one step of a prompt.
export default function ChooseStep({
  step,
  value,
  context,
  document,
  data,
  onAnswer,
}: StepControlProps) {
  const { t } = useTranslation()
  const picked = Array.isArray(value) ? value.map(String) : []
  const owned = ownedValues(step, data)
  const options = stepOptions(step, context, document)
  const wanted = chooseTarget(step, context, document, data)
  const remaining = Math.max(0, wanted - picked.length)
  const toggle = (option: string) =>
    onAnswer(
      picked.includes(option)
        ? picked.filter((item) => item !== option)
        : picked.length < wanted
          ? [...picked, option]
          : picked
    )
  return (
    <>
      <p role="status" style={{ margin: 0, fontSize: 13, color: 'var(--text-dim)' }}>
        {t('characters.chooseRemaining', { count: remaining })}
      </p>
      <ul style={optionList}>
        {options.map((option) => {
          const already = owned.has(option.value)
          const selected = picked.includes(option.value)
          const full = !selected && remaining === 0
          return (
            <li key={option.value}>
              <label style={optionLabel(already || full)}>
                <input
                  type="checkbox"
                  checked={selected || already}
                  disabled={already || full}
                  onChange={() => toggle(option.value)}
                />
                {option.label}
                {already ? (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {t('characters.alreadyHave')}
                  </span>
                ) : null}
              </label>
            </li>
          )
        })}
      </ul>
    </>
  )
}
