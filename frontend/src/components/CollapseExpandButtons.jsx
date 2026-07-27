import { useTranslation } from 'react-i18next'
import ToolbarButton from './ToolbarButton'

/**
 * Shared "Collapse All" / "Expand All" pair used by the system detail and media
 * gallery toolbars. Each button disables when the action would be a no-op.
 */
export default function CollapseExpandButtons({
  onCollapseAll,
  onExpandAll,
  collapseDisabled = false,
  expandDisabled = false,
}) {
  const { t } = useTranslation()
  return (
    <>
      <ToolbarButton
        label={t('common.collapseAll')}
        onClick={onCollapseAll}
        disabled={collapseDisabled}
      />
      <ToolbarButton
        label={t('common.expandAll')}
        onClick={onExpandAll}
        disabled={expandDisabled}
      />
    </>
  )
}
