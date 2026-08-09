import CardLink from '../CardLink'
import TagList from './TagList'
import { cardStyle } from './searchStyles'

/**
 * One media hit (map, token, audio) in the global search results. A real link:
 * a plain click navigates in place, middle click and ctrl/cmd-click open the
 * detail page in a new tab (issue #313). Tag chips are links of their own and
 * sit above the card overlay.
 */
export default function ResultCard({ to, title, subtitle, tags }) {
  return (
    <div
      style={{ ...cardStyle, position: 'relative' }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-card-hover)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-card)')}
    >
      <CardLink to={to} label={title} />
      <div style={{ fontWeight: 500, fontSize: 15 }}>{title}</div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>{subtitle}</div>
      {tags?.length > 0 && <TagList tags={tags} />}
    </div>
  )
}
