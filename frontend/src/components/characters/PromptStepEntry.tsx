import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuChevronDown, LuChevronUp } from 'react-icons/lu'
import Spinner from '../Spinner'
import ContentEntryDetail from './ContentEntryDetail'
import type { ContentTypeDefinition } from './ContentEntryDetail'
import { fieldInput, helpText, iconBtn } from './characterStyles'
import { entryKey } from './promptCatalog'
import { entriesTarget, isEntry } from './sheetPrompts'
import type { EntryAnswer } from './sheetPrompts'
import { optionLabel, optionList } from './promptStepShared'
import type { StepControlProps } from './promptStepShared'

// Catalog entries: one for an `entry` step, `count` of them for an `entries`
// step, from those the step's `filters` and `filter` let through, searched by
// name. Each opens below its name to show what it is, as in the catalog
// browser - a subclass is chosen by what it does, not by its name. The
// options come worked out for the answers as they stand, so they follow a
// change of answer without the catalog being read again.
export default function EntryStep({
  step,
  value,
  context,
  document,
  options,
  failed,
  onAnswer,
}: StepControlProps) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState('')
  const multiple = step.type === 'entries'
  const contentTypes = (document?.content_types || {}) as Record<string, unknown>
  const typeDefinition = (contentTypes[step.content_type || ''] || {}) as ContentTypeDefinition
  const describable = Object.keys(typeDefinition.fields || {}).length > 0
  const picked: EntryAnswer[] = multiple
    ? Array.isArray(value)
      ? value.filter(isEntry)
      : []
    : isEntry(value)
      ? [value]
      : []
  const pickedKeys = new Set(picked.map(entryKey))
  const wanted = multiple ? entriesTarget(step, context, options?.length) : 1
  const remaining = Math.max(0, wanted - picked.length)

  const shown = useMemo(() => {
    const terms = search.trim().toLowerCase()
    const list = options || []
    return terms
      ? list.filter((entry) =>
          String(entry.name || '')
            .toLowerCase()
            .includes(terms)
        )
      : list
  }, [options, search])

  if (!options) return <Spinner />
  if (failed) return <p style={{ ...helpText, color: 'var(--danger, #c33)' }}>{failed}</p>
  if (!options.length) return <p style={helpText}>{t('characters.promptNoEntries')}</p>

  const toggle = (entry: EntryAnswer) => {
    if (!multiple) {
      onAnswer(entry)
      return
    }
    const key = entryKey(entry)
    if (pickedKeys.has(key)) {
      const left = picked.filter((item) => entryKey(item) !== key)
      onAnswer(left.length ? left : undefined)
    } else if (remaining > 0) {
      onAnswer([...picked, entry])
    }
  }

  return (
    <>
      {multiple ? (
        <p role="status" style={{ margin: 0, fontSize: 13, color: 'var(--text-dim)' }}>
          {t('characters.chooseRemaining', { count: remaining })}
        </p>
      ) : null}
      {options.length > 8 ? (
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
          const key = entryKey(entry)
          const name = entry.name || entry._ref
          const expanded = open === key
          const selected = pickedKeys.has(key)
          const full = multiple && !selected && remaining === 0
          return (
            <li key={key}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <label style={{ ...optionLabel(full), flex: 1, minWidth: 0 }}>
                  <input
                    type={multiple ? 'checkbox' : 'radio'}
                    name={`prompt-${step.key}`}
                    checked={selected}
                    disabled={full}
                    onChange={() => toggle(entry)}
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
