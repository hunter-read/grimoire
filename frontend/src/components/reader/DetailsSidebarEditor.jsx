import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import api from '../../api'
import { CATEGORY_ORDER, categoryLabel, slugify } from '../../constants'
import CategoryPicker from '../metadata/CategoryPicker'
import GenrePicker from '../metadata/GenrePicker'
import LinkListEditor from '../metadata/LinkListEditor'
import LookupCombobox from '../metadata/LookupCombobox'
import TagPicker from '../metadata/TagPicker'
import useLookups from '../metadata/useLookups'
import { cleanLinks, linksForEditing } from '../metadata/metadataUtils'

/**
 * The editable form behind the details sidebar's Edit button.
 *
 * Same fields and PATCH payload as the library's BookEditor, laid out in one
 * column to fit the sidebar. Kept separate from BookEditor rather than reusing
 * it: that component is a two-column card with its own header, close button,
 * fetch-metadata action, and reset-progress control, none of which belong in a
 * 320px reader panel.
 */
export default function DetailsSidebarEditor({ book, onSaved, onCancel }) {
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
  const [error, setError] = useState(false)

  const categoryOptions = [...new Set([...CATEGORY_ORDER, form.category].filter(Boolean))].map(
    (slug) => ({ value: slug, label: categoryLabel(slug) })
  )

  const fieldLabel = {
    fontSize: 12,
    color: 'var(--text-muted)',
    display: 'block',
    marginBottom: 3,
  }

  const field = (label, key, opts = {}) => (
    <div style={{ marginBottom: 10 }}>
      <label htmlFor={`reader-book-field-${key}`} style={fieldLabel}>
        {label}
      </label>
      {opts.textarea ? (
        <textarea
          id={`reader-book-field-${key}`}
          value={form[key]}
          onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
          rows={4}
          style={{ width: '100%', resize: 'vertical', fontSize: 13, boxSizing: 'border-box' }}
        />
      ) : (
        <input
          id={`reader-book-field-${key}`}
          type="text"
          value={form[key]}
          onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
          style={{ width: '100%', fontSize: 13, boxSizing: 'border-box' }}
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
    setError(false)
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
        setSaving(false)
        onSaved({ ...book, ...payload })
      })
      .catch(() => {
        setSaving(false)
        setError(true)
      })
  }

  return (
    <div>
      {field(t('bookEditor.titleLabel'), 'title')}
      {field(t('bookEditor.descriptionLabel'), 'description', { textarea: true })}

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
        />
      </div>

      <div style={{ marginBottom: 10 }}>
        <label style={fieldLabel}>{t('bookEditor.tagsLabel')}</label>
        <TagPicker
          value={tags}
          onChange={setTags}
          resourceType="book"
          placeholder={t('bookEditor.tagPlaceholder')}
        />
      </div>

      {field(t('bookEditor.authorsLabel'), 'authors')}
      {field(t('bookEditor.artistsLabel'), 'artists')}
      {field(t('bookEditor.publisherLabel'), 'publisher')}
      {field(t('bookEditor.isbnLabel'), 'isbn')}
      {field(t('bookEditor.versionLabel'), 'version')}
      {field(t('bookEditor.languageLabel'), 'language')}

      <div style={{ marginBottom: 10 }}>
        <label htmlFor="reader-book-field-license" style={fieldLabel}>
          {t('bookEditor.licenseLabel')}
        </label>
        <LookupCombobox
          id="reader-book-field-license"
          value={form.license}
          onChange={(v) => setForm((f) => ({ ...f, license: v }))}
          options={licenseOptions}
          placeholder={t('bookEditor.licensePlaceholder')}
        />
      </div>

      {/* Flexible publication date: year (+ optional month/day). */}
      <div style={{ display: 'flex', gap: 6 }}>
        <div style={{ flex: 1 }}>{field(t('bookEditor.yearLabel'), 'year')}</div>
        <div style={{ flex: 1 }}>{field(t('bookEditor.monthLabel'), 'month')}</div>
        <div style={{ flex: 1 }}>{field(t('bookEditor.dayLabel'), 'day')}</div>
      </div>

      <div style={{ marginBottom: 10 }}>
        <label style={fieldLabel}>{t('bookEditor.urlsLabel')}</label>
        <LinkListEditor
          links={form.urls}
          onChange={(urls) => setForm((f) => ({ ...f, urls }))}
          addLabel={t('bookEditor.addUrl')}
          labelPlaceholder={t('bookEditor.urlLabelPlaceholder')}
          urlPlaceholder={t('bookEditor.urlPlaceholder')}
          idPrefix="reader-book-url"
        />
      </div>

      <label
        htmlFor="reader-book-is-explicit"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          cursor: 'pointer',
          width: 'fit-content',
          marginBottom: 14,
        }}
      >
        <input
          id="reader-book-is-explicit"
          type="checkbox"
          checked={form.is_explicit}
          onChange={(e) => setForm((f) => ({ ...f, is_explicit: e.target.checked }))}
          style={{ width: 15, height: 15, cursor: 'pointer', accentColor: 'var(--danger)' }}
        />
        <span style={{ fontSize: 13, color: 'var(--danger)' }}>{t('bookEditor.markExplicit')}</span>
      </label>

      {error && (
        <div style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 8 }}>
          {t('bookEditor.failed')}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={onCancel}
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
            cursor: saving ? 'default' : 'pointer',
          }}
        >
          {saving ? t('bookEditor.saving') : t('bookEditor.save')}
        </button>
      </div>
    </div>
  )
}
