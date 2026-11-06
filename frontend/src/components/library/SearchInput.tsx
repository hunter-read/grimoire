import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import type { CSSProperties, Ref } from 'react'
import { LuSearch, LuX } from 'react-icons/lu'

export interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  ariaLabel?: string
  style?: CSSProperties
  /** The input itself, for a page that focuses it from a shortcut. */
  inputRef?: Ref<HTMLInputElement>
  /** A key that jumps here (useSlashToSearch), shown in the empty box. */
  shortcut?: string
}

/**
 * Compact, standalone search box (magnifier icon + clear button) matching the
 * system-detail search bar. Used to keep title/name search visible outside the
 * filter modal for the media galleries.
 */
export default function SearchInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  style,
  inputRef,
  shortcut,
}: SearchInputProps) {
  const { t } = useTranslation()
  const [focused, setFocused] = useState(false)
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
        ref={inputRef}
        type="text"
        aria-label={ariaLabel || placeholder}
        aria-keyshortcuts={shortcut}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        style={{
          width: '100%',
          fontSize: 13,
          padding: '6px 28px 6px 30px',
          borderRadius: 6,
          border: '1px solid var(--border-control)',
          background: 'var(--bg-card)',
          boxSizing: 'border-box',
        }}
      />
      {shortcut && !value && !focused && (
        <kbd
          aria-hidden="true"
          className="search-shortcut-hint"
          style={{
            position: 'absolute',
            right: 8,
            top: '50%',
            transform: 'translateY(-50%)',
            minWidth: 18,
            padding: '0 5px',
            borderRadius: 4,
            border: '1px solid var(--border-light)',
            fontSize: 11,
            lineHeight: '16px',
            textAlign: 'center',
            fontFamily: 'inherit',
            color: 'var(--text-muted)',
            pointerEvents: 'none',
          }}
        >
          {shortcut}
        </kbd>
      )}
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label={t('common.clearSearch')}
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
