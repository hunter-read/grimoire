import { useTranslation } from 'react-i18next'
import CollapseExpandButtons from '../CollapseExpandButtons'
import ToggleSwitch from '../ToggleSwitch'
import type { ReactNode } from 'react'
import type useMediaGallery from '../../hooks/useMediaGallery'
import type { MediaConfig } from './mediaConfig'

export interface GalleryToolbarProps {
  config: Pick<MediaConfig, 'i18n'>
  gallery: ReturnType<typeof useMediaGallery>
  leading?: ReactNode
}

/**
 * Header view-controls for a media gallery (maps / tokens / audio): a
 * folder-grouping switch and collapse/expand-all. The search box, the
 * SortFilterBar (sort + filter modal), and the bulk-select / view-mode buttons
 * are rendered separately by GalleryLayout — the latter two live in the sticky
 * toolbar row alongside sort and filters (#255).
 *
 * `leading` is an optional control placed at the head of the row (audio's
 * "Saved sets"). It takes the slack so the row fills the same width as the
 * search box above it, keeping the header a tidy rectangle rather than a
 * ragged right edge.
 */
export default function GalleryToolbar({ config, gallery, leading }: GalleryToolbarProps) {
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
      {leading}
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
