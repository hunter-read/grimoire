import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCircleCheck, LuCopy, LuTriangleAlert } from 'react-icons/lu'

// Shown once, right after a key is created or regenerated: the only time the
// full key exists outside the integration it is pasted into.
export default function ApiKeyReveal({ apiKey, secret, onClose }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(secret)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // Clipboard can be unavailable (insecure origin); the key is selectable.
    }
  }

  const example = `curl -H "X-API-Key: ${secret}" ${window.location.origin}/api/stats`

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="api-key-reveal-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--scrim)',
      }}
    >
      <div
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: 24,
          width: 520,
          maxWidth: '92vw',
          boxSizing: 'border-box',
        }}
      >
        <h3 id="api-key-reveal-title" style={{ marginTop: 0, fontSize: 16, marginBottom: 8 }}>
          {t('appSettings.apiKeys.reveal.title', { name: apiKey.name })}
        </h3>
        <p
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'flex-start',
            fontSize: 13,
            color: 'var(--gold)',
            lineHeight: 1.5,
            marginBottom: 16,
          }}
        >
          <LuTriangleAlert size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          {t('appSettings.apiKeys.reveal.warning')}
        </p>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '8px 12px',
            marginBottom: 12,
          }}
        >
          <code
            data-testid="api-key-secret"
            style={{ flex: 1, fontSize: 13, wordBreak: 'break-all', color: 'var(--gold)' }}
          >
            {secret}
          </code>
          <button
            type="button"
            onClick={copy}
            aria-label={t('appSettings.apiKeys.reveal.copy')}
            title={t('appSettings.apiKeys.reveal.copy')}
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
            {copied ? (
              <LuCircleCheck size={15} style={{ color: 'var(--green)' }} />
            ) : (
              <LuCopy size={15} />
            )}
          </button>
        </div>
        {copied && (
          <div role="status" style={{ fontSize: 12, color: 'var(--green)', marginBottom: 8 }}>
            {t('appSettings.apiKeys.reveal.copied')}
          </div>
        )}
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
          {t('appSettings.apiKeys.reveal.example')}
        </div>
        <code
          style={{
            display: 'block',
            fontSize: 11,
            background: 'var(--bg-card)',
            padding: '6px 8px',
            borderRadius: 4,
            wordBreak: 'break-all',
            color: 'var(--text-dim)',
            marginBottom: 20,
          }}
        >
          {example}
        </code>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 16px',
              borderRadius: 6,
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              color: 'var(--text)',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {t('appSettings.apiKeys.reveal.done')}
          </button>
        </div>
      </div>
    </div>
  )
}
