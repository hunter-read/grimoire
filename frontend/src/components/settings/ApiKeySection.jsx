import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCircleCheck, LuKey, LuCopy, LuTrash } from 'react-icons/lu'
import { settings as settingsApi } from '../../api'
import Spinner from '../Spinner'

export default function ApiKeySection() {
  const { t } = useTranslation()
  const [apiKey, setApiKey] = useState(null)
  const [copying, setCopying] = useState(false)
  const [working, setWorking] = useState(false)

  useEffect(() => {
    settingsApi
      .get()
      .then((d) => setApiKey(d.stats_api_key || ''))
      .catch(() => setApiKey(''))
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
      <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>
        {t('appSettings.apiKey.title')}
      </h3>
      <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.6 }}>
        {t('appSettings.apiKey.description')}{' '}
        <code
          style={{
            fontSize: 12,
            background: 'var(--bg-card)',
            padding: '1px 5px',
            borderRadius: 4,
          }}
        >
          X-API-Key
        </code>{' '}
        {t('appSettings.apiKey.descriptionSuffix')}
      </p>

      {apiKey === null ? (
        <Spinner size={20} />
      ) : apiKey ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '8px 12px',
            }}
          >
            <code style={{ flex: 1, fontSize: 13, wordBreak: 'break-all', color: 'var(--gold)' }}>
              {apiKey}
            </code>
            <button
              onClick={handleCopy}
              title={t('appSettings.apiKey.copyKey')}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-muted)',
                display: 'flex',
                padding: 4,
                flexShrink: 0,
              }}
            >
              {copying ? (
                <LuCircleCheck size={15} style={{ color: 'var(--green)' }} />
              ) : (
                <LuCopy size={15} />
              )}
            </button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', wordBreak: 'break-all' }}>
            {t('appSettings.apiKey.endpoint')}{' '}
            <span style={{ color: 'var(--text-dim)' }}>{statsUrl}</span>
            <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>
              {t('appSettings.apiKey.set')}{' '}
              <code
                style={{
                  fontSize: 11,
                  background: 'var(--bg-card)',
                  padding: '1px 4px',
                  borderRadius: 3,
                }}
              >
                X-API-Key: {apiKey}
              </code>
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              onClick={handleGenerate}
              disabled={working}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 16px',
                borderRadius: 6,
                fontSize: 14,
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                color: 'var(--text-dim)',
                cursor: working ? 'default' : 'pointer',
              }}
            >
              <LuKey size={13} /> {t('appSettings.apiKey.regenerate')}
            </button>
            <button
              onClick={handleRevoke}
              disabled={working}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 16px',
                borderRadius: 6,
                fontSize: 14,
                background: 'rgba(180,60,60,0.1)',
                border: '1px solid rgba(180,60,60,0.4)',
                color: '#e07070',
                cursor: working ? 'default' : 'pointer',
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
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 18px',
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 500,
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            color: 'var(--text-dim)',
            cursor: working ? 'default' : 'pointer',
          }}
        >
          {working ? <Spinner size={13} /> : <LuKey size={13} />}
          {working ? t('appSettings.apiKey.generating') : t('appSettings.apiKey.generate')}
        </button>
      )}
    </div>
  )
}
