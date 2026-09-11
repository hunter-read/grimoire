import { useTranslation } from 'react-i18next'
import { LuTriangleAlert } from 'react-icons/lu'
import { argbToAlpha, argbToCss, argbToRgbHex, rgbHexToArgb } from './color'
import Field from './Field'
import { inputStyle, sectionTitleStyle } from './ui'

/**
 * Map-wide environment settings (issue #127).
 *
 * Both controls here were reported as confusing, and the reason is that their
 * names describe the *file format* rather than the decision the user is making.
 * "Baked lighting" and "ambient light strength" mean something precise to
 * whoever wrote the spec and nothing to a GM with a dungeon map. So each one
 * now leads with the question it answers, in plain terms, and shows the
 * consequence of the answer.
 *
 * `baked_lighting` means the lighting is already painted into the image. It is
 * not cosmetic: importers may ignore or dampen authored lights when it is set,
 * so a user placing lights over an already-lit map needs to know which they
 * have. Hence the warning rather than a silent checkbox.
 *
 * `ambient_light` is the light level the VTT starts from before any placed
 * light contributes — the difference between an unlit corner being pitch black
 * and being dim-but-readable. Stored as the same ARGB hex as a light's colour,
 * with the alpha channel carrying the strength; that packing is a format
 * detail, so the UI presents it as a colour and a separate brightness.
 */
export default function EnvironmentPanel({ environment, lightCount, onChange }) {
  const { t } = useTranslation()
  const alpha = argbToAlpha(environment.ambient_light)
  const bakedWithLights = environment.baked_lighting && lightCount > 0

  return (
    <div>
      <div style={sectionTitleStyle}>{t('maps.vtt.environment.title')}</div>

      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: 13 }}>
        <input
          type="checkbox"
          checked={!!environment.baked_lighting}
          onChange={(e) => onChange({ ...environment, baked_lighting: e.target.checked })}
          style={{ marginTop: 2 }}
        />
        <span>{t('maps.vtt.environment.baked')}</span>
      </label>
      <div
        style={{ fontSize: 11, color: 'var(--text-muted)', margin: '6px 0 12px', lineHeight: 1.5 }}
      >
        {t('maps.vtt.environment.bakedHint')}
      </div>

      {bakedWithLights && (
        <div
          role="alert"
          style={{
            display: 'flex',
            gap: 8,
            padding: '8px 10px',
            marginBottom: 12,
            borderRadius: 4,
            border: '1px solid var(--warning, #b7791f)',
            background: 'var(--bg-card)',
            fontSize: 12,
          }}
        >
          <LuTriangleAlert size={15} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
          <span>{t('maps.vtt.environment.bakedWarning', { count: lightCount })}</span>
        </div>
      )}

      <div style={{ fontSize: 13, marginBottom: 2 }}>{t('maps.vtt.environment.ambientLabel')}</div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 8px', lineHeight: 1.5 }}>
        {t('maps.vtt.environment.ambientHint')}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
        <Field label={t('maps.vtt.environment.ambient')}>
          <input
            type="color"
            value={argbToRgbHex(environment.ambient_light)}
            aria-label={t('maps.vtt.environment.ambient')}
            onChange={(e) =>
              onChange({ ...environment, ambient_light: rgbHexToArgb(e.target.value, alpha) })
            }
            style={{ ...inputStyle, width: 54, height: 30, padding: 2 }}
          />
        </Field>
        <Field label={t('maps.vtt.environment.ambientStrength')} style={{ flex: 1 }}>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={alpha}
            aria-label={t('maps.vtt.environment.ambientStrength')}
            onChange={(e) =>
              onChange({
                ...environment,
                ambient_light: rgbHexToArgb(
                  argbToRgbHex(environment.ambient_light),
                  Number(e.target.value)
                ),
              })
            }
            style={{ width: '100%' }}
          />
        </Field>
      </div>

      {/* A swatch of the actual result. "Strength 0.35" means nothing on its
          own; the sample shows whether an unlit corner will read as black or
          as dim moonlight, which is the thing being chosen. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
        <div
          data-testid="ambient-sample"
          aria-hidden="true"
          style={{
            width: 44,
            height: 22,
            borderRadius: 3,
            border: '1px solid var(--border)',
            // The colour over black, because that is what ambient light is
            // lifting: an area with no light of its own. The stored alpha
            // already carries the strength, so it is not scaled again here.
            backgroundColor: '#000',
            backgroundImage: `linear-gradient(0deg, ${argbToCss(
              environment.ambient_light
            )}, ${argbToCss(environment.ambient_light)})`,
          }}
        />
        <span style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
          {alpha <= 0.01
            ? t('maps.vtt.environment.ambientDark')
            : t('maps.vtt.environment.ambientLit', { percent: Math.round(alpha * 100) })}
        </span>
      </div>
    </div>
  )
}
