import { useTranslation } from 'react-i18next'
import { LuChevronDown, LuChevronRight } from 'react-icons/lu'
import { cardStyle } from './searchStyles'

/** A collapsible book result group in the search view: book header + page hits. */
export default function BookGroup({ group, collapsed, onToggle, onNavigate }) {
  const { t } = useTranslation()
  const key = `book-${group.id}`
  const isCollapsed = collapsed[key]
  const pageCount = group.pages.length

  return (
    <div style={{ marginBottom: 8 }}>
      <button
        onClick={() => onToggle(key)}
        aria-label={
          isCollapsed
            ? t('search.expandBook', { title: group.title })
            : t('search.collapseBook', { title: group.title })
        }
        style={{
          ...cardStyle,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          width: '100%',
          textAlign: 'left',
          cursor: 'pointer',
          marginBottom: 0,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-card-hover)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-card)')}
      >
        {isCollapsed ? (
          <LuChevronRight size={14} style={{ flexShrink: 0 }} />
        ) : (
          <LuChevronDown size={14} style={{ flexShrink: 0 }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>{group.title}</span>
          {group.game_system && (
            <span style={{ fontSize: 13, color: 'var(--gold-dim)', marginLeft: 10 }}>
              {group.game_system}
            </span>
          )}
        </div>
        <span style={{ fontSize: 13, color: 'var(--text-muted)', flexShrink: 0 }}>
          {t('search.groupedBy', { count: pageCount })}
        </span>
      </button>

      {!isCollapsed && (
        <div style={{ marginLeft: 16, marginTop: 4, marginBottom: 4 }}>
          {group.pages.map((p, i) => (
            <div
              key={i}
              onClick={() => onNavigate(p.page_number)}
              style={{ ...cardStyle, borderLeft: '3px solid var(--border)' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-card-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-card)')}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  marginBottom: 4,
                }}
              >
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  {t('common.pagePrefixed', { page: p.page_number })}
                </span>
              </div>
              <div
                style={{ fontSize: 14, color: 'var(--text-dim)', lineHeight: 1.5 }}
                dangerouslySetInnerHTML={{ __html: p.snippet }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
