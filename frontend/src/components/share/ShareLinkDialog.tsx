import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuX } from 'react-icons/lu'
import { shareLinks, type Schema } from '../../api'
import ShareLinkCreateForm from './ShareLinkCreateForm'
import ShareLinkList from './ShareLinkList'

export interface ShareLinkDialogProps {
  resourceType: Schema<'ShareLinkCreate'>['resource_type']
  resourceId: string
  title?: string | null
  onClose: () => void
}

/**
 * Share one item (issue #541): make a new link, and see, copy or revoke the
 * links you already made for it. A newly created link goes to the top of the
 * list, where its Copy buttons are.
 */
export default function ShareLinkDialog({
  resourceType,
  resourceId,
  title,
  onClose,
}: ShareLinkDialogProps) {
  const { t } = useTranslation()
  const [links, setLinks] = useState<Schema<'ShareLinkOut'>[] | null>(null)
  const [error, setError] = useState('')
  // null until a load fails; then the server's message, or '' for the fallback.
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    let live = true
    shareLinks
      .list({ resource_type: resourceType, resource_id: resourceId })
      .then((data) => live && setLinks(data))
      .catch((err: Error) => {
        if (!live) return
        setLinks([])
        setLoadError(err.message || '')
      })
    return () => {
      live = false
    }
  }, [resourceType, resourceId])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--scrim)',
      }}
    >
      <div
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: 24,
          width: 560,
          maxWidth: '92vw',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span id="share-dialog-title" style={{ fontSize: 15, fontWeight: 600 }}>
            {t('share.dialog.title')}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              display: 'flex',
              padding: 2,
            }}
          >
            <LuX size={16} />
          </button>
        </div>
        {title && (
          <p
            style={{
              fontSize: 13,
              color: 'var(--text-muted)',
              margin: '4px 0 0',
              overflowWrap: 'anywhere',
            }}
          >
            {title}
          </p>
        )}
        <p style={{ fontSize: 13, lineHeight: 1.5, margin: '12px 0 20px' }}>
          {t('share.dialog.intro')}
        </p>

        <ShareLinkCreateForm
          resourceType={resourceType}
          resourceId={resourceId}
          onCreated={(link) => setLinks((prev) => [link, ...(prev || [])])}
        />

        <div style={{ marginTop: 24 }}>
          <div
            style={{
              fontSize: 12,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              marginBottom: 10,
            }}
          >
            {t('share.dialog.existing')}
          </div>
          {(error || loadError !== null) && (
            <p role="alert" style={{ fontSize: 13, color: 'var(--danger)', margin: '0 0 8px' }}>
              {error || loadError || t('share.loadFailed')}
            </p>
          )}
          {links === null ? (
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
              {t('common.loading')}
            </p>
          ) : (
            <ShareLinkList
              links={links}
              onChange={setLinks}
              onError={setError}
              emptyText={t('share.dialog.none')}
            />
          )}
        </div>
      </div>
    </div>
  )
}
