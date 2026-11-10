import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuPlus, LuRotateCcw, LuTrash2 } from 'react-icons/lu'
import Pips from '../../characters/Pips'
import { fieldInput, ghostBtn, iconBtn } from '../../characters/characterStyles'
import {
  items,
  rowId,
  RESET_SCOPES,
  type Clock,
  type ClocksConfig,
  type ResetScope,
} from '../types'
import InlineText from './InlineText'
import type { PanelBodyProps } from './panelProps'

/**
 * Countdowns and progress clocks, each a row of boxes ticked as things happen.
 *
 * A countdown says how many boxes are left; a clock how many are filled.
 * Either way, a full row has triggered - and a looping one can start again.
 */
export default function ClocksPanel({ panel, onState }: PanelBodyProps) {
  const { t } = useTranslation()
  const mode = (panel.config as Partial<ClocksConfig>).mode === 'clock' ? 'clock' : 'countdown'
  const clocks = items<Clock>(panel.state)
  const [name, setName] = useState('')
  const [size, setSize] = useState(4)

  const save = (next: Clock[]) => onState({ items: next })
  const update = (id: string, patch: Partial<Clock>) =>
    save(clocks.map((clock) => (clock.id === id ? { ...clock, ...patch } : clock)))

  const add = () => {
    save([
      ...clocks,
      { id: rowId(), name: name.trim(), size, ticks: 0, note: '', resets: '', loops: false },
    ])
    setName('')
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {clocks.length === 0 && (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
          {t(`gmScreen.clocks.empty.${mode}`)}
        </p>
      )}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
        {clocks.map((clock) => {
          const label = clock.name || t('gmScreen.clocks.unnamed')
          const triggered = clock.ticks >= clock.size
          return (
            <li
              key={clock.id}
              style={{
                display: 'grid',
                gap: 4,
                borderBottom: '1px solid var(--border)',
                paddingBottom: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <InlineText
                  value={clock.name}
                  label={t('gmScreen.clocks.name')}
                  placeholder={t('gmScreen.clocks.unnamed')}
                  onCommit={(value) => update(clock.id, { name: value })}
                  style={{ fontWeight: 600 }}
                />
                <span
                  style={{
                    fontSize: 12,
                    whiteSpace: 'nowrap',
                    color: triggered ? 'var(--gold)' : 'var(--text-dim)',
                    fontWeight: triggered ? 700 : 400,
                  }}
                >
                  {triggered
                    ? t('gmScreen.clocks.triggered')
                    : mode === 'countdown'
                      ? t('gmScreen.clocks.left', { count: clock.size - clock.ticks })
                      : t('gmScreen.clocks.filled', { ticks: clock.ticks, size: clock.size })}
                </span>
                {triggered && clock.loops && (
                  <button
                    type="button"
                    onClick={() => update(clock.id, { ticks: 0 })}
                    aria-label={t('gmScreen.clocks.loop', { name: label })}
                    style={iconBtn}
                  >
                    <LuRotateCcw size={14} aria-hidden="true" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => save(clocks.filter((other) => other.id !== clock.id))}
                  aria-label={t('gmScreen.clocks.remove', { name: label })}
                  style={iconBtn}
                >
                  <LuTrash2 size={14} aria-hidden="true" />
                </button>
              </div>
              <Pips
                count={clock.size}
                used={clock.ticks}
                label={label}
                onChange={(ticks) => update(clock.id, { ticks })}
              />
              <InlineText
                value={clock.note}
                label={t('gmScreen.clocks.note')}
                placeholder={t('gmScreen.clocks.notePlaceholder')}
                maxLength={500}
                onCommit={(value) => update(clock.id, { note: value })}
                style={{ fontSize: 12, color: 'var(--text-dim)' }}
              />
              <details style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                <summary>{t('gmScreen.clocks.options')}</summary>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', paddingTop: 6 }}>
                  <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                    {t('gmScreen.clocks.boxes')}
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={clock.size}
                      onChange={(event) =>
                        update(clock.id, {
                          size: Math.max(1, Math.min(30, Number(event.target.value) || 1)),
                        })
                      }
                      style={{ ...fieldInput, width: 64, padding: '3px 6px' }}
                    />
                  </label>
                  <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                    {t('gmScreen.resets.label')}
                    <select
                      value={clock.resets}
                      onChange={(event) =>
                        update(clock.id, { resets: event.target.value as ResetScope })
                      }
                      style={{ ...fieldInput, padding: '3px 6px', width: 'auto' }}
                    >
                      {RESET_SCOPES.map((scope) => (
                        <option key={scope} value={scope}>
                          {t(`gmScreen.resets.${scope || 'never'}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={clock.loops}
                      onChange={(event) => update(clock.id, { loops: event.target.checked })}
                    />
                    {t('gmScreen.clocks.loops')}
                  </label>
                </div>
              </details>
            </li>
          )
        })}
      </ul>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          add()
        }}
        style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}
      >
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-label={t('gmScreen.clocks.newName')}
          placeholder={t('gmScreen.clocks.newName')}
          maxLength={120}
          style={{ ...fieldInput, flex: '1 1 120px', padding: '5px 8px' }}
        />
        <input
          type="number"
          min={1}
          max={30}
          value={size}
          onChange={(event) => setSize(Math.max(1, Math.min(30, Number(event.target.value) || 1)))}
          aria-label={t('gmScreen.clocks.boxes')}
          style={{ ...fieldInput, width: 64, padding: '5px 8px' }}
        />
        <button
          type="submit"
          style={{ ...ghostBtn, padding: '5px 10px' }}
          disabled={clocks.length >= 50}
        >
          <LuPlus size={14} aria-hidden="true" /> {t(`gmScreen.clocks.add.${mode}`)}
        </button>
      </form>
    </div>
  )
}
