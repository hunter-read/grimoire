import { useTranslation } from 'react-i18next'
import { LuLink2 } from 'react-icons/lu'
import type { Schema } from '../../api'
import { systemDisplayName } from '../../utils/systemDisplayName'

/**
 * Marks a book standing on this shelf through a link rather than its own folder
 * (issue #446), naming the system it lives in when the reader may see it.
 * Renders nothing for a shelf's own books.
 */
export interface LinkedBookBadgeProps {
  book: { is_linked?: boolean; linked_from?: Schema<'LinkedSystemRef'> | null }
  /** The grid card's smaller size, beside the page count. */
  small?: boolean
}

export default function LinkedBookBadge({ book, small = false }: LinkedBookBadgeProps) {
  const { t } = useTranslation()
  if (!book.is_linked) return null
  const title = book.linked_from
    ? t('bookLinks.linkedFrom', { name: systemDisplayName(book.linked_from) })
    : t('bookLinks.linkedHidden')
  return (
    <span
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        fontSize: small ? 10 : 11,
        padding: small ? '0 5px' : '1px 6px',
        borderRadius: small ? 7 : 8,
        flexShrink: 0,
        color: 'var(--gold-dim)',
        background: 'rgba(214, 178, 74, 0.10)',
        border: '1px solid rgba(214, 178, 74, 0.35)',
      }}
    >
      <LuLink2 size={small ? 9 : 10} aria-hidden="true" />
      {t('bookLinks.badge')}
      <span className="sr-only">{`: ${title}`}</span>
    </span>
  )
}
