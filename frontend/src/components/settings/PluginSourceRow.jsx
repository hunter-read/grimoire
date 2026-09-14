import { useTranslation } from 'react-i18next'
import { LuBadgeCheck, LuTrash2 } from 'react-icons/lu'
import { formatIndexUrl, getSourceContents, isUrlTrusted } from './PluginSourcePill'

/**
 * A single configured add-on source repository card item.
 */
export default function PluginSourceRow({ url, index, data, busy, onRemove }) {
  const { t } = useTranslation()
  const contents = getSourceContents(url, data)
  const isTrusted = isUrlTrusted(
    url,
    data?.trusted_index_urls || (data?.default_index_url ? [data.default_index_url] : [])
  )

  return (
    <li
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
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          gap: 4,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
            {formatIndexUrl(url)}
          </span>
          {isTrusted && (
            <LuBadgeCheck
              size={16}
              color="var(--gold-dim)"
              title={t('addons.verifiedSource', 'Verified Source')}
            />
          )}
        </div>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: 12,
            color: 'var(--text-muted)',
            wordBreak: 'break-all',
            textDecoration: 'underline',
          }}
        >
          {url}
        </a>
        {contents.length > 0 && (
          <div
            style={{
              fontSize: 12,
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginTop: 2,
            }}
          >
            {contents.map((type, idx) => {
              const label =
                type === 'plugins'
                  ? t('addons.contentPlugins', 'Plugins')
                  : type === 'themes'
                    ? t('addons.contentThemes', 'Themes')
                    : t('addons.contentTemplates', 'Templates')
              return (
                <span key={type} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {idx > 0 && <span style={{ opacity: 0.4 }}>•</span>}
                  <span>{label}</span>
                </span>
              )
            })}
          </div>
        )}
      </div>
      <button
        onClick={() => onRemove(index)}
        disabled={busy}
        aria-label={t('addons.remove', 'Remove')}
        title={t('addons.remove', 'Remove')}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--danger, #c0392b)',
          cursor: 'pointer',
          padding: 6,
          borderRadius: 4,
        }}
      >
        <LuTrash2 size={16} />
      </button>
    </li>
  )
}
