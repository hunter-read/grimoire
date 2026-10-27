import { useTranslation } from 'react-i18next'
import { LuBadgeCheck } from 'react-icons/lu'

function isGitHubUserContentHost(hostname) {
  return hostname === 'githubusercontent.com' || hostname.endsWith('.githubusercontent.com')
}

function isGitHubComHost(hostname) {
  return hostname === 'github.com' || hostname.endsWith('.github.com')
}

export function formatIndexUrl(url) {
  if (!url) return ''
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase()
    const isUserContent = isGitHubUserContentHost(host)
    const isGitHub = isGitHubComHost(host)

    if (isUserContent || isGitHub) {
      const parts = parsed.pathname.split('/').filter(Boolean)
      if (parts.length >= 2) {
        const owner = parts[0]
        const repo = parts[1]
        let branch = ''

        if (isUserContent) {
          if (parts[2] === 'refs' && parts[3] === 'heads' && parts.length >= 5) {
            branch = parts[4]
          } else if (parts.length >= 3) {
            branch = parts[2]
          }
        } else if (isGitHub) {
          if (
            (parts[2] === 'raw' || parts[2] === 'tree' || parts[2] === 'blob') &&
            parts.length >= 4
          ) {
            branch = parts[3]
          } else if (parts.length >= 3) {
            branch = parts[2]
          }
        }

        if (branch && branch !== 'main') {
          return `${owner}/${repo} (${branch})`
        }
        return `${owner}/${repo}`
      }
    }
    return parsed.hostname
  } catch (e) {
    return url
  }
}

export function normalizeUrl(url) {
  if (!url) return ''
  return url.trim().replace(/\/+$/, '')
}

export function isUrlTrusted(url, trustedUrls = []) {
  if (!url || !Array.isArray(trustedUrls) || trustedUrls.length === 0) return false
  const norm = normalizeUrl(url)
  return trustedUrls.some((t) => normalizeUrl(t) === norm)
}

export function getSourceContents(url, data) {
  if (!url) return []
  if (data?.source_contents?.[url]) {
    return data.source_contents[url]
  }
  const norm = normalizeUrl(url)
  if (norm.endsWith('themes/index.json')) return ['themes']
  if (norm.endsWith('templates/index.json')) return ['templates']
  if (url === data?.default_index_url || norm.includes('grimoire-codex/community-add-ons')) {
    return ['plugins', 'themes', 'templates']
  }
  return ['plugins', 'themes']
}

export default function PluginSourcePill({ url, isVerified, trustedIndexUrls = [], style }) {
  const { t } = useTranslation()

  if (!url) return null

  const verified = isVerified ?? isUrlTrusted(url, trustedIndexUrls)
  const title = verified ? t('addons.verifiedSource', 'Verified Source') : `From: ${url}`

  return (
    <span
      title={title}
      style={{
        fontSize: 10,
        color: verified ? 'var(--gold-dim)' : 'var(--text-muted)',
        border: `1px solid ${verified ? 'var(--gold-dim)' : 'var(--border)'}`,
        borderRadius: 4,
        padding: '2px 6px',
        textTransform: 'uppercase',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontWeight: 600,
        letterSpacing: '0.02em',
        lineHeight: 1.2,
        ...style,
      }}
    >
      {verified && <LuBadgeCheck size={12} />}
      {formatIndexUrl(url)}
    </span>
  )
}
