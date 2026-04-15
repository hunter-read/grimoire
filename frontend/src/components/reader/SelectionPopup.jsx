import { useTranslation } from 'react-i18next'
import { LuBookmarkPlus } from 'react-icons/lu'

/**
 * Floating chip shown above a text selection, allowing users to bookmark it.
 *
 * @param {object}   props.selectionPopup - { x, y, text, page }
 * @param {Function} props.onBookmark     - called with (page, text) when the button is pressed
 */
export default function SelectionPopup({ selectionPopup, onBookmark }) {
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
        onMouseDown={e => {
          e.preventDefault()
          onBookmark(selectionPopup.page, selectionPopup.text)
        }}
        style={{
          background: 'var(--bg-panel)', border: '1px solid var(--border)',
          borderRadius: 6, padding: '6px 12px', fontSize: 13,
          color: 'var(--gold)', cursor: 'pointer', display: 'flex',
          alignItems: 'center', gap: 6, boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
          whiteSpace: 'nowrap',
        }}
      >
        <LuBookmarkPlus size={13} /> {t('selectionPopup.bookmarkSelection')}
      </button>
    </div>
  )
}
