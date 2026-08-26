import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuDownload, LuX } from 'react-icons/lu'
import api from '../../api'
import { CATEGORY_ORDER, categoryLabel, slugify } from '../../constants'
import AccessLevelPicker from '../metadata/AccessLevelPicker'
import GenrePicker from '../metadata/GenrePicker'
import CategoryPicker from '../metadata/CategoryPicker'
import LinkListEditor from '../metadata/LinkListEditor'
import LookupCombobox from '../metadata/LookupCombobox'
import TagPicker from '../metadata/TagPicker'
import useLookups from '../metadata/useLookups'
import { cleanLinks, linksForEditing } from '../metadata/metadataUtils'
import { ACCESS_INHERIT } from '../../accessLevels'
import { useAuth } from '../../context/AuthContext'
import MetadataFetchDialog from './MetadataFetchDialog'
import useMetadataSources from './useMetadataSources'
import { intoBookForm } from './metadataFieldValue'

export default function BookEditor({
  book,
  onSave,
  onClose,
  allTags = [],
  existingCategories = [],
  systemGenres = [],
}) {
  const { t } = useTranslation()
  // May be null outside an AuthProvider; see AccessLevelPicker.
  const isAdmin = useAuth()?.user?.role === 'admin'
  const { genres: genreTree, licenses, reload: reloadLookups } = useLookups()
  const licenseOptions = licenses.map((l) => l.name)
  const [form, setForm] = useState({
    title: book.title || '',
    description: book.description || '',
    authors: (book.authors || []).join(', '),
    artists: (book.artists || []).join(', '),
    genres: book.genres || [],
    publisher: book.publisher || '',
    isbn: book.isbn || '',
    version: book.version || '',
    language: book.language || '',
    license: book.license || '',
    year: book.year ? String(book.year) : '',
    month: book.month ? String(book.month) : '',
    day: book.day ? String(book.day) : '',
    urls: linksForEditing(book.urls),
    category: book.category || 'core',
    is_explicit: book.is_explicit || false,
    // null means "inherit"; the picker maps it to its sentinel and back.
    access_level: book.access_level ?? null,
  })
  const [tags, setTags] = useState(book.tags || [])
  // "Fetch metadata" only appears when a source is actually available, so the
  // button never promises something the server cannot do. Cached per kind, so
  // reopening an editor doesn't re-ask and the button doesn't pop in late.
  const { sources: metadataSources } = useMetadataSources('books', book.id)
  const hasSources = metadataSources.length > 0
  const [fetching, setFetching] = useState(false)

  // Applied fields arrive in API shape (arrays, numbers); the form holds some
  // of them as text, so they are converted before merging in. Tags live in
  // their own state.
  const handleFetched = (fields) => {
    const { tags: fetchedTags, ...rest } = fields
    setForm((f) => ({ ...f, ...intoBookForm(rest) }))
    if (fetchedTags) setTags(fetchedTags)
  }
  const [saving, setSaving] = useState(false)

  // Category combobox options: built-in categories (with friendly labels)
  // followed by any custom category slugs already used in the library, deduped
  // and always including the current value. `[{value, label}]`.
  const categoryOptions = [
    ...new Set([...CATEGORY_ORDER, ...existingCategories, form.category].filter(Boolean)),
  ].map((slug) => ({ value: slug, label: categoryLabel(slug) }))

  const fieldLabel = {
    fontSize: 12,
    color: 'var(--text-muted)',
    display: 'block',
    marginBottom: 3,
  }

  const field = (label, key, opts = {}) => (
    <div style={{ marginBottom: 10 }}>
      <label htmlFor={`book-field-${key}`} style={fieldLabel}>
        {label}
      </label>
      {opts.textarea ? (
        <textarea
          id={`book-field-${key}`}
          value={form[key]}
          onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
          rows={3}
          style={{ width: '100%', resize: 'vertical', fontSize: 13 }}
        />
      ) : (
        <input
          id={`book-field-${key}`}
          type="text"
          value={form[key]}
          onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
          style={{ width: '100%', fontSize: 13 }}
        />
      )}
    </div>
  )

  const splitCsv = (s) =>
    s
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean)

  const handleSave = () => {
    setSaving(true)
    const { access_level, ...rest } = form
    const payload = {
      ...rest,
      category: slugify(form.category) || 'core',
      authors: splitCsv(form.authors),
      artists: splitCsv(form.artists),
      urls: cleanLinks(form.urls),
      year: form.year ? parseInt(form.year) : null,
      month: form.month ? parseInt(form.month) : null,
      day: form.day ? parseInt(form.day) : null,
      tags,
    }
    // Only sent when the admin actually changed it. The endpoint 403s any
    // non-admin who includes the key at all, so a GM editing a title must not
    // send back the value the form merely loaded.
    if (isAdmin && access_level !== (book.access_level ?? null)) {
      payload.access_level = access_level === null ? ACCESS_INHERIT : access_level
    }
    api
      .patch(`/books/${book.id}`, payload)
      .then(() => {
        onSave({ ...book, ...payload })
        setSaving(false)
      })
      .catch(() => setSaving(false))
  }

  return (
    <div
      style={{
        background: 'var(--bg-panel)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: 16,
        marginTop: 4,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-dim)' }}>
          {t('bookEditor.editMetadata')}
        </span>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-muted)',
            display: 'flex',
          }}
        >
          <LuX size={14} />
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: '0 16px',
        }}
      >
        <div>
          {field(t('bookEditor.titleLabel'), 'title')}
          {field(t('bookEditor.descriptionLabel'), 'description', { textarea: true })}
          {/* Category sits directly under the description. */}
          <div style={{ marginBottom: 10 }}>
            <label style={fieldLabel}>{t('bookEditor.categoryLabel')}</label>
            <CategoryPicker
              value={form.category}
              onChange={(category) => setForm((f) => ({ ...f, category }))}
              options={categoryOptions}
            />
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={fieldLabel}>{t('bookEditor.genresLabel')}</label>
            <GenrePicker
              genreTree={genreTree}
              selected={form.genres}
              onChange={(genres) => setForm((f) => ({ ...f, genres }))}
              onGenreCreated={reloadLookups}
              inheritGenres={systemGenres}
            />
          </div>
          {/* Tags under genres, using the shared chip input. */}
          <div style={{ marginBottom: 10 }}>
            <label style={fieldLabel}>{t('bookEditor.tagsLabel')}</label>
            <TagPicker
              value={tags}
              onChange={setTags}
              resourceType="book"
              placeholder={t('bookEditor.tagPlaceholder')}
            />
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={fieldLabel}>{t('bookEditor.urlsLabel')}</label>
            <LinkListEditor
              links={form.urls}
              onChange={(urls) => setForm((f) => ({ ...f, urls }))}
              addLabel={t('bookEditor.addUrl')}
              labelPlaceholder={t('bookEditor.urlLabelPlaceholder')}
              urlPlaceholder={t('bookEditor.urlPlaceholder')}
              idPrefix="book-url"
            />
          </div>
        </div>
        <div>
          {field(t('bookEditor.authorsLabel'), 'authors')}
          {field(t('bookEditor.artistsLabel'), 'artists')}
          {field(t('bookEditor.publisherLabel'), 'publisher')}
          {field(t('bookEditor.isbnLabel'), 'isbn')}
          {field(t('bookEditor.versionLabel'), 'version')}
          {field(t('bookEditor.languageLabel'), 'language')}
          {/* Per-book license override (blank = inherit the system license). */}
          <div style={{ marginBottom: 10 }}>
            <label htmlFor="book-field-license" style={fieldLabel}>
              {t('bookEditor.licenseLabel')}
            </label>
            <LookupCombobox
              id="book-field-license"
              value={form.license}
              onChange={(v) => setForm((f) => ({ ...f, license: v }))}
              options={licenseOptions}
              placeholder={t('bookEditor.licensePlaceholder')}
            />
          </div>
          {/* Flexible publication date: year (+ optional month/day). */}
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>{field(t('bookEditor.yearLabel'), 'year')}</div>
            <div style={{ flex: 1 }}>{field(t('bookEditor.monthLabel'), 'month')}</div>
            <div style={{ flex: 1 }}>{field(t('bookEditor.dayLabel'), 'day')}</div>
          </div>
          {/* Explicit flag lives here, in place of the former read-only file facts. */}
          <label
            htmlFor="book-is-explicit"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              cursor: 'pointer',
              width: 'fit-content',
              marginTop: 4,
            }}
          >
            <input
              id="book-is-explicit"
              type="checkbox"
              checked={form.is_explicit}
              onChange={(e) => setForm((f) => ({ ...f, is_explicit: e.target.checked }))}
              style={{ width: 15, height: 15, cursor: 'pointer', accentColor: 'var(--danger)' }}
            />
            <span style={{ fontSize: 13, color: 'var(--danger)' }}>
              {t('bookEditor.markExplicit')}
            </span>
          </label>
          {/* Renders nothing for non-admins. The explicit checkbox above is a
              bare label with no bottom margin, so the gap between the two is
              set here rather than left to the picker's own label spacing —
              which is what made it read as a stray gap before. */}
          {isAdmin && (
            <div style={{ marginTop: 14 }}>
              <AccessLevelPicker
                id="book-access-level"
                value={form.access_level}
                effectiveLevel={book.effective_access_level}
                onChange={(v) =>
                  setForm((f) => ({ ...f, access_level: v === ACCESS_INHERIT ? null : v }))
                }
              />
            </div>
          )}
        </div>
      </div>

      {/* Buttons stay a plain row anchored bottom-left; nothing else shares it,
          so the pair never shifts as fields above them change height. */}
      <div
        style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 14 }}
      >
        <button
          onClick={onClose}
          style={{
            padding: '6px 14px',
            borderRadius: 5,
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            color: 'var(--text-dim)',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          {t('bookEditor.cancel')}
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: '6px 14px',
            borderRadius: 5,
            background: 'var(--gold-dim)',
            border: 'none',
            color: 'var(--bg-deep)',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {saving ? t('bookEditor.saving') : t('bookEditor.save')}
        </button>
        {hasSources && (
          <button
            onClick={() => setFetching(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              borderRadius: 5,
              background: 'none',
              border: '1px solid var(--border)',
              color: 'var(--text-dim)',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            <LuDownload size={13} />
            {t('bookEditor.fetchMetadata')}
          </button>
        )}
      </div>

      {fetching && (
        <MetadataFetchDialog
          resource={book}
          kind="books"
          onApply={handleFetched}
          onClose={() => setFetching(false)}
        />
      )}
    </div>
  )
}
