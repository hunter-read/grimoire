import { useTranslation } from 'react-i18next'
import { LuTrash2 } from 'react-icons/lu'
import { btnStyle } from './ui'

/**
 * Property panel for one portal — a door or a window (issue #126).
 *
 * Only three things are editable because only three things exist in the format.
 * `closed` is the door/window discriminator, exactly as importers read it: a
 * closed portal is a door that blocks sight until opened, an open one is a
 * window you can see through. `freestanding` marks a portal not set into a wall.
 *
 * Notably absent, because a `.uvtt` cannot carry them: secret doors, locked
 * state, and one-way/directional behaviour. Roll20 lets users mark a door
 * secret or locked *after* import; it is not something the file can express, so
 * offering the toggle here would lose the setting on export.
 */
export default function PortalProperties({ portal, onChange, onDelete }) {
  const { t } = useTranslation()
  const set = (patch) => onChange({ ...portal, ...patch })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
          {t('maps.vtt.portal.kind')}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => set({ closed: true })}
            aria-pressed={!!portal.closed}
            style={{
              ...btnStyle,
              flex: 1,
              justifyContent: 'center',
              borderColor: portal.closed ? 'var(--gold)' : 'var(--border)',
              color: portal.closed ? 'var(--gold)' : 'var(--text)',
            }}
          >
            {t('maps.vtt.portal.door')}
          </button>
          <button
            type="button"
            onClick={() => set({ closed: false })}
            aria-pressed={!portal.closed}
            style={{
              ...btnStyle,
              flex: 1,
              justifyContent: 'center',
              borderColor: !portal.closed ? 'var(--gold)' : 'var(--border)',
              color: !portal.closed ? 'var(--gold)' : 'var(--text)',
            }}
          >
            {t('maps.vtt.portal.window')}
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
          {portal.closed ? t('maps.vtt.portal.doorHint') : t('maps.vtt.portal.windowHint')}
        </div>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13 }}>
        <input
          type="checkbox"
          checked={!!portal.freestanding}
          onChange={(e) => set({ freestanding: e.target.checked })}
        />
        {t('maps.vtt.portal.freestanding')}
      </label>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -8 }}>
        {t('maps.vtt.portal.freestandingHint')}
      </div>

      <button type="button" onClick={onDelete} style={{ ...btnStyle, alignSelf: 'flex-start' }}>
        <LuTrash2 size={13} aria-hidden="true" /> {t('maps.vtt.deleteSelected')}
      </button>
    </div>
  )
}
