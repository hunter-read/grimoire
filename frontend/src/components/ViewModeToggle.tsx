import { useTranslation } from 'react-i18next'
import { LuLayoutGrid, LuGrid2X2, LuList } from 'react-icons/lu'

export const MODE_ICON = { card: LuLayoutGrid, compact: LuGrid2X2, list: LuList }

/**
 * Single button that cycles the shared view mode card → compact → list → card.
 * Styled to match the favorites (heart) toggle it sits beside.
 */
export default function ViewModeToggle({ mode, onCycle, style }) {
  const { t } = useTranslation()
  const Icon = MODE_ICON[mode] || LuLayoutGrid
  return (
    <button
      onClick={onCycle}
      title={t('library.viewMode.toggle')}
      aria-label={t('library.viewMode.toggleWithMode', { mode: t(`library.viewMode.${mode}`) })}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '6px 10px',
        borderRadius: 6,
        border: '1px solid var(--border)',
        background: 'var(--bg-card)',
        color: 'var(--text-muted)',
        fontSize: 13,
        cursor: 'pointer',
        transition: 'all 0.15s',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      <Icon size={16} />
    </button>
  )
}
