import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCircleCheck } from 'react-icons/lu'
import api from '../../api'
import Spinner from '../Spinner'
import CollapsibleSection from './CollapsibleSection'
import SettingToggle from './SettingToggle'
import { clearCodexStatusCache } from '../codex/useCodexStatus'
import { clearMetadataSourcesCache } from '../system/useMetadataSources'

/**
 * Admin settings for GrimoireCodexDB (issue #35), the built-in metadata source.
 *
 * Lookup is on by default and only runs when someone fetches metadata. Sending
 * records needs an API token from a GrimoireCodexDB account; the token is write-only, so
 * the page only ever knows whether one is set. A setting pinned by a CODEX_*
 * environment variable shows read-only.
 */
export default function CodexSection() {
  const { t } = useTranslation()
  const [values, setValues] = useState(null)
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [test, setTest] = useState(null)

  useEffect(() => {
    api
      .get('/codex/settings')
      .then((s) => {
        setValues(s)
        setUrl(s.url)
      })
      .catch((e) => setError(e.message))
  }, [])

  const locked = (key) => values?.locked?.includes(key)

  const save = (patch) => {
    setSaving(true)
    setError('')
    setTest(null)
    return api
      .put('/codex/settings', patch)
      .then((s) => {
        setValues(s)
        setUrl(s.url)
        // The source list and the editors' GrimoireCodexDB panel both read these.
        clearMetadataSourcesCache()
        clearCodexStatusCache()
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
        return true
      })
      .catch((e) => {
        setError(e.message)
        return false
      })
      .finally(() => setSaving(false))
  }

  const saveUrl = () => {
    if (url.trim() && url.trim() !== values.url) save({ url: url.trim() })
  }

  const saveToken = () => {
    if (token.trim()) save({ api_token: token.trim() }).then((ok) => ok && setToken(''))
  }

  const runTest = () => {
    setTest({ busy: true })
    setError('')
    api
      .post('/codex/test')
      .then((r) => setTest({ result: r }))
      .catch((e) => setTest({ error: e.message }))
  }

  const title = (
    <>
      {t('codex.settings.title')}
      {saving && <Spinner size={13} style={{ marginLeft: 8 }} />}
      {saved && <LuCircleCheck size={14} style={{ color: 'var(--green)', marginLeft: 8 }} />}
    </>
  )

  return (
    <CollapsibleSection
      title={title}
      description={t('codex.settings.description')}
      storageKey="grimoire:settings:codex"
    >
      {values === null ? (
        error ? (
          <p role="alert" style={errorText}>
            {error}
          </p>
        ) : (
          <Spinner size={20} />
        )
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 560 }}>
          <SettingToggle
            id="codex-enabled"
            checked={values.enabled}
            disabled={saving || locked('enabled')}
            onChange={(v) => save({ enabled: v })}
            label={t('codex.settings.enabled')}
            hint={
              locked('enabled') ? t('codex.settings.lockedBy', { name: 'CODEX_ENABLED' }) : null
            }
          />

          <div>
            <label htmlFor="codex-url" style={label}>
              {t('codex.settings.url')}
            </label>
            <input
              id="codex-url"
              type="url"
              value={url}
              disabled={locked('url')}
              onChange={(e) => setUrl(e.target.value)}
              onBlur={saveUrl}
              onKeyDown={(e) => e.key === 'Enter' && saveUrl()}
              spellCheck={false}
              autoComplete="off"
              style={input}
            />
            <p style={hintText}>
              {locked('url')
                ? t('codex.settings.lockedBy', { name: 'CODEX_URL' })
                : t('codex.settings.urlHint')}
            </p>
          </div>

          <SettingToggle
            id="codex-send-hashes"
            checked={values.send_hashes}
            disabled={saving || locked('send_hashes')}
            onChange={(v) => save({ send_hashes: v })}
            label={t('codex.settings.sendHashes')}
            hint={
              locked('send_hashes')
                ? t('codex.settings.lockedBy', { name: 'CODEX_SEND_HASHES' })
                : t('codex.settings.sendHashesHint')
            }
          />

          <div>
            <label htmlFor="codex-token" style={label}>
              {t('codex.settings.token')}
            </label>
            {locked('api_token') ? (
              <p style={hintText}>{t('codex.settings.lockedBy', { name: 'CODEX_API_TOKEN' })}</p>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input
                    id="codex-token"
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && saveToken()}
                    placeholder={
                      values.has_token
                        ? t('codex.settings.tokenSaved')
                        : t('codex.settings.tokenPlaceholder')
                    }
                    autoComplete="off"
                    spellCheck={false}
                    style={{ ...input, flex: '1 1 220px' }}
                  />
                  <button
                    type="button"
                    onClick={saveToken}
                    disabled={saving || !token.trim()}
                    style={button}
                  >
                    {t('codex.settings.saveToken')}
                  </button>
                  {values.has_token && (
                    <button
                      type="button"
                      onClick={() => save({ api_token: '' })}
                      disabled={saving}
                      style={button}
                    >
                      {t('codex.settings.removeToken')}
                    </button>
                  )}
                </div>
                <p style={hintText}>{t('codex.settings.tokenHint')}</p>
              </>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={runTest}
              disabled={!values.enabled || test?.busy}
              style={button}
            >
              {t('codex.settings.test')}
            </button>
            {test?.busy && <Spinner size={14} />}
            {test?.result && (
              <span role="status" style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                {test.result.account
                  ? t('codex.settings.connectedAs', test.result.account)
                  : t('codex.settings.connected')}
              </span>
            )}
            {test?.error && (
              <span role="alert" style={{ ...errorText, margin: 0 }}>
                {test.error}
              </span>
            )}
          </div>

          {error && (
            <p role="alert" style={errorText}>
              {error}
            </p>
          )}
        </div>
      )}
    </CollapsibleSection>
  )
}

const label = { fontSize: 13, color: 'var(--text-dim)', display: 'block', marginBottom: 6 }

const hintText = { fontSize: 12, color: 'var(--text-muted)', margin: '6px 0 0', lineHeight: 1.5 }

const errorText = { fontSize: 13, color: 'var(--danger)', margin: 0 }

const input = {
  width: '100%',
  padding: '7px 10px',
  background: 'var(--bg-deep)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text)',
  fontSize: 14,
}

const button = {
  padding: '7px 14px',
  borderRadius: 6,
  background: 'none',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  fontSize: 13,
  cursor: 'pointer',
}
