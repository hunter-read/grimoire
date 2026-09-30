import { useTranslation } from 'react-i18next'
import SortFilterBar from './SortFilterBar'
import BulkToggleButton from '../BulkToggleButton'
import ViewModeToggle from '../ViewModeToggle'
import useTagLabels, { titleCaseTag } from '../../hooks/useTagLabels'

/**
 * The systems toolbar: name search, sort, filters, saved presets, multi-select
 * and view mode. Shared by the main library grid and a container's child grid
 * (issue #500) so drilling into a collection keeps the same controls.
 *
 * @param systems   rows the filter dropdowns are derived from (before filtering)
 * @param tags      every tag across those rows, for the tag filter
 * @param state     { sort, order, filters }
 * @param onChange  (nextState) => void
 * @param saved     the useSavedFilters('systems') result
 * @param bulk      the useBulkSelection() result
 * @param canEdit   whether multi-select is offered
 */
export default function SystemSortFilterBar({
  systems,
  tags,
  state,
  onChange,
  saved,
  bulk,
  canEdit,
  viewMode,
  onCycleViewMode,
}) {
  const { t } = useTranslation()
  // Shared-tag display labels for system tags (values still match on internal key).
  const systemTagLabels = useTagLabels('system')

  // Filter dropdown options are derived from the rows actually in the grid, so
  // flattening a container surfaces its children's families/genres and grouping
  // hides them again — an option that can never match is worse than a missing
  // one. (Edition is deliberately not offered: it isn't recorded consistently
  // enough across systems to filter on.)
  const optionsFrom = (pick) =>
    [...new Set(systems.flatMap((s) => [pick(s)].flat().filter(Boolean)))]
      .sort((a, b) => a.localeCompare(b))
      .map((v) => ({ value: v, label: v }))

  const genreOptions = optionsFrom((s) => s.genres || [])
  const familyOptions = optionsFrom((s) => s.system_family)
  const parentSystemOptions = optionsFrom((s) => s.parent_system)
  const diceOptions = optionsFrom((s) => s.dice_materials || [])
  const tagOptions = tags.map((tg) => ({
    value: tg,
    label: systemTagLabels[tg] || titleCaseTag(tg),
  }))

  return (
    <SortFilterBar
      sticky
      scope="systems"
      trailing={
        <>
          {canEdit && (
            <BulkToggleButton
              active={bulk.bulkMode}
              onToggle={() => (bulk.bulkMode ? bulk.exit() : bulk.enter())}
            />
          )}
          <ViewModeToggle mode={viewMode} onCycle={onCycleViewMode} />
        </>
      }
      state={state}
      onChange={onChange}
      sortOptions={[
        { value: 'name', label: t('sortFilter.sortName') },
        { value: 'book_count', label: t('sortFilter.sortBookCount') },
        { value: 'page_count', label: t('sortFilter.sortPageCount') },
        { value: 'year', label: t('sortFilter.sortYear') },
      ]}
      selectFilters={[
        {
          key: 'genre',
          label: t('sortFilter.filterGenre'),
          allLabel: t('sortFilter.allGenres'),
          options: genreOptions,
        },
        {
          key: 'family',
          label: t('sortFilter.filterFamily'),
          allLabel: t('sortFilter.allFamilies'),
          options: familyOptions,
        },
        ...(parentSystemOptions.length
          ? [
              {
                key: 'parent_system',
                label: t('sortFilter.filterParentSystem'),
                allLabel: t('sortFilter.allParentSystems'),
                options: parentSystemOptions,
              },
            ]
          : []),
        {
          key: 'dice',
          label: t('sortFilter.filterDice'),
          allLabel: t('sortFilter.allDice'),
          options: diceOptions,
        },
      ]}
      queryFilters={[
        {
          key: 'tags',
          label: t('sortFilter.filterTags'),
          emptyLabel: t('sortFilter.noTags'),
          options: tagOptions,
        },
      ]}
      toggleFilters={[
        {
          key: 'favorites',
          label: t('sortFilter.filterFavorites'),
          boolean: true,
        },
        { key: 'explicit', label: t('sortFilter.filterExplicit') },
      ]}
      saved={saved.saved}
      onSavePreset={(name, opts) => saved.save(name, state, opts)}
      onSetDefault={saved.setDefault}
      onDeletePreset={saved.remove}
    />
  )
}
