import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LuBookOpen, LuMap, LuUser, LuMusic, LuFile } from 'react-icons/lu'
import api, { campaigns } from '../../api'
import AudioPlayer from '../audio/AudioPlayer'
import LazyImg from '../LazyImg'

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
  textDecoration: 'none',
}

/**
 * Renders a [[book:ID]] / [[map:ID]] / [[token:ID]] / [[audio:ID]] / [[file:ID]] / [[image:ID]]
 * wiki embed as an inline image, an inline audio player, or a link/download card.
 * Linkable embeds are real links, so middle click / ctrl-click opens them in a
 * new tab (issue #313).
 */
export default function EmbedCard({ spec, campaignId }) {
  const { t } = useTranslation()
  const [type, id, page] = spec.split(':')

  // A book embed names the book, so its title is fetched here. It stays null if
  // the book can't be resolved (deleted or unreadable), and the card falls back
  // to the generic "Book" label. Rules-of-hooks keeps this above the early
  // returns below, hence the type guard rather than a conditional hook.
  const [bookTitle, setBookTitle] = useState(null)
  useEffect(() => {
    if (type !== 'book') return
    let active = true
    api
      .get(`/books/${id}`)
      .then((b) => {
        if (active) setBookTitle(b.title || null)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [type, id])

  // An embedded audio track plays in the global player (play / play next), with a
  // click-through to its detail page.
  if (type === 'audio') {
    return (
      <span
        style={{
          ...embedCardStyle,
          cursor: 'default',
          gap: 10,
        }}
      >
        <AudioPlayer track={{ id }} showPlayNext size={34} />
        <Link
          to={`/audio/${id}`}
          style={{
            font: 'inherit',
            color: 'var(--text)',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            textDecoration: 'none',
          }}
        >
          <LuMusic size={15} color="#f0a868" />
          {t('wiki.embed_audio')}
        </Link>
      </span>
    )
  }

  // An embedded image renders inline. It's served from the campaign file endpoint
  // (token-authenticated), so we need the campaign id to build the URL.
  if (type === 'image') {
    if (!campaignId) return null
    return (
      <LazyImg
        src={campaigns.fileUrl(campaignId, id)}
        alt=""
        style={{ maxWidth: '100%', borderRadius: 8, display: 'block', margin: '8px 0' }}
      />
    )
  }

  // A non-image campaign file embeds as a card opening the file in a new tab.
  if (type === 'file') {
    if (!campaignId) return null
    return (
      <a
        href={campaigns.fileUrl(campaignId, id)}
        target="_blank"
        rel="noopener noreferrer"
        style={embedCardStyle}
      >
        <LuFile size={15} color="#e0b341" />
        {t('wiki.embed_file')}
      </a>
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
  // A resolved title replaces the generic type label; the page suffix is added
  // on top of whichever of the two we ended up with.
  const name = type === 'book' && bookTitle ? bookTitle : t(`wiki.embed_${type}`)
  const label = type === 'book' && page ? t('wiki.embedBookPage', { title: name, page }) : name
  return (
    <Link to={to} style={embedCardStyle}>
      <Icon size={15} color={color} />
      {label}
    </Link>
  )
}
