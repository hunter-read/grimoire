import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LuArrowLeft, LuInfo, LuChevronDown } from 'react-icons/lu'
import useImageGestures from '../../hooks/useImageGestures'
import useImagePrefetch from '../../hooks/useImagePrefetch'
import useSiblingNavigation from '../../hooks/useSiblingNavigation'
import api, { mediaUrl } from '../../api'
import Spinner from '../Spinner'
import { formatSize } from '../../utils'
import InlineTagEditor from './InlineTagEditor'
import MapPdfViewer from './MapPdfViewer'
import MapImagePane from './MapImagePane'
import MapVideoPane from './MapVideoPane'
import MapVttPane from './MapVttPane'
import MapGridEditor from './MapGridEditor'
import ArchivePlaceholder from '../media/ArchivePlaceholder'
import SiblingNavButtons from '../media/SiblingNavButtons'
import SiblingPosition from '../media/SiblingPosition'
import { isArchiveMedia } from '../../constants'
import AddToCampaignButton from '../campaigns/AddToCampaignButton'
import DetailFavoriteButton from '../DetailFavoriteButton'
import VariantPicker from '../VariantPicker'
import EditVttButton from './vtt/EditVttButton'
import { canExportUvtt } from './vtt/editTargets'
import DownloadVersionButton from '../DownloadVersionButton'
import MetaRow from '../MetaRow'
import TagSection from '../TagSection'
import useIsMobile from '../../hooks/useIsMobile'

