import { useTranslation } from 'react-i18next'
import { LuBookOpen, LuMap, LuUser, LuFile } from 'react-icons/lu'
import { campaigns } from '../../api'

const embedCardStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 12px',
  margin: '2px 0',
  background: 'var(--bg-deep)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--text)',
  cursor: 'pointer',
  fontSize: 14,
}

/**
 * Renders a [[book:ID]] / [[map:ID]] / [[token:ID]] / [[file:ID]] / [[image:ID]]
 * wiki embed as an inline image or a link/download card.
 */
export default function EmbedCard({ spec, campaignId, onNavigate }) {
  const { t } = useTranslation()
  const [type, id, page] = spec.split(':')

  // An embedded image renders inline. It's served from the campaign file endpoint
  // (token-authenticated), so we need the campaign id to build the URL.
  if (type === 'image') {
    if (!campaignId) return null
    return (
      <img
        src={campaigns.fileUrl(campaignId, id)}
        alt=""
        style={{ maxWidth: '100%', borderRadius: 8, display: 'block', margin: '8px 0' }}
      />
    )
  }

  // A non-image campaign file embeds as a download card opening the file.
  if (type === 'file') {
    if (!campaignId) return null
    return (
      <button
        type="button"
        onClick={() => window.open(campaigns.fileUrl(campaignId, id), '_blank')}
        style={embedCardStyle}
      >
        <LuFile size={15} color="#e0b341" />
        {t('wiki.embed_file')}
      </button>
    )
  }

  const meta = {
    book: { Icon: LuBookOpen, color: '#a78bfa', to: `/library/book/${id}` },
    map: { Icon: LuMap, color: '#60a5fa', to: `/maps/${id}` },
    token: { Icon: LuUser, color: '#34d399', to: `/tokens/${id}` },
  }[type]
  if (!meta) return null
  const { Icon, color } = meta
  const to = type === 'book' && page ? `${meta.to}?page=${page}` : meta.to
  const label =
    type === 'book' && page ? t('wiki.embedBookPage', { page }) : t(`wiki.embed_${type}`)
  return (
    <button type="button" onClick={() => onNavigate(to)} style={embedCardStyle}>
      <Icon size={15} color={color} />
      {label}
    </button>
  )
}
