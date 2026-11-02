import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuTrash2, LuPlus } from 'react-icons/lu'
import api from '../../api'
import type { Schema } from '../../api'
import Spinner from '../Spinner'
import ConfirmModal from './ConfirmModal'

type DiceMaterial = Schema<'DiceMaterialOut'>

interface ConfirmState {
  id: string
  name: string
  count: number
}

const GROUPS = ['Dice', 'Cards', 'Other', 'Custom']

/**
 * Admin manager for the dice / materials lookup list. Each entry has a name and
 * a group ("Dice", "Cards", "Other", "Custom"); the display is grouped and new
 * entries pick their group. Removing an in-use value confirms first (force=true).
 */
export default function DiceMaterialManagerSection() {
  const { t } = useTranslation()
  const [items, setItems] = useState<DiceMaterial[] | null>(null)
  const [name, setName] = useState('')
  const [group, setGroup] = useState('Custom')
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [error, setError] = useState('')
  // Said aloud after an add or remove, which otherwise changes the list
  // silently - and a removal takes away the button that was pressed, so focus
  // goes back to the name field once the list has reloaded.
  const [announcement, setAnnouncement] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const refocusInput = useRef(false)

  const load = () => {
    api
      .get('/dice-materials')
      .then((r) => setItems(r.dice_materials || []))
      .catch(() => setItems([]))
  }

  useEffect(load, [])

  useEffect(() => {
    if (!refocusInput.current) return
    refocusInput.current = false
    inputRef.current?.focus()
  }, [items])

  const add = () => {
    if (!name.trim()) return
    setError('')
    api
      .post('/dice-materials', { name: name.trim(), group })
      .then(() => {
        setAnnouncement(t('a11y.settings.added', { name: name.trim() }))
        setName('')
        load()
      })
      .catch((e) => setError(e?.message || t('lookupSettings.addFailed')))
  }

  const remove = (item: Pick<DiceMaterial, 'id' | 'name'>, force = false) => {
    api
      .delete(`/dice-materials/${item.id}${force ? '?force=true' : ''}`)
      .then(() => {
        setConfirm(null)
        setAnnouncement(t('a11y.settings.removed', { name: item.name }))
        refocusInput.current = true
        load()
      })
      .catch((e) => {
        const detail = e?.body?.detail
        if (e?.status === 409 && detail && typeof detail === 'object') {
          setConfirm({
            id: item.id,
            name: detail.name || item.name,
            count: detail.usage_count || 0,
          })
        } else {
          setError(e?.message || t('lookupSettings.removeFailed'))
        }
      })
  }

  if (items === null) return <Spinner size={20} />

  // Group the items for display, preserving the canonical group order with any
  // unexpected groups appended after.
  const byGroup: Record<string, DiceMaterial[]> = {}
  for (const item of items) {
    const g = item.group || 'Custom'
    ;(byGroup[g] = byGroup[g] || []).push(item)
  }
  const orderedGroups = [
    ...GROUPS.filter((g) => byGroup[g]),
    ...Object.keys(byGroup).filter((g) => !GROUPS.includes(g)),
  ]

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder={t('lookupSettings.diceNamePlaceholder')}
          aria-label={t('lookupSettings.diceNamePlaceholder')}
          style={{ flex: '1 1 160px', minWidth: 0 }}
        />
        <select
          value={group}
          onChange={(e) => setGroup(e.target.value)}
          aria-label={t('lookupSettings.diceGroupLabel')}
          style={{ flex: '0 1 140px', minWidth: 0 }}
        >
          {GROUPS.map((g) => (
            <option key={g} value={g}>
              {t(`lookupSettings.diceGroup.${g.toLowerCase()}`, { defaultValue: g })}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={add}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '6px 12px',
            borderRadius: 6,
            background: 'var(--gold-dim)',
            color: 'var(--bg-deep)',
            border: 'none',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          <LuPlus size={13} /> {t('lookupSettings.add')}
        </button>
      </div>

      {error && (
        <div role="alert" style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>
          {error}
        </div>
      )}
      <p role="status" className="sr-only">
        {announcement}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {orderedGroups.map((g) => (
          <div key={g}>
            {/* A heading per group, under the section's h3, so a screen reader
                can jump between Dice, Cards and the rest. */}
            <h4
              id={`dice-group-${g}`}
              style={{
                fontSize: 11,
                fontFamily: 'inherit',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'var(--text-muted)',
                fontWeight: 600,
                margin: '0 0 6px',
              }}
            >
              {t(`lookupSettings.diceGroup.${g.toLowerCase()}`, { defaultValue: g })}
            </h4>
            <ul
              role="list"
              aria-labelledby={`dice-group-${g}`}
              style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                display: 'flex',
                flexWrap: 'wrap',
                gap: 6,
              }}
            >
              {byGroup[g].map((item) => (
                <li
                  key={item.id}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 13,
                    padding: '4px 6px 4px 10px',
                    borderRadius: 16,
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    color: 'var(--text)',
                  }}
                >
                  {item.name}
                  <button
                    type="button"
                    onClick={() => remove(item)}
                    aria-label={`${t('common.remove')} ${item.name}`}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--text-muted)',
                      display: 'flex',
                      padding: 2,
                    }}
                  >
                    <LuTrash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {confirm && (
        <ConfirmModal
          title={t('lookupSettings.removeTitle', { name: confirm.name })}
          message={t('lookupSettings.inUseWarning', { name: confirm.name, count: confirm.count })}
          confirmLabel={t('lookupSettings.confirmRemove')}
          onClose={() => setConfirm(null)}
          onConfirm={() => remove({ id: confirm.id, name: confirm.name }, true)}
        />
      )}
    </div>
  )
}
