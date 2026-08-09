import { useTranslation } from 'react-i18next'
import { LuListChecks } from 'react-icons/lu'
import ToolbarButton from './ToolbarButton'
import useIsMobile from '../hooks/useIsMobile'

/**
 * Shared "Select" / "Cancel" toggle used on every library-style page.
 * Keeps a stable width regardless of state (the label swaps between two words)
 * and standardizes the off-state label to "Cancel" across all pages.
 *
 * On mobile the label collapses to the icon alone so the toolbar row it lives
 * in stays on a single line; the text moves to aria-label/title so the
 * control keeps its accessible name.
 */
export default function BulkToggleButton({ active, onToggle, style }) {
  const { t } = useTranslation()
  const isMobile = useIsMobile()
  const label = active ? t('common.cancel') : t('common.select')
  return (
    <ToolbarButton
      icon={<LuListChecks size={13} />}
      label={isMobile ? null : label}
      ariaLabel={label}
      title={label}
      onClick={onToggle}
      active={active}
      minWidth={isMobile ? undefined : 96}
      style={style}
    />
  )
}