export default function MapDetailView() {
  const { mapId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  // Return to wherever the map was opened from (a campaign resource row passes
  // `state.from`). Guests have no /maps browse route, so a hardcoded '/maps'
  // would bounce them off the catch-all back to the campaign list (issue #361).
  const backPathRef = useRef(location.state?.from ?? null)
  // Going back is a *return* to the gallery, so it restores the filters the user
  // had rather than re-applying their saved default over them.
  const goBack = () => navigate(backPathRef.current || '/maps', { state: { restoreView: true } })
  const { t } = useTranslation()
  const isMobilePhone = useIsMobile(640)
  const [map, setMap] = useState(null)
  const [editingMapTags, setEditingMapTags] = useState(false)
  const [editingFolderTags, setEditingFolderTags] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [editingGrid, setEditingGrid] = useState(false)
  const [vttData, setVttData] = useState(null)
  const imagePane = useRef(null)

  const mapDetailPath = useCallback((id) => `/maps/${id}`, [])
  const {
    siblings,
    index: siblingIdx,
    hasPrev,
    hasNext,
    onPrev,
    onNext,
  } = useSiblingNavigation({
    item: map,
    id: mapId,
    listUrl: '/maps',
    listKey: 'maps',
    detailPath: mapDetailPath,
    navigate,
    get: api.get,
    // Maps narrow by folder in SQL, so a huge gallery does not materialise
    // every row to find one folder's neighbours.
    serverFiltered: true,
  })

  const { imageStyle } = useImageGestures({
    onNext,
    onPrev,
    containerRef: imagePane,
    resetKey: mapId,
  })

  // Warm the cache for neighbouring maps so prev/next feels instant. Prefetch
  // the downscaled preview, not the original — pulling neighbouring 50MB files
  // in the background competed for bandwidth with the map being viewed, which
  // made the thing the user actually asked for slower.
  const mapPreviewUrl = useCallback((m) => {
    if (m.is_archive) return null
    const ext = (m.filename || '').toLowerCase()
    // Videos stream on demand and VTT images come from their own endpoint;
    // neither is worth pulling ahead of time.
    if (/\.(webm|mp4|uvtt|dd2vtt)$/.test(ext)) return null
    return mediaUrl(`/maps/${m.id}/page/1`, { width: 2000 })
  }, [])
  useImagePrefetch(siblings, siblingIdx, mapPreviewUrl)

  useEffect(() => {
    setVttData(null)
    api.get(`/maps/${mapId}`).then(setMap)
  }, [mapId])

  if (!map)
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <Spinner size={32} />
      </div>
    )

  const folder = (() => {
    const parts = (map.relative_path || '').replace(/\\/g, '/').split('/')
    const dirParts = parts.slice(1, -1)
    return dirParts.length > 0 ? dirParts.join(' / ') : null
  })()

  const currentFolderTags = map.folder_tags ?? []
  const isArchive = isArchiveMedia(map)
  const isPdf = !!map.is_pdf
  const isVideo = map.media_kind === 'video'
  const isVtt = map.media_kind === 'vtt'

  const saveMapTags = async (tags) => {
    await api.patch(`/maps/${mapId}`, { tags })
    setMap({ ...map, tags })
    setEditingMapTags(false)
  }

  const saveFolderTags = async (tags) => {
    await api.patch('/map-folders', { path: map.folder_path, tags })
    setMap({ ...map, folder_tags: tags })
    setEditingFolderTags(false)
  }

  const gridSourceLabel = {
    filename: t('maps.detail.gridSourceFilename'),
    dpi: t('maps.detail.gridSourceDpi'),
    computed: t('maps.detail.gridSourceComputed'),
    manual: t('maps.detail.gridSourceManual'),
  }

  // Re-fetch after a grid edit rather than patching state locally: the detail
  // payload's `grid` is derived server-side from the override, so the response
  // is the only place the resolved grid actually exists.
  const reloadMap = async () => {
    setMap(await api.get(`/maps/${mapId}`))
    setEditingGrid(false)
  }

  // Only raster maps can be exported: a PDF, video or archive has no single
  // image to embed, and a .uvtt is already in the target format.
  const isRasterMap = !isPdf && !isVideo && !isVtt && !isArchive

  // Whether a .uvtt can be built for this map. The rule lives beside the
  // editor's own target rules so the button and the download menu cannot drift
  // apart — see `vtt/editTargets`. The grid editor stays available either way:
  // correcting the grid is worth doing for its own sake, not only for export.
  const exportable = canExportUvtt(map)

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 20px',
          background: 'var(--bg-panel)',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
          flexWrap: 'wrap',
        }}
      >
        <button
          onClick={goBack}
          aria-label={t('maps.detail.back')}
          style={{
            background: 'none',
            color: 'var(--text-dim)',
            fontSize: 15,
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <LuArrowLeft size={15} /> {!isMobilePhone && t('common.back')}
        </button>
        <div style={{ width: 1, height: 20, background: 'var(--border)' }} />
        <span
          style={{
            fontSize: 16,
            fontWeight: 500,
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {map.filename}
        </span>
        <SiblingPosition
          index={siblingIdx}
          total={siblings.length}
          label={t('maps.detail.position', {
            current: siblingIdx + 1,
            total: siblings.length,
          })}
        />
        {isMobilePhone && (
          <button
            onClick={() => setShowDetails((v) => !v)}
            title={t('maps.detail.details')}
            style={{
              background: showDetails ? 'var(--bg-card-hover)' : 'var(--bg-card)',
              border: '1px solid var(--border)',
              color: showDetails ? 'var(--gold)' : 'var(--text-dim)',
              borderRadius: 4,
              padding: '4px 10px',
              fontSize: 14,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              cursor: 'pointer',
            }}
          >
            <LuInfo size={13} />
            <LuChevronDown
              size={11}
              style={{
                transform: showDetails ? 'rotate(180deg)' : 'none',
                transition: 'transform 0.2s',
              }}
            />
          </button>
        )}
        <VariantPicker item={map} detailPath={(id) => `/maps/${id}`} compact />
        {/* The VTT editor authors walls, doors and lights (issues #126/#127).
            A .uvtt opens on the geometry it already carries; a map paired with
            one offers the choice, since only the user knows which they mean.
            Nothing saved here touches the file on disk. */}
        <EditVttButton map={map} compact={isMobilePhone} />
        <DetailFavoriteButton type="map" id={mapId} compact={isMobilePhone} />
        <AddToCampaignButton resourceType="map" resourceId={mapId} />
        <DownloadVersionButton
          type="maps"
          id={mapId}
          item={map}
          compact={isMobilePhone}
          extraItems={
            exportable
              ? [
                  {
                    key: 'uvtt',
                    label: t('maps.detail.downloadUvtt'),
                    sublabel: t('maps.detail.downloadUvttHint'),
                    href: mediaUrl(`/maps/${mapId}/export.uvtt`),
                  },
                ]
              : []
          }
        />
      </div>

      {/* Body */}
      <div
        style={{
          flex: 1,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: isMobilePhone ? 'column' : 'row',
        }}
      >
        {/* Image / PDF / archive pane */}
        {isArchive ? (
          <ArchivePlaceholder fileUrl={`/maps/${mapId}/file`} filename={map.filename} />
        ) : isPdf ? (
          <div style={{ flex: 1, minWidth: 0, display: 'flex' }}>
            <MapPdfViewer
              mapId={mapId}
              filename={map.filename}
              totalPages={map.page_count || 1}
              isMobilePhone={isMobilePhone}
            />
          </div>
        ) : (
          <div
            ref={imagePane}
            style={{
              position: 'relative',
              flex: 1,
              overflow: 'auto',
              background: 'var(--bg-deep)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 24,
            }}
          >
            {isVideo ? (
              <MapVideoPane mapId={mapId} filename={map.filename} isMobilePhone={isMobilePhone} />
            ) : isVtt ? (
              <MapVttPane
                mapId={mapId}
                filename={map.filename}
                isMobilePhone={isMobilePhone}
                onData={setVttData}
              />
            ) : (
              <MapImagePane
                mapId={mapId}
                filename={map.filename}
                hasThumbnail={map.has_thumbnail}
                imageStyle={imageStyle}
                isMobilePhone={isMobilePhone}
              />
            )}
            <SiblingNavButtons
              hasPrev={hasPrev}
              hasNext={hasNext}
              onPrev={onPrev}
              onNext={onNext}
              prevLabel={t('maps.detail.previous')}
              nextLabel={t('maps.detail.next')}
            />
          </div>
        )}

        {/* Metadata sidebar — always visible on desktop, toggle-controlled on mobile */}
        <div
          style={{
            ...(isMobilePhone
              ? {
                  display: showDetails ? 'block' : 'none',
                  width: '100%',
                  borderTop: '1px solid var(--border)',
                  maxHeight: '50vh',
                }
              : { width: 280, flexShrink: 0, borderLeft: '1px solid var(--border)' }),
            background: 'var(--bg-panel)',
            padding: '24px 20px',
            overflowY: 'auto',
          }}
        >
          <h3 style={{ fontSize: 15, marginBottom: 20 }}>{t('maps.detail.title')}</h3>

          {folder && <MetaRow label={t('maps.detail.location')} value={folder} />}
          <MetaRow label={t('maps.detail.fileSize')} value={formatSize(map.file_size)} />
          {map.pixel_width != null && (
            <MetaRow
              label={t('maps.detail.resolution')}
              value={t('maps.detail.resolutionValue', {
                width: map.pixel_width,
                height: map.pixel_height,
              })}
            />
          )}
          {map.dpi != null && <MetaRow label={t('maps.detail.dpi')} value={String(map.dpi)} />}
          {map.map_type && <MetaRow label={t('maps.detail.type')} value={map.map_type} />}

          {/* Universal VTT feature data — grid resolution plus the wall/portal/
              light counts that make the file useful in a VTT. */}
          {isVtt && vttData && (
            <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--text-muted)',
                  marginBottom: 12,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                {t('maps.detail.vttTitle')}
              </div>
              {vttData.grid_width != null && vttData.grid_height != null && (
                <MetaRow
                  label={t('maps.detail.gridDimensions')}
                  value={t('maps.detail.gridDimensionsValue', {
                    width: vttData.grid_width,
                    height: vttData.grid_height,
                  })}
                />
              )}
              {vttData.pixels_per_grid != null && (
                <MetaRow
                  label={t('maps.detail.gridCellSize')}
                  value={t('maps.detail.gridCellSizeValue', { px: vttData.pixels_per_grid })}
                />
              )}
              <MetaRow
                label={t('maps.detail.vttWalls')}
                value={String(vttData.wall_count + vttData.object_wall_count)}
              />
              <MetaRow label={t('maps.detail.vttPortals')} value={String(vttData.portal_count)} />
              <MetaRow label={t('maps.detail.vttLights')} value={String(vttData.light_count)} />
            </div>
          )}

          {/* Grid — editable so a wrong detection can be corrected before the
              map is exported to .uvtt (issue #125). Shown for any raster map,
              including one where nothing could be detected. */}
          {(map.grid || isRasterMap) && (
            <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  marginBottom: 12,
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}
                >
                  {t('maps.detail.grid')}
                </div>
                {!editingGrid && isRasterMap && (
                  <button
                    type="button"
                    data-testid="open-grid-editor"
                    onClick={() => setEditingGrid(true)}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      fontSize: 12,
                      color: 'var(--accent, var(--text-dim))',
                      cursor: 'pointer',
                    }}
                  >
                    {t('maps.detail.editTags')}
                  </button>
                )}
              </div>
              {editingGrid ? (
                <MapGridEditor
                  map={map}
                  onSaved={reloadMap}
                  onCancel={() => setEditingGrid(false)}
                />
              ) : map.grid ? (
                <>
                  <MetaRow
                    label={t('maps.detail.gridDimensions')}
                    value={t('maps.detail.gridDimensionsValue', {
                      width: map.grid.width,
                      height: map.grid.height,
                    })}
                  />
                  {map.grid.cell_px != null && (
                    <MetaRow
                      label={t('maps.detail.gridCellSize')}
                      value={t('maps.detail.gridCellSizeValue', { px: map.grid.cell_px })}
                    />
                  )}
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    {gridSourceLabel[map.grid.source] ?? map.grid.source}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  {t('maps.detail.gridUnknown')}
                </div>
              )}
            </div>
          )}

          {/* Folder tags */}
          {folder &&
            (editingFolderTags ? (
              <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--text-muted)',
                    marginBottom: 10,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}
                >
                  {t('maps.detail.folderTags')}
                </div>
                <InlineTagEditor
                  tags={currentFolderTags}
                  onSave={saveFolderTags}
                  onCancel={() => setEditingFolderTags(false)}
                  resourceType="map"
                />
              </div>
            ) : (
              <TagSection
                label={t('maps.detail.folderTags')}
                tags={currentFolderTags}
                canEdit={true}
                onEdit={() => setEditingFolderTags(true)}
                editLabel={t('maps.detail.editTags')}
                noTagsLabel={t('maps.detail.noTags')}
              />
            ))}

          {/* Map tags */}
          {editingMapTags ? (
            <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--text-muted)',
                  marginBottom: 10,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                {t('maps.detail.mapTags')}
              </div>
              <InlineTagEditor
                tags={map.tags}
                onSave={saveMapTags}
                onCancel={() => setEditingMapTags(false)}
                resourceType="map"
              />
            </div>
          ) : (
            <TagSection
              label={t('maps.detail.mapTags')}
              tags={map.tags}
              canEdit
              onEdit={() => setEditingMapTags(true)}
              editLabel={t('maps.detail.editTags')}
              noTagsLabel={t('maps.detail.noTags')}
            />
          )}
        </div>
      </div>
    </div>
  )
}
