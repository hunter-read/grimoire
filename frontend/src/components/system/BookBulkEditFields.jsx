import { useTranslation } from 'react-i18next'
import { CATEGORY_ORDER, categoryLabel } from '../../constants'
import AccessLevelPicker from '../metadata/AccessLevelPicker'
import GenrePicker from '../metadata/GenrePicker'
import CategoryPicker from '../metadata/CategoryPicker'
import LinkListEditor from '../metadata/LinkListEditor'
import LookupCombobox from '../metadata/LookupCombobox'
import TagPicker from '../metadata/TagPicker'
import useLookups from '../metadata/useLookups'
import { linksForEditing } from '../metadata/metadataUtils'

// Rich editor body for one book inside the bulk-edit carousel. Mirrors the
// single-book editor and reuses the same shared components (CategoryPicker,
// GenrePicker with inherit-from-system, TagPicker, LinkListEditor).
export default function BookBulkEditFields({
  draft,
  setField,
  existingCategories = [],
  systemGenres = [],
}) {
  const { t } = useTranslation()
  const { genres: genreTree, licenses, reload: reloadLookups } = useLookups()
  const licenseOptions = licenses.map((l) => l.name)

  const categoryOptions = [
    ...new Set([...CATEGORY_ORDER, ...existingCategories, draft.category].filter(Boolean)),
  ].map((slug) => ({ value: slug, label: categoryLabel(slug) }))

  const csv = (arr) => (Array.isArray(arr) ? arr.join(', ') : '')
  const setCsv = (field, value) =>
    setField(
      field,
      value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <label htmlFor="book-bulk-title" style={label}>
          {t('bookEditor.titleLabel')}
        </label>
        <input
          id="book-bulk-title"
          type="text"
          value={draft.title || ''}
          onChange={(e) => setField('title', e.target.value)}
          style={input}
        />
      </div>

      <div>
        <label htmlFor="book-bulk-description" style={label}>
          {t('bookEditor.descriptionLabel')}
        </label>
        <textarea
          id="book-bulk-description"
          value={draft.description || ''}
          onChange={(e) => setField('description', e.target.value)}
          rows={3}
          style={{ ...input, resize: 'vertical', fontFamily: 'inherit' }}
        />
      </div>

      {/* Category under description. */}
      <div>
        <label style={label}>{t('bookEditor.categoryLabel')}</label>
        <CategoryPicker
          value={draft.category || 'core'}
          onChange={(v) => setField('category', v)}
          options={categoryOptions}
        />
      </div>

      {/* Genres, with inherit-from-system. */}
      <div>
        <label style={label}>{t('bookEditor.genresLabel')}</label>
        <GenrePicker
          genreTree={genreTree}
          selected={draft.genres || []}
          onChange={(v) => setField('genres', v)}
          onGenreCreated={reloadLookups}
          inheritGenres={systemGenres}
        />
      </div>

      {/* Tags under genres. */}
      <div>
        <label style={label}>{t('bookEditor.tagsLabel')}</label>
        <TagPicker
          value={draft.tags || []}
          onChange={(v) => setField('tags', v)}
          resourceType="book"
          placeholder={t('bookEditor.tagPlaceholder')}
        />
      </div>

      <div>
        <label style={label}>{t('bookEditor.urlsLabel')}</label>
        <LinkListEditor
          links={linksForEditing(draft.urls)}
          onChange={(v) => setField('urls', v)}
          addLabel={t('bookEditor.addUrl')}
          labelPlaceholder={t('bookEditor.urlLabelPlaceholder')}
          urlPlaceholder={t('bookEditor.urlPlaceholder')}
          idPrefix="book-bulk-url"
        />
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 200px' }}>
          <label htmlFor="book-bulk-authors" style={label}>
            {t('bookEditor.authorsLabel')}
          </label>
          <input
            id="book-bulk-authors"
            type="text"
            value={csv(draft.authors)}
            onChange={(e) => setCsv('authors', e.target.value)}
            style={input}
          />
        </div>
        <div style={{ flex: '1 1 200px' }}>
          <label htmlFor="book-bulk-artists" style={label}>
            {t('bookEditor.artistsLabel')}
          </label>
          <input
            id="book-bulk-artists"
            type="text"
            value={csv(draft.artists)}
            onChange={(e) => setCsv('artists', e.target.value)}
            style={input}
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 160px' }}>
          <label htmlFor="book-bulk-publisher" style={label}>
            {t('bookEditor.publisherLabel')}
          </label>
          <input
            id="book-bulk-publisher"
            type="text"
            value={draft.publisher || ''}
            onChange={(e) => setField('publisher', e.target.value)}
            style={input}
          />
        </div>
        <div style={{ flex: '1 1 120px' }}>
          <label htmlFor="book-bulk-isbn" style={label}>
            {t('bookEditor.isbnLabel')}
          </label>
          <input
            id="book-bulk-isbn"
            type="text"
            value={draft.isbn || ''}
            onChange={(e) => setField('isbn', e.target.value)}
            style={input}
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 100px' }}>
          <label htmlFor="book-bulk-version" style={label}>
            {t('bookEditor.versionLabel')}
          </label>
          <input
            id="book-bulk-version"
            type="text"
            value={draft.version || ''}
            onChange={(e) => setField('version', e.target.value)}
            style={input}
          />
        </div>
        <div style={{ flex: '1 1 100px' }}>
          <label htmlFor="book-bulk-language" style={label}>
            {t('bookEditor.languageLabel')}
          </label>
          <input
            id="book-bulk-language"
            type="text"
            value={draft.language || ''}
            onChange={(e) => setField('language', e.target.value)}
            style={input}
          />
        </div>
        <div style={{ flex: '1 1 140px' }}>
          <label style={label}>{t('bookEditor.licenseLabel')}</label>
          <LookupCombobox
            id="book-bulk-license"
            value={draft.license || ''}
            onChange={(v) => setField('license', v)}
            options={licenseOptions}
            placeholder={t('bookEditor.licensePlaceholder')}
          />
        </div>
      </div>

      {/* Flexible publication date. */}
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <label htmlFor="book-bulk-year" style={label}>
            {t('bookEditor.yearLabel')}
          </label>
          <input
            id="book-bulk-year"
            type="number"
            value={draft.year ?? ''}
            onChange={(e) => setField('year', e.target.value)}
            style={input}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label htmlFor="book-bulk-month" style={label}>
            {t('bookEditor.monthLabel')}
          </label>
          <input
            id="book-bulk-month"
            type="number"
            value={draft.month ?? ''}
            onChange={(e) => setField('month', e.target.value)}
            style={input}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label htmlFor="book-bulk-day" style={label}>
            {t('bookEditor.dayLabel')}
          </label>
          <input
            id="book-bulk-day"
            type="number"
            value={draft.day ?? ''}
            onChange={(e) => setField('day', e.target.value)}
            style={input}
          />
        </div>
      </div>

      <AccessLevelPicker
        id="book-bulk-access-level"
        value={draft.access_level}
        effectiveLevel={draft.effective_access_level}
        onChange={(v) => setField('access_level', v)}
      />

      <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={!!draft.is_explicit}
          onChange={(e) => setField('is_explicit', e.target.checked)}
          style={{ width: 15, height: 15, cursor: 'pointer', accentColor: 'var(--danger)' }}
        />
        <span style={{ fontSize: 14, color: 'var(--danger)' }}>{t('bookEditor.markExplicit')}</span>
      </label>
    </div>
  )
}

const label = {
  display: 'block',
  fontSize: 12,
  color: 'var(--text-muted)',
  fontWeight: 500,
  marginBottom: 6,
}
const input = {
  width: '100%',
  padding: '8px 10px',
  background: 'var(--bg-deep)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--text)',
  fontSize: 14,
  boxSizing: 'border-box',
}
