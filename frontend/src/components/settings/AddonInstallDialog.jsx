import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuTriangleAlert, LuX } from 'react-icons/lu'
import AuthorByline from './AuthorByline'

/**
 * Install confirmation for a script-backed add-on (issue #203).
 *
 * Only shown when an add-on ships Python that will run on this server. It names
 * the script and its checksum, and the install button stays disabled until the
 * admin explicitly acknowledges — consent has to be a deliberate act, not a
 * reflexive click. YAML-only add-ons skip this entirely.
 *
 * Props:
 *   addon     – the index entry being installed
 *   updating  – true when re-approving an existing add-on's changed script
 *   onConfirm – () => void
 *   onClose   – () => void
 */
export default function AddonInstallDialog({ addon, updating = false, onConfirm, onClose }) {
  const { t } = useTranslation()
  const [acknowledged, setAcknowledged] = useState(false)

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const displayedChangelog = addon.changelog || []

  useEffect(() => {
    if (!addon.requires_script) {
      setAcknowledged(true)
    }
  }, [addon.requires_script])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="addon-install-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--scrim)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: 24,
          width: 460,
          maxWidth: '92vw',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxSizing: 'border-box',
          overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span id="addon-install-title" style={{ fontSize: 15, fontWeight: 600 }}>
              {t(updating ? 'addons.updateTitle' : 'addons.installTitle', { name: addon.name })}
            </span>
            <button
              onClick={onClose}
              aria-label={t('common.close')}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-muted)',
                display: 'flex',
                padding: 2,
              }}
            >
              <LuX size={16} />
            </button>
          </div>
          <AuthorByline author={addon.author} authorUrl={addon.author_url} />
          {addon.description && (
            <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 4, lineHeight: 1.4 }}>
              {addon.description}
            </div>
          )}
        </div>

        {displayedChangelog.length > 0 && (
          <div style={{ 
            display: 'flex', 
            flexDirection: 'column', 
            flexShrink: 0,
            marginBottom: 16
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5, flexShrink: 0 }}>What's New</div>
            <div style={{ 
              display: 'flex', 
              flexDirection: 'column', 
              gap: 12, 
              overflowY: 'auto', 
              maxHeight: 250,
              paddingRight: 8,
              background: 'var(--bg-deep)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: 12
            }}>
              {displayedChangelog.map((c) => (
                <div key={c.version}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
                    v{c.version}
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.5, color: 'var(--text-dim)' }}>
                    {c.changes.map((change, i) => (
                      <li key={i}>{change}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}

        {addon.requires_script && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              padding: 14,
              borderRadius: 6,
              background: 'var(--bg-deep)',
              border: '1px solid var(--warning, #d98324)',
              flexShrink: 0,
              marginBottom: 16
            }}
          >
            <div style={{ display: 'flex', gap: 10 }}>
              <LuTriangleAlert size={18} style={{ color: 'var(--warning, #d98324)', flexShrink: 0, marginTop: 2 }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <p style={{ fontSize: 13, lineHeight: 1.5, margin: 0 }}>
                  {t(updating ? 'addons.scriptUpdateWarning' : 'addons.scriptWarning')}
                </p>
                {addon.script_sha256 && (
                  <div
                    title="SHA-256 Checksum"
                    style={{
                      fontSize: 11,
                      color: 'var(--text-muted)',
                      fontFamily: 'monospace',
                      wordBreak: 'break-all',
                      userSelect: 'all',
                      opacity: 0.8
                    }}
                  >
                    {addon.script_sha256}
                  </div>
                )}
                {addon.source_url && (
                  <a
                    href={addon.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontSize: 12,
                      color: 'var(--gold, #d4af37)',
                      textDecoration: 'none',
                      marginTop: 2,
                      display: 'inline-block'
                    }}
                  >
                    View source code on GitHub ↗
                  </a>
                )}
              </div>
            </div>
            <div style={{ height: 1, background: 'var(--border)', margin: '2px 0', opacity: 0.5 }} />
            <label
              style={{
                display: 'flex',
                gap: 10,
                alignItems: 'center',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                style={{ margin: 0 }}
              />
              <span style={{ fontWeight: 500 }}>{t('addons.scriptAcknowledge')}</span>
            </label>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexShrink: 0 }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px',
              borderRadius: 6,
              background: 'none',
              border: '1px solid var(--border)',
              color: 'var(--text)',
              cursor: 'pointer',
            }}
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={onConfirm}
            disabled={!acknowledged}
            style={{
              padding: '8px 20px',
              borderRadius: 6,
              border: 'none',
              background: acknowledged ? 'var(--gold-dim)' : 'var(--bg-deep)',
              color: acknowledged ? 'var(--bg-deep)' : 'var(--text-muted)',
              fontWeight: 600,
              cursor: acknowledged ? 'pointer' : 'default',
            }}
          >
            {t(updating ? 'addons.update' : 'addons.install')}
          </button>
        </div>
      </div>
    </div>
  )
}
