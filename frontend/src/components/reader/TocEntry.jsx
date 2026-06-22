import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuChevronDown } from 'react-icons/lu'

/** A single (recursive) table-of-contents node with collapsible children. */
export default function TocEntry({ node, currentPage, onGoToPage, depth = 0 }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(depth < 2)
  const hasChildren = node.children && node.children.length > 0
  const isActive = currentPage === node.page

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          paddingLeft: 8 + depth * 14,
          paddingRight: 8,
          paddingTop: 4,
          paddingBottom: 4,
          background: isActive ? 'var(--bg-card-hover)' : 'none',
          borderRadius: 4,
        }}
      >
        {hasChildren ? (
          <button
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={
              open
                ? t('toc.collapse', { title: node.title })
                : t('toc.expand', { title: node.title })
            }
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              display: 'flex',
              flexShrink: 0,
              padding: 0,
            }}
          >
            <LuChevronDown
              size={12}
              aria-hidden="true"
              style={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform 0.15s' }}
            />
          </button>
        ) : (
          <span style={{ width: 16, flexShrink: 0 }} />
        )}
        <button
          onClick={() => onGoToPage(node.page)}
          style={{
            flex: 1,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            textAlign: 'left',
            color: isActive ? 'var(--gold)' : 'var(--text-dim)',
            fontSize: depth === 0 ? 13 : 12,
            fontWeight: depth === 0 ? 500 : 400,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            padding: 0,
          }}
          title={node.title}
        >
          {node.title}
        </button>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{node.page}</span>
      </div>
      {hasChildren &&
        open &&
        node.children.map((child, i) => (
          <TocEntry
            key={i}
            node={child}
            currentPage={currentPage}
            onGoToPage={onGoToPage}
            depth={depth + 1}
          />
        ))}
    </div>
  )
}
