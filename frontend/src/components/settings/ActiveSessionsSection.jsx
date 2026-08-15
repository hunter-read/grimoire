import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuLaptop, LuLogOut, LuShieldCheck } from 'react-icons/lu'
import { auth as authApi } from '../../api'
import Spinner from '../Spinner'

// Turn a raw User-Agent into something a person can recognise their own device
// by. Deliberately coarse: the goal is "which of my devices is this", not
// accurate client detection, and every unknown agent still shows its raw text.
function describeClient(userAgent) {
  if (!userAgent) return null
  const ua = userAgent
  const browser =
    // Order matters: Edge and Chrome both claim "Chrome", Chrome claims "Safari".
    /Edg\//.test(ua)
      ? 'Edge'
      : /OPR\/|Opera/.test(ua)
        ? 'Opera'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Chrome\//.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : null
  const platform = /iPhone|iPad|iPod/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux/.test(ua)
            ? 'Linux'
            : null
  if (browser && platform) return `${browser} on ${platform}`
  return browser || platform || null
}

function formatWhen(iso, locale) {
  if (!iso) return null
  // Timestamps arrive as naive UTC, so mark them as such before formatting or
  // the browser reads them as local time and shows the wrong hour.
  const normalized = /(Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })
}

export default function ActiveSessionsSection() {
  const { t, i18n } = useTranslation()
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    try {
      setSessions(await authApi.sessions())
      setError(null)
    } catch (err) {
      setError(err?.message || t('userSettings.sessions.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    load()
  }, [load])

  const revokeOne = async (id) => {
    setBusyId(id)
    setError(null)
    try {
      await authApi.revokeSession(id)
      setSessions((prev) => prev.filter((s) => s.id !== id))
    } catch (err) {
      setError(err?.message || t('userSettings.sessions.revokeFailed'))
    } finally {
      setBusyId(null)
    }
  }

  const revokeOthers = async () => {
    setBusyId('others')
    setError(null)
    try {
      await authApi.revokeOtherSessions()
      setSessions((prev) => prev.filter((s) => s.current))
    } catch (err) {
      setError(err?.message || t('userSettings.sessions.revokeFailed'))
    } finally {
      setBusyId(null)
    }
  }

  const others = sessions.filter((s) => !s.current)

  return (
    <div>
      <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
        {t('userSettings.sessions.title')}
      </h3>
      <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.6 }}>
        {t('userSettings.sessions.description')}
      </p>

      {error && (
        <div style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 12 }}>{error}</div>
      )}

      {loading ? (
        <Spinner size={16} />
      ) : sessions.length === 0 ? (
        <p style={{ fontSize: 14, color: 'var(--text-dim)' }}>{t('userSettings.sessions.empty')}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 560 }}>
          {sessions.map((session) => {
            const client = describeClient(session.user_agent)
            const lastUsed = formatWhen(session.last_used_at, i18n.language)
            return (
              <div
                key={session.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 14px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: session.current ? 'var(--bg-raised)' : 'transparent',
                }}
              >
                <LuLaptop size={18} style={{ flexShrink: 0, color: 'var(--text-dim)' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                    {client || t('userSettings.sessions.unknownDevice')}
                    {session.current && (
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: 'var(--green)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        <LuShieldCheck size={12} /> {t('userSettings.sessions.thisDevice')}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 3 }}>
                    {[
                      session.origin === 'oidc'
                        ? t('userSettings.sessions.originSso')
                        : session.origin === 'guest'
                          ? t('userSettings.sessions.originGuest')
                          : t('userSettings.sessions.originPassword'),
                      session.ip_address,
                      lastUsed && t('userSettings.sessions.lastUsed', { when: lastUsed }),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
                {!session.current && (
                  <button
                    type="button"
                    onClick={() => revokeOne(session.id)}
                    disabled={busyId === session.id}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 12px',
                      borderRadius: 6,
                      fontSize: 13,
                      background: 'transparent',
                      border: '1px solid var(--border)',
                      color: 'var(--danger)',
                      cursor: busyId === session.id ? 'default' : 'pointer',
                      opacity: busyId === session.id ? 0.6 : 1,
                      flexShrink: 0,
                    }}
                  >
                    {busyId === session.id ? <Spinner size={12} /> : <LuLogOut size={13} />}
                    {t('userSettings.sessions.revoke')}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {others.length > 0 && (
        <button
          type="button"
          onClick={revokeOthers}
          disabled={busyId === 'others'}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            marginTop: 16,
            padding: '8px 18px',
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 500,
            background: 'transparent',
            border: '1px solid var(--danger)',
            color: 'var(--danger)',
            cursor: busyId === 'others' ? 'default' : 'pointer',
            opacity: busyId === 'others' ? 0.6 : 1,
          }}
        >
          {busyId === 'others' && <Spinner size={13} />}
          {t('userSettings.sessions.revokeAllOthers')}
        </button>
      )}
    </div>
  )
}
