import PromptStepChoose from './PromptStepChoose'
import PromptStepDistribute from './PromptStepDistribute'
import PromptStepEntry from './PromptStepEntry'
import PromptStepNumber from './PromptStepNumber'
import PromptStepSelect from './PromptStepSelect'
import type { StepControlProps } from './promptStepShared'

/** The control for one step of a prompt, by its type. */
export default function PromptStepControl(props: StepControlProps) {
  switch (props.step.type) {
    case 'choose':
      return <PromptStepChoose {...props} />
    case 'distribute':
      return <PromptStepDistribute {...props} />
    case 'entry':
      return <PromptStepEntry {...props} />
    case 'number':
      return <PromptStepNumber {...props} />
    case 'select':
      return <PromptStepSelect {...props} />
    default:
      return null
  }
}
