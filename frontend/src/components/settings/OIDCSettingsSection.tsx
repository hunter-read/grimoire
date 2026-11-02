import { useState, useEffect, useCallback, useRef } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  LuCircleCheck,
  LuRefreshCw,
  LuCopy,
  LuLock,
  LuEye,
  LuEyeOff,
  LuTriangleAlert,
} from 'react-icons/lu'
import api, { settings as settingsApi, type Schema } from '../../api'
import Spinner from '../Spinner'
import OIDCButtonAppearance from './OIDCButtonAppearance'
import { useUnsavedChanges } from './settingsDirty'

type Settings = Schema<'SettingsResponse'>
type SettingsPatch = Schema<'SettingsPatch'>
type Draft = Record<string, string | boolean>

interface DiscoveryDoc {
  issuer?: string
  authorization_endpoint?: string
  token_endpoint?: string
  userinfo_endpoint?: string
  jwks_uri?: string
  end_session_endpoint?: string
}

interface FieldRowProps {
  key: string
  label: string
  hint?: ReactNode
  type?: string
  placeholder?: string
}

/** Read a settings field by name; the form addresses fields as strings. */
const field = (data: Settings, key: string): unknown =>
  (data as unknown as Record<string, unknown>)[key]

const errorMessage = (e: unknown): string => {
  const message = (e as { message?: unknown } | null)?.message
  return typeof message === 'string' ? message : ''
}

// ID tokens are verified against the provider's published keys, so only
// public-key algorithms are offered (the server refuses anything else).
const SIGNING_ALGS = [
  'RS256',
  'RS384',
  'RS512',
  'ES256',
  'ES384',
  'ES512',
  'PS256',
  'PS384',
  'PS512',
]
const MATCH_BY_OPTIONS = ['none', 'email', 'username']

const STRING_FIELDS = [
  'oidc_issuer_url',
  'oidc_token_issuer',
  'oidc_authorization_endpoint',
  'oidc_token_endpoint',
  'oidc_userinfo_endpoint',
  'oidc_jwks_uri',
  'oidc_end_session_endpoint',
  'oidc_client_id',
  'oidc_signing_alg',
  'oidc_groups_claim',
  'oidc_admin_group',
  'oidc_gm_group',
  'oidc_player_group',
  'oidc_permissions_claim',
  'oidc_match_by',
]

const BOOL_FIELDS = ['oidc_enabled', 'oidc_auto_launch', 'oidc_auto_register']

