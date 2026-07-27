import { useTranslation } from 'react-i18next'
import ToggleSwitch from '../ToggleSwitch'

/**
 * Toggles the SystemDetailView book list between category-grouped (the default)
 * and a single flat list. Rendered as a clickable pill with the label first and
 * the switch second; clicking anywhere on the pill flips it. Sort/filter state
 * is unaffected by toggling.
 */
export default function CategoryGroupToggle({ grouped, onToggle }) {
  const { t } = useTranslation()
  return (
    <ToggleSwitch
      id="category-group-toggle"
      checked={grouped}
      onChange={onToggle}
      labelFirst
      pill
      label={
        <span style={{ fontSize: 13, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
          {t('systemDetail.groupByCategory')}
        </span>
      }
    />
  )
}
