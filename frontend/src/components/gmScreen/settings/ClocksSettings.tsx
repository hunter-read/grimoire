import { useTranslation } from 'react-i18next'
import { fieldInput, fieldLabel } from '../../characters/characterStyles'
import type { SettingsProps } from '../GmPanelFrame'

/** Whether rows count down what is left or up what is filled. */
export default function ClocksSettings({ config, onChange }: SettingsProps) {
  const { t } = useTranslation()
  return (
    <label style={fieldLabel}>
      {t('gmScreen.clocks.mode')}
      <select
        value={config.mode === 'clock' ? 'clock' : 'countdown'}
        onChange={(event) => onChange({ ...config, mode: event.target.value })}
        style={fieldInput}
      >
        <option value="countdown">{t('gmScreen.clocks.modeCountdown')}</option>
        <option value="clock">{t('gmScreen.clocks.modeClock')}</option>
      </select>
    </label>
  )
}
