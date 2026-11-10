import { useTranslation } from 'react-i18next'
import type { SettingsProps } from '../GmPanelFrame'
import ResetSelect from './ResetSelect'

/** When the pools empty. The pools themselves stay set up. */
export default function PoolsSettings({ config, onChange }: SettingsProps) {
  const { t } = useTranslation()
  return (
    <ResetSelect
      label={t('gmScreen.pools.resets')}
      value={config.resets}
      onChange={(resets) => onChange({ ...config, resets })}
    />
  )
}
