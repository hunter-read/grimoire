import { useTranslation } from 'react-i18next'
import ToggleSwitch from '../ToggleSwitch'

/**
 * Toggles the library grid between showing container folders as single cards
 * (the default) and flattening them so their child systems appear inline.
 *
 * Mirrors the SystemDetailView's CategoryGroupToggle: a clickable pill with the
 * label first and the switch second. Sort/filter state is unaffected by
 * toggling — flattening changes which rows are in the grid, then the existing
 * sort and filters apply to that set as usual.
 */
export default function SystemGroupToggle({ grouped, onToggle }) {
  const { t } = useTranslation()
  return (
    <ToggleSwitch
      id="system-group-toggle"
      checked={grouped}
      onChange={onToggle}
      labelFirst
      pill
      label={
        <span style={{ fontSize: 13, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
          {t('library.groupContainers')}
        </span>
      }
    />
  )
}
