import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { LuChevronDown, LuChevronRight } from 'react-icons/lu'
import PageHit from './PageHit'
import type { PrefetchableBook } from '../reader/pagePrefetch'
import { cardStyle } from './searchStyles'

/** A book's page hits, gathered from the flat search results. */
export interface SearchBookGroup extends PrefetchableBook {
  title: string
  game_system: string
  pages: { page_number: number; snippet: string }[]
}

interface BookGroupProps {
  group: SearchBookGroup
  collapsed: Record<string, boolean | undefined>
  onToggle: (key: string) => void
}

/** A collapsible book result group in the search view: book header + page hits. */
export default function BookGroup({ group, collapsed, onToggle }: BookGroupProps) {
  const { t } = useTranslation()
  const key = `book-${group.id}`
  const isCollapsed = collapsed[key]
  const pageCount = group.pages.length

  return (
    <div style={{ marginBottom: 8 }}>
      {/* A book under the Books h2. Its name is what the button shows - title,
          system and hit count - and aria-expanded says whether it is open. */}
      <h3 style={{ margin: 0, font: 'inherit', color: 'inherit', letterSpacing: 'normal' }}>
        <button
          onClick={() => onToggle(key)}
          aria-expanded={!isCollapsed}
          style={{
            ...(cardStyle as CSSProperties),
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
      </h3>

      {!isCollapsed && (
        <ul
          role="list"
          className="card-list"
          style={{ marginLeft: 16, marginTop: 4, marginBottom: 4 }}
        >
          {group.pages.map((p, i) => (
            <li key={i}>
              <PageHit book={group} page={p} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
