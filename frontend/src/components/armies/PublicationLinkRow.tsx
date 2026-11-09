import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { armies as armiesApi, type Schema } from '../../api'
import { errorText, input, muted, primaryBtn, secondaryBtn } from './armyStyles'
import { errorMessage } from './armyText'

type BookMatch = Schema<'BookMatch'>

interface PublicationLinkRowProps {
  item: Schema<'ArmyPublication'>
  onLink: (publication: string, bookId: string, offset: number) => Promise<void>
  onUnlink: (publication: string) => Promise<void>
}

/**
 * Link one cited publication to a library book (GMs and admins). Offers the
 * books whose titles match, or a title search, and an offset for books whose
 * printed page numbers do not match the PDF's.
 */
export default function PublicationLinkRow({ item, onLink, onUnlink }: PublicationLinkRowProps) {
  const { t } = useTranslation()
  const suggestions = item.suggestions ?? []
  const [bookId, setBookId] = useState(item.link?.book_id ?? suggestions[0]?.book_id ?? '')
  const [offset, setOffset] = useState(String(item.link?.page_offset ?? 0))
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<BookMatch[] | null>(null)
  const [error, setError] = useState('')

  const search = async () => {
    if (query.trim().length < 2) return
    setError('')
    try {
      const books = await armiesApi.searchBooks(query.trim())
      setFound(books)
      if (books[0] && !bookId) setBookId(books[0].book_id)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const run = async (action: () => Promise<void>) => {
    setError('')
    try {
      await action()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const options = [...suggestions, ...(found ?? [])].filter(
    (b, i, all) => all.findIndex((x) => x.book_id === b.book_id) === i
  )
  if (item.link && !options.some((o) => o.book_id === item.link?.book_id)) {
    options.unshift({ book_id: item.link.book_id, title: item.link.book_title })
  }

  return (
    <li style={{ display: 'grid', gap: 6, padding: '8px 0', borderTop: '1px solid var(--border)' }}>
      <strong style={{ fontSize: 14 }}>{item.publication}</strong>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          style={{ ...input, minWidth: 200 }}
          value={bookId}
          onChange={(e) => setBookId(e.target.value)}
          aria-label={t('armies.links.book')}
        >
          <option value="">{t('armies.links.chooseBook')}</option>
          {options.map((o) => (
            <option key={o.book_id} value={o.book_id}>
              {o.title}
            </option>
          ))}
        </select>
        <input
          style={{ ...input, width: 80 }}
          type="number"
          value={offset}
          onChange={(e) => setOffset(e.target.value)}
          aria-label={t('armies.links.offset')}
          title={t('armies.links.offsetHint')}
        />
        <button
          type="button"
          style={primaryBtn}
          disabled={!bookId}
          onClick={() =>
            void run(() => onLink(item.publication, bookId, Math.trunc(Number(offset) || 0)))
          }
        >
          {t('armies.links.link')}
        </button>
        {item.link && (
          <button
            type="button"
            style={secondaryBtn}
            onClick={() => void run(() => onUnlink(item.publication))}
          >
            {t('armies.links.unlink')}
          </button>
        )}
      </div>
      <form
        style={{ display: 'flex', gap: 8 }}
        onSubmit={(e) => {
          e.preventDefault()
          void search()
        }}
      >
        <input
          style={{ ...input, flex: 1 }}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('armies.links.searchPlaceholder')}
          aria-label={t('armies.links.searchPlaceholder')}
        />
        <button type="submit" style={secondaryBtn}>
          {t('armies.links.search')}
        </button>
      </form>
      {found?.length === 0 && <span style={muted}>{t('armies.links.noMatches')}</span>}
      {error && (
        <p role="alert" style={errorText}>
          {error}
        </p>
      )}
    </li>
  )
}
