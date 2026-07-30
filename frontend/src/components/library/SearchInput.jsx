import { LuSearch, LuX } from 'react-icons/lu'

/**
 * Compact, standalone search box (magnifier icon + clear button) matching the
 * system-detail search bar. Used to keep title/name search visible outside the
 * filter modal for the media galleries.
 */
export default function SearchInput({ value, onChange, placeholder, ariaLabel, style }) {
  return (
    <div style={{ position: 'relative', ...style }}>
      <LuSearch
        size={13}
        style={{
          position: 'absolute',
          left: 10,
          top: '50%',
          transform: 'translateY(-50%)',
          color: 'var(--text-muted)',
          pointerEvents: 'none',
        }}
      />
      <input
        type="text"
        aria-label={ariaLabel || placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%',
          fontSize: 13,
          padding: '6px 28px 6px 30px',
          borderRadius: 6,
          border: '1px solid var(--border)',
          background: 'var(--bg-card)',
          boxSizing: 'border-box',
        }}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          style={{
            position: 'absolute',
            right: 8,
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-muted)',
            display: 'flex',
            padding: 0,
          }}
        >
          <LuX size={12} />
        </button>
      )}
    </div>
  )
}
