import { useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { LuX } from 'react-icons/lu'
import useDialogFocus from '../../hooks/useDialogFocus'
import { iconBtn, modalBody, modalHeader, modalPanel, scrim } from '../characters/characterStyles'

interface GmDialogProps {
  title: string
  onClose: () => void
  children: ReactNode
}

/** The modal the GM screen's board actions open in. */
export default function GmDialog({ title, onClose, children }: GmDialogProps) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useDialogFocus(ref, { onClose })
  return (
    <div style={scrim} onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{ ...modalPanel, maxWidth: 560 }}
      >
        <div style={modalHeader}>
          <h2 id={titleId} style={{ margin: 0, fontSize: 17, flex: 1 }}>
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label={t('common.close')} style={iconBtn}>
            <LuX size={16} aria-hidden="true" />
          </button>
        </div>
        <div style={modalBody}>{children}</div>
      </div>
    </div>
  )
}
