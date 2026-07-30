import { useTranslation } from 'react-i18next'
import { LuListChecks } from 'react-icons/lu'
import ToolbarButton from './ToolbarButton'

/**
 * Shared "Select" / "Cancel" toggle used on every library-style page.
 * Keeps a stable width regardless of state (the label swaps between two words)
 * and standardizes the off-state label to "Cancel" across all pages.
 */
export default function BulkToggleButton({ active, onToggle, style }) {
  const { t } = useTranslation()
  return (
    <ToolbarButton
      icon={<LuListChecks size={13} />}
      label={active ? t('common.cancel') : t('common.select')}
      onClick={onToggle}
      active={active}
      minWidth={96}
      style={style}
    />
  )
}
