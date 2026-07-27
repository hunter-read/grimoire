import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuLibrary } from 'react-icons/lu'
import { systemDisplayName } from '../../utils/systemDisplayName'

/**
 * Compact pill for system-agnostic collections — no cover image, sits at the
 * top of the library for quick access.
 */
export default function AgnosticChip({ system, onClick }) {
  const { t } = useTranslation()
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        background: hovered ? 'var(--bg-card-hover)' : 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '8px 14px',
        cursor: 'pointer',
        transition: 'background 0.15s',
      }}
    >
      <LuLibrary size={16} color="var(--gold-dim)" style={{ flexShrink: 0 }} />
      <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>
        {systemDisplayName(system)}
      </span>
      {system.is_explicit && <span style={{ fontSize: 10, color: '#e07070' }}>18+</span>}
      <span
        style={{
          background: 'var(--bg-deep)',
          borderRadius: 20,
          padding: '1px 9px',
          fontSize: 12,
          color: 'var(--text-dim)',
          whiteSpace: 'nowrap',
        }}
      >
        {t('library.bookCount', { count: system.book_count })}
      </span>
    </div>
  )
}
