import { useTranslation } from 'react-i18next'
import { LuBan } from 'react-icons/lu'

import { ICON_COLOR_NAMES, ICON_COLOR_PRESETS, resolveIconColor } from '../../campaigns/iconColors'

// Plain white and black, stored as ordinary hex literals so they travel through
// the same validated "#rrggbb" path every custom colour uses.
const MONOCHROME = { white: '#ffffff', black: '#000000' }
const MONOCHROME_NAMES = Object.keys(MONOCHROME)

/**
 * A row of preset colour swatches plus a native colour picker.
 *
 * Deliberately the same vocabulary campaign icons use — preset tokens like
 * "gold" or a "#rrggbb" literal — so a colour means the same thing wherever it
 * is stored, and `resolveIconColor` guards every value before it reaches a style
 * attribute. Presets are fixed hex rather than theme variables: a chosen colour
 * should look the same in light and dark mode.
 *
 * `allowNone` adds a leading "no colour" swatch, which the background control
 * uses for transparency; the frame colour has no such option, since a frame with
 * no colour would be invisible.
 */
export default function ColorSwatchRow({
  label,
  value,
  onChange,
  allowNone = false,
  noneLabel,
  fallback = '#8a8f98',
}) {
  const { t } = useTranslation()
  // "Preset" for the custom swatch's purposes means "some other swatch already
  // shows this", which includes the two monochrome ones — otherwise picking
  // white would light up the custom-hex swatch as well.
  const lowered = typeof value === 'string' ? value.trim().toLowerCase() : ''
  const isPreset =
    lowered in ICON_COLOR_PRESETS || MONOCHROME_NAMES.some((n) => MONOCHROME[n] === lowered)
  // White and black are stored as ordinary hex, so they resolve through the
  // same validated path as any custom colour — no new vocabulary to store.
  const resolved = resolveIconColor(value, fallback)
  const isNone = allowNone && !value

  return (
    <div>
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          marginBottom: 6,
          display: 'block',
        }}
      >
        {label}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
        {allowNone && (
          <button
            type="button"
            onClick={() => onChange('')}
            title={noneLabel}
            aria-label={noneLabel}
            aria-pressed={isNone}
            style={swatchStyle(isNone, 'transparent')}
          >
            <LuBan size={11} aria-hidden="true" style={{ color: 'var(--text-muted)' }} />
          </button>
        )}
        {/* Black and white lead the presets: a token frame or backdrop is far
            more often plain than tinted, and neither is a sensible campaign-icon
            tint (each vanishes against one of the two themes), which is why they
            live here rather than in the shared palette. */}
        {MONOCHROME_NAMES.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => onChange(MONOCHROME[name])}
            title={t(`tokenEditor.color_${name}`)}
            aria-label={t(`tokenEditor.color_${name}`)}
            aria-pressed={resolved === MONOCHROME[name]}
            style={swatchStyle(resolved === MONOCHROME[name], MONOCHROME[name])}
          />
        ))}
        {ICON_COLOR_NAMES.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => onChange(name)}
            title={t(`iconPicker.color_${name}`)}
            aria-label={t(`iconPicker.color_${name}`)}
            aria-pressed={value === name}
            style={swatchStyle(value === name, ICON_COLOR_PRESETS[name])}
          />
        ))}
        {/* Custom hex. The native colour input is the control; it sits invisibly
            over the swatch, which carries the "#" affordance. */}
        <label
          title={t('iconPicker.colorCustom')}
          style={{
            ...swatchStyle(!!value && !isPreset, resolved),
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
              color: 'var(--on-media)',
              textShadow: '0 0 2px rgba(0,0,0,0.8)',
              pointerEvents: 'none',
            }}
          >
            #
          </span>
          <input
            type="color"
            value={resolved}
            aria-label={t('iconPicker.colorCustom')}
            onChange={(e) => onChange(e.target.value)}
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
  width: 20,
  height: 20,
  background,
  border: active ? '2px solid var(--text)' : '1px solid var(--border)',
  borderRadius: 5,
  cursor: 'pointer',
  padding: 0,
})
