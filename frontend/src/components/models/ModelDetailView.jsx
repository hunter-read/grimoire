import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LuArrowLeft, LuInfo, LuChevronDown } from 'react-icons/lu'
import { useAuth } from '../../context/AuthContext'
import useIsMobile from '../../hooks/useIsMobile'
import api from '../../api'
import Spinner from '../Spinner'
import { formatSize } from '../../utils'
import InlineTagEditor from '../maps/InlineTagEditor'
import AddToCampaignButton from '../campaigns/AddToCampaignButton'
import VariantPicker from '../VariantPicker'
import DownloadVersionButton from '../DownloadVersionButton'
import MetaRow from '../MetaRow'
import TagSection from '../TagSection'
import ArchivePlaceholder from '../media/ArchivePlaceholder'
import { isArchiveMedia } from '../../constants'
import ModelViewerPane from './ModelViewerPane'

export default function ModelDetailView() {
  const { modelId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  // See MapDetailView: guests reach this view from a campaign resource row and
  // have no /models browse route to go back to (issue #361).
  const backPathRef = useRef(location.state?.from ?? null)
  // Going back is a *return* to the gallery, so it restores the filters the user
  // had rather than re-applying their saved default over them.
  const goBack = () => navigate(backPathRef.current || '/models', { state: { restoreView: true } })
  const { t } = useTranslation()
  const { user } = useAuth()
  const isMobilePhone = useIsMobile(640)
  const canEdit = user?.role === 'admin' || user?.role === 'gm'
  const [model, setModel] = useState(null)
  const [editingModelTags, setEditingModelTags] = useState(false)
  const [editingFolderTags, setEditingFolderTags] = useState(false)
  const [showDetails, setShowDetails] = useState(false)

  useEffect(() => {
    api.get(`/models/${modelId}`).then(setModel)
  }, [modelId])

  if (!model)
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <Spinner size={32} />
      </div>
    )

  const folder = (() => {
    const parts = (model.relative_path || '').replace(/\\/g, '/').split('/')
    const dirParts = parts.slice(1, -1)
    return dirParts.length > 0 ? dirParts.join(' / ') : null
  })()

  const currentFolderTags = model.folder_tags ?? []
  const isArchive = isArchiveMedia(model)

  const saveModelTags = async (tags) => {
    await api.patch(`/models/${modelId}`, { tags })
    setModel({ ...model, tags })
    setEditingModelTags(false)
  }

  const saveFolderTags = async (tags) => {
    await api.patch('/model-folders', { path: model.folder_path, tags })
    setModel({ ...model, folder_tags: tags })
    setEditingFolderTags(false)
  }

  const toggleExplicit = async () => {
    const next = !model.is_explicit
    await api.patch(`/models/${modelId}`, { is_explicit: next })
    setModel({ ...model, is_explicit: next })
  }

  // Tri-state, cycling unknown → presupported → unsupported → unknown. The scan
  // can only guess from the filename and folder, and a file that moved between
  // a Presupported/ and an Unsupported/ folder keeps whatever it was first
  // scanned as — so the user needs the last word.
  const cycleSupport = async () => {
    const next = model.is_supported === null ? true : model.is_supported === true ? false : null
    await api.patch(`/models/${modelId}`, { is_supported: next })
    setModel({ ...model, is_supported: next })
  }

  const supportLabel =
    model.is_supported === true
      ? t('models.presupported')
      : model.is_supported === false
        ? t('models.unsupported')
        : t('models.supportUnknown')

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
          aria-label={t('models.detail.back')}
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
          {model.filename}
        </span>
        {isMobilePhone && (
          <button
            onClick={() => setShowDetails((v) => !v)}
            title={t('models.detail.details')}
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
        <VariantPicker item={model} detailPath={(id) => `/models/${id}`} compact />
        <AddToCampaignButton resourceType="model" resourceId={modelId} />
        <DownloadVersionButton type="models" id={modelId} item={model} compact={isMobilePhone} />
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
        {isArchive ? (
          <ArchivePlaceholder fileUrl={`/models/${modelId}/file`} filename={model.filename} />
        ) : (
          <div
            style={{
              flex: 1,
              overflow: 'auto',
              background: 'var(--bg-deep)',
              padding: 24,
            }}
          >
            <ModelViewerPane model={model} height="100%" />
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
              : { width: 260, flexShrink: 0, borderLeft: '1px solid var(--border)' }),
            background: 'var(--bg-panel)',
            padding: '24px 20px',
            overflowY: 'auto',
          }}
        >
          <h3 style={{ fontSize: 15, marginBottom: 20 }}>{t('models.detail.title')}</h3>

          {canEdit && (
            <div style={{ marginBottom: 20 }}>
              <label
                htmlFor="model-is-explicit"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  cursor: 'pointer',
                  width: 'fit-content',
                }}
              >
                <input
                  id="model-is-explicit"
                  type="checkbox"
                  checked={model.is_explicit || false}
                  onChange={toggleExplicit}
                  style={{ width: 15, height: 15, cursor: 'pointer', accentColor: 'var(--danger)' }}
                />
                <span style={{ fontSize: 13, color: 'var(--danger)' }}>
                  {t('models.detail.explicitContent')}
                </span>
              </label>
            </div>
          )}

          {folder && <MetaRow label={t('models.detail.location')} value={folder} />}
          <MetaRow label={t('models.detail.fileSize')} value={formatSize(model.file_size)} />
          {model.triangle_count > 0 && (
            <MetaRow
              label={t('models.detail.triangles')}
              value={model.triangle_count.toLocaleString()}
            />
          )}
          <MetaRow
            label={t('models.detail.supports')}
            value={
              canEdit ? (
                <button
                  onClick={cycleSupport}
                  title={t('models.detail.cycleSupports')}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    font: 'inherit',
                    color: 'var(--accent)',
                    cursor: 'pointer',
                    textDecoration: 'underline dotted',
                  }}
                >
                  {supportLabel}
                </button>
              ) : (
                supportLabel
              )
            }
          />

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
                  {t('models.detail.folderTags')}
                </div>
                <InlineTagEditor
                  tags={currentFolderTags}
                  onSave={saveFolderTags}
                  onCancel={() => setEditingFolderTags(false)}
                  resourceType="model"
                />
              </div>
            ) : (
              <TagSection
                label={t('models.detail.folderTags')}
                tags={currentFolderTags}
                canEdit={true}
                onEdit={() => setEditingFolderTags(true)}
                editLabel={t('models.detail.editTags')}
                noTagsLabel={t('models.detail.noTags')}
              />
            ))}

          {/* Model tags */}
          {editingModelTags ? (
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
                {t('models.detail.modelTags')}
              </div>
              <InlineTagEditor
                tags={model.tags}
                onSave={saveModelTags}
                onCancel={() => setEditingModelTags(false)}
                resourceType="model"
              />
            </div>
          ) : (
            <TagSection
              label={t('models.detail.modelTags')}
              tags={model.tags}
              canEdit
              onEdit={() => setEditingModelTags(true)}
              editLabel={t('models.detail.editTags')}
              noTagsLabel={t('models.detail.noTags')}
            />
          )}
        </div>
      </div>
    </div>
  )
}
