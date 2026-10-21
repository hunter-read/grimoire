import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCheck } from 'react-icons/lu'

export interface SelectMods {
  shift: boolean
  meta: boolean
}

interface Props {
  /** Whether the view is in select mode; outside it the card renders untouched. */
  active: boolean
  selected: boolean
  /** The item's name, for the toggle's accessible label. */
  label: string
  onToggle: (mods: SelectMods) => void
  children: ReactNode
}

/**
 * Make any card selectable, for views whose cards know nothing about bulk mode
 * (favorites, tag pages, search results - issue #589).
 *
 * In select mode a transparent toggle covers the card, so a click anywhere on
 * it selects rather than navigates - the same contract as the library cards,
 * where selection mode owns the click - and the card itself is left unchanged.
 */
export default function SelectableCard({ active, selected, label, onToggle, children }: Props) {
  const { t } = useTranslation()
  if (!active) return <>{children}</>
  return (
    <div style={{ position: 'relative' }}>
      {children}
      <button
        type="button"
        aria-pressed={selected}
        aria-label={t('bulk.selectItem', { name: label })}
        onClick={(e) => onToggle({ shift: e.shiftKey, meta: e.metaKey || e.ctrlKey })}
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 5,
          padding: 0,
          margin: 0,
          cursor: 'pointer',
          borderRadius: 8,
          background: selected ? 'rgba(212,175,55,0.08)' : 'transparent',
          border: `2px solid ${selected ? 'var(--gold-dim)' : 'transparent'}`,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            width: 20,
            height: 20,
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: selected ? 'var(--gold)' : 'var(--bg-input)',
            border: selected ? 'none' : '2px solid var(--border-light)',
            boxShadow: '0 1px 4px var(--shadow)',
            boxSizing: 'border-box',
          }}
        >
          {selected && <LuCheck size={12} color="var(--bg-deep)" strokeWidth={3} />}
        </span>
      </button>
    </div>
  )
}
