import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LuArrowDown, LuArrowUp, LuBookOpen, LuPlus, LuSearch, LuTrash2 } from 'react-icons/lu'
import { leagues as leaguesApi, type Schema } from '../../api'
import {
  card,
  errorText,
  iconBtn,
  input,
  muted,
  secondaryBtn,
  sectionTitle,
} from '../armies/armyStyles'
import { errorMessage } from '../armies/armyText'

type Book = Schema<'LeagueBook'>
type Visibility = 'public' | 'private' | 'organizer'
const VISIBILITIES: Visibility[] = ['public', 'private', 'organizer']

export interface LeagueBooksProps {
  league: Schema<'LeagueDetail'>
}

/**
 * The library books the organiser shares with the league, like a campaign's
 * linked books: every member, chosen members, or the organiser alone.
 *
 * This is how a league's guests, who have no library, read the books their
 * armies cite. Members see the books that reach them; the organiser finds
 * books to add and decides who each one reaches.
 */
export default function LeagueBooks({ league }: LeagueBooksProps) {
  const { t } = useTranslation()
  const manage = !!league.can_manage
  const [books, setBooks] = useState<Book[] | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Schema<'BookSearchResult'>[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const reload = useCallback(
    () =>
      leaguesApi
        .listBooks(league.id)
        .then(setBooks)
        .catch(() => setBooks([])),
    [league.id]
  )

  useEffect(() => {
    void reload()
  }, [reload])

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await work()
      await reload()
    } catch (e) {
      setError(errorMessage(e, t('leagues.books.failed')))
    } finally {
      setBusy(false)
    }
  }

  const search = (e: FormEvent) => {
    e.preventDefault()
    const q = query.trim()
    if (q.length < 2) return
    setError('')
    leaguesApi
      .searchBooks(league.id, q)
      .then(setResults)
      .catch((err: unknown) => setError(errorMessage(err, t('leagues.books.failed'))))
  }

  const move = (index: number, by: number) => {
    if (!books) return
    const ids = books.map((b) => b.id)
    const [id] = ids.splice(index, 1)
    ids.splice(index + by, 0, id)
    void run(() => leaguesApi.reorderBooks(league.id, ids))
  }

  if (books === null) return null
  if (!manage && books.length === 0) return null

  const shared = new Set(books.map((b) => b.book_id))
  const members = (league.members ?? []).filter((m) => m.user_id !== league.organizer_id)

  return (
    <section style={card} aria-labelledby="league-books-title">
      <h2 id="league-books-title" style={sectionTitle}>
        {t('leagues.books.title')}
      </h2>
      {books.length === 0 ? (
        <p style={muted}>{t('leagues.books.none')}</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
          {books.map((b, i) => (
            <li key={b.id} style={{ display: 'grid', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <LuBookOpen size={14} aria-hidden="true" />
                <Link to={`/library/book/${b.book_id}`} style={{ flex: 1, minWidth: 160 }}>
                  {b.title}
                </Link>
                {manage && (
                  <>
                    <select
                      style={input}
                      value={b.visibility}
                      aria-label={t('leagues.books.visibilityFor', { title: b.title })}
                      onChange={(e) =>
                        void run(() =>
                          leaguesApi.updateBook(league.id, b.id, {
                            visibility: e.target.value as Visibility,
                          })
                        )
                      }
                    >
                      {VISIBILITIES.map((v) => (
                        <option key={v} value={v}>
                          {t(`leagues.books.visibility.${v}`)}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      style={iconBtn}
                      disabled={busy || i === 0}
                      onClick={() => move(i, -1)}
                      aria-label={t('leagues.books.moveUp', { title: b.title })}
                      title={t('leagues.books.moveUp', { title: b.title })}
                    >
                      <LuArrowUp size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      style={iconBtn}
                      disabled={busy || i === books.length - 1}
                      onClick={() => move(i, 1)}
                      aria-label={t('leagues.books.moveDown', { title: b.title })}
                      title={t('leagues.books.moveDown', { title: b.title })}
                    >
                      <LuArrowDown size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      style={iconBtn}
                      disabled={busy}
                      onClick={() => void run(() => leaguesApi.removeBook(league.id, b.id))}
                      aria-label={t('leagues.books.remove', { title: b.title })}
                      title={t('leagues.books.remove', { title: b.title })}
                    >
                      <LuTrash2 size={14} aria-hidden="true" />
                    </button>
                  </>
                )}
              </div>
              {manage && b.visibility === 'private' && (
                <fieldset
                  style={{
                    border: 'none',
                    margin: 0,
                    padding: '0 0 0 22px',
                    display: 'flex',
                    gap: 12,
                    flexWrap: 'wrap',
                  }}
                >
                  <legend style={muted}>{t('leagues.books.sharedWith')}</legend>
                  {members.length === 0 && <span style={muted}>{t('leagues.noMembers')}</span>}
                  {members.map((m) => {
                    const ids = b.shared_user_ids ?? []
                    const on = ids.includes(m.user_id)
                    return (
                      <label
                        key={m.user_id}
                        style={{ display: 'flex', gap: 4, alignItems: 'center' }}
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={busy}
                          onChange={() =>
                            void run(() =>
                              leaguesApi.updateBook(league.id, b.id, {
                                shared_user_ids: on
                                  ? ids.filter((id) => id !== m.user_id)
                                  : [...ids, m.user_id],
                              })
                            )
                          }
                        />
                        {m.name}
                      </label>
                    )
                  })}
                </fieldset>
              )}
            </li>
          ))}
        </ul>
      )}
      {manage && (
        <>
          <form onSubmit={search} style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('leagues.books.searchPlaceholder')}
              aria-label={t('leagues.books.searchPlaceholder')}
              minLength={2}
              style={{ ...input, flex: 1 }}
            />
            <button type="submit" style={secondaryBtn}>
              <LuSearch size={14} aria-hidden="true" /> {t('leagues.books.search')}
            </button>
          </form>
          {results && (
            <ul
              style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', display: 'grid', gap: 6 }}
            >
              {results.length === 0 && <li style={muted}>{t('leagues.books.noResults')}</li>}
              {results.map((r) => (
                <li key={r.book_id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ flex: 1 }}>
                    {r.title}
                    {r.game_system_name && (
                      <span style={{ ...muted, marginLeft: 6 }}>{r.game_system_name}</span>
                    )}
                  </span>
                  <button
                    type="button"
                    style={iconBtn}
                    disabled={busy || shared.has(r.book_id)}
                    onClick={() =>
                      void run(() =>
                        leaguesApi.addBook(league.id, {
                          book_id: r.book_id,
                          visibility: 'organizer',
                        })
                      )
                    }
                    aria-label={t('leagues.books.add', { title: r.title })}
                    title={t('leagues.books.add', { title: r.title })}
                  >
                    <LuPlus size={14} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p style={{ ...muted, marginBottom: 0 }}>{t('leagues.books.hint')}</p>
        </>
      )}
      {error && (
        <p role="alert" style={errorText}>
          {error}
        </p>
      )}
    </section>
  )
}
