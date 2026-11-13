import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuPlus, LuTrash2 } from 'react-icons/lu'
import { fieldInput, fieldLabel, ghostBtn, iconBtn } from '../../characters/characterStyles'
import type { SettingsProps } from '../GmPanelFrame'
import { rowId, tableConfig, type TableColumn } from '../types'

const MAX_COLUMNS = 4

/**
 * The table's columns, one entry per line. The die each column rolls is the
 * number of its entries, so a d20 table is twenty lines. Blank lines are
 * dropped when the panel is saved.
 */
export default function TableSettings({ config, onChange }: SettingsProps) {
  const { t } = useTranslation()
  const current = tableConfig(config)
  // A new panel has no columns yet: offer one to fill in, under a steady id.
  const [blankId] = useState(rowId)
  const save = (patch: Partial<typeof current>) => onChange({ ...current, ...patch })
  const update = (id: string, patch: Partial<TableColumn>) =>
    save({
      columns: current.columns.map((column) =>
        column.id === id ? { ...column, ...patch } : column
      ),
    })
  const columns = current.columns.length
    ? current.columns
    : [{ id: blankId, label: '', entries: [] as string[] }]

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {columns.length > 1 && (
        <label style={fieldLabel}>
          {t('gmScreen.table.mode')}
          <select
            value={current.mode}
            onChange={(event) => save({ mode: event.target.value === 'join' ? 'join' : 'list' })}
            style={fieldInput}
          >
            <option value="list">{t('gmScreen.table.modeList')}</option>
            <option value="join">{t('gmScreen.table.modeJoin')}</option>
          </select>
        </label>
      )}
      {columns.map((column, index) => (
        <fieldset
          key={column.id}
          style={{ border: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}
        >
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              value={column.label}
              maxLength={60}
              aria-label={t('gmScreen.table.columnName', { number: index + 1 })}
              placeholder={t('gmScreen.table.column', { number: index + 1 })}
              onChange={(event) =>
                current.columns.length
                  ? update(column.id, { label: event.target.value })
                  : save({ columns: [{ ...column, label: event.target.value }] })
              }
              style={{ ...fieldInput, flex: 1 }}
            />
            {columns.length > 1 && (
              <button
                type="button"
                onClick={() =>
                  save({ columns: current.columns.filter((other) => other.id !== column.id) })
                }
                aria-label={t('gmScreen.table.removeColumn', { number: index + 1 })}
                style={iconBtn}
              >
                <LuTrash2 size={14} aria-hidden="true" />
              </button>
            )}
          </div>
          <textarea
            value={column.entries.join('\n')}
            rows={8}
            aria-label={t('gmScreen.table.entries', { number: index + 1 })}
            onChange={(event) => {
              const entries = event.target.value.split('\n').slice(0, 100)
              if (current.columns.length) update(column.id, { entries })
              else save({ columns: [{ ...column, entries }] })
            }}
            style={{ ...fieldInput, fontSize: 12, resize: 'vertical' }}
          />
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {t('gmScreen.table.entriesHelp', {
              count: column.entries.filter((entry) => entry.trim()).length,
            })}
          </span>
        </fieldset>
      ))}
      {columns.length < MAX_COLUMNS && (
        <button
          type="button"
          onClick={() => save({ columns: [...columns, { id: rowId(), label: '', entries: [] }] })}
          style={{ ...ghostBtn, justifySelf: 'start', padding: '5px 10px' }}
        >
          <LuPlus size={14} aria-hidden="true" /> {t('gmScreen.table.addColumn')}
        </button>
      )}
    </div>
  )
}
