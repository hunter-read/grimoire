import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuTrash2, LuPlus } from 'react-icons/lu'
import api from '../../api'
import Spinner from '../Spinner'

const GROUPS = ['Dice', 'Cards', 'Other', 'Custom']

/**
 * Admin manager for the dice / materials lookup list. Each entry has a name and
 * a group ("Dice", "Cards", "Other", "Custom"); the display is grouped and new
 * entries pick their group. Removing an in-use value confirms first (force=true).
 */
export default function DiceMaterialManagerSection() {
  const { t } = useTranslation()
  const [items, setItems] = useState(null)
  const [name, setName] = useState('')
  const [group, setGroup] = useState('Custom')
  const [confirm, setConfirm] = useState(null)
  const [error, setError] = useState('')

  const load = () => {
    api
      .get('/dice-materials')
      .then((r) => setItems(r.dice_materials || []))
      .catch(() => setItems([]))
  }

  useEffect(load, [])

  const add = () => {
    if (!name.trim()) return
    setError('')
    api
      .post('/dice-materials', { name: name.trim(), group })
      .then(() => {
        setName('')
        load()
      })
      .catch((e) => setError(e?.message || t('lookupSettings.addFailed')))
  }

  const remove = (item, force = false) => {
    api
      .delete(`/dice-materials/${item.id}${force ? '?force=true' : ''}`)
      .then(() => {
        setConfirm(null)
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
  const byGroup = {}
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

      {error && <div style={{ color: '#e07070', fontSize: 13, marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {orderedGroups.map((g) => (
          <div key={g}>
            <div
              style={{
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'var(--text-muted)',
                fontWeight: 600,
                marginBottom: 6,
              }}
            >
              {t(`lookupSettings.diceGroup.${g.toLowerCase()}`, { defaultValue: g })}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {byGroup[g].map((item) => (
                <span
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
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {confirm && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
        >
          <div
            style={{
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: 24,
              maxWidth: 420,
            }}
          >
            <h4 style={{ fontSize: 16, marginBottom: 10 }}>
              {t('lookupSettings.removeTitle', { name: confirm.name })}
            </h4>
            <p
              style={{ fontSize: 14, color: 'var(--text-dim)', lineHeight: 1.6, marginBottom: 20 }}
            >
              {t('lookupSettings.inUseWarning', { name: confirm.name, count: confirm.count })}
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setConfirm(null)}
                style={{
                  padding: '6px 14px',
                  borderRadius: 6,
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-dim)',
                  cursor: 'pointer',
                }}
              >
                {t('lookupSettings.cancel')}
              </button>
              <button
                type="button"
                onClick={() => remove({ id: confirm.id, name: confirm.name }, true)}
                style={{
                  padding: '6px 14px',
                  borderRadius: 6,
                  background: '#c0504d',
                  border: 'none',
                  color: '#fff',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                {t('lookupSettings.confirmRemove')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
