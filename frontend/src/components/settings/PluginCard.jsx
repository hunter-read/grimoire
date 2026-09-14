import { useTranslation } from 'react-i18next'
import { LuArrowUp, LuDownload, LuMenu, LuTrash2 } from 'react-icons/lu'
import PluginSourcePill from './PluginSourcePill'
import AuthorByline from './AuthorByline'

/**
 * A single add-on plugin item card (installed or available).
 */
export default function PluginCard({
  addon,
  isInstalled,
  trustedIndexUrls = [],
  busy = false,
  onContextMenu,
  onUpdate,
  onToggleEnabled,
  onRemove,
  onInstall,
}) {
  const { t } = useTranslation()

  return (
    <li
      onContextMenu={(e) => onContextMenu && onContextMenu(e, addon, isInstalled)}
      style={{
        display: 'flex',
        gap: 16,
        alignItems: 'center',
        padding: '12px 16px',
        borderRadius: 8,
        background: 'var(--bg-deep)',
        border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.04))',
        marginBottom: 8,
      }}
    >
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>{addon.name}</span>
          <span
            style={{
              fontWeight: 400,
              fontSize: 11,
              color: 'var(--text-muted)',
              background: 'var(--bg)',
              padding: '1px 6px',
              borderRadius: 4,
              border: '1px solid var(--border)',
              lineHeight: 1.3,
            }}
          >
            v{addon.version}
          </span>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              flexWrap: 'wrap',
            }}
          >
            {addon.index_url && (
              <PluginSourcePill url={addon.index_url} trustedIndexUrls={trustedIndexUrls} />
            )}
            {isInstalled && addon.update_available && (
              <span
                style={{
                  fontSize: 10,
                  color: 'var(--gold-dim)',
                  border: '1px solid var(--gold-dim)',
                  borderRadius: 4,
                  padding: '2px 6px',
                  textTransform: 'uppercase',
                  fontWeight: 600,
                  letterSpacing: '0.02em',
                  lineHeight: 1.2,
                }}
              >
                {t('addons.updateBadge', { version: addon.available_version })}
              </span>
            )}
            {!isInstalled && addon.requires_script && (
              <span
                style={{
                  fontSize: 10,
                  color: 'var(--warning, #d98324)',
                  border: '1px solid var(--warning, #d98324)',
                  borderRadius: 4,
                  padding: '2px 6px',
                  textTransform: 'uppercase',
                  fontWeight: 600,
                  letterSpacing: '0.02em',
                  lineHeight: 1.2,
                }}
              >
                {t('addons.runsCode', 'runs code')}
              </span>
            )}
          </div>
        </div>
        {addon.description && (
          <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.4 }}>
            {addon.description}
          </div>
        )}
        <AuthorByline author={addon.author} authorUrl={addon.author_url} />
        {isInstalled && !addon.runnable && addon.blocked_reason && (
          <div style={{ fontSize: 12, color: 'var(--warning, #d98324)', marginTop: 2 }}>
            {addon.blocked_reason}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        {addon.available_in && addon.available_in.length > 1 && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              if (onContextMenu) onContextMenu(e, addon, isInstalled)
            }}
            title="More options"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: 6,
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <LuMenu size={16} />
          </button>
        )}
        {isInstalled ? (
          <>
            {addon.update_available && (
              <button
                onClick={() => onUpdate && onUpdate(addon)}
                disabled={busy}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: 'none',
                  background: 'var(--gold-dim)',
                  color: 'var(--bg-deep)',
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: busy ? 'default' : 'pointer',
                }}
              >
                <LuArrowUp size={13} />
                {t('addons.update', 'Update')}
              </button>
            )}
            <label
              style={{
                display: 'flex',
                gap: 6,
                alignItems: 'center',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={addon.enabled}
                onChange={() => onToggleEnabled && onToggleEnabled(addon)}
                aria-label={t('addons.enabled', 'Enabled')}
              />
              {t('addons.enabled', 'Enabled')}
            </label>
            <button
              onClick={() => onRemove && onRemove(addon)}
              aria-label={t('addons.remove', 'Remove')}
              title={t('addons.remove', 'Remove')}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-muted)',
                display: 'flex',
                padding: 6,
                borderRadius: 4,
              }}
            >
              <LuTrash2 size={16} />
            </button>
          </>
        ) : (
          <button
            onClick={() => onInstall && onInstall(addon)}
            disabled={busy}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'none',
              color: 'var(--text)',
              cursor: busy ? 'default' : 'pointer',
              fontWeight: 500,
              fontSize: 13,
            }}
          >
            <LuDownload size={14} />
            {t('addons.install', 'Install')}
          </button>
        )}
      </div>
    </li>
  )
}
