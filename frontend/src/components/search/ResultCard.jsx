import CardLink from '../CardLink'
import ResultThumb from './ResultThumb'
import TagList from './TagList'
import { cardStyle } from './searchStyles'

/**
 * One media hit (map, token, audio) in the global search results. A real link:
 * a plain click navigates in place, middle click and ctrl/cmd-click open the
 * detail page in a new tab (issue #313). Tag chips are links of their own and
 * sit above the card overlay.
 *
 * Carries the item's thumbnail (issue #343) when `type` is given — a map is far
 * quicker to recognise by its picture than by its filename. Without `type` the
 * row renders text-only, so callers outside search are unaffected.
 */
export default function ResultCard({ to, title, subtitle, tags, type, id, hasThumbnail }) {
  return (
    <div
      style={{
        ...cardStyle,
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-card-hover)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-card)')}
    >
      <CardLink to={to} label={title} />
      {type && <ResultThumb type={type} id={id} hasThumbnail={hasThumbnail} alt="" />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 500, fontSize: 15 }}>{title}</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>{subtitle}</div>
        {tags?.length > 0 && <TagList tags={tags} />}
      </div>
    </div>
  )
}
