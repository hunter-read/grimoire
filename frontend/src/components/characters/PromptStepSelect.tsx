import { stepOptions } from './sheetPrompts'
import { optionLabel, optionList } from './promptStepShared'
import type { StepControlProps } from './promptStepShared'

// One option, which may decide the steps after it.
export default function SelectStep({ step, value, context, document, onAnswer }: StepControlProps) {
  const options = stepOptions(step, context, document)
  return (
    <ul style={optionList}>
      {options.map((option) => (
        <li key={option.value}>
          <label style={optionLabel(false)}>
            <input
              type="radio"
              name={`prompt-${step.key}`}
              checked={value === option.value}
              onChange={() => onAnswer(option.value)}
            />
            {option.label}
          </label>
        </li>
      ))}
    </ul>
  )
}
