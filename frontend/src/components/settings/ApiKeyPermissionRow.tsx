import { useTranslation } from 'react-i18next'
import { rank } from './apiKeyUtils'

const selectStyle = {
  boxSizing: 'border-box',
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg-card)',
  color: 'var(--text)',
  fontSize: 13,
  minWidth: 150,
}

// One permission in the key editor: its name and what it covers, and a level
// picker. `floor` is the All permissions level - levels below it aren't a choice,
// and once it reaches this area's highest level (`covered`) the picker locks.
export default function ApiKeyPermissionRow({ perm, value, floor, covered, onChange, first }) {
  const { t } = useTranslation()
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        padding: '8px 12px',
        borderTop: first ? 'none' : '1px solid var(--border)',
      }}
    >
      <div style={{ flex: '1 1 240px', minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: perm.emphasis ? 600 : undefined }}>
          {perm.label}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.4 }}>
          {perm.description}
        </div>
      </div>
      <select
        aria-label={perm.label}
        value={value}
        disabled={covered}
        onChange={(e) => onChange(perm.id, e.target.value)}
        style={{ ...selectStyle, opacity: covered ? 0.6 : 1 }}
      >
        {perm.levels.map((level) => (
          <option key={level} value={level} disabled={rank(level) < rank(floor)}>
            {t(`appSettings.apiKeys.levels.${level}`)}
          </option>
        ))}
      </select>
    </div>
  )
}
