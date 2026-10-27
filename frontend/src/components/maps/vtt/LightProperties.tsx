import { useTranslation } from 'react-i18next'
import { LuTrash2 } from 'react-icons/lu'
import { argbToAlpha, argbToCss, argbToRgbHex, rgbHexToArgb } from './color'
import Field from './Field'
import NumberNudge from './NumberNudge'
import { LIGHT_PRESETS, PRESET_CUSTOM, applyPreset, matchPreset } from './lightPresets'
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
 *
 * The preset picker leads, because "this is a torch" is the answer the user
 * actually has; range, intensity and colour are how a torch is *spelled*, and
 * deriving them from a blank form is the tedious part. Picking one fills the
 * three fields below, which stay editable — a preset is a starting point, and
 * tuning one simply reads as Custom again.
 */
export default function LightProperties({ light, onChange, onDelete }) {
  const { t } = useTranslation()
  const alpha = argbToAlpha(light.color)

  const set = (patch) => onChange({ ...light, ...patch })
  const preset = matchPreset(light)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Field label={t('maps.vtt.light.preset')}>
        <select
          value={preset}
          aria-label={t('maps.vtt.light.preset')}
          onChange={(e) => {
            // "Custom" is a label for "none of these", not a preset to apply:
            // choosing it must leave the light exactly as it is rather than
            // resetting the values the user just tuned.
            if (e.target.value === PRESET_CUSTOM) return
            onChange(applyPreset(light, e.target.value))
          }}
          style={{ ...inputStyle, width: '100%' }}
        >
          <option value={PRESET_CUSTOM}>{t('maps.vtt.light.presetCustom')}</option>
          {LIGHT_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {t(`maps.vtt.light.presets.${p.id}`)}
            </option>
          ))}
        </select>
      </Field>

      {/* A row of swatches as well as the dropdown. The names are the useful
          handle, but "brazier" versus "bonfire" is a question about colour and
          reach, and the swatch answers it without opening the menu. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {LIGHT_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            title={t(`maps.vtt.light.presets.${p.id}`)}
            aria-label={t(`maps.vtt.light.presets.${p.id}`)}
            aria-pressed={preset === p.id}
            data-testid={`light-preset-${p.id}`}
            onClick={() => onChange(applyPreset(light, p.id))}
            style={{
              width: 22,
              height: 22,
              padding: 0,
              borderRadius: 4,
              cursor: 'pointer',
              background: argbToCss(p.color),
              border:
                preset === p.id ? '2px solid var(--gold, #d4af37)' : '1px solid var(--border)',
            }}
          />
        ))}
      </div>

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
