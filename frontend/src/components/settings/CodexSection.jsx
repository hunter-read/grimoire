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
 * Admin settings for Grimoire Codex DB (issue #35), the built-in metadata source.
 *
 * Only rendered on a server with GRIMOIRE_CODEX_DB_API_TOKEN set (see AddonsTab). The token
 * itself lives only in the environment and never reaches the page; setting it is
 * what turns Grimoire Codex DB on. Lookup only runs when someone fetches metadata. A setting pinned by a
 * GRIMOIRE_CODEX_DB_* environment variable shows read-only.
 */
export default function CodexSection() {
  const { t } = useTranslation()
  const [values, setValues] = useState(null)
  const [url, setUrl] = useState('')
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
    api
      .put('/codex/settings', patch)
      .then((s) => {
        setValues(s)
        setUrl(s.url)
        // The source list and the editors' Grimoire Codex DB panel both read these.
        clearMetadataSourcesCache()
        clearCodexStatusCache()
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      })
      .catch((e) => setError(e.message))
      .finally(() => setSaving(false))
  }

  const saveUrl = () => {
    if (url.trim() && url.trim() !== values.url) save({ url: url.trim() })
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
                ? t('codex.settings.lockedBy', { name: 'GRIMOIRE_CODEX_DB_URL' })
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
                ? t('codex.settings.lockedBy', { name: 'GRIMOIRE_CODEX_DB_SEND_HASHES' })
                : t('codex.settings.sendHashesHint')
            }
          />

          <p style={{ ...hintText, margin: 0 }}>{t('codex.settings.tokenFromEnv')}</p>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button type="button" onClick={runTest} disabled={test?.busy} style={button}>
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
