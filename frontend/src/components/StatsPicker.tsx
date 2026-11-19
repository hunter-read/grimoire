import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { LuGripVertical } from 'react-icons/lu'
import { MAX_SIDEBAR_STATS, STAT_GROUPS, STAT_LABEL_KEYS, type StatId } from '../lib/sidebarStats'

export interface StatsPickerProps {
  value: StatId[]
  onChange: (next: StatId[]) => void
  disabled?: boolean
}

const subheading: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  margin: '0 0 6px',
  padding: 0,
}

/**
 * Choose up to ten library stats and put them in order. The stats are ticked
 * in groups laid out in columns; the ticked ones are listed above in the order
 * they show, dragged by their handle. The handle also moves its stat with the
 * up and down arrow keys - the drag-free way WCAG 2.5.7 asks for - and focus
 * follows the stat to its new place.
 */
export default function StatsPicker({ value, onChange, disabled = false }: StatsPickerProps) {
  const { t } = useTranslation()
  const ids = useId()
  const full = value.length >= MAX_SIDEBAR_STATS

  const dragFrom = useRef<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  const grips = useRef<(HTMLButtonElement | null)[]>([])
  const [focusRow, setFocusRow] = useState<number | null>(null)
  const [announcement, setAnnouncement] = useState('')

  useEffect(() => {
    if (focusRow === null) return
    grips.current[focusRow]?.focus()
    setFocusRow(null)
  }, [focusRow, value])

  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= value.length) return false
    const next = [...value]
    const [stat] = next.splice(from, 1)
    next.splice(to, 0, stat)
    onChange(next)
    setAnnouncement(t('stats.moved', { position: to + 1, total: value.length }))
    return true
  }

  const onDrop = (to: number) => {
    const from = dragFrom.current
    dragFrom.current = null
    setDragOver(null)
    if (from !== null) move(from, to)
  }

  const toggle = (id: StatId) =>
    onChange(value.includes(id) ? value.filter((stat) => stat !== id) : [...value, id])

  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 4px' }}>
        {t('stats.chosenCount', { count: value.length, max: MAX_SIDEBAR_STATS })}
        {full && ` - ${t('stats.fullHint')}`}
      </p>
      <p id={`${ids}-hint`} style={{ fontSize: 12, color: 'var(--text-dim)', margin: '0 0 8px' }}>
        {t('stats.reorderHint')}
      </p>

      {value.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: '0 0 16px' }}>
          {t('stats.noneChosen')}
        </p>
      ) : (
        <ol
          aria-label={t('stats.chosenList')}
          style={{
            listStyle: 'none',
            padding: 0,
            margin: '0 0 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            maxWidth: 360,
          }}
        >
          {value.map((id, index) => {
            const name = t(STAT_LABEL_KEYS[id])
            return (
              <li
                key={id}
                onDragOver={(e) => {
                  if (dragFrom.current === null) return
                  e.preventDefault()
                  if (dragOver !== index) setDragOver(index)
                }}
                onDrop={() => onDrop(index)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '5px 8px',
                  fontSize: 13,
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  borderTop:
                    dragOver === index ? '2px solid var(--gold)' : '1px solid var(--border)',
                }}
              >
                <button
                  type="button"
                  ref={(el) => {
                    grips.current[index] = el
                  }}
                  draggable={!disabled}
                  disabled={disabled}
                  aria-label={t('stats.reorder', { name })}
                  aria-describedby={`${ids}-hint`}
                  title={t('stats.reorder', { name })}
                  onKeyDown={(e) => {
                    const to =
                      e.key === 'ArrowUp' ? index - 1 : e.key === 'ArrowDown' ? index + 1 : index
                    if (move(index, to)) {
                      e.preventDefault()
                      setFocusRow(to)
                    }
                  }}
                  onDragStart={(e) => {
                    dragFrom.current = index
                    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragEnd={() => {
                    dragFrom.current = null
                    setDragOver(null)
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    color: 'var(--text-muted)',
                    cursor: disabled ? 'default' : 'grab',
                  }}
                >
                  <LuGripVertical size={15} />
                </button>
                <span style={{ color: 'var(--text-dim)', minWidth: 16 }}>{index + 1}.</span>
                <span style={{ flex: 1 }}>{name}</span>
              </li>
            )
          })}
        </ol>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
          gap: '16px 24px',
        }}
      >
        {STAT_GROUPS.map((group) => (
          <fieldset key={group.labelKey} style={{ border: 'none', margin: 0, padding: 0 }}>
            <legend style={subheading}>{t(group.labelKey)}</legend>
            {group.stats.map((id) => {
              const checked = value.includes(id)
              const locked = disabled || (!checked && full)
              return (
                <label
                  key={id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '3px 0',
                    fontSize: 13,
                    cursor: locked ? 'default' : 'pointer',
                    color: locked && !checked ? 'var(--text-dim)' : undefined,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={locked}
                    onChange={() => toggle(id)}
                  />
                  {t(STAT_LABEL_KEYS[id])}
                </label>
              )
            })}
          </fieldset>
        ))}
      </div>

      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
    </div>
  )
}
