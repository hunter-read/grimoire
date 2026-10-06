import { useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { LuX } from 'react-icons/lu'
import useDialogFocus from '../../hooks/useDialogFocus'
import { scrim, modalPanel, modalHeader, modalBody, iconBtn } from './characterStyles'

/**
 * The modal shell the character pages share: a titled panel over a scrim,
 * labelled for assistive technology, with focus kept inside it, Escape and a
 * click outside to close, and focus handed back to the opener afterwards.
 *
 * `children` is the body, which scrolls; `footer` stays pinned below it, the
 * place for a dialog's actions. `tabs` sits between the title and the body.
 */
export default function CharacterDialog({
  title,
  description,
  onClose,
  children,
  footer,
  tabs,
  maxWidth = 860,
  initialFocusRef,
}) {
  const { t } = useTranslation()
  const titleId = useId()
  const descriptionId = useId()
  const panelRef = useRef(null)
  useDialogFocus(panelRef, { onClose, initialFocusRef })

  return (
    <div
      style={scrim}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        style={{ ...modalPanel, maxWidth }}
      >
        <header style={modalHeader}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id={titleId} style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
              {title}
            </h2>
            {description ? (
              <p
                id={descriptionId}
                style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}
              >
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            title={t('common.close')}
            style={iconBtn}
          >
            <LuX size={18} />
          </button>
        </header>
        {tabs}
        <div style={modalBody}>{children}</div>
        {footer ? (
          <footer
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 8,
              padding: '12px 20px 16px',
              borderTop: '1px solid var(--border)',
            }}
          >
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  )
}
