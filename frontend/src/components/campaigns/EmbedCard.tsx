import { useState, useEffect, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LuBookOpen, LuMap, LuUser, LuBox, LuMusic, LuFile } from 'react-icons/lu'
import type { IconType } from 'react-icons'
import { campaigns, client } from '../../api'
import AudioPlayer from '../audio/AudioPlayer'
import LazyImg from '../LazyImg'
import useHoverPrefetch from '../../hooks/useHoverPrefetch'
import {
  openingPageUrls,
  prefetchInBackground,
  type PrefetchableBook,
} from '../reader/pagePrefetch'

// Still JavaScript, so TypeScript would read every destructured prop as required.

// Ids are uuids or slugs. The spec comes straight from wiki text anyone with
// edit rights wrote, and the id lands in router paths and an authenticated API
// request, so anything else ("../users", "x?y") is not an embed at all.
const ID_RE = /^[A-Za-z0-9_-]+$/
const PAGE_RE = /^\d+$/

const embedCardStyle: CSSProperties = {
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
 *
 * A book embed starts loading the page it opens on as soon as the pointer
 * rests on it. With `prefetch`, a `book:ID:PAGE` embed loads it in the
 * background while the note is on screen instead (issue #640) - the caller
 * decides which embeds get that, so a note full of links can't queue them all.
 */
interface EmbedCardProps {
  spec: string
  campaignId?: string
  prefetch?: boolean
}

export default function EmbedCard({ spec, campaignId, prefetch = false }: EmbedCardProps) {
  const { t } = useTranslation()
  const [type, rawId = '', rawPage] = spec.split(':')
  const valid = ID_RE.test(rawId) && (rawPage === undefined || PAGE_RE.test(rawPage))
  const id = valid ? rawId : ''
  const page = valid ? rawPage : undefined

  // A book embed names the book, so it is fetched here for its title - and for
  // what a prefetch needs. It stays null if the book can't be resolved (deleted
  // or unreadable), so the card falls back to the generic "Book" label and
  // nothing is prefetched for a book the viewer can't open. Rules-of-hooks keeps
  // these above the early returns below, hence the type guards rather than
  // conditional hooks.
  const [book, setBook] = useState<(PrefetchableBook & { title?: string | null }) | null>(null)
  useEffect(() => {
    if (type !== 'book' || !id) return
    let active = true
    client
      .get('/books/{book_id}', { path: { book_id: id } })
      .then((b) => {
        if (active) setBook(b)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [type, id])

  const pageNum = page ? Number(page) : null
  useEffect(() => {
    if (!prefetch || !book || !pageNum) return
    return prefetchInBackground(openingPageUrls(book, pageNum))
  }, [prefetch, book, pageNum])
  const hoverPrefetch = useHoverPrefetch(() => (book ? openingPageUrls(book, pageNum) : []))

  if (!valid) return null

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
          <LuMusic size={15} color="var(--type-audio)" />
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
        <LuFile size={15} color="var(--type-file)" />
        {t('wiki.embed_file')}
      </a>
    )
  }

  const cards: Record<string, { Icon: IconType; color: string; to: string }> = {
    book: { Icon: LuBookOpen, color: 'var(--type-book)', to: `/library/book/${id}` },
    map: { Icon: LuMap, color: 'var(--type-map)', to: `/maps/${id}` },
    token: { Icon: LuUser, color: 'var(--type-token)', to: `/tokens/${id}` },
    model: { Icon: LuBox, color: 'var(--type-model)', to: `/models/${id}` },
  }
  const meta = cards[type]
  if (!meta) return null
  const { Icon, color } = meta
  const to = type === 'book' && page ? `${meta.to}?page=${page}` : meta.to
  // A resolved title replaces the generic type label; the page suffix is added
  // on top of whichever of the two we ended up with.
  const name = type === 'book' && book?.title ? book.title : t(`wiki.embed_${type}`)
  const label = type === 'book' && page ? t('wiki.embedBookPage', { title: name, page }) : name
  return (
    <Link to={to} style={embedCardStyle} {...(type === 'book' ? hoverPrefetch : null)}>
      <Icon size={15} color={color} />
      {label}
    </Link>
  )
}
