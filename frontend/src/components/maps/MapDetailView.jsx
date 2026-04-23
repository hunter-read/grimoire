import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LuArrowLeft, LuDownload, LuTag, LuInfo, LuChevronDown } from 'react-icons/lu'
import useImageGestures from '../../hooks/useImageGestures'

const isMobilePhone = window.matchMedia('(max-width: 640px)').matches

const getFolderPath = (m) =>
  (m.relative_path || '').replace(/\\/g, '/').split('/').slice(1, -1).join('/')
import api, { mediaUrl } from '../../api'
import Spinner from '../Spinner'
import { formatSize } from '../../utils'
import InlineTagEditor from './InlineTagEditor'
import AddToCampaignButton from '../campaigns/AddToCampaignButton'

function MetaRow({ label, value }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          fontSize: 12,
          color: 'var(--text-muted)',
          marginBottom: 3,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 15, color: 'var(--text)' }}>{value}</div>
    </div>
  )
}

function TagSection({ label, tags, onEdit, canEdit, editLabel, noTagsLabel }) {
  return (
    <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 10,
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
          {label}
        </div>
        {canEdit && (
          <button
            onClick={onEdit}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 12,
            }}
          >
            <LuTag size={11} /> {editLabel}
          </button>
        )}
      </div>
      {tags.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {tags.map((tag) => (
            <span key={tag} style={tagPillStyle}>
              {tag}
            </span>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>
          {noTagsLabel}
        </div>
      )}
    </div>
  )
}

export default function MapDetailView() {
  const { mapId } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [map, setMap] = useState(null)
  const [siblings, setSiblings] = useState([])
  const [editingMapTags, setEditingMapTags] = useState(false)
  const [editingFolderTags, setEditingFolderTags] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const imagePane = useRef(null)

  // Load siblings for prev/next navigation
  useEffect(() => {
    api
      .get('/maps')
      .then((all) => {
        if (!map) return
        const folder = getFolderPath(map)
        const sorted = all
          .filter((m) => getFolderPath(m) === folder)
          .sort((a, b) => a.filename.localeCompare(b.filename))
        setSiblings(sorted)
      })
      .catch(() => {})
  }, [map])

  const siblingIdx = siblings.findIndex((m) => m.id === mapId)
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
          <LuArrowLeft size={15} /> {t('common.back')}
        </button>
        <div style={{ width: 1, height: 20, background: 'var(--border)' }} />
        <span
          style={{
            fontSize: 16,
            fontWeight: 500,
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {map.filename}
        </span>
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
          <LuDownload size={13} /> {t('common.download')}
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
        {/* Image pane */}
        <div
          ref={imagePane}
          style={{
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
        </div>

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

const tagPillStyle = {
  fontSize: 12,
  padding: '2px 8px',
  borderRadius: 10,
  background: 'var(--tag-bg)',
  border: '1px solid var(--tag-border)',
  color: 'var(--text-dim)',
}
