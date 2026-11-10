import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuPlus, LuTrash2 } from 'react-icons/lu'
import { fieldInput, ghostBtn, iconBtn } from '../../characters/characterStyles'
import { items, rowId, type Pool } from '../types'
import InlineText from './InlineText'
import type { PanelBodyProps } from './panelProps'
import Stepper from './Stepper'

/**
 * Named pools of tokens several foes share, added to and spent as they act.
 * Clearing the board for a new scene empties the pools but keeps them set up.
 */
export default function PoolsPanel({ panel, onState }: PanelBodyProps) {
  const { t } = useTranslation()
  const pools = items<Pool>(panel.state)
  const [name, setName] = useState('')

  const save = (next: Pool[]) => onState({ items: next })
  const update = (id: string, patch: Partial<Pool>) =>
    save(pools.map((pool) => (pool.id === id ? { ...pool, ...patch } : pool)))

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {pools.length === 0 && (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
          {t('gmScreen.pools.empty')}
        </p>
      )}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
        {pools.map((pool) => {
          const label = pool.name || t('gmScreen.pools.unnamed')
          return (
            <li key={pool.id} style={{ display: 'grid', gap: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <InlineText
                  value={pool.name}
                  label={t('gmScreen.pools.name')}
                  placeholder={t('gmScreen.pools.unnamed')}
                  onCommit={(value) => update(pool.id, { name: value })}
                  style={{ fontWeight: 600 }}
                />
                <Stepper
                  value={pool.tokens}
                  label={label}
                  min={0}
                  onChange={(tokens) => update(pool.id, { tokens: Math.max(0, tokens) })}
                />
                <button
                  type="button"
                  onClick={() => save(pools.filter((other) => other.id !== pool.id))}
                  aria-label={t('gmScreen.pools.remove', { name: label })}
                  style={iconBtn}
                >
                  <LuTrash2 size={14} aria-hidden="true" />
                </button>
              </div>
              <InlineText
                value={pool.note}
                label={t('gmScreen.pools.note')}
                placeholder={t('gmScreen.pools.notePlaceholder')}
                maxLength={500}
                onCommit={(value) => update(pool.id, { note: value })}
                style={{ fontSize: 12, color: 'var(--text-dim)' }}
              />
            </li>
          )
        })}
      </ul>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          save([...pools, { id: rowId(), name: name.trim(), tokens: 0, note: '' }])
          setName('')
        }}
        style={{ display: 'flex', gap: 6 }}
      >
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-label={t('gmScreen.pools.newName')}
          placeholder={t('gmScreen.pools.newName')}
          maxLength={120}
          style={{ ...fieldInput, flex: 1, padding: '5px 8px' }}
        />
        <button
          type="submit"
          style={{ ...ghostBtn, padding: '5px 10px' }}
          disabled={pools.length >= 50}
        >
          <LuPlus size={14} aria-hidden="true" /> {t('gmScreen.pools.add')}
        </button>
      </form>
    </div>
  )
}
