import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuShare2 } from 'react-icons/lu'
import useCanShare from './useCanShare'
import ShareLinkDialog, { type ShareLinkDialogProps } from './ShareLinkDialog'

export interface ShareLinkButtonProps {
  resourceType: ShareLinkDialogProps['resourceType']
  resourceId: string
  title?: string | null
  compact?: boolean
}

/**
 * The detail toolbar's Share button (issue #541). Renders nothing for anyone
 * who may not create share links, so there is never a button that only fails.
 */
export default function ShareLinkButton({
  resourceType,
  resourceId,
  title,
  compact = false,
}: ShareLinkButtonProps) {
  const { t } = useTranslation()
  const canShare = useCanShare()
  const [open, setOpen] = useState(false)
  if (!canShare) return null
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t('share.button')}
        aria-label={t('share.button')}
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          color: 'var(--text-dim)',
          borderRadius: 4,
          padding: '4px 10px',
          fontSize: 14,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          cursor: 'pointer',
        }}
      >
        <LuShare2 size={13} aria-hidden="true" />
        {!compact && t('share.button')}
      </button>
      {open && (
        <ShareLinkDialog
          resourceType={resourceType}
          resourceId={resourceId}
          title={title}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
