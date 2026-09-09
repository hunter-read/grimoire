import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuTriangleAlert } from 'react-icons/lu'
import api from '../../api'

const inputStyle = {
  width: '100%',
  padding: '5px 8px',
  fontSize: 14,
  borderRadius: 4,
  border: '1px solid var(--border)',
  background: 'var(--bg-input, var(--bg-deep))',
  color: 'var(--text)',
}

const btnStyle = {
  padding: '5px 12px',
  fontSize: 13,
  borderRadius: 4,
  border: '1px solid var(--border)',
  background: 'var(--bg-card)',
  color: 'var(--text)',
  cursor: 'pointer',
}

// A blank field means "no value"; 0 is the API's signal to clear the override.
const toNumber = (v) => (v.trim() === '' ? 0 : Number(v))

/**
 * Editor for a map's grid, letting a GM correct a wrong detection (issue #125).
 *
 * The grid is otherwise inferred from the filename, DPI, or pixel size, and a
 * wrong guess is baked into every `.uvtt` export. Values are fractional so a
 * map that bleeds a partial cell past its grid can be described accurately.
 *
 * A grid the backend considers implausible is *saved*, not rejected: the
 * warning is shown afterwards with what the dimensions imply, because unusual
 * maps genuinely exist and only the user can say which case this is.
 */
export default function MapGridEditor({ map, onSaved, onCancel }) {
  const { t } = useTranslation()
  const detected = map.grid || {}
  const [width, setWidth] = useState(String(map.grid_width ?? detected.width ?? ''))
  const [height, setHeight] = useState(String(map.grid_height ?? detected.height ?? ''))
  const [cellPx, setCellPx] = useState(String(map.grid_px ?? detected.cell_px ?? ''))
  const [warning, setWarning] = useState(null)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      const res = await api.patch(`/maps/${map.id}`, {
        grid_width: toNumber(width),
        grid_height: toNumber(height),
        grid_px: toNumber(cellPx),
      })
      // Surface the advisory once, then let the next save close the editor —
      // the value is already stored either way.
      if (res?.grid_warning && !warning) {
        setWarning(res.grid_warning)
        setSaving(false)
        return
      }
      onSaved()
    } catch {
      setSaving(false)
    }
  }

  const clear = async () => {
    setSaving(true)
    try {
      await api.patch(`/maps/${map.id}`, { grid_width: 0, grid_height: 0, grid_px: 0 })
      onSaved()
    } catch {
      setSaving(false)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <label style={{ flex: 1 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {t('maps.detail.gridWidth')}
          </span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={width}
            onChange={(e) => setWidth(e.target.value)}
            aria-label={t('maps.detail.gridWidth')}
            style={inputStyle}
          />
        </label>
        <label style={{ flex: 1 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {t('maps.detail.gridHeight')}
          </span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={height}
            onChange={(e) => setHeight(e.target.value)}
            aria-label={t('maps.detail.gridHeight')}
            style={inputStyle}
          />
        </label>
      </div>
      <label style={{ display: 'block', marginBottom: 10 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {t('maps.detail.gridCellSize')}
        </span>
        <input
          type="number"
          step="0.01"
          min="0"
          value={cellPx}
          onChange={(e) => setCellPx(e.target.value)}
          aria-label={t('maps.detail.gridCellSize')}
          style={inputStyle}
        />
      </label>

      {warning && (
        <div
          role="alert"
          style={{
            display: 'flex',
            gap: 8,
            padding: '8px 10px',
            marginBottom: 10,
            borderRadius: 4,
            border: '1px solid var(--warning, #b7791f)',
            background: 'var(--bg-card)',
            fontSize: 12,
            color: 'var(--text)',
          }}
        >
          <LuTriangleAlert size={16} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
          <div>
            <div>
              {t('maps.detail.gridWarning', {
                cellX: warning.cell_x,
                cellY: warning.cell_y,
              })}
            </div>
            <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>
              {t('maps.detail.gridWarningHint', {
                width: warning.suggested_width,
                height: warning.suggested_height,
              })}
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={save} disabled={saving} style={btnStyle}>
          {warning ? t('maps.detail.gridSaveAnyway') : t('common.save')}
        </button>
        <button type="button" onClick={onCancel} disabled={saving} style={btnStyle}>
          {t('common.cancel')}
        </button>
        {(map.grid_width || map.grid_height) && (
          <button
            type="button"
            onClick={clear}
            disabled={saving}
            style={{ ...btnStyle, marginLeft: 'auto' }}
          >
            {t('maps.detail.gridReset')}
          </button>
        )}
      </div>
    </div>
  )
}
