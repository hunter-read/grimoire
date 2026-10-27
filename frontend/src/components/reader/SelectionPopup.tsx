import { useTranslation } from 'react-i18next'
import { LuBookmarkPlus } from 'react-icons/lu'

/** Where a text selection sits on screen, what it says, and which page it is on. */
export interface TextSelection {
  x: number
  y: number
  text: string
  page: number
}

interface SelectionPopupProps {
  selectionPopup: TextSelection
  /** Called with (page, text) when the button is pressed. */
  onBookmark: (page: number, text: string) => void
}

/** Floating chip shown above a text selection, allowing users to bookmark it. */
export default function SelectionPopup({ selectionPopup, onBookmark }: SelectionPopupProps) {
  const { t } = useTranslation()
  return (
    <div
      data-bookmark-ui="true"
      style={{
        position: 'fixed',
        left: selectionPopup.x,
        top: selectionPopup.y - 40,
        transform: 'translateX(-50%)',
        zIndex: 1000,
      }}
    >
      <button
        onMouseDown={(e) => {
          e.preventDefault()
          onBookmark(selectionPopup.page, selectionPopup.text)
        }}
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: '6px 12px',
          fontSize: 13,
          color: 'var(--gold)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          boxShadow: '0 2px 8px var(--shadow)',
          whiteSpace: 'nowrap',
        }}
      >
        <LuBookmarkPlus size={13} /> {t('selectionPopup.bookmarkSelection')}
      </button>
    </div>
  )
}
