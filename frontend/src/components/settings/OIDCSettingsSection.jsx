import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCircleCheck, LuRefreshCw, LuCopy, LuLock, LuEye, LuEyeOff } from 'react-icons/lu'
import api, { settings as settingsApi } from '../../api'
import Spinner from '../Spinner'

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
  'HS256',
]
const MATCH_BY_OPTIONS = ['none', 'email', 'username']

const STRING_FIELDS = [
  'oidc_issuer_url',
  'oidc_authorization_endpoint',
  'oidc_token_endpoint',
  'oidc_userinfo_endpoint',
  'oidc_jwks_uri',
  'oidc_end_session_endpoint',
  'oidc_client_id',
  'oidc_signing_alg',
  'oidc_button_text',
  'oidc_groups_claim',
  'oidc_permissions_claim',
  'oidc_match_by',
]

const BOOL_FIELDS = ['oidc_enabled', 'oidc_auto_launch', 'oidc_auto_register']

export default function OIDCSettingsSection() {
  const { t } = useTranslation()
  const [data, setData] = useState(null)
  const [draft, setDraft] = useState({})
  const [secretDraft, setSecretDraft] = useState('') // empty = no change
  const [showSecret, setShowSecret] = useState(false)
  const [discovering, setDiscovering] = useState(false)
  const [discoverError, setDiscoverError] = useState('')
  const [savingField, setSavingField] = useState(null)
  const [savedField, setSavedField] = useState(null)
  const [error, setError] = useState('')
  const [redirectCopied, setRedirectCopied] = useState(false)

  const reload = useCallback(() => {
    settingsApi.get().then(setData)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  // Mirror server values into draft state once they arrive
  useEffect(() => {
    if (!data) return
    const next = {}
    for (const k of STRING_FIELDS) next[k] = data[k] ?? ''
    for (const k of BOOL_FIELDS) next[k] = !!data[k]
    setDraft(next)
  }, [data])

  if (!data) return <Spinner size={20} />

  const isLocked = (key) => !!data[`${key}_env_locked`]

  const saveField = async (key, value) => {
    if (isLocked(key)) return
    setSavingField(key)
    setError('')
    try {
      const updated = await settingsApi.patch({ [key]: value })
      setData(updated)
      setSavedField(key)
      setTimeout(() => setSavedField(null), 1800)
    } catch (e) {
      setError(e?.message || t('authSettings.oidc.saveFailed'))
    } finally {
      setSavingField(null)
    }
  }

  const handleStringBlur = (key) => {
    const v = draft[key] ?? ''
    if (v === (data[key] ?? '')) return
    saveField(key, v)
  }

  const handleBoolToggle = (key) => {
    const next = !draft[key]
    setDraft((d) => ({ ...d, [key]: next }))
    saveField(key, next)
  }

  const handleSelectChange = (key, value) => {
    setDraft((d) => ({ ...d, [key]: value }))
    saveField(key, value)
  }

  const handleDiscover = async () => {
    const issuer = (draft.oidc_issuer_url || '').trim()
    if (!issuer) {
      setDiscoverError(t('authSettings.oidc.discoverNeedsIssuer'))
      return
    }
    setDiscovering(true)
    setDiscoverError('')
    try {
      const doc = await api.post('/auth/openid/discover', { issuer_url: issuer })
      // Populate empty fields; don't overwrite values the admin already set.
      const updates = {}
      const fillIfEmpty = (key, value) => {
        if (!value) return
        if (isLocked(key)) return
        if ((draft[key] || '').trim()) return
        updates[key] = value
      }
      fillIfEmpty('oidc_authorization_endpoint', doc.authorization_endpoint)
      fillIfEmpty('oidc_token_endpoint', doc.token_endpoint)
      fillIfEmpty('oidc_userinfo_endpoint', doc.userinfo_endpoint)
      fillIfEmpty('oidc_jwks_uri', doc.jwks_uri)
      fillIfEmpty('oidc_end_session_endpoint', doc.end_session_endpoint)
      if (Object.keys(updates).length > 0) {
        const updated = await settingsApi.patch(updates)
        setData(updated)
      }
    } catch (e) {
      setDiscoverError(e?.message || t('authSettings.oidc.discoverFailed'))
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
      setTimeout(() => setSavedField(null), 1800)
    } catch (e) {
      setError(e?.message || t('authSettings.oidc.saveFailed'))
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
    } catch (e) {
      setError(e?.message || t('authSettings.oidc.saveFailed'))
    } finally {
      setSavingField(null)
    }
  }

  const handleCopyRedirect = () => {
    navigator.clipboard.writeText(data.oidc_redirect_uri)
    setRedirectCopied(true)
    setTimeout(() => setRedirectCopied(false), 1500)
  }

  // ---------- helpers ----------
  const fieldRow = ({ key, label, hint, type = 'text', placeholder = '' }) => {
    const locked = isLocked(key)
    return (
      <div key={key} style={{ marginBottom: 14 }}>
        <label style={fieldLabelStyle}>
          <span>{label}</span>
          {locked && (
            <span style={lockedTagStyle} title={t('authSettings.oidc.envLockedTitle')}>
              <LuLock size={10} /> {t('authSettings.oidc.envLocked')}
            </span>
          )}
          {savingField === key && <Spinner size={12} />}
          {savedField === key && <LuCircleCheck size={13} style={{ color: 'var(--green)' }} />}
        </label>
        <input
          type={type}
          value={draft[key] ?? ''}
          onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
          onBlur={() => handleStringBlur(key)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              e.target.blur()
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
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.4 }}>
            {hint}
          </div>
        )}
      </div>
    )
  }

  const checkboxRow = (key, label, hint) => {
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
            disabled={locked || savingField === key}
            style={{
              width: 16,
              height: 16,
              accentColor: 'var(--gold)',
              cursor: locked ? 'not-allowed' : 'pointer',
            }}
          />
          <span style={{ fontSize: 14 }}>{label}</span>
          {locked && (
            <span style={lockedTagStyle}>
              <LuLock size={10} /> {t('authSettings.oidc.envLocked')}
            </span>
          )}
          {savingField === key && <Spinner size={13} />}
          {savedField === key && <LuCircleCheck size={14} style={{ color: 'var(--green)' }} />}
        </label>
        {hint && (
          <div
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
      <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>
        {t('authSettings.oidc.title')}
      </h3>
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
            onClick={handleCopyRedirect}
            title={t('authSettings.oidc.copy')}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: redirectCopied ? 'var(--green)' : 'var(--text-muted)',
              display: 'flex',
              padding: 6,
            }}
          >
            {redirectCopied ? <LuCircleCheck size={15} /> : <LuCopy size={15} />}
          </button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>
          {t('authSettings.oidc.redirectUriHint')}
        </div>
      </div>

      {/* Issuer URL with Autopopulate */}
      <div style={{ marginBottom: 14 }}>
        <label style={fieldLabelStyle}>
          <span>{t('authSettings.oidc.issuerUrl')}</span>
          {isLocked('oidc_issuer_url') && (
            <span style={lockedTagStyle}>
              <LuLock size={10} /> {t('authSettings.oidc.envLocked')}
            </span>
          )}
          {savingField === 'oidc_issuer_url' && <Spinner size={12} />}
          {savedField === 'oidc_issuer_url' && (
            <LuCircleCheck size={13} style={{ color: 'var(--green)' }} />
          )}
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            value={draft.oidc_issuer_url ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, oidc_issuer_url: e.target.value }))}
            onBlur={() => handleStringBlur('oidc_issuer_url')}
            disabled={isLocked('oidc_issuer_url')}
            placeholder="https://idp.example.com/realms/main"
            style={{
              flex: 1,
              fontSize: 13,
              padding: '7px 10px',
              background: isLocked('oidc_issuer_url') ? 'var(--bg-deep)' : 'var(--bg-input)',
            }}
          />
          <button
            type="button"
            onClick={handleDiscover}
            disabled={discovering || !draft.oidc_issuer_url}
            style={{
              ...primaryBtnStyle,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              opacity: discovering || !draft.oidc_issuer_url ? 0.6 : 1,
              cursor: discovering || !draft.oidc_issuer_url ? 'default' : 'pointer',
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
          <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 6 }}>{discoverError}</div>
        )}
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>
          {t('authSettings.oidc.issuerUrlHint')}
        </div>
      </div>

      {fieldRow({
        key: 'oidc_authorization_endpoint',
        label: t('authSettings.oidc.authorizationEndpoint'),
      })}
      {fieldRow({ key: 'oidc_token_endpoint', label: t('authSettings.oidc.tokenEndpoint') })}
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
      {fieldRow({ key: 'oidc_client_id', label: t('authSettings.oidc.clientId') })}

      {/* Client secret — masked, set/clear pattern */}
      <div style={{ marginBottom: 14 }}>
        <label style={fieldLabelStyle}>
          <span>{t('authSettings.oidc.clientSecret')}</span>
          {isLocked('oidc_client_secret') && (
            <span style={lockedTagStyle}>
              <LuLock size={10} /> {t('authSettings.oidc.envLocked')}
            </span>
          )}
          {savingField === 'oidc_client_secret' && <Spinner size={12} />}
          {savedField === 'oidc_client_secret' && (
            <LuCircleCheck size={13} style={{ color: 'var(--green)' }} />
          )}
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
            {'•'.repeat(Math.min(data.oidc_client_secret_length || 0, 40))}
          </div>
        )}
        {!isLocked('oidc_client_secret') && (
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <input
                type={showSecret ? 'text' : 'password'}
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
                  showSecret ? t('authSettings.oidc.hideSecret') : t('authSettings.oidc.showSecret')
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
            {'•'.repeat(Math.min(data.oidc_client_secret_length || 0, 40))}
          </div>
        )}
      </div>

      {/* Signing alg */}
      <div style={{ marginBottom: 14 }}>
        <label style={fieldLabelStyle}>
          <span>{t('authSettings.oidc.signingAlg')}</span>
          {isLocked('oidc_signing_alg') && (
            <span style={lockedTagStyle}>
              <LuLock size={10} /> {t('authSettings.oidc.envLocked')}
            </span>
          )}
        </label>
        <select
          value={draft.oidc_signing_alg || 'RS256'}
          onChange={(e) => handleSelectChange('oidc_signing_alg', e.target.value)}
          disabled={isLocked('oidc_signing_alg')}
          style={selectStyle}
        >
          {SIGNING_ALGS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>

      {fieldRow({
        key: 'oidc_button_text',
        label: t('authSettings.oidc.buttonText'),
        hint: t('authSettings.oidc.buttonTextHint'),
      })}
      {fieldRow({
        key: 'oidc_groups_claim',
        label: t('authSettings.oidc.groupsClaim'),
        hint: t('authSettings.oidc.groupsClaimHint'),
      })}
      {fieldRow({
        key: 'oidc_permissions_claim',
        label: t('authSettings.oidc.permissionsClaim'),
        hint: t('authSettings.oidc.permissionsClaimHint'),
      })}

      {/* Match by */}
      <div style={{ marginBottom: 14 }}>
        <label style={fieldLabelStyle}>
          <span>{t('authSettings.oidc.matchBy')}</span>
          {isLocked('oidc_match_by') && (
            <span style={lockedTagStyle}>
              <LuLock size={10} /> {t('authSettings.oidc.envLocked')}
            </span>
          )}
        </label>
        <select
          value={draft.oidc_match_by || 'none'}
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
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>
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

      {error && <div style={{ marginTop: 10, fontSize: 13, color: 'var(--red)' }}>{error}</div>}
    </div>
  )
}

const fieldLabelStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
  color: 'var(--text-dim)',
  marginBottom: 5,
}

const lockedTagStyle = {
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

const selectStyle = {
  background: 'var(--bg-input)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  borderRadius: 6,
  padding: '7px 10px',
  fontSize: 13,
  width: '100%',
  maxWidth: 320,
}

const primaryBtnStyle = {
  padding: '7px 14px',
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 500,
  background: 'var(--gold-dim)',
  color: 'var(--bg-deep)',
  border: '1px solid var(--gold-dim)',
  cursor: 'pointer',
}

const dangerBtnStyle = {
  padding: '7px 14px',
  borderRadius: 6,
  fontSize: 13,
  background: 'rgba(180,60,60,0.12)',
  border: '1px solid rgba(180,60,60,0.4)',
  color: '#e07070',
  cursor: 'pointer',
}
