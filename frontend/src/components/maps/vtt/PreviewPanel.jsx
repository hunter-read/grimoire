import { useTranslation } from 'react-i18next'
import { LuEye, LuEyeOff } from 'react-icons/lu'

import Field from './Field'
import { btnStyle, inputStyle, sectionTitleStyle } from './ui'

/**
 * The player-view preview: what someone standing on the map would actually see.
 *
 * GMs asked for this because the authored geometry is otherwise unverifiable.
 * A wall drawn in the wrong place looks identical to one drawn correctly until
 * it reaches a virtual tabletop, and the round trip to find out is export,
 * import, move a token, come back. This answers the question in place.
 *
 * It is a toggle, off by default, because the darkened view is actively in the
 * way while drawing — the point of tracing walls is seeing the artwork under
 * them.
 *
 * **None of this is written to the `.uvtt`.** The format has no concept of a
 * player token or a viewing position, so the token, its sight radius and its
 * light are editor state only. The panel says so, because the natural
 * assumption is the opposite.
 */
export default function PreviewPanel({ preview, onChange }) {
  const { t } = useTranslation()
  // Defaulted rather than required: the panel is one optional part of a large
  // sidebar, and a caller that has no preview state yet should get the control
  // in its off position rather than a crash.
  const state = preview || { enabled: false, sightRange: 0, lightRange: 0 }
  const set = (patch) => onChange?.({ ...state, ...patch })

  return (
    <div data-testid="preview-panel">
      <div style={sectionTitleStyle}>{t('maps.vtt.preview.title')}</div>

      <button
        type="button"
        onClick={() => set({ enabled: !state.enabled })}
        aria-pressed={state.enabled}
        style={{
          ...btnStyle,
          width: '100%',
          justifyContent: 'center',
          borderColor: state.enabled ? 'var(--gold)' : 'var(--border)',
          color: state.enabled ? 'var(--gold)' : 'var(--text)',
        }}
      >
        {state.enabled ? (
          <LuEyeOff size={13} aria-hidden="true" />
        ) : (
          <LuEye size={13} aria-hidden="true" />
        )}
        {state.enabled ? t('maps.vtt.preview.hide') : t('maps.vtt.preview.show')}
      </button>

      <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '8px 0 0', lineHeight: 1.5 }}>
        {t('maps.vtt.preview.hint')}
      </div>

      {state.enabled && (
        <>
          <div
            style={{ fontSize: 11, color: 'var(--text-muted)', margin: '10px 0', lineHeight: 1.5 }}
          >
            {t('maps.vtt.preview.moveHint')}
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
            <Field label={t('maps.vtt.preview.sight')} style={{ flex: 1, minWidth: 0 }}>
              <input
                type="number"
                min="0"
                step="1"
                value={state.sightRange}
                aria-label={t('maps.vtt.preview.sight')}
                onChange={(e) => set({ sightRange: Math.max(0, Number(e.target.value) || 0) })}
                style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
              />
            </Field>
            <Field label={t('maps.vtt.preview.light')} style={{ flex: 1, minWidth: 0 }}>
              <input
                type="number"
                min="0"
                step="1"
                value={state.lightRange}
                aria-label={t('maps.vtt.preview.light')}
                onChange={(e) => set({ lightRange: Math.max(0, Number(e.target.value) || 0) })}
                style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
              />
            </Field>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>
            {t('maps.vtt.preview.rangeHint')}
          </div>

          {/* The reason this panel exists at all is that nothing here reaches
              the file. Saying so prevents a GM tuning a torch radius here and
              expecting it in Foundry. */}
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.5 }}>
            {t('maps.vtt.preview.notExported')}
          </div>
        </>
      )}
    </div>
  )
}
