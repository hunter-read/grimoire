import { Link } from 'react-router-dom'

/**
 * One tag in the tags page's left-hand list. Selecting a tag is a URL change
 * (`/tags?tag=<internal>`), so the row is a real link: a plain click selects it
 * in place while middle click and ctrl/cmd-click open it in a new tab (issue
 * #313). `replace` matches how the view itself updates the param, so browsing
 * tags doesn't pile up one history entry per click.
 */
export default function TagListButton({ tag, active }) {
  return (
    <Link
      to={`/tags?tag=${encodeURIComponent(tag.internal)}`}
      replace
      aria-current={active}
      style={{
        flex: 1,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 8,
        padding: '7px 10px 7px 2px',
        color: 'var(--text)',
        fontSize: 14,
        textAlign: 'left',
        textDecoration: 'none',
        minWidth: 0,
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {tag.display}
      </span>
      <span style={{ color: 'var(--text-muted)', fontSize: 12, flexShrink: 0 }}>{tag.count}</span>
    </Link>
  )
}
