import { LuBookOpen, LuMap, LuMusic, LuUser } from 'react-icons/lu'
import LazyImg from '../LazyImg'
import { imageSources } from '../../api'

// Fallback glyph per collection, shown when a row has no thumbnail yet (or its
// image fails to load). A search result should never be a blank rectangle: the
// icon still tells the user what kind of thing they are looking at.
const FALLBACK_ICONS = {
  book: LuBookOpen,
  map: LuMap,
  token: LuUser,
  audio: LuMusic,
}

/**
 * The cover/artwork square on a search result row (issue #343).
 *
 * Search results used to be text-only, which made scanning them slower than
 * browsing the library — the cover is how people recognise a book. Sizing is
 * fixed rather than fluid so a column of rows keeps a straight left edge, and
 * the box is reserved before the image arrives so results don't jump as
 * thumbnails stream in.
 */
export default function ResultThumb({ type, id, hasThumbnail, alt, size = 48 }) {
  const Fallback = FALLBACK_ICONS[type] ?? LuBookOpen
  const src = hasThumbnail ? imageSources.thumbUrl(type, id) : null

  const box = {
    width: size,
    // Books are portrait; everything else reads better square.
    height: type === 'book' ? Math.round(size * 1.3) : size,
    flexShrink: 0,
    borderRadius: 4,
    overflow: 'hidden',
    background: 'var(--bg-deep)',
    border: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  }

  if (!src) {
    return (
      <div style={box} aria-hidden="true">
        <Fallback
          size={Math.round(size * 0.4)}
          style={{ color: 'var(--text-muted)', opacity: 0.5 }}
        />
      </div>
    )
  }

  return (
    <div style={box}>
      <LazyImg
        src={src}
        alt={alt ?? ''}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />
    </div>
  )
}
