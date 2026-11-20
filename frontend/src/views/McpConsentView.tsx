import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { LuPlug, LuTriangleAlert } from 'react-icons/lu'
import { apiKeys, mcpSignIns, type ApiError, type Schema } from '../api'
import { useAuth } from '../context/AuthContext'
import Spinner from '../components/Spinner'
import ApiKeyPermissionPicker from '../components/settings/ApiKeyPermissionPicker'
import { sendBrowserTo } from '../utils/sendBrowserTo'

type SignInRequest = Schema<'OAuthRequestOut'>
type Permission = Schema<'ApiKeyPermissionOut'>

const buttonStyle = (primary: boolean, busy: boolean): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  flex: '1 1 140px',
  padding: '10px 16px',
  borderRadius: 6,
  fontSize: 14,
  fontWeight: 600,
  cursor: busy ? 'default' : 'pointer',
  opacity: busy ? 0.7 : 1,
  background: primary ? 'var(--gold-dim)' : 'var(--bg-card)',
  color: primary ? 'var(--bg-deep)' : 'var(--text)',
  border: `1px solid ${primary ? 'var(--gold-dim)' : 'var(--border)'}`,
})

const message = (err: unknown): string | undefined => {
  const text = (err as ApiError | null)?.message
  return typeof text === 'string' && text ? text : undefined
}

export interface McpConsentViewProps {
  /** The `request` parameter from the URL; null when there is none. */
  requestId: string | null
}

/**
 * The consent page for an MCP client's sign-in (issue #906): `/oauth/consent`.
 *
 * `/authorize` sends the browser here with a request id. The page says which
 * app is asking and, prominently, which host the browser goes to next: a
 * request id isn't tied to the browser that started the sign-in, so anyone can
 * send someone this page, and that host is the one detail a lookalike app
 * calling itself "Claude" can't fake. Access defaults to read-only; Customise
 * opens the same picker as the key editor. Deny is offered even to a user who
 * can't approve, so the app hears `access_denied` rather than waiting.
 *
 * It stands alone, without the app shell, and only ever renders signed in:
 * signed out, the login page shows at this same address.
 */
