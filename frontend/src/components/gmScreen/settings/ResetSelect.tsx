import { useTranslation } from 'react-i18next'
import { fieldInput, fieldLabel } from '../../characters/characterStyles'
import { RESET_SCOPES, type ResetScope } from '../types'

interface ResetSelectProps {
  value: unknown
  onChange: (value: ResetScope) => void
  label?: string
}

/** When a panel clears: at the end of a scene or session, at a rest, or never. */
export default function ResetSelect({ value, onChange, label }: ResetSelectProps) {
  const { t } = useTranslation()
  return (
    <label style={fieldLabel}>
      {label ?? t('gmScreen.resets.label')}
      <select
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value as ResetScope)}
        style={fieldInput}
      >
        {RESET_SCOPES.map((scope) => (
          <option key={scope} value={scope}>
            {t(`gmScreen.resets.${scope || 'never'}`)}
          </option>
        ))}
      </select>
    </label>
  )
}
