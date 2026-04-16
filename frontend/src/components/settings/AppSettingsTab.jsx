import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCircleCheck, LuKey, LuCopy, LuTrash } from 'react-icons/lu'
import { settings as settingsApi } from '../../api'
import Spinner from '../Spinner'

// ---------------------------------------------------------------------------
// Sidebar Visibility section
// ---------------------------------------------------------------------------

function SidebarVisibilitySection() {
  const { t } = useTranslation()
  const [values,  setValues]  = useState(null)
  const [saving,  setSaving]  = useState(null)
  const [saved,   setSaved]   = useState(null)

  const VISIBILITY_ITEMS = [
    { key: 'hide_maps',      label: t('appSettings.sidebarVisibility.hideMaps')      },
    { key: 'hide_tokens',    label: t('appSettings.sidebarVisibility.hideTokens')    },
    { key: 'hide_campaigns', label: t('appSettings.sidebarVisibility.hideCampaigns') },
  ]

  useEffect(() => {
    settingsApi.get()
      .then(d => setValues({ hide_maps: d.hide_maps, hide_tokens: d.hide_tokens, hide_campaigns: d.hide_campaigns }))
      .catch(() => setValues({ hide_maps: false, hide_tokens: false, hide_campaigns: false }))
  }, [])

  const toggle = async (key) => {
    const next = !values[key]
    setValues(v => ({ ...v, [key]: next }))
    setSaving(key)
    try {
      await settingsApi.patch({ [key]: next })
      setSaved(key)
      setTimeout(() => setSaved(null), 2000)
      window.dispatchEvent(new CustomEvent('grimoire:settings-changed'))
    } finally {
      setSaving(null)
    }
  }

  return (
    <div style={{ marginBottom: 40 }}>
      <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>{t('appSettings.sidebarVisibility.title')}</h3>
      <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.6 }}>
        {t('appSettings.sidebarVisibility.description')}
      </p>

      {values === null ? <Spinner size={20} /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {VISIBILITY_ITEMS.map(({ key, label }) => (
            <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', width: 'fit-content' }}>
              <input
                type="checkbox"
                checked={values[key]}
                onChange={() => toggle(key)}
                disabled={saving === key}
                style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--gold)' }}
              />
              <span style={{ fontSize: 14, color: 'var(--text)' }}>{label}</span>
              {saving === key && <Spinner size={13} />}
              {saved === key && <LuCircleCheck size={14} style={{ color: 'var(--green)' }} />}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stats Display section
// ---------------------------------------------------------------------------

function StatsDisplaySection() {
  const { t } = useTranslation()
  const [values, setValues] = useState(null)
  const [saving, setSaving] = useState(null)
  const [saved,  setSaved]  = useState(null)

  const STAT_ITEMS = [
    { key: 'show_stat_systems', label: t('stats.systems') },
    { key: 'show_stat_books',   label: t('stats.books')   },
    { key: 'show_stat_pages',   label: t('stats.pages')   },
    { key: 'show_stat_maps',    label: t('stats.maps')    },
    { key: 'show_stat_tokens',  label: t('stats.tokens')  },
    { key: 'show_stat_size',    label: t('stats.size')    },
  ]

  useEffect(() => {
    settingsApi.get()
      .then(d => setValues(Object.fromEntries(STAT_ITEMS.map(({ key }) => [key, d[key] ?? false]))))
      .catch(() => setValues(Object.fromEntries(STAT_ITEMS.map(({ key }) => [key, false]))))
  }, [])

  const toggle = async (key) => {
    const next = !values[key]
    setValues(v => ({ ...v, [key]: next }))
    setSaving(key)
    try {
      await settingsApi.patch({ [key]: next })
      setSaved(key)
      setTimeout(() => setSaved(null), 2000)
      window.dispatchEvent(new CustomEvent('grimoire:settings-changed'))
    } finally {
      setSaving(null)
    }
  }

  return (
    <div style={{ marginBottom: 40 }}>
      <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>{t('appSettings.sidebarStats.title')}</h3>
      <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.6 }}>
        {t('appSettings.sidebarStats.description')}
      </p>
      {values === null ? <Spinner size={20} /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {STAT_ITEMS.map(({ key, label }) => (
            <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', width: 'fit-content' }}>
              <input
                type="checkbox"
                checked={values[key]}
                onChange={() => toggle(key)}
                disabled={saving === key}
                style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--gold)' }}
              />
              <span style={{ fontSize: 14, color: 'var(--text)' }}>{label}</span>
              {saving === key && <Spinner size={13} />}
              {saved === key && <LuCircleCheck size={14} style={{ color: 'var(--green)' }} />}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stats API Key section
// ---------------------------------------------------------------------------

function ApiKeySection() {
  const { t } = useTranslation()
  const [apiKey,   setApiKey]   = useState(null)
  const [copying,  setCopying]  = useState(false)
  const [working,  setWorking]  = useState(false)

  useEffect(() => {
    settingsApi.get().then(d => setApiKey(d.stats_api_key || '')).catch(() => setApiKey(''))
  }, [])

  const handleGenerate = async () => {
    setWorking(true)
    try {
      const d = await settingsApi.generateApiKey()
      setApiKey(d.stats_api_key)
    } finally {
      setWorking(false)
    }
  }

  const handleRevoke = async () => {
    setWorking(true)
    try {
      await settingsApi.revokeApiKey()
      setApiKey('')
    } finally {
      setWorking(false)
    }
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(apiKey)
    setCopying(true)
    setTimeout(() => setCopying(false), 1800)
  }

  const statsUrl = `${window.location.origin}/api/stats`

  return (
    <div>
      <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>{t('appSettings.apiKey.title')}</h3>
      <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.6 }}>
        {t('appSettings.apiKey.description')}{' '}
        <code style={{ fontSize: 12, background: 'var(--bg-card)', padding: '1px 5px', borderRadius: 4 }}>X-API-Key</code>
        {' '}{t('appSettings.apiKey.descriptionSuffix')}
      </p>

      {apiKey === null ? <Spinner size={20} /> : apiKey ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 8, padding: '8px 12px',
          }}>
            <code style={{ flex: 1, fontSize: 13, wordBreak: 'break-all', color: 'var(--gold)' }}>{apiKey}</code>
            <button
              onClick={handleCopy}
              title={t('appSettings.apiKey.copyKey')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: 4, flexShrink: 0 }}
            >
              {copying ? <LuCircleCheck size={15} style={{ color: 'var(--green)' }} /> : <LuCopy size={15} />}
            </button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', wordBreak: 'break-all' }}>
            {t('appSettings.apiKey.endpoint')} <span style={{ color: 'var(--text-dim)' }}>{statsUrl}</span>
            <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>{t('appSettings.apiKey.set')} <code style={{ fontSize: 11, background: 'var(--bg-card)', padding: '1px 4px', borderRadius: 3 }}>X-API-Key: {apiKey}</code></span>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              onClick={handleGenerate}
              disabled={working}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '8px 16px', borderRadius: 6, fontSize: 14,
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                color: 'var(--text-dim)', cursor: working ? 'default' : 'pointer',
              }}
            >
              <LuKey size={13} /> {t('appSettings.apiKey.regenerate')}
            </button>
            <button
              onClick={handleRevoke}
              disabled={working}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '8px 16px', borderRadius: 6, fontSize: 14,
                background: 'rgba(180,60,60,0.1)', border: '1px solid rgba(180,60,60,0.4)',
                color: '#e07070', cursor: working ? 'default' : 'pointer',
              }}
            >
              <LuTrash size={13} /> {t('appSettings.apiKey.revoke')}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={handleGenerate}
          disabled={working}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '8px 18px', borderRadius: 6, fontSize: 14, fontWeight: 500,
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            color: 'var(--text-dim)', cursor: working ? 'default' : 'pointer',
          }}
        >
          {working ? <Spinner size={13} /> : <LuKey size={13} />}
          {working ? t('appSettings.apiKey.generating') : t('appSettings.apiKey.generate')}
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab root
// ---------------------------------------------------------------------------

export default function AppSettingsTab() {
  return (
    <div>
      <SidebarVisibilitySection />
      <div style={{ borderTop: '1px solid var(--border)', marginBottom: 40 }} />
      <StatsDisplaySection />
      <div style={{ borderTop: '1px solid var(--border)', marginBottom: 40 }} />
      <ApiKeySection />
    </div>
  )
}
