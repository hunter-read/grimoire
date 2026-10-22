import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCircleCheck, LuEye, LuLock } from 'react-icons/lu'
import { settings as settingsApi, type Schema } from '../../api'
import Spinner from '../Spinner'

type Settings = Schema<'SettingsResponse'>
type Mode = 'auto' | 'events' | 'poll'

const MODES: Mode[] = ['auto', 'events', 'poll']

const STATE_COLORS: Record<string, string> = {
  watching: 'var(--green)',
  polling: 'var(--green)',
  unavailable: 'var(--danger)',
}

/**
 * Watching the library for changes (issue #670): rescan by itself when files
 * are added, renamed, moved or deleted, instead of waiting for a schedule.
 *
 * Both settings can be pinned by an environment variable (LIBRARY_WATCH,
 * LIBRARY_WATCH_MODE), in which case they show read-only with the variable's
 * name. The status line is what the watcher last reported doing, so a share
 * the server cannot watch says why here rather than only in the logs.
 */
export default function WatchLibrarySection() {
  const { t } = useTranslation()
  const [data, setData] = useState<Settings | null>(null)
  const [enabled, setEnabled] = useState(true)
  const [mode, setMode] = useState<Mode>('auto')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const apply = (next: Settings) => {
    setData(next)
    setEnabled(next.library_watch_enabled ?? true)
    const nextMode = next.library_watch_mode as Mode
    setMode(MODES.includes(nextMode) ? nextMode : 'auto')
  }

  useEffect(() => {
    settingsApi.get().then(apply)
  }, [])

  const handleSave = async () => {
    if (!data) return
    setSaving(true)
    setSaved(false)
    try {
      const body: { library_watch_enabled?: boolean; library_watch_mode?: string } = {}
      if (!data.library_watch_env_locked) body.library_watch_enabled = enabled
      if (!data.library_watch_mode_env_locked) body.library_watch_mode = mode
      apply(await settingsApi.patch(body))
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
      // The watcher picks the change up a moment later; show what it did.
      setTimeout(() => {
        settingsApi
          .get()
          .then((fresh) => setData(fresh))
          .catch(() => {})
      }, 2000)
    } finally {
      setSaving(false)
    }
  }

  const lockNote = (locked: boolean, name: string) =>
    locked ? (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          fontSize: 12,
          color: 'var(--text-muted)',
        }}
      >
        <LuLock size={11} /> {t('maintenance.watch.envLocked', { name })}
      </span>
    ) : null

  const seconds = data?.library_watch_poll_interval ?? 120
  const state = data?.library_watch_state
  const canSave = data && !(data.library_watch_env_locked && data.library_watch_mode_env_locked)

  return (
    <div>
      <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>
        {t('maintenance.watch.title')}
      </h3>
      <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.6 }}>
        {t('maintenance.watch.description')}
      </p>

      {!data ? (
        <Spinner size={20} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <label
              htmlFor="library-watch-enabled"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 14,
                color: 'var(--text)',
                cursor: data.library_watch_env_locked ? 'not-allowed' : 'pointer',
                userSelect: 'none',
              }}
            >
              <input
                id="library-watch-enabled"
                type="checkbox"
                checked={enabled}
                disabled={data.library_watch_env_locked}
                onChange={(e) => setEnabled(e.target.checked)}
                style={{ width: 15, height: 15, cursor: 'inherit', accentColor: 'var(--gold)' }}
              />
              {t('maintenance.watch.enabled')}
            </label>
            {lockNote(data.library_watch_env_locked, 'LIBRARY_WATCH')}
          </div>

          {enabled && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 13, color: 'var(--text-dim)' }} id="library-watch-mode">
                {t('maintenance.watch.modeLabel')}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div
                  role="radiogroup"
                  aria-labelledby="library-watch-mode"
                  style={{
                    display: 'flex',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    overflow: 'hidden',
                    width: 'fit-content',
                    opacity: data.library_watch_mode_env_locked ? 0.6 : 1,
                  }}
                >
                  {MODES.map((value, idx) => (
                    <button
                      key={value}
                      role="radio"
                      aria-checked={mode === value}
                      disabled={data.library_watch_mode_env_locked}
                      onClick={() => setMode(value)}
                      style={{
                        padding: '7px 18px',
                        fontSize: 14,
                        cursor: data.library_watch_mode_env_locked ? 'not-allowed' : 'pointer',
                        border: 'none',
                        borderRight: idx < MODES.length - 1 ? '1px solid var(--border)' : 'none',
                        background: mode === value ? 'var(--bg-card-hover)' : 'var(--bg-card)',
                        color: mode === value ? 'var(--gold)' : 'var(--text-dim)',
                        transition: 'background 0.15s, color 0.15s',
                      }}
                    >
                      {t(`maintenance.watch.modes.${value}`)}
                    </button>
                  ))}
                </div>
                {lockNote(data.library_watch_mode_env_locked, 'LIBRARY_WATCH_MODE')}
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 }}>
                {t(`maintenance.watch.modeHelp.${mode}`, { seconds })}
              </p>
            </div>
          )}

          {state && (
            <p
              data-testid="library-watch-state"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 13,
                margin: 0,
                color: STATE_COLORS[state.state] ?? 'var(--text-dim)',
              }}
            >
              <LuEye size={13} />
              {t(`maintenance.watch.state.${state.state}`, {
                seconds,
                detail: state.detail,
                defaultValue: state.state,
              })}
            </p>
          )}

          {canSave && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 18px',
                  borderRadius: 6,
                  fontSize: 14,
                  fontWeight: 500,
                  background: 'var(--gold-dim)',
                  border: 'none',
                  color: 'var(--bg-deep)',
                  cursor: saving ? 'default' : 'pointer',
                  opacity: saving ? 0.6 : 1,
                }}
              >
                {saving && <Spinner size={13} />}
                {saving ? t('maintenance.watch.saving') : t('maintenance.watch.save')}
              </button>
              {saved && (
                <span
                  style={{
                    fontSize: 13,
                    color: 'var(--green)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                  }}
                >
                  <LuCircleCheck size={14} /> {t('maintenance.watch.saved')}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
