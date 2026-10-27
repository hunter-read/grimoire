import { useTranslation } from 'react-i18next'
import {
  LuFlipHorizontal2,
  LuFlipVertical2,
  LuRotateCcw,
  LuRotateCw,
  LuUndo2,
} from 'react-icons/lu'

import ColorSwatchRow from './ColorSwatchRow'
import IconButton from './IconButton'
import { MAX_SCALE, MIN_SCALE } from './useTokenTransform'

/**
 * Output size, zoom, rotation, flip, and background.
 *
 * The token's shape is not here: it comes from the frame you pick, and the
 * frame list already offers a plain circle and square (uncoloured, they crop
 * without drawing a ring), so a separate Shape control said the same thing
 * twice.
 *
 * Purely presentational — every control reports through a callback and holds no
 * state of its own, so the editor keeps a single source of truth for the spec.
 */

const label = { fontSize: 12, fontWeight: 600, marginBottom: 6, display: 'block' }
const section = { marginBottom: 16 }

export default function TokenEditorControls({
  size,
  sizes,
  onSizeChange,
  background,
  onBackgroundChange,
  transform,
  actions,
  disabled = false,
  sourceWarning = null,
}) {
  const { t } = useTranslation()

  return (
    <div style={{ opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? 'none' : 'auto' }}>
      <div style={section}>
        <label style={label} htmlFor="token-editor-size">
          {t('tokenEditor.size')}
        </label>
        <select
          id="token-editor-size"
          value={size}
          onChange={(e) => onSizeChange(Number(e.target.value))}
          style={{
            width: '100%',
            padding: '6px 8px',
            fontSize: 13,
            borderRadius: 5,
            background: 'var(--bg-card)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
          }}
        >
          {sizes.map((value) => (
            <option key={value} value={value}>
              {t('tokenEditor.sizeOption', { size: value })}
            </option>
          ))}
        </select>
        {sourceWarning && (
          <p style={{ fontSize: 11, color: 'var(--warning, var(--gold))', margin: '6px 0 0' }}>
            {sourceWarning}
          </p>
        )}
      </div>

      <div style={section}>
        <label style={label} htmlFor="token-editor-zoom">
          {t('tokenEditor.zoom')}
        </label>
        <input
          id="token-editor-zoom"
          type="range"
          min={MIN_SCALE}
          max={MAX_SCALE}
          step={0.05}
          value={transform.scale}
          onChange={(e) => actions.setScale(Number(e.target.value))}
          style={{ width: '100%' }}
        />
      </div>

      <div style={section}>
        <label style={label} htmlFor="token-editor-rotation">
          {t('tokenEditor.rotation')}
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <IconButton onClick={() => actions.rotate(-15)} title={t('tokenEditor.rotateLeft')}>
            <LuRotateCcw size={15} aria-hidden="true" />
          </IconButton>
          <input
            id="token-editor-rotation"
            type="range"
            min={0}
            max={359}
            step={1}
            value={transform.rotation}
            onChange={(e) => actions.setRotation(Number(e.target.value))}
            style={{ flex: 1 }}
          />
          <IconButton onClick={() => actions.rotate(15)} title={t('tokenEditor.rotateRight')}>
            <LuRotateCw size={15} aria-hidden="true" />
          </IconButton>
        </div>
      </div>

      <div style={section}>
        <span style={label}>{t('tokenEditor.flip')}</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <IconButton
            onClick={actions.flipX}
            active={transform.flipX}
            title={t('tokenEditor.flipHorizontal')}
          >
            <LuFlipHorizontal2 size={15} aria-hidden="true" />
          </IconButton>
          <IconButton
            onClick={actions.flipY}
            active={transform.flipY}
            title={t('tokenEditor.flipVertical')}
          >
            <LuFlipVertical2 size={15} aria-hidden="true" />
          </IconButton>
          <IconButton onClick={actions.reset} title={t('tokenEditor.reset')}>
            <LuUndo2 size={15} aria-hidden="true" />
          </IconButton>
        </div>
      </div>

      <div style={section}>
        <ColorSwatchRow
          label={t('tokenEditor.background')}
          value={background}
          onChange={onBackgroundChange}
          allowNone
          noneLabel={t('tokenEditor.bgTransparent')}
        />
      </div>
    </div>
  )
}
