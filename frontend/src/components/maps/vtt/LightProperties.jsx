import { useTranslation } from 'react-i18next'
import { LuTrash2 } from 'react-icons/lu'
import { argbToAlpha, argbToRgbHex, rgbHexToArgb } from './color'
import Field from './Field'
import NumberNudge from './NumberNudge'
import { btnStyle, inputStyle } from './ui'

/**
 * Property panel for one light (issue #127).
 *
 * The controls map one-to-one onto the fields the format actually carries, and
 * deliberately no further: there is no animation, falloff curve, colour
 * temperature, or dim/bright split here, because a `.uvtt` cannot express any
 * of them and importers derive the last one themselves. Offering the control
 * would promise something the exported file could not keep.
 *
 * Colour is edited as RGB + opacity and stored as ARGB hex — see `color.js`.
 * `intensity` has no scale agreed between VTTs (Foundry, Roll20 and FGU each
 * read it differently), so the preview here can never match a target VTT
 * exactly; what is guaranteed is that the exported value is the one entered.
 */
export default function LightProperties({ light, onChange, onDelete }) {
  const { t } = useTranslation()
  const alpha = argbToAlpha(light.color)

  const set = (patch) => onChange({ ...light, ...patch })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 10 }}>
        <Field label={t('maps.vtt.light.x')}>
          <NumberNudge
            value={light.position.x}
            step={0.5}
            width={64}
            label={t('maps.vtt.light.x')}
            onChange={(v) => set({ position: { ...light.position, x: v } })}
          />
        </Field>
        <Field label={t('maps.vtt.light.y')}>
          <NumberNudge
            value={light.position.y}
            step={0.5}
            width={64}
            label={t('maps.vtt.light.y')}
            onChange={(v) => set({ position: { ...light.position, y: v } })}
          />
        </Field>
      </div>

      <Field label={t('maps.vtt.light.range')}>
        <NumberNudge
          value={light.range}
          step={0.5}
          label={t('maps.vtt.light.range')}
          onChange={(v) => set({ range: Math.max(0, v) })}
        />
      </Field>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -8 }}>
        {t('maps.vtt.light.rangeHint')}
      </div>

      <Field label={t('maps.vtt.light.intensity')}>
        <input
          type="range"
          min="0"
          max="3"
          step="0.05"
          value={light.intensity}
          aria-label={t('maps.vtt.light.intensity')}
          onChange={(e) => set({ intensity: Number(e.target.value) })}
          style={{ width: '100%' }}
        />
      </Field>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -8 }}>
        {t('maps.vtt.light.intensityHint', { value: light.intensity })}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
        <Field label={t('maps.vtt.light.color')}>
          <input
            type="color"
            value={argbToRgbHex(light.color)}
            aria-label={t('maps.vtt.light.color')}
            onChange={(e) => set({ color: rgbHexToArgb(e.target.value, alpha) })}
            style={{ ...inputStyle, width: 54, height: 30, padding: 2 }}
          />
        </Field>
        <Field label={t('maps.vtt.light.opacity')} style={{ flex: 1 }}>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={alpha}
            aria-label={t('maps.vtt.light.opacity')}
            onChange={(e) =>
              set({ color: rgbHexToArgb(argbToRgbHex(light.color), Number(e.target.value)) })
            }
            style={{ width: '100%' }}
          />
        </Field>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13 }}>
        <input
          type="checkbox"
          checked={!!light.shadows}
          onChange={(e) => set({ shadows: e.target.checked })}
        />
        {t('maps.vtt.light.shadows')}
      </label>

      <button type="button" onClick={onDelete} style={{ ...btnStyle, alignSelf: 'flex-start' }}>
        <LuTrash2 size={13} aria-hidden="true" /> {t('maps.vtt.deleteSelected')}
      </button>
    </div>
  )
}
