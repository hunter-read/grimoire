import { useState, useEffect } from 'react'
import type { CSSProperties } from 'react'
import AccessLevelPicker from '../metadata/AccessLevelPicker'
import { useTranslation } from 'react-i18next'
import { LuX, LuPlus } from 'react-icons/lu'
import api from '../../api'
import type { Schema } from '../../api'
import type { CoverPickerBook } from './coverPickerUtils'
import CoverPicker from './CoverPicker'
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
/** One system's draft in the bulk-edit carousel, holding values as edited. */
export interface SystemDraft {
  description?: string | null
  system_family?: string | null
  dice_materials?: string[] | null
  genres?: string[] | null
  tags?: string[] | null
  parent_system?: string | null
  edition?: string | null
  license?: string | null
  /** A number from the server; text once the field has been typed in. */
  year?: number | string | null
  publishers?: Schema<'PublisherRef'>[] | null
  urls?: Schema<'LinkEntry'>[] | null
  character_builder_urls?: Schema<'LinkEntry'>[] | null
  access_level?: string | null
  is_explicit?: boolean | null
  cover_book_id?: string | null
}

export interface SystemBulkEditFieldsProps {
  /** The system on screen; a list row carries no books, so they are fetched. */
  system: { id: string; books?: CoverPickerBook[] | null }
  draft: SystemDraft
  setField: (field: string, value: unknown) => void
}

export default function SystemBulkEditFields({
  system,
  draft,
  setField,
}: SystemBulkEditFieldsProps) {
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
  const [books, setBooks] = useState<CoverPickerBook[] | null>(system.books || null)

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
        if (!cancelled) setBooks((full as Schema<'SystemDetail'>).books || [])
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

  const setPublisher = (idx: number, key: 'name' | 'url', value: string) =>
    setField(
      'publishers',
      publishers.map((p, i) => (i === idx ? { ...p, [key]: value } : p))
    )
  const addPublisher = () => setField('publishers', [...publishers, { name: '', url: '' }])
  const removePublisher = (idx: number) =>
    setField(
      'publishers',
      publishers.filter((_, i) => i !== idx)
    )

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

      <AccessLevelPicker
        id="sys-bulk-access-level"
        value={draft.access_level}
        allowInherit={false}
        onChange={(v) => setField('access_level', v)}
      />

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

      {/* Same picker the single-system editor uses: core books first, paged,
          with hover previews. Eight per page rather than the default ten —
          this modal is narrower, so ten wraps to a third row. `books` is null
          until the lazy fetch lands, which is what `loading` reserves space
          for: without it the section appears from nothing and pushes the
          modal's buttons down just as you go to click them. */}
      <CoverPicker
        books={books || []}
        value={draft.cover_book_id ?? null}
        onChange={(id) => setField('cover_book_id', id)}
        pageSize={8}
        loading={books === null}
      />
    </div>
  )
}

const label: CSSProperties = {
  display: 'block',
  fontSize: 12,
  color: 'var(--text-muted)',
  fontWeight: 500,
  marginBottom: 6,
}
const input: CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  background: 'var(--bg-deep)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--text)',
  fontSize: 14,
  boxSizing: 'border-box',
}
const iconBtn: CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--text-muted)',
  display: 'flex',
  padding: 4,
}
const addBtn: CSSProperties = {
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
