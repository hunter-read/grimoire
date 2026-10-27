import { useTranslation } from 'react-i18next'
import { LuChevronDown, LuChevronRight } from 'react-icons/lu'

// A collapsible section of the key editor. Its header says how many of its
// areas the key reaches, so a closed group still shows what it grants.
export default function ApiKeyPermissionGroup({ id, open, onToggle, granted, total, children }) {
  const { t } = useTranslation()
  const label = t(`appSettings.apiKeys.groups.${id}`, id)
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
      <button
        type="button"
        onClick={() => onToggle(id)}
        aria-expanded={open}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          padding: '10px 12px',
          background: 'var(--bg-card)',
          border: 'none',
          borderBottom: open ? '1px solid var(--border)' : 'none',
          color: 'var(--text)',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        {open ? <LuChevronDown size={16} /> : <LuChevronRight size={16} />}
        <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{label}</span>
        <span
          style={{
            fontSize: 12,
            color: granted > 0 ? 'var(--gold)' : 'var(--text-muted)',
          }}
        >
          {t('appSettings.apiKeys.dialog.groupCount', { granted, total })}
        </span>
      </button>
      {open && <div>{children}</div>}
    </div>
  )
}
