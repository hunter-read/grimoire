import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import PluginSourcePill, { isUrlTrusted } from './PluginSourcePill'

const DEFAULT_COMMUNITY_URLS = [
  'https://raw.githubusercontent.com/grimoire-codex/community-add-ons/main/index.yaml',
  'https://raw.githubusercontent.com/grimoire-codex/community-add-ons/main/index.json',
]

export default function PluginSourceContextMenu({
  x,
  y,
  isUpdate,
  sources = [],
  defaultIndexUrl = '',
  trustedIndexUrls = [],
  onSelect,
  onClose,
}) {
  const { t } = useTranslation()

  useEffect(() => {
    const handleClick = () => onClose()
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('click', handleClick)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('click', handleClick)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  if (!sources || sources.length === 0) return null

  const titleText = isUpdate
    ? t('addons.updateFromSpecificSource', 'Update from specific source')
    : t('addons.installFromSpecificSource', 'Install from specific source')

  const trustedList =
    trustedIndexUrls.length > 0
      ? trustedIndexUrls
      : defaultIndexUrl
        ? [defaultIndexUrl, ...DEFAULT_COMMUNITY_URLS]
        : DEFAULT_COMMUNITY_URLS

  return (
    <div
      style={{
        position: 'fixed',
        top: y,
        left: x,
        background: 'var(--bg-deep)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        padding: '4px 0',
        zIndex: 1000,
        minWidth: 200,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        style={{
          padding: '4px 12px',
          fontSize: 11,
          color: 'var(--text-muted)',
          fontWeight: 600,
          textTransform: 'uppercase',
        }}
      >
        {titleText}
      </div>
      {sources.map((avail, i) => {
        const isVerified =
          avail.isVerified ??
          avail.is_verified ??
          (defaultIndexUrl && avail.index_url === defaultIndexUrl
            ? true
            : isUrlTrusted(avail.index_url, trustedList))

        return (
          <button
            key={i}
            onClick={() => {
              onSelect(avail.index_url)
              onClose()
            }}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '8px 12px',
              background: 'none',
              border: 'none',
              color: 'var(--text)',
              cursor: 'pointer',
              fontSize: 13,
            }}
            onMouseOver={(e) => (e.target.style.background = 'var(--bg-hover)')}
            onMouseOut={(e) => (e.target.style.background = 'none')}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <PluginSourcePill
                url={avail.index_url}
                isVerified={isVerified}
                trustedIndexUrls={trustedList}
              />
              {avail.version && (
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>(v{avail.version})</span>
              )}
            </div>
          </button>
        )
      })}
    </div>
  )
}