export default function OIDCSettingsSection() {
  const { t } = useTranslation()
  const [data, setData] = useState<Settings | null>(null)
  const [draft, setDraft] = useState<Draft>({})
  const [secretDraft, setSecretDraft] = useState('') // empty = no change
  const [showSecret, setShowSecret] = useState(false)
  const [discovering, setDiscovering] = useState(false)
  const [discoverError, setDiscoverError] = useState('')
  const [savingField, setSavingField] = useState<string | null>(null)
  const [savedField, setSavedField] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [redirectCopied, setRedirectCopied] = useState(false)
  // Said after Autopopulate fills fields, which change with no focus on them.
  const [discoverStatus, setDiscoverStatus] = useState('')
  // Saving or clearing the secret disables the button that was pressed; focus
  // goes back to the field instead of falling to <body>.
  const secretInputRef = useRef<HTMLInputElement>(null)

  // The "Saved" and "Copied" ticks clear themselves after a moment. Their
  // timers are cancelled on unmount, so leaving the page mid-tick never sets
  // state on a component that is gone.
  const timersRef = useRef(new Set<ReturnType<typeof setTimeout>>())
  useEffect(() => {
    const timers = timersRef.current
    return () => timers.forEach((id) => clearTimeout(id))
  }, [])
  const later = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timersRef.current.delete(id)
      fn()
    }, ms)
    timersRef.current.add(id)
  }, [])

  const reload = useCallback(() => {
    settingsApi.get().then(setData)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  // Mirror server values into draft state once they arrive
  useEffect(() => {
    if (!data) return
    const next: Draft = {}
    for (const k of STRING_FIELDS) next[k] = (field(data, k) as string | undefined) ?? ''
    for (const k of BOOL_FIELDS) next[k] = !!field(data, k)
    setDraft(next)
  }, [data])

  // A text field saves when it loses focus, and the secret on its own Save:
  // anything typed but not yet saved is an unsaved edit.
  const dirty =
    !!data &&
    Object.keys(draft).length > 0 &&
    (secretDraft !== '' ||
      STRING_FIELDS.some(
        (k) =>
          !field(data, `${k}_env_locked`) &&
          (draft[k] ?? '') !== ((field(data, k) as string | undefined) ?? '')
      ))
  useUnsavedChanges('oidc', dirty)

  if (!data) return <Spinner size={20} />

  const isLocked = (key: string) => !!field(data, `${key}_env_locked`)
  const text = (key: string) => (draft[key] as string | undefined) ?? ''
  const signingAlg = text('oidc_signing_alg') || 'RS256'
  const signingAlgSupported = SIGNING_ALGS.includes(signingAlg)
  // Until OIDC is turned on, only what's needed to decide (and the redirect
  // URI to register with the provider) is shown; the rest follows the toggle.
  const enabled = 'oidc_enabled' in draft ? !!draft.oidc_enabled : !!data.oidc_enabled
  // Read defensively: older servers don't send it.
  const configured = field(data, 'oidc_configured') !== false

  const saveField = async (key: string, value: string | boolean) => {
    if (isLocked(key)) return
    setSavingField(key)
    setError('')
    try {
      const updated = await settingsApi.patch({ [key]: value } as SettingsPatch)
      setData(updated)
      setSavedField(key)
      later(() => setSavedField(null), 1800)
    } catch (e) {
      setError(errorMessage(e) || t('authSettings.oidc.saveFailed'))
    } finally {
      setSavingField(null)
    }
  }

  const handleStringBlur = (key: string) => {
    const v = text(key)
    if (v === ((field(data, key) as string | undefined) ?? '')) return
    saveField(key, v)
  }

  const handleBoolToggle = (key: string) => {
    // One save per box at a time; see checkboxRow for why it isn't disabled.
    if (savingField === key) return
    const next = !draft[key]
    setDraft((d) => ({ ...d, [key]: next }))
    saveField(key, next)
  }

  const handleSelectChange = (key: string, value: string) => {
    setDraft((d) => ({ ...d, [key]: value }))
    saveField(key, value)
  }

  const handleDiscover = async () => {
    const issuer = text('oidc_issuer_url').trim()
    if (!issuer) {
      setDiscoverError(t('authSettings.oidc.discoverNeedsIssuer'))
      return
    }
    setDiscovering(true)
    setDiscoverError('')
    setDiscoverStatus('')
    try {
      const doc = (await api.post('/auth/openid/discover', {
        issuer_url: issuer,
      })) as DiscoveryDoc
      const updates: Record<string, string> = {}
      // Always update oidc_issuer_url with the canonical issuer from the discovery
      // document — the token's `iss` claim must match this exactly, and IdPs
      // often return a different value than the URL the user typed (e.g. they
      // typed the full .well-known URL, or there's a trailing-slash difference).
      if (doc.issuer && !isLocked('oidc_issuer_url')) {
        updates['oidc_issuer_url'] = doc.issuer
      }
      // Populate empty fields; don't overwrite values the admin already set.
      const fillIfEmpty = (key: string, value: string | undefined) => {
        if (!value) return
        if (isLocked(key)) return
        if (text(key).trim()) return
        updates[key] = value
      }
      fillIfEmpty('oidc_token_issuer', doc.issuer)
      fillIfEmpty('oidc_authorization_endpoint', doc.authorization_endpoint)
      fillIfEmpty('oidc_token_endpoint', doc.token_endpoint)
      fillIfEmpty('oidc_userinfo_endpoint', doc.userinfo_endpoint)
      fillIfEmpty('oidc_jwks_uri', doc.jwks_uri)
      fillIfEmpty('oidc_end_session_endpoint', doc.end_session_endpoint)
      if (Object.keys(updates).length > 0) {
        const updated = await settingsApi.patch(updates as SettingsPatch)
        setData(updated)
      }
      setDiscoverStatus(t('a11y.settingsAccess.discovered', { count: Object.keys(updates).length }))
    } catch (e) {
      setDiscoverError(errorMessage(e) || t('authSettings.oidc.discoverFailed'))
    } finally {
      setDiscovering(false)
    }
  }

  const handleSaveSecret = async () => {
    if (!secretDraft) return
    if (isLocked('oidc_client_secret')) return
    setSavingField('oidc_client_secret')
    setError('')
    try {
      const updated = await settingsApi.patch({ oidc_client_secret: secretDraft })
      setData(updated)
      setSecretDraft('')
      setSavedField('oidc_client_secret')
      later(() => setSavedField(null), 1800)
      secretInputRef.current?.focus()
    } catch (e) {
      setError(errorMessage(e) || t('authSettings.oidc.saveFailed'))
    } finally {
      setSavingField(null)
    }
  }

  const handleClearSecret = async () => {
    if (isLocked('oidc_client_secret')) return
    setSavingField('oidc_client_secret')
    setError('')
    try {
      const updated = await settingsApi.patch({ oidc_client_secret: '__CLEAR__' })
      setData(updated)
      // The Clear button goes away with the secret.
      secretInputRef.current?.focus()
    } catch (e) {
      setError(errorMessage(e) || t('authSettings.oidc.saveFailed'))
    } finally {
      setSavingField(null)
    }
  }

  const handleCopyRedirect = () => {
    navigator.clipboard.writeText(data.oidc_redirect_uri)
    setRedirectCopied(true)
    later(() => setRedirectCopied(false), 1500)
  }

  // ---------- helpers ----------
  // A field's "Saved" tick, in a live region so it is announced, not only seen.
  const savedTick = (key: string, size: number) => (
    <span role="status" style={{ display: 'inline-flex' }}>
      {savedField === key && (
        <>
          <LuCircleCheck size={size} aria-hidden="true" style={{ color: 'var(--green)' }} />
          <span className="visually-hidden">{t('common.saved')}</span>
        </>
      )}
    </span>
  )

  const subBlock = (title: string, children: ReactNode) => (
    <div style={{ marginTop: 28 }}>
      <h4 style={subheadingStyle}>{title}</h4>
      {children}
    </div>
  )

  // A field's description: its "set by environment" note and its hint.
  const describedBy = (key: string, locked: boolean, hasHint: boolean) =>
    [locked && `${key}-locked`, hasHint && `${key}-hint`].filter(Boolean).join(' ') || undefined

  const fieldRow = ({ key, label, hint, type = 'text', placeholder = '' }: FieldRowProps) => {
    const locked = isLocked(key)
    return (
      <div key={key} style={{ marginBottom: 14 }}>
        {/* The input is named by the label text alone (aria-labelledby): the
            label also holds the saving spinner and "Saved" status, which would
            otherwise be read as part of the field's name. */}
        <label htmlFor={key} style={fieldLabelStyle}>
          <span id={`${key}-label`}>{label}</span>
          {locked && (
            <span
              id={`${key}-locked`}
              style={lockedTagStyle}
              title={t('authSettings.oidc.envLockedTitle')}
            >
              <LuLock size={10} /> {t('authSettings.oidc.envLocked')}
            </span>
          )}
          {savingField === key && <Spinner size={12} />}
          {savedTick(key, 13)}
        </label>
        <input
          id={key}
          type={type}
          aria-labelledby={`${key}-label`}
          aria-describedby={describedBy(key, locked, !!hint)}
          autoComplete="off"
          spellCheck={false}
          value={text(key)}
          onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
          onBlur={() => handleStringBlur(key)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              e.currentTarget.blur()
            }
          }}
          disabled={locked}
          placeholder={placeholder}
          style={{
            width: '100%',
            fontSize: 13,
            padding: '7px 10px',
            boxSizing: 'border-box',
            background: locked ? 'var(--bg-deep)' : 'var(--bg-input)',
            color: locked ? 'var(--text-muted)' : 'var(--text)',
            cursor: locked ? 'not-allowed' : 'text',
          }}
        />
        {hint && (
          <div
            id={`${key}-hint`}
            style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.4 }}
          >
            {hint}
          </div>
        )}
      </div>
    )
  }

  const checkboxRow = (key: string, label: string, hint?: ReactNode) => {
    const locked = isLocked(key)
    return (
      <div key={key} style={{ marginBottom: 14 }}>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            cursor: locked ? 'not-allowed' : 'pointer',
            opacity: locked ? 0.7 : 1,
            width: 'fit-content',
          }}
        >
          <input
            type="checkbox"
            checked={!!draft[key]}
            onChange={() => handleBoolToggle(key)}
            // Disabled only when locked. Disabling it while it saves would drop
            // focus from the box just toggled; aria-disabled says it is busy.
            disabled={locked}
            aria-disabled={savingField === key || undefined}
            aria-labelledby={`${key}-label`}
            aria-describedby={describedBy(key, locked, !!hint)}
            style={{
              width: 16,
              height: 16,
              accentColor: 'var(--gold)',
              cursor: locked ? 'not-allowed' : 'pointer',
            }}
          />
          <span id={`${key}-label`} style={{ fontSize: 14 }}>
            {label}
          </span>
          {locked && (
            <span id={`${key}-locked`} style={lockedTagStyle}>
              <LuLock size={10} /> {t('authSettings.oidc.envLocked')}
            </span>
          )}
          {savingField === key && <Spinner size={13} />}
          {savedTick(key, 14)}
        </label>
        {hint && (
          <div
            id={`${key}-hint`}
            style={{
              fontSize: 12,
              color: 'var(--text-muted)',
              marginTop: 4,
              lineHeight: 1.5,
              marginLeft: 26,
            }}
          >
            {hint}
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <h3 style={{ marginBottom: 6 }}>{t('authSettings.oidc.title')}</h3>
      <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.6 }}>
        {t('authSettings.oidc.description')}
      </p>

      {checkboxRow(
        'oidc_enabled',
        t('authSettings.oidc.enable'),
        t('authSettings.oidc.enableHint')
      )}

      {/* Redirect URI display */}
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 12,
          marginBottom: 20,
        }}
      >
        <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 6 }}>
          {t('authSettings.oidc.redirectUriLabel')}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <code
            style={{
              flex: 1,
              fontSize: 13,
              color: 'var(--gold)',
              wordBreak: 'break-all',
              background: 'var(--bg-deep)',
              padding: '6px 10px',
              borderRadius: 6,
            }}
          >
            {data.oidc_redirect_uri}
          </code>
          <button
            type="button"
            onClick={handleCopyRedirect}
            title={t('authSettings.oidc.copy')}
            aria-label={t('authSettings.oidc.copy')}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: redirectCopied ? 'var(--green)' : 'var(--text-muted)',
              display: 'flex',
              padding: 6,
            }}
          >
            {redirectCopied ? (
              <LuCircleCheck size={15} aria-hidden="true" />
            ) : (
              <LuCopy size={15} aria-hidden="true" />
            )}
          </button>
          <span role="status" className="visually-hidden">
            {redirectCopied ? t('authSettings.oidc.copied') : ''}
          </span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>
          {t('authSettings.oidc.redirectUriHint')}
        </div>
      </div>

      {enabled && (
        <>
          {!configured && (
            <p
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                fontSize: 14,
                lineHeight: 1.5,
                color: 'var(--warning)',
                margin: '0 0 8px',
              }}
            >
              <LuTriangleAlert
                size={16}
                aria-hidden="true"
                style={{ flexShrink: 0, marginTop: 2 }}
              />
              {t('authSettings.oidc.notConfigured')}
            </p>
          )}

          {subBlock(
            t('authSettings.oidc.groups.provider'),
            <>
              {/* Issuer URL with Autopopulate */}
              <div style={{ marginBottom: 14 }}>
                <label htmlFor="oidc_issuer_url" style={fieldLabelStyle}>
                  <span id="oidc_issuer_url-label">{t('authSettings.oidc.issuerUrl')}</span>
                  {isLocked('oidc_issuer_url') && (
                    <span id="oidc_issuer_url-locked" style={lockedTagStyle}>
                      <LuLock size={10} /> {t('authSettings.oidc.envLocked')}
                    </span>
                  )}
                  {savingField === 'oidc_issuer_url' && <Spinner size={12} />}
                  {savedTick('oidc_issuer_url', 13)}
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    id="oidc_issuer_url"
                    // text, not url: a url field trims what is typed, which
                    // would hide the "needs an issuer" check from a blank entry.
                    type="text"
                    inputMode="url"
                    autoComplete="off"
                    spellCheck={false}
                    aria-labelledby="oidc_issuer_url-label"
                    aria-describedby={describedBy(
                      'oidc_issuer_url',
                      isLocked('oidc_issuer_url'),
                      true
                    )}
                    aria-invalid={discoverError ? true : undefined}
                    aria-errormessage={discoverError ? 'oidc_issuer_url-error' : undefined}
                    value={text('oidc_issuer_url')}
                    onChange={(e) => setDraft((d) => ({ ...d, oidc_issuer_url: e.target.value }))}
                    onBlur={() => handleStringBlur('oidc_issuer_url')}
                    disabled={isLocked('oidc_issuer_url')}
                    placeholder="https://idp.example.com/realms/main"
                    style={{
                      flex: 1,
                      fontSize: 13,
                      padding: '7px 10px',
                      background: isLocked('oidc_issuer_url')
                        ? 'var(--bg-deep)'
                        : 'var(--bg-input)',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => !discovering && handleDiscover()}
                    // Not disabled mid-request: that would drop the focus it has.
                    disabled={!text('oidc_issuer_url')}
                    aria-disabled={discovering || undefined}
                    style={{
                      ...primaryBtnStyle,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      opacity: discovering || !text('oidc_issuer_url') ? 0.6 : 1,
                      cursor: discovering || !text('oidc_issuer_url') ? 'default' : 'pointer',
                    }}
                    title={t('authSettings.oidc.autopopulateTitle')}
                  >
                    <LuRefreshCw size={13} />{' '}
                    {discovering
                      ? t('authSettings.oidc.autopopulating')
                      : t('authSettings.oidc.autopopulate')}
                  </button>
                </div>
                {discoverError && (
                  <div
                    id="oidc_issuer_url-error"
                    role="alert"
                    style={{ fontSize: 12, color: 'var(--red)', marginTop: 6 }}
                  >
                    {discoverError}
                  </div>
                )}
                <div className="sr-only" role="status">
                  {discoverStatus}
                </div>
                <div
                  id="oidc_issuer_url-hint"
                  style={{
                    fontSize: 12,
                    color: 'var(--text-muted)',
                    marginTop: 4,
                    lineHeight: 1.5,
                  }}
                >
                  {t('authSettings.oidc.issuerUrlHint')}
                </div>
              </div>

              {fieldRow({
                key: 'oidc_token_issuer',
                label: t('authSettings.oidc.tokenIssuer'),
              })}
              {fieldRow({
                key: 'oidc_authorization_endpoint',
                label: t('authSettings.oidc.authorizationEndpoint'),
              })}
              {fieldRow({
                key: 'oidc_token_endpoint',
                label: t('authSettings.oidc.tokenEndpoint'),
              })}
              {fieldRow({
                key: 'oidc_userinfo_endpoint',
                label: t('authSettings.oidc.userinfoEndpoint'),
              })}
              {fieldRow({ key: 'oidc_jwks_uri', label: t('authSettings.oidc.jwksUri') })}
              {fieldRow({
                key: 'oidc_end_session_endpoint',
                label: t('authSettings.oidc.endSessionEndpoint'),
                hint: t('authSettings.oidc.endSessionHint'),
              })}
              {/* Signing alg */}
              <div style={{ marginBottom: 14 }}>
                <label htmlFor="oidc_signing_alg" style={fieldLabelStyle}>
                  <span id="oidc_signing_alg-label">{t('authSettings.oidc.signingAlg')}</span>
                  {isLocked('oidc_signing_alg') && (
                    <span id="oidc_signing_alg-locked" style={lockedTagStyle}>
                      <LuLock size={10} /> {t('authSettings.oidc.envLocked')}
                    </span>
                  )}
                </label>
                <select
                  id="oidc_signing_alg"
                  aria-labelledby="oidc_signing_alg-label"
                  aria-describedby={describedBy(
                    'oidc_signing_alg',
                    isLocked('oidc_signing_alg'),
                    !signingAlgSupported
                  )}
                  aria-invalid={!signingAlgSupported || undefined}
                  value={signingAlg}
                  onChange={(e) => handleSelectChange('oidc_signing_alg', e.target.value)}
                  disabled={isLocked('oidc_signing_alg')}
                  style={selectStyle}
                >
                  {/* A value saved before it stopped being offered (HS256), shown as
              what it is rather than silently as the first option. */}
                  {!signingAlgSupported && (
                    <option value={signingAlg} disabled>
                      {t('authSettings.oidc.signingAlgUnsupported', { alg: signingAlg })}
                    </option>
                  )}
                  {SIGNING_ALGS.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
                {!signingAlgSupported && (
                  <div
                    id="oidc_signing_alg-hint"
                    style={{ fontSize: 12, color: 'var(--red)', marginTop: 4, lineHeight: 1.5 }}
                  >
                    {t('authSettings.oidc.signingAlgUnsupportedHint')}
                  </div>
                )}
              </div>
            </>
          )}

          {subBlock(
            t('authSettings.oidc.groups.client'),
            <>
              {fieldRow({ key: 'oidc_client_id', label: t('authSettings.oidc.clientId') })}

              {/* Client secret — masked, set/clear pattern */}
              <div style={{ marginBottom: 14 }}>
                <label htmlFor="oidc_client_secret" style={fieldLabelStyle}>
                  <span id="oidc_client_secret-label">{t('authSettings.oidc.clientSecret')}</span>
                  {isLocked('oidc_client_secret') && (
                    <span style={lockedTagStyle}>
                      <LuLock size={10} /> {t('authSettings.oidc.envLocked')}
                    </span>
                  )}
                  {savingField === 'oidc_client_secret' && <Spinner size={12} />}
                  {savedTick('oidc_client_secret', 13)}
                </label>
                {data.oidc_client_secret_set && !secretDraft && !isLocked('oidc_client_secret') && (
                  <div
                    style={{
                      fontSize: 13,
                      color: 'var(--text-muted)',
                      padding: '7px 10px',
                      background: 'var(--bg-deep)',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      marginBottom: 6,
                      fontFamily: 'monospace',
                    }}
                  >
                    {/* A row of bullets is read as "bullet bullet bullet…". */}
                    <span aria-hidden="true">
                      {'•'.repeat(Math.min(data.oidc_client_secret_length || 0, 40))}
                    </span>
                    <span className="sr-only">{t('a11y.settingsAccess.secretIsSet')}</span>
                  </div>
                )}
                {!isLocked('oidc_client_secret') && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ flex: 1, position: 'relative' }}>
                      <input
                        ref={secretInputRef}
                        id="oidc_client_secret"
                        type={showSecret ? 'text' : 'password'}
                        aria-labelledby="oidc_client_secret-label"
                        autoComplete="off"
                        spellCheck={false}
                        value={secretDraft}
                        onChange={(e) => setSecretDraft(e.target.value)}
                        placeholder={
                          data.oidc_client_secret_set
                            ? t('authSettings.oidc.clientSecretReplace')
                            : t('authSettings.oidc.clientSecretPlaceholder')
                        }
                        style={{
                          width: '100%',
                          fontSize: 13,
                          padding: '7px 36px 7px 10px',
                          boxSizing: 'border-box',
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowSecret((v) => !v)}
                        title={
                          showSecret
                            ? t('authSettings.oidc.hideSecret')
                            : t('authSettings.oidc.showSecret')
                        }
                        aria-label={
                          showSecret
                            ? t('authSettings.oidc.hideSecret')
                            : t('authSettings.oidc.showSecret')
                        }
                        style={{
                          position: 'absolute',
                          right: 6,
                          top: '50%',
                          transform: 'translateY(-50%)',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          color: 'var(--text-muted)',
                          display: 'flex',
                          padding: 4,
                        }}
                      >
                        {showSecret ? <LuEyeOff size={14} /> : <LuEye size={14} />}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={handleSaveSecret}
                      disabled={!secretDraft || savingField === 'oidc_client_secret'}
                      aria-label={t('a11y.settingsAccess.saveSecret')}
                      style={{
                        ...primaryBtnStyle,
                        opacity: !secretDraft ? 0.5 : 1,
                        cursor: !secretDraft ? 'default' : 'pointer',
                      }}
                    >
                      {t('common.save')}
                    </button>
                    {data.oidc_client_secret_set && (
                      <button
                        type="button"
                        onClick={handleClearSecret}
                        disabled={savingField === 'oidc_client_secret'}
                        aria-label={t('a11y.settingsAccess.clearSecret')}
                        style={dangerBtnStyle}
                      >
                        {t('common.clear')}
                      </button>
                    )}
                  </div>
                )}
                {isLocked('oidc_client_secret') && (
                  <div
                    style={{
                      fontSize: 13,
                      color: 'var(--text-muted)',
                      padding: '7px 10px',
                      background: 'var(--bg-deep)',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      fontFamily: 'monospace',
                    }}
                  >
                    {/* A row of bullets is read as "bullet bullet bullet…". */}
                    <span aria-hidden="true">
                      {'•'.repeat(Math.min(data.oidc_client_secret_length || 0, 40))}
                    </span>
                    <span className="sr-only">{t('a11y.settingsAccess.secretIsSet')}</span>
                  </div>
                )}
              </div>
            </>
          )}

          {/* The button's text, colours, radius and icon, with a live preview. */}
          <div style={{ marginTop: 28 }}>
            <OIDCButtonAppearance data={data} onSaved={setData} />
          </div>

          {subBlock(
            t('authSettings.oidc.groups.roles'),
            <>
              {fieldRow({
                key: 'oidc_groups_claim',
                label: t('authSettings.oidc.groupsClaim'),
                hint: t('authSettings.oidc.groupsClaimHint'),
              })}
              {fieldRow({
                key: 'oidc_admin_group',
                label: t('authSettings.oidc.adminGroup'),
                placeholder: 'admin',
              })}
              {fieldRow({
                key: 'oidc_gm_group',
                label: t('authSettings.oidc.gmGroup'),
                placeholder: 'gm',
              })}
              {fieldRow({
                key: 'oidc_player_group',
                label: t('authSettings.oidc.playerGroup'),
                placeholder: 'player',
                hint: t('authSettings.oidc.roleGroupsHint'),
              })}
              {fieldRow({
                key: 'oidc_permissions_claim',
                label: t('authSettings.oidc.permissionsClaim'),
                hint: t('authSettings.oidc.permissionsClaimHint'),
              })}
            </>
          )}

          {subBlock(
            t('authSettings.oidc.groups.behaviour'),
            <>
              {/* Match by */}
              <div style={{ marginBottom: 14 }}>
                <label htmlFor="oidc_match_by" style={fieldLabelStyle}>
                  <span id="oidc_match_by-label">{t('authSettings.oidc.matchBy')}</span>
                  {isLocked('oidc_match_by') && (
                    <span id="oidc_match_by-locked" style={lockedTagStyle}>
                      <LuLock size={10} /> {t('authSettings.oidc.envLocked')}
                    </span>
                  )}
                </label>
                <select
                  id="oidc_match_by"
                  aria-labelledby="oidc_match_by-label"
                  aria-describedby={describedBy('oidc_match_by', isLocked('oidc_match_by'), true)}
                  value={text('oidc_match_by') || 'none'}
                  onChange={(e) => handleSelectChange('oidc_match_by', e.target.value)}
                  disabled={isLocked('oidc_match_by')}
                  style={selectStyle}
                >
                  {MATCH_BY_OPTIONS.map((m) => (
                    <option key={m} value={m}>
                      {t(`authSettings.oidc.matchByOptions.${m}`)}
                    </option>
                  ))}
                </select>
                <div
                  id="oidc_match_by-hint"
                  style={{
                    fontSize: 12,
                    color: 'var(--text-muted)',
                    marginTop: 4,
                    lineHeight: 1.5,
                  }}
                >
                  {t('authSettings.oidc.matchByHint')}
                </div>
              </div>

              {checkboxRow(
                'oidc_auto_launch',
                t('authSettings.oidc.autoLaunch'),
                t('authSettings.oidc.autoLaunchHint')
              )}
              {checkboxRow(
                'oidc_auto_register',
                t('authSettings.oidc.autoRegister'),
                t('authSettings.oidc.autoRegisterHint')
              )}
            </>
          )}
        </>
      )}

      {error && (
        <div role="alert" style={{ marginTop: 10, fontSize: 13, color: 'var(--red)' }}>
          {error}
        </div>
      )}
    </div>
  )
}

