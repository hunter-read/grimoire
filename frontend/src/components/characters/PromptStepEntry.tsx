import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuChevronDown, LuChevronUp } from 'react-icons/lu'
import Spinner from '../Spinner'
import ContentEntryDetail from './ContentEntryDetail'
import type { ContentTypeDefinition } from './ContentEntryDetail'
import { fieldInput, helpText, iconBtn } from './characterStyles'
import { loadEntryOptions } from './sheetPrompts'
import type { EntryAnswer } from './sheetPrompts'
import { optionLabel, optionList } from './promptStepShared'
import type { StepControlProps } from './promptStepShared'

// One catalog entry: those the step's `filters` and `filter` let through,
// searched by name. Each opens below its name to show what it is, as in the
// catalog browser - a subclass is chosen by what it does, not by its name.
export default function EntryStep({
  step,
  value,
  context,
  document,
  browse,
  onAnswer,
}: StepControlProps) {
  const { t } = useTranslation()
  const [entries, setEntries] = useState<EntryAnswer[] | null>(null)
  const [failed, setFailed] = useState('')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState('')
  const contentTypes = (document?.content_types || {}) as Record<string, unknown>
  const typeDefinition = (contentTypes[step.content_type || ''] || {}) as ContentTypeDefinition
  const describable = Object.keys(typeDefinition.fields || {}).length > 0
  const chosen =
    value && typeof value === 'object' ? String((value as { _ref?: unknown })._ref ?? '') : ''

  // Loaded once per opening: the filter reads the sheet and the answers as
  // they were when the step first showed.
  useEffect(() => {
    let cancelled = false
    if (!browse || !step.content_type) {
      setEntries([])
      return undefined
    }
    const contentType = step.content_type
    loadEntryOptions(step, context, (page, size) =>
      browse(contentType, step.filters || {}, page, size)
    )
      .then((found) => {
        if (!cancelled) setEntries(found)
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setFailed(e.message)
          setEntries([])
        }
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browse, step])

  const shown = useMemo(() => {
    const terms = search.trim().toLowerCase()
    const list = entries || []
    return terms
      ? list.filter((entry) =>
          String(entry.name || '')
            .toLowerCase()
            .includes(terms)
        )
      : list
  }, [entries, search])

  if (entries === null) return <Spinner />
  if (failed) return <p style={{ ...helpText, color: 'var(--danger, #c33)' }}>{failed}</p>
  if (!entries.length) return <p style={helpText}>{t('characters.promptNoEntries')}</p>
  return (
    <>
      {entries.length > 8 ? (
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('characters.promptSearch')}
          aria-label={t('characters.promptSearch')}
          style={fieldInput}
        />
      ) : null}
      <ul style={{ ...optionList, maxHeight: 360, overflowY: 'auto' }}>
        {shown.map((entry) => {
          const key = `${entry._source || ''}:${entry._ref}`
          const name = entry.name || entry._ref
          const expanded = open === key
          return (
            <li key={key}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <label style={{ ...optionLabel(false), flex: 1, minWidth: 0 }}>
                  <input
                    type="radio"
                    name={`prompt-${step.key}`}
                    checked={chosen === entry._ref}
                    onChange={() => onAnswer(entry)}
                  />
                  {name}
                </label>
                {describable ? (
                  <button
                    type="button"
                    onClick={() => setOpen(expanded ? '' : key)}
                    aria-expanded={expanded}
                    aria-label={t(
                      expanded ? 'characters.promptHideDetails' : 'characters.promptShowDetails',
                      { name }
                    )}
                    title={t(
                      expanded ? 'characters.promptHideDetails' : 'characters.promptShowDetails',
                      { name }
                    )}
                    style={iconBtn}
                  >
                    {expanded ? <LuChevronUp size={14} /> : <LuChevronDown size={14} />}
                  </button>
                ) : null}
              </div>
              {expanded ? (
                <ContentEntryDetail entry={{ data: entry }} typeDefinition={typeDefinition} />
              ) : null}
            </li>
          )
        })}
      </ul>
    </>
  )
}
