import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuBadgeCheck, LuKeyRound, LuLock, LuTrash2 } from 'react-icons/lu'
import type { Schema } from '../../api'
import { formatIndexUrl, getSourceContents, isUrlTrusted } from './PluginSourcePill'
import SourceCredentialDialog from './SourceCredentialDialog'

type CredentialMap = Schema<'SourceCredentialsResponse'>['source_credentials']

interface Props {
  url: string
  index: number
  data: Schema<'AddonListResponse'> | null
  busy: boolean
  onRemove: (index: number) => void
}

const iconButton = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: 6,
  borderRadius: 4,
} as const

/**
 * A single configured add-on source repository card item.
 */
export default function PluginSourceRow({ url, index, data, busy, onRemove }: Props) {
  const { t } = useTranslation()
  const [editingToken, setEditingToken] = useState(false)
  // What the token dialog last saved, until the next list load catches up.
  // Kept here so the row reflects a change without the section reloading.
  const [savedCredentials, setSavedCredentials] = useState<CredentialMap | null>(null)
  // A fresh list from the server supersedes it (a removed source drops its
  // token server-side, and rows are keyed by position, so state can outlive a URL).
  const [listSeen, setListSeen] = useState(data)
  if (data !== listSeen) {
    setListSeen(data)
    setSavedCredentials(null)
  }
  const contents: string[] = getSourceContents(url, data)
  const isTrusted = isUrlTrusted(
    url,
    data?.trusted_index_urls || (data?.default_index_url ? [data.default_index_url] : [])
  )
  const credential = (savedCredentials ?? data?.source_credentials ?? {})[url]
  const name: string = formatIndexUrl(url)

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
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{name}</span>
          {isTrusted && (
            <LuBadgeCheck
              size={16}
              color="var(--gold-dim)"
              title={t('addons.verifiedSource', 'Verified Source')}
            />
          )}
          {credential && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 12,
                color: credential.unreadable ? 'var(--danger, #c0392b)' : 'var(--text-muted)',
              }}
            >
              <LuLock size={12} aria-hidden="true" />
              {credential.unreadable ? t('addons.tokenNeedsReentry') : t('addons.privateSource')}
            </span>
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
              // A lookup rather than a chain of ternaries: the chain labelled
              // every unrecognised type as "Templates", so a new content type
              // silently rendered as the wrong one.
              const labels: Record<string, string> = {
                plugins: t('addons.contentPlugins', 'Plugins'),
                themes: t('addons.contentThemes', 'Themes'),
                templates: t('addons.contentTemplates', 'Templates'),
                'character-sheets': t('addons.contentCharacterSheets', 'Character sheets'),
              }
              const label = labels[type] || type
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
        onClick={() => setEditingToken(true)}
        disabled={busy}
        aria-label={t('addons.tokenButton')}
        title={t('addons.tokenButton')}
        style={{ ...iconButton, color: credential ? 'var(--gold-dim)' : 'var(--text-muted)' }}
      >
        <LuKeyRound size={16} />
      </button>
      <button
        onClick={() => onRemove(index)}
        disabled={busy}
        aria-label={t('addons.remove', 'Remove')}
        title={t('addons.remove', 'Remove')}
        style={{ ...iconButton, color: 'var(--danger, #c0392b)' }}
      >
        <LuTrash2 size={16} />
      </button>
      {editingToken && (
        <SourceCredentialDialog
          url={url}
          name={name}
          info={credential}
          onClose={() => setEditingToken(false)}
          onSaved={(saved) => {
            setSavedCredentials(saved)
            setEditingToken(false)
          }}
        />
      )}
    </li>
  )
}
