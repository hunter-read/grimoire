import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  LuArrowLeft,
  LuDownload,
  LuInfo,
  LuChevronDown,
  LuChevronLeft,
  LuChevronRight,
} from 'react-icons/lu'
import useImageGestures from '../../hooks/useImageGestures'
import useImagePrefetch from '../../hooks/useImagePrefetch'
import api, { mediaUrl } from '../../api'
import Spinner from '../Spinner'
import { formatSize } from '../../utils'
import InlineTagEditor from './InlineTagEditor'
import MapPdfViewer from './MapPdfViewer'
import AddToCampaignButton from '../campaigns/AddToCampaignButton'
import MetaRow from '../MetaRow'
import TagSection from '../TagSection'
import useIsMobile from '../../hooks/useIsMobile'

const getFolderPath = (m) =>
  (m.relative_path || '').replace(/\\/g, '/').split('/').slice(1, -1).join('/')

const navButtonStyle = {
  position: 'absolute',
  top: '50%',
  transform: 'translateY(-50%)',
  zIndex: 2,
  width: 44,
  height: 44,
  borderRadius: '50%',
  border: '1px solid var(--border)',
  background: 'rgba(0, 0, 0, 0.55)',
  color: 'var(--text)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
}

export default function MapDetailView() {
  const { mapId } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const isMobilePhone = useIsMobile(640)
  const [map, setMap] = useState(null)
  const [siblings, setSiblings] = useState([])
  const [editingMapTags, setEditingMapTags] = useState(false)
  const [editingFolderTags, setEditingFolderTags] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const imagePane = useRef(null)
  const loadedFolder = useRef(null)

  // Load siblings (same-folder maps) for prev/next navigation. Only refetch when
  // the folder changes — navigating within a folder reuses the loaded list.
  useEffect(() => {
    if (!map) return
    const folder = getFolderPath(map)
    if (loadedFolder.current === folder) return
    loadedFolder.current = folder
    api
      .get(`/maps?folder=${encodeURIComponent(folder)}`)
      .then((res) => {
        const sorted = (res.maps ?? []).sort((a, b) => a.filename.localeCompare(b.filename))
        setSiblings(sorted)
      })
      .catch(() => {
        loadedFolder.current = null
      })
  }, [map])

  const siblingIdx = siblings.findIndex((m) => m.id === mapId)
  const hasPrev = siblingIdx > 0
  const hasNext = siblingIdx >= 0 && siblingIdx < siblings.length - 1
  const onNext = useCallback(() => {
    if (siblingIdx < siblings.length - 1) navigate(`/maps/${siblings[siblingIdx + 1].id}`)
  }, [siblingIdx, siblings, navigate])
  const onPrev = useCallback(() => {
    if (siblingIdx > 0) navigate(`/maps/${siblings[siblingIdx - 1].id}`)
  }, [siblingIdx, siblings, navigate])

  const { imageStyle } = useImageGestures({
    onNext,
    onPrev,
    containerRef: imagePane,
    resetKey: mapId,
  })

  // Warm the cache for neighbouring maps so prev/next feels instant.
  const mapFileUrl = useCallback((m) => mediaUrl(`/maps/${m.id}/file`), [])
  useImagePrefetch(siblings, siblingIdx, mapFileUrl)

  useEffect(() => {
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
  const isPdf = !!map.is_pdf

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
  }

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
          onClick={() => navigate('/maps')}
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
        {siblingIdx >= 0 && siblings.length > 1 && (
          <span
            style={{ fontSize: 13, color: 'var(--text-muted)', flexShrink: 0 }}
            aria-label={t('maps.detail.position', {
              current: siblingIdx + 1,
              total: siblings.length,
            })}
          >
            {siblingIdx + 1} / {siblings.length}
          </span>
        )}
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
        <AddToCampaignButton resourceType="map" resourceId={mapId} />
        <a
          href={mediaUrl(`/maps/${mapId}/file`)}
          download
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            color: 'var(--text-dim)',
            borderRadius: 4,
            padding: '4px 12px',
            fontSize: 14,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            textDecoration: 'none',
          }}
        >
          <LuDownload size={13} /> {!isMobilePhone && t('common.download')}
        </a>
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
        {/* Image / PDF pane */}
        {isPdf ? (
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
            <img
              src={mediaUrl(`/maps/${mapId}/file`)}
              alt={map.filename}
              style={{
                maxWidth: '100%',
                maxHeight: isMobilePhone ? undefined : 'calc(100vh - 60px)',
                borderRadius: 4,
                boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
                ...imageStyle,
              }}
              draggable={false}
            />
            {hasPrev && (
              <button
                onClick={onPrev}
                aria-label={t('maps.detail.previous')}
                title={t('maps.detail.previous')}
                style={{ ...navButtonStyle, left: 12 }}
              >
                <LuChevronLeft size={26} />
              </button>
            )}
            {hasNext && (
              <button
                onClick={onNext}
                aria-label={t('maps.detail.next')}
                title={t('maps.detail.next')}
                style={{ ...navButtonStyle, right: 12 }}
              >
                <LuChevronRight size={26} />
              </button>
            )}
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

          {map.grid && (
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
                {t('maps.detail.grid')}
              </div>
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
