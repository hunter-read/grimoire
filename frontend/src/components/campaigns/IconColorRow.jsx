import { useTranslation } from 'react-i18next'
import { LuBan } from 'react-icons/lu'
import { ICON_COLOR_NAMES, ICON_COLOR_PRESETS } from './iconColors'

// Colour swatches plus a custom hex input, shown at the foot of IconPicker.
// Reports changes immediately so the tint previews on the picker's trigger.
// `color` is the stored value (preset token, "#rrggbb", or empty) and
// `resolved` its CSS form, already computed by the caller.
export default function IconColorRow({ color, resolved, onColorChange }) {
  const { t } = useTranslation()
  const isPreset = typeof color === 'string' && color.trim().toLowerCase() in ICON_COLOR_PRESETS
  // The native colour input needs a concrete hex; fall back to the resolved
  // preset (or a neutral) so opening it doesn't jump to black.
  const customValue = resolved || '#8a8f98'

  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
      <div
        style={{
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--text-muted)',
          fontWeight: 600,
          marginBottom: 5,
        }}
      >
        {t('iconPicker.colorLabel')}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
        {/* Default = inherit the row's text colour. */}
        <button
          type="button"
          onClick={() => onColorChange('')}
          title={t('iconPicker.colorDefault')}
          aria-label={t('iconPicker.colorDefault')}
          aria-pressed={!color}
          style={swatchStyle(!color, 'transparent')}
        >
          <LuBan size={11} aria-hidden="true" style={{ color: 'var(--text-muted)' }} />
        </button>
        {ICON_COLOR_NAMES.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => onColorChange(name)}
            title={t(`iconPicker.color_${name}`)}
            aria-label={t(`iconPicker.color_${name}`)}
            aria-pressed={color === name}
            style={swatchStyle(color === name, ICON_COLOR_PRESETS[name])}
          />
        ))}
        {/* Custom hex. The native colour input is the control; it's visually
            hidden behind the swatch, which carries the "#" affordance. */}
        <label
          title={t('iconPicker.colorCustom')}
          style={{
            ...swatchStyle(!!color && !isPreset, customValue),
            padding: 0,
            overflow: 'hidden',
            position: 'relative',
            cursor: 'pointer',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 9,
              fontWeight: 700,
              color: '#fff',
              textShadow: '0 0 2px rgba(0,0,0,0.8)',
              pointerEvents: 'none',
            }}
          >
            #
          </span>
          <input
            type="color"
            value={customValue}
            aria-label={t('iconPicker.colorCustom')}
            onChange={(e) => onColorChange(e.target.value)}
            style={{ opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }}
          />
        </label>
      </div>
    </div>
  )
}

const swatchStyle = (active, background) => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 18,
  height: 18,
  background,
  border: active ? '2px solid var(--text)' : '1px solid var(--border)',
  borderRadius: 5,
  cursor: 'pointer',
  padding: 0,
})
