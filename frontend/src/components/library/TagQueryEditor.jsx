import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuPlus, LuX } from 'react-icons/lu'
import MultiSelectDropdown from '../metadata/MultiSelectDropdown'
import { FILTER_ANY, FILTER_NONE } from './specialFilters'
import {
  GROUP_EXCLUDE,
  GROUP_INCLUDE,
  describeQuery,
  emptyGroup,
  pruneGroups,
  toGroups,
} from './tagQuery'

/**
 * Editor for the grouped tag filter. Each row is one group — a mode
 * ("any of" / "none of") plus a multi-select of tags — and the rows are ANDed
 * together, so `Building AND (store OR shop)` is two rows.
 *
 * The value is whatever sits in `filters.tags`: a group list, or a legacy flat
 * array which is normalised on first edit.
 *
 * Props:
 *  - value: current `filters.tags`
 *  - onChange: (nextGroups | undefined) => void — undefined when empty, so the
 *    active-filter count and the clear button keep treating it as unset
 *  - options: [{ value, label }] the available tags
 *  - label, emptyLabel, searchPlaceholder: passed through to the dropdowns
 */
export default function TagQueryEditor({
  value,
  onChange,
  options = [],
  label,
  emptyLabel,
  searchPlaceholder,
}) {
  const { t } = useTranslation()
  const groups = toGroups(value)
  // An empty group constrains nothing, so it is pruned out of the committed
  // filter state — but it still needs to be *shown* while the user fills it in.
  // `draft` holds those not-yet-committed rows: the trailing empty groups, plus
  // the one always-present row when nothing has been picked at all.
  const [draft, setDraft] = useState(groups.length ? [] : [emptyGroup()])
  const rows = [...groups, ...draft]

  const commit = (next) => {
    setDraft(next.filter((g) => g.tags.length === 0))
    const pruned = pruneGroups(next)
    onChange(pruned.length ? pruned : undefined)
  }

  const update = (i, patch) => commit(rows.map((g, n) => (n === i ? { ...g, ...patch } : g)))
  const remove = (i) => commit(rows.filter((_, n) => n !== i))
  const add = () => setDraft((d) => [...d, emptyGroup()])

  const summary = describeQuery(rows, {
    and: t('sortFilter.tagQueryAnd'),
    or: t('sortFilter.tagQueryOr'),
    not: t('sortFilter.tagQueryNot'),
    none: t('sortFilter.specialNone', { field: label }),
    any: t('sortFilter.specialAny', { field: label }),
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map((group, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* The joiner between rows is fixed (AND), so it is shown as text
              rather than a control the user might expect to change. */}
          <span style={{ ...joiner, visibility: i === 0 ? 'hidden' : 'visible' }}>
            {t('sortFilter.tagQueryAnd')}
          </span>
          <select
            aria-label={t('sortFilter.tagGroupMode', { n: i + 1 })}
            value={group.mode}
            onChange={(e) => update(i, { mode: e.target.value })}
            style={modeSelect}
          >
            <option value={GROUP_INCLUDE}>{t('sortFilter.tagGroupAnyOf')}</option>
            <option value={GROUP_EXCLUDE}>{t('sortFilter.tagGroupNoneOf')}</option>
          </select>
          <div style={{ flex: 1, minWidth: 0 }}>
            <MultiSelectDropdown
              label={t('sortFilter.tagGroupTags', { n: i + 1 })}
              options={options}
              selected={group.tags}
              onChange={(tags) => update(i, { tags })}
              emptyLabel={emptyLabel}
              searchPlaceholder={searchPlaceholder}
              specialOptions={[
                { value: FILTER_NONE, label: t('sortFilter.specialNone', { field: label }) },
                { value: FILTER_ANY, label: t('sortFilter.specialAny', { field: label }) },
              ]}
            />
          </div>
          {/* The only row is cleared rather than removed, so there is always a
              row to type into. */}
          <button
            type="button"
            onClick={() => (rows.length === 1 ? commit([emptyGroup()]) : remove(i))}
            disabled={rows.length === 1 && group.tags.length === 0}
            aria-label={t('sortFilter.tagGroupRemove', { n: i + 1 })}
            style={{
              ...iconBtn,
              opacity: rows.length === 1 && group.tags.length === 0 ? 0.3 : 1,
            }}
          >
            <LuX size={14} />
          </button>
        </div>
      ))}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={add} style={addBtn}>
          <LuPlus size={13} />
          {t('sortFilter.tagGroupAdd')}
        </button>
        {summary && (
          <span style={summaryStyle} title={summary}>
            {summary}
          </span>
        )}
      </div>
    </div>
  )
}

const joiner = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.06em',
  color: 'var(--text-muted)',
  width: 26,
  textAlign: 'right',
  flexShrink: 0,
}
const modeSelect = {
  fontSize: 12,
  padding: '6px 4px',
  borderRadius: 6,
  background: 'var(--bg-input)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  flexShrink: 0,
}
const iconBtn = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--text-muted)',
  display: 'flex',
  padding: 2,
  flexShrink: 0,
}
const addBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 12,
  padding: '4px 8px',
  borderRadius: 6,
  background: 'none',
  border: '1px dashed var(--border)',
  color: 'var(--text-dim)',
  cursor: 'pointer',
}
const summaryStyle = {
  fontSize: 11,
  color: 'var(--text-muted)',
  fontStyle: 'italic',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flex: 1,
  minWidth: 0,
}
