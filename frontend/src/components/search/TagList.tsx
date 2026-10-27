/** Simple inline tag chips for map/token search results. */
export default function TagList({ tags }) {
  return (
    <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {tags.map((tag) => (
        <span
          key={tag}
          style={{
            fontSize: 12,
            padding: '2px 8px',
            borderRadius: 4,
            background: 'var(--bg-panel)',
            border: '1px solid var(--border)',
            color: 'var(--text-muted)',
          }}
        >
          {tag}
        </span>
      ))}
    </div>
  )
}
