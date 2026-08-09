import useLinkProps from '../../hooks/useLinkProps'

/**
 * One tag in the tags page's left-hand list. Selecting a tag is a URL change
 * (`/tags?tag=<internal>`), so the row behaves like a link: plain click selects
 * it in place, while middle click and ctrl/cmd-click open it in a new tab
 * (issue #313).
 */
export default function TagListButton({ tag, active, onSelect }) {
  const linkProps = useLinkProps(`/tags?tag=${encodeURIComponent(tag.internal)}`, () =>
    onSelect(tag.internal)
  )
  return (
    <button
      type="button"
      {...linkProps}
      aria-current={active}
      style={{
        flex: 1,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 8,
        padding: '7px 10px 7px 2px',
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        color: 'var(--text)',
        fontSize: 14,
        textAlign: 'left',
        minWidth: 0,
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {tag.display}
      </span>
      <span style={{ color: 'var(--text-muted)', fontSize: 12, flexShrink: 0 }}>{tag.count}</span>
    </button>
  )
}
