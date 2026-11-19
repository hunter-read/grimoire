import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LuArrowLeft } from 'react-icons/lu'
import { compendium as compendiumApi, type Schema } from '../../api'
import Spinner from '../Spinner'
import ContentEntryDetail from '../characters/ContentEntryDetail'
import type { ContentTypeDefinition } from '../characters/ContentEntryDetail'
import { compendiumTypePath, type CompendiumRef } from './compendiumPaths'

export interface CompendiumEntryViewProps extends CompendiumRef {
  contentType: string
  entryId: string
  origin?: string | null
}

/**
 * One compendium entry, on its own URL so entries can be linked and shared.
 *
 * Drawn by the same read-only renderer the sheet's catalogue uses, against the
 * definition the entry's own sheet or pack gives it.
 */
export default function CompendiumEntryView({
  systemId,
  gameType,
  contentType,
  entryId,
  origin,
}: CompendiumEntryViewProps) {
  const { t } = useTranslation()
  const [entry, setEntry] = useState<Schema<'CompendiumEntryDetail'> | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setEntry(null)
    setError('')
    compendiumApi
      .entry(systemId, contentType, entryId, origin)
      .then((result) => !cancelled && setEntry(result))
      .catch((e: Error) => !cancelled && setError(e.message || t('compendium.entryFailed')))
    return () => {
      cancelled = true
    }
  }, [systemId, contentType, entryId, origin, t])

  const definition = entry?.type_definition
  const typeLabel = definition?.label_plural || definition?.label || contentType

  return (
    <article aria-labelledby="compendium-entry-name">
      <Link
        to={compendiumTypePath({ systemId, gameType }, contentType)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 13,
          color: 'var(--text-dim)',
          marginBottom: 12,
        }}
      >
        <LuArrowLeft size={13} aria-hidden="true" /> {t('compendium.backTo', { label: typeLabel })}
      </Link>
      {error ? (
        <p role="alert" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      ) : !entry || !definition ? (
        <Spinner />
      ) : (
        <>
          <h2 id="compendium-entry-name" style={{ margin: '0 0 4px', fontSize: 24 }}>
            {entry.name}
          </h2>
          <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-muted)' }}>
            {[
              definition.label,
              entry.display,
              entry.ruleset ? t('compendium.fromRuleset', { name: entry.ruleset_name }) : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <ContentEntryDetail
            entry={entry}
            typeDefinition={definition as ContentTypeDefinition}
            hideEmpty
          />
        </>
      )}
    </article>
  )
}