// A labelled block of related fields, a step below the setting's own h3, in
// the body face rather than the display one.
const subheadingStyle: CSSProperties = {
  fontFamily: "'Alegreya Sans', sans-serif",
  fontSize: 15,
  fontWeight: 700,
  letterSpacing: 0,
  color: 'var(--text-dim)',
  margin: '0 0 10px',
}

const fieldLabelStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
  color: 'var(--text-dim)',
  marginBottom: 5,
}

const lockedTagStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '0.04em',
  padding: '1px 6px',
  borderRadius: 4,
  background: 'rgba(180, 160, 100, 0.12)',
  color: 'var(--gold-dim)',
  border: '1px solid rgba(180, 160, 100, 0.4)',
}

const selectStyle: CSSProperties = {
  background: 'var(--bg-input)',
  border: '1px solid var(--border-control)',
  color: 'var(--text)',
  borderRadius: 6,
  padding: '7px 10px',
  fontSize: 13,
  width: '100%',
  maxWidth: 320,
}

const primaryBtnStyle: CSSProperties = {
  padding: '7px 14px',
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 500,
  background: 'var(--gold-dim)',
  color: 'var(--bg-deep)',
  border: '1px solid var(--gold-dim)',
  cursor: 'pointer',
}

const dangerBtnStyle: CSSProperties = {
  padding: '7px 14px',
  borderRadius: 6,
  fontSize: 13,
  background: 'rgba(180,60,60,0.12)',
  border: '1px solid rgba(180,60,60,0.4)',
  color: 'var(--danger)',
  cursor: 'pointer',
}
