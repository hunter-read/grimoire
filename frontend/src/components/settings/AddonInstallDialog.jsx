import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuTriangleAlert, LuX } from 'react-icons/lu'

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
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
          }}
        >
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

        <div
          style={{
            display: 'flex',
            gap: 10,
            padding: 12,
            borderRadius: 6,
            background: 'var(--bg-deep)',
            border: '1px solid var(--warning, #d98324)',
            marginBottom: 12,
          }}
        >
          <LuTriangleAlert size={18} style={{ color: 'var(--warning, #d98324)', flexShrink: 0 }} />
          <p style={{ fontSize: 13, lineHeight: 1.6, margin: 0 }}>
            {t(updating ? 'addons.scriptUpdateWarning' : 'addons.scriptWarning')}
          </p>
        </div>

        {addon.script_sha256 && (
          <p
            style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              fontFamily: 'monospace',
              wordBreak: 'break-all',
              marginBottom: 12,
            }}
          >
            sha256: {addon.script_sha256}
          </p>
        )}

        <label
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'flex-start',
            fontSize: 13,
            marginBottom: 16,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            style={{ marginTop: 2 }}
          />
          {t('addons.scriptAcknowledge')}
        </label>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
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
