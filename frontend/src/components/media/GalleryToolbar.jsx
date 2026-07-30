import { useTranslation } from 'react-i18next'
import ViewModeToggle from '../ViewModeToggle'
import BulkToggleButton from '../BulkToggleButton'
import CollapseExpandButtons from '../CollapseExpandButtons'
import ToggleSwitch from '../ToggleSwitch'

const toolBtnStyle = {
  padding: '6px 12px',
  borderRadius: 6,
  fontSize: 13,
  background: 'var(--bg-card)',
  color: 'var(--text-dim)',
  border: '1px solid var(--border)',
  cursor: 'pointer',
}

/**
 * Header view-controls for a media gallery (maps / tokens / audio): bulk-select,
 * view-mode, a folder-grouping switch, and collapse/expand-all. The standalone
 * search box and the SortFilterBar (sort + filter modal) are rendered separately
 * by GalleryLayout, mirroring the system/library toolbar arrangement.
 */
export default function GalleryToolbar({ config, gallery, showBulk }) {
  const { t } = useTranslation()
  const { i18n } = config
  const { bulkMode } = gallery.bulk

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
        justifyContent: 'flex-end',
      }}
    >
      {showBulk && <BulkToggleButton active={bulkMode} onToggle={gallery.bulk.enter} />}
      {bulkMode && <BulkToggleButton active onToggle={gallery.bulk.exit} />}
      <ViewModeToggle
        mode={gallery.viewMode}
        onCycle={gallery.cycleViewMode}
        style={toolBtnStyle}
      />
      <ToggleSwitch
        id={`${i18n}-group-toggle`}
        checked={gallery.grouped}
        onChange={gallery.setGrouped}
        labelFirst
        pill
        label={
          <span style={{ fontSize: 13, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
            {t('sortFilter.groupByFolder')}
          </span>
        }
      />
      <CollapseExpandButtons
        onCollapseAll={() => gallery.setCollapsed(gallery.allKeys)}
        onExpandAll={() => gallery.setCollapsed(new Set())}
        collapseDisabled={gallery.noFolders || bulkMode || !gallery.grouped || gallery.allCollapsed}
        expandDisabled={gallery.noFolders || bulkMode || !gallery.grouped || gallery.allExpanded}
      />
    </div>
  )
}