export default function McpConsentView({ requestId }: McpConsentViewProps) {
  const { t } = useTranslation()
  const { user } = useAuth()!
  const [request, setRequest] = useState<SignInRequest | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'gone' | 'failed'>(
    requestId ? 'loading' : 'gone'
  )
  const [loadError, setLoadError] = useState<string | null>(null)
  const [customise, setCustomise] = useState(false)
  const [permissions, setPermissions] = useState<Permission[] | null>(null)
  const [levels, setLevels] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<'approve' | 'deny' | null>(null)
  const [error, setError] = useState<string | null>(null)
  // A second click can land before the disabled buttons render; this stops it
  // sending a second answer.
  const answered = useRef(false)

  useEffect(() => {
    document.title = 'Grimoire'
    if (!requestId) return
    mcpSignIns
      .get(requestId)
      .then((data) => {
        setRequest(data)
        setLevels({ ...data.default_permissions })
        setStatus('ready')
      })
      .catch((err: ApiError) => {
        if (err.status === 404) {
          setStatus('gone')
        } else {
          setLoadError(message(err) ?? null)
          setStatus('failed')
        }
      })
  }, [requestId])

  const openCustomise = () => {
    setCustomise(true)
    setError(null)
    if (permissions) return
    apiKeys
      .permissions()
      .then(setPermissions)
      .catch((err: unknown) => {
        // Back to Read only, with Customize there to try again, rather than
        // a spinner that never finishes.
        setCustomise(false)
        setError(message(err) || t('mcpConsent.answerFailed'))
      })
  }

  const answer = async (choice: 'approve' | 'deny') => {
    if (!requestId || answered.current) return
    answered.current = true
    setBusy(choice)
    setError(null)
    try {
      const { redirect_to } =
        choice === 'approve'
          ? await mcpSignIns.approve(requestId, customise ? levels : null)
          : await mcpSignIns.deny(requestId)
      sendBrowserTo(redirect_to)
    } catch (err) {
      answered.current = false
      setBusy(null)
      if ((err as ApiError).status === 404) setStatus('gone')
      else setError(message(err) || t('mcpConsent.answerFailed'))
    }
  }

  let body
  if (status === 'loading') {
    body = (
      <div style={{ textAlign: 'center', padding: 24 }}>
        <Spinner size={28} />
      </div>
    )
  } else if (status === 'gone' || status === 'failed' || !request) {
    body = (
      <div style={{ textAlign: 'center' }}>
        <LuTriangleAlert size={32} style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
        <h1 style={{ fontSize: 20, margin: '12px 0 8px' }}>
          {status === 'failed' ? t('mcpConsent.failedTitle') : t('mcpConsent.goneTitle')}
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-dim)', margin: 0, lineHeight: 1.6 }}>
          {status === 'failed' ? loadError || t('mcpConsent.failedBody') : t('mcpConsent.goneBody')}
        </p>
      </div>
    )
  } else {
    const host = request.redirect_host
    body = (
      <>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <LuPlug size={30} style={{ color: 'var(--gold)' }} aria-hidden="true" />
          <h1 style={{ fontSize: 20, margin: '10px 0 6px', overflowWrap: 'anywhere' }}>
            {t('mcpConsent.title', { app: request.client_name })}
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: 0 }}>
            {t('mcpConsent.signedInAs', { name: user?.username ?? '' })}
          </p>
        </div>

        <div
          style={{
            border: '1px solid var(--gold-dim)',
            borderRadius: 8,
            padding: '12px 14px',
            marginBottom: 16,
            background: 'var(--bg-card)',
          }}
        >
          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{t('mcpConsent.hostLabel')}</div>
          <div
            data-testid="consent-host"
            style={{ fontSize: 18, fontWeight: 700, overflowWrap: 'anywhere', marginTop: 2 }}
          >
            {host}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.5 }}>
            {t('mcpConsent.hostHint')}
          </div>
        </div>

        {request.may_approve ? (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
              {t('mcpConsent.accessTitle')}
            </div>
            {customise ? (
              permissions ? (
                <ApiKeyPermissionPicker
                  permissions={permissions}
                  levels={levels}
                  onChange={(id, level) => setLevels((prev) => ({ ...prev, [id]: level }))}
                />
              ) : (
                <Spinner size={18} />
              )
            ) : (
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 220px', fontSize: 13, lineHeight: 1.5 }}>
                  <div style={{ fontWeight: 600 }}>{t('mcpConsent.readOnly')}</div>
                  <div style={{ color: 'var(--text-dim)' }}>{t('mcpConsent.readOnlyHint')}</div>
                </div>
                <button
                  type="button"
                  onClick={openCustomise}
                  disabled={busy !== null}
                  style={{ ...buttonStyle(false, busy !== null), flex: '0 0 auto', fontSize: 13 }}
                >
                  {t('mcpConsent.customise')}
                </button>
              </div>
            )}
          </div>
        ) : (
          <p
            role="note"
            style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6, margin: '0 0 16px' }}
          >
            {t('mcpConsent.cannotApprove')}
          </p>
        )}

        {error && (
          <div role="alert" style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 12 }}>
            {error}
          </div>
        )}

        <p
          id="consent-destination"
          style={{ fontSize: 13, color: 'var(--text-dim)', margin: '0 0 10px', lineHeight: 1.5 }}
        >
          {request.may_approve
            ? t('mcpConsent.eitherWay', { host })
            : t('mcpConsent.denyGoesTo', { host })}
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => void answer('deny')}
            disabled={busy !== null}
            aria-describedby="consent-destination"
            style={buttonStyle(false, busy !== null)}
          >
            {busy === 'deny' && <Spinner size={12} />}
            {t('mcpConsent.deny')}
          </button>
          {request.may_approve && (
            <button
              type="button"
              onClick={() => void answer('approve')}
              disabled={busy !== null}
              aria-describedby="consent-destination"
              style={buttonStyle(true, busy !== null)}
            >
              {busy === 'approve' && <Spinner size={12} />}
              {t('mcpConsent.approve')}
            </button>
          )}
        </div>
      </>
    )
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg-deep)',
        color: 'var(--text)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 16px',
        boxSizing: 'border-box',
      }}
    >
      <main
        style={{
          width: customise ? 640 : 460,
          maxWidth: '100%',
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: 24,
          boxSizing: 'border-box',
        }}
      >
        {body}
      </main>
    </div>
  )
}
