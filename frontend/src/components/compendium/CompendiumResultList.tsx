import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { Schema } from '../../api'
import { compendiumEntryPath } from './compendiumPaths'

type Result = Schema<'CompendiumSearchResult'> | Schema<'CompendiumEntry'>

export interface CompendiumResultListProps {
  results: Result[]
  // Where each entry opens: one system's compendium, or - for global search -
  // the first of the systems a result appears in.
  systemId?: string
  gameType?: string | null
  // Name the type of each entry (a search across every type does).
  showType?: boolean
  // Name the system each entry is in (global search does).
  showSystem?: boolean
}

/** Compendium entries as a list of links, for browsing and for search. */
export default function CompendiumResultList({
  results,
  systemId,
  gameType,
  showType = false,
  showSystem = false,
}: CompendiumResultListProps) {
  const { t } = useTranslation()
  return (
    <ul role="list" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
      {results.map((entry) => {
        const systems = 'systems' in entry ? entry.systems || [] : []
        const target = systemId || systems[0]?.id
        if (!target) return null
        const meta = [
          showType && 'type_label' in entry ? entry.type_label : '',
          entry.display,
          entry.ruleset ? t('compendium.fromRuleset', { name: entry.ruleset_name }) : '',
          showSystem ? systems.map((s) => s.name).join(', ') : '',
        ].filter(Boolean)
        return (
          <li key={`${entry.origin}:${entry.content_type}:${entry.entry_id}`}>
            <Link
              to={compendiumEntryPath(
                { systemId: target, gameType },
                entry.content_type,
                entry.entry_id,
                entry.origin
              )}
              style={{
                display: 'block',
                padding: '8px 12px',
                border: '1px solid var(--border)',
                borderRadius: 8,
                background: 'var(--bg-card)',
                color: 'var(--text)',
                textDecoration: 'none',
              }}
            >
              <span style={{ fontWeight: 600 }}>{entry.name}</span>
              {meta.length ? (
                <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)' }}>
                  {meta.join(' · ')}
                </span>
              ) : null}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
