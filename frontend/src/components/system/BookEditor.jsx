import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuX } from 'react-icons/lu'
import api from '../../api'
import { saveBookPrefs, getBookPrefs } from '../../hooks/useBookPrefs'
import { CATEGORY_ORDER, categoryLabel, slugify } from '../../constants'
import GenrePicker from '../metadata/GenrePicker'
import CategoryPicker from '../metadata/CategoryPicker'
import LinkListEditor from '../metadata/LinkListEditor'
import LookupCombobox from '../metadata/LookupCombobox'
import TagPicker from '../metadata/TagPicker'
import useLookups from '../metadata/useLookups'
import { cleanLinks, linksForEditing } from '../metadata/metadataUtils'

export default function BookEditor({
  book,
  onSave,
  onClose,
  allTags = [],
  existingCategories = [],
  systemGenres = [],
}) {
  const { t } = useTranslation()
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
  })
  const [tags, setTags] = useState(book.tags || [])
  const [saving, setSaving] = useState(false)
  const [progressReset, setProgressReset] = useState(false)
  const hasProgress = !!getBookPrefs(book.id).page

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
    const payload = {
      ...form,
      category: slugify(form.category) || 'core',
      authors: splitCsv(form.authors),
      artists: splitCsv(form.artists),
      urls: cleanLinks(form.urls),
      year: form.year ? parseInt(form.year) : null,
      month: form.month ? parseInt(form.month) : null,
      day: form.day ? parseInt(form.day) : null,
      tags,
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
              style={{ width: 15, height: 15, cursor: 'pointer', accentColor: '#e07070' }}
            />
            <span style={{ fontSize: 13, color: '#e07070' }}>{t('bookEditor.markExplicit')}</span>
          </label>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
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
        {(hasProgress || progressReset) && (
          <button
            onClick={() => {
              saveBookPrefs(book.id, { page: null })
              setProgressReset(true)
            }}
            disabled={progressReset}
            style={{
              marginLeft: 'auto',
              padding: '6px 14px',
              borderRadius: 5,
              background: 'none',
              border: '1px solid var(--border)',
              color: progressReset ? 'var(--green)' : 'var(--text-muted)',
              fontSize: 12,
              cursor: progressReset ? 'default' : 'pointer',
            }}
          >
            {progressReset ? `✓ ${t('bookEditor.progressReset')}` : t('bookEditor.resetProgress')}
          </button>
        )}
      </div>
    </div>
  )
}
