import TagList from './TagList'
import useLinkProps from '../../hooks/useLinkProps'
import { cardStyle } from './searchStyles'

/**
 * One media hit (map, token, audio) in the global search results. Behaves like a
 * link: a plain click navigates in place, middle click and ctrl/cmd-click open
 * the detail page in a new tab (issue #313).
 */
export default function ResultCard({ to, title, subtitle, tags, onOpen }) {
  const linkProps = useLinkProps(to, onOpen)
  return (
    <div
      {...linkProps}
      style={cardStyle}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-card-hover)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-card)')}
    >
      <div style={{ fontWeight: 500, fontSize: 15 }}>{title}</div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>{subtitle}</div>
      {tags?.length > 0 && <TagList tags={tags} />}
    </div>
  )
}
