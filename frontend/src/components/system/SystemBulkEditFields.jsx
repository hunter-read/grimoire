import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { LuImage, LuX, LuPlus } from 'react-icons/lu'
import api, { mediaUrl } from '../../api'
import LazyImg from '../LazyImg'
import GenrePicker from '../metadata/GenrePicker'
import LinkListEditor from '../metadata/LinkListEditor'
import LookupCombobox from '../metadata/LookupCombobox'
import TagPicker from '../metadata/TagPicker'
import SingleSelectCombobox from '../metadata/SingleSelectCombobox'
import DiceMaterialsPicker from '../metadata/DiceMaterialsPicker'
import { groupsFromManaged } from '../metadata/diceMaterials'
import useLookups from '../metadata/useLookups'
import { linksForEditing } from '../metadata/metadataUtils'

// Rich editor body for one system inside the bulk-edit carousel. Mirrors the
// single-system SystemEditor so every field is editable in bulk: description,
// system family, dice/materials, genres, tags, license, year, publishers,
// generic + character-builder links, explicit flag, and a per-system cover
// picker sourced from that system's own books (lazy-fetched, since the systems
// list doesn't carry them).
export default function SystemBulkEditFields({ system, draft, setField }) {
  const { t } = useTranslation()
  const {
    genres: genreTree,
    families,
    parentSystems,
    licenses,
    diceMaterials,
    reload: reloadLookups,
  } = useLookups()
  const parentSystemOptions = parentSystems.map((p) => p.name)
  const licenseOptions = licenses.map((l) => l.name)
  const diceGroups = diceMaterials.length ? groupsFromManaged(diceMaterials) : undefined
  const [books, setBooks] = useState(system.books || null)

  // The systems list endpoint omits per-system books, so fetch them the first
  // time we land on a system that doesn't already have them.
  useEffect(() => {
    let cancelled = false
    if (system.books) {
      setBooks(system.books)
      return
    }
    setBooks(null)
    api
      .get(`/systems/${system.id}`)
      .then((full) => {
        if (!cancelled) setBooks(full.books || [])
      })
      .catch(() => {
        if (!cancelled) setBooks([])
      })
    return () => {
      cancelled = true
    }
  }, [system.id, system.books])

  const tags = draft.tags || []
  const publishers = draft.publishers || []
  const familyOptions = families.map((f) => f.name)

  const setPublisher = (idx, key, value) =>
    setField(
      'publishers',
      publishers.map((p, i) => (i === idx ? { ...p, [key]: value } : p))
    )
  const addPublisher = () => setField('publishers', [...publishers, { name: '', url: '' }])
  const removePublisher = (idx) =>
    setField(
      'publishers',
      publishers.filter((_, i) => i !== idx)
    )

  const booksWithThumbnails = (books || []).filter((b) => b.has_thumbnail)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <label htmlFor="sys-bulk-description" style={label}>
          {t('systemEditor.description')}
        </label>
        <textarea
          id="sys-bulk-description"
          value={draft.description || ''}
          onChange={(e) => setField('description', e.target.value)}
          rows={3}
          style={{ ...input, resize: 'vertical', fontFamily: 'inherit' }}
        />
      </div>

      {/* System Family under description. */}
      <div>
        <label style={label}>{t('systemEditor.systemFamily')}</label>
        <LookupCombobox
          id="sys-bulk-family"
          value={draft.system_family || ''}
          onChange={(v) => setField('system_family', v)}
          options={familyOptions}
          placeholder={t('systemEditor.systemFamilyPlaceholder')}
        />
      </div>

      {/* Dice / Materials under System Family. */}
      <div>
        <label style={label}>{t('systemEditor.diceMaterials')}</label>
        <DiceMaterialsPicker
          selected={draft.dice_materials || []}
          onChange={(v) => setField('dice_materials', v)}
          groups={diceGroups}
          onCreate={reloadLookups}
        />
      </div>

      {/* Genres (shown before tags). */}
      <div>
        <label style={label}>{t('systemEditor.genres')}</label>
        <GenrePicker
          genreTree={genreTree}
          selected={draft.genres || []}
          onChange={(v) => setField('genres', v)}
          onGenreCreated={reloadLookups}
        />
      </div>

      <div>
        <label style={label}>{t('systemEditor.tags')}</label>
        <TagPicker
          value={tags}
          onChange={(v) => setField('tags', v)}
          resourceType="system"
          placeholder={t('systemEditor.tagPlaceholder')}
        />
      </div>

      {/* Parent System (75%) + Edition (25%) above License + Year. */}
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: 3 }}>
          <label style={label}>{t('systemEditor.parentSystem')}</label>
          <SingleSelectCombobox
            id="sys-bulk-parent"
            value={draft.parent_system || ''}
            onChange={(v) => setField('parent_system', v)}
            options={parentSystemOptions}
            placeholder={t('systemEditor.parentSystemPlaceholder')}
            createEndpoint="/parent-systems"
            onCreate={reloadLookups}
            createLabel={(name) => t('systemEditor.createParentSystem', { name })}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label htmlFor="sys-bulk-edition" style={label}>
            {t('systemEditor.edition')}
          </label>
          <input
            id="sys-bulk-edition"
            value={draft.edition || ''}
            onChange={(e) => setField('edition', e.target.value)}
            placeholder={t('systemEditor.editionPlaceholder')}
            style={input}
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <label style={label}>{t('systemEditor.license')}</label>
          <LookupCombobox
            id="sys-bulk-license"
            value={draft.license || ''}
            onChange={(v) => setField('license', v)}
            options={licenseOptions}
            placeholder={t('systemEditor.licensePlaceholder')}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label htmlFor="sys-bulk-year" style={label}>
            {t('systemEditor.year')}
          </label>
          <input
            id="sys-bulk-year"
            type="number"
            value={draft.year ?? ''}
            onChange={(e) => setField('year', e.target.value)}
            style={input}
          />
        </div>
      </div>

      <div>
        <label style={label}>{t('systemEditor.publishers')}</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {publishers.map((p, idx) => (
            <div
              key={idx}
              style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}
            >
              <input
                type="text"
                value={p.name}
                onChange={(e) => setPublisher(idx, 'name', e.target.value)}
                placeholder={t('systemEditor.publisherNamePlaceholder')}
                aria-label={t('systemEditor.publisherNamePlaceholder')}
                style={{ ...input, flex: '1 1 140px', minWidth: 0 }}
              />
              <input
                type="text"
                value={p.url}
                onChange={(e) => setPublisher(idx, 'url', e.target.value)}
                placeholder={t('systemEditor.publisherUrlPlaceholder')}
                aria-label={t('systemEditor.publisherUrlPlaceholder')}
                style={{ ...input, flex: '1 1 180px', minWidth: 0 }}
              />
              <button
                type="button"
                onClick={() => removePublisher(idx)}
                style={iconBtn}
                aria-label={t('common.remove')}
              >
                <LuX size={14} />
              </button>
            </div>
          ))}
          <button type="button" onClick={addPublisher} style={addBtn}>
            <LuPlus size={13} /> {t('systemEditor.addPublisher')}
          </button>
        </div>
      </div>

      <div>
        <label style={label}>{t('systemEditor.urls')}</label>
        <LinkListEditor
          links={linksForEditing(draft.urls)}
          onChange={(v) => setField('urls', v)}
          addLabel={t('systemEditor.addUrl')}
          labelPlaceholder={t('systemEditor.urlLabelPlaceholder')}
          urlPlaceholder={t('systemEditor.urlPlaceholder')}
          idPrefix="sys-bulk-url"
        />
      </div>

      <div>
        <label style={label}>{t('systemEditor.characterBuilderUrls')}</label>
        <LinkListEditor
          links={linksForEditing(draft.character_builder_urls)}
          onChange={(v) => setField('character_builder_urls', v)}
          addLabel={t('systemEditor.addCharacterBuilder')}
          labelPlaceholder={t('systemEditor.characterBuilderLabelPlaceholder')}
          urlPlaceholder={t('systemEditor.urlPlaceholder')}
          idPrefix="sys-bulk-cb-url"
        />
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={!!draft.is_explicit}
          onChange={(e) => setField('is_explicit', e.target.checked)}
          style={{ width: 15, height: 15, cursor: 'pointer', accentColor: 'var(--gold)' }}
        />
        <span style={{ fontSize: 14, color: 'var(--text-dim)' }}>
          {t('systemEditor.markExplicit')}
        </span>
      </label>

      {booksWithThumbnails.length > 0 && (
        <div>
          <label style={{ ...label, display: 'flex', alignItems: 'center', gap: 6 }}>
            <LuImage size={14} /> {t('systemEditor.coverImage')}
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {booksWithThumbnails.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() =>
                  setField('cover_book_id', draft.cover_book_id === b.id ? null : b.id)
                }
                title={b.title}
                style={{
                  padding: 0,
                  border: `2px solid ${draft.cover_book_id === b.id ? 'var(--gold)' : 'var(--border)'}`,
                  borderRadius: 6,
                  overflow: 'hidden',
                  cursor: 'pointer',
                  background: 'none',
                  width: 60,
                  height: 80,
                  flexShrink: 0,
                }}
              >
                <LazyImg
                  src={mediaUrl(`/books/${b.id}/thumbnail`)}
                  alt={b.title}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              </button>
            ))}
          </div>
        </div>
      )}
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
const tagBox = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 5,
  alignItems: 'center',
  padding: '6px 8px',
  borderRadius: 8,
  cursor: 'text',
  background: 'var(--bg-deep)',
  border: '1px solid var(--border)',
  minHeight: 36,
}
const tagChip = {
  fontSize: 12,
  padding: '2px 6px 2px 8px',
  borderRadius: 10,
  background: 'rgba(201,168,76,0.15)',
  border: '1px solid var(--gold-dim)',
  color: 'var(--gold)',
  display: 'inline-flex',
  alignItems: 'center',
}
const tagChipRemove = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'inherit',
  padding: '0 0 0 4px',
  lineHeight: 1,
}
const tagBoxInput = {
  fontSize: 13,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  color: 'var(--text)',
  minWidth: 80,
  flex: 1,
}
const iconBtn = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--text-muted)',
  display: 'flex',
  padding: 4,
}
const addBtn = {
  alignSelf: 'flex-start',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--text-muted)',
  fontSize: 13,
  padding: '2px 0',
}
