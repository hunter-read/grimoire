import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuDownload, LuX, LuPlus } from 'react-icons/lu'
import api from '../../api'
import CoverPicker from './CoverPicker'
import MetadataFetchDialog from './MetadataFetchDialog'
import GenrePicker from '../metadata/GenrePicker'
import TagPicker from '../metadata/TagPicker'
import LinkListEditor from '../metadata/LinkListEditor'
import LookupCombobox from '../metadata/LookupCombobox'
import SingleSelectCombobox from '../metadata/SingleSelectCombobox'
import DiceMaterialsPicker from '../metadata/DiceMaterialsPicker'
import { groupsFromManaged } from '../metadata/diceMaterials'
import useLookups from '../metadata/useLookups'
import { cleanLinks, linksForEditing } from '../metadata/metadataUtils'

export default function SystemEditor({ system, onSave }) {
  const { t } = useTranslation()
  const {
    genres: genreTree,
    families,
    parentSystems,
    licenses,
    diceMaterials,
    reload: reloadLookups,
  } = useLookups()
  // Managed dice/materials groups (undefined until loaded → picker falls back to defaults).
  const diceGroups = diceMaterials.length ? groupsFromManaged(diceMaterials) : undefined
  const [form, setForm] = useState({
    description: system.description || '',
    publishers: system.publishers?.length ? system.publishers : [{ name: '', url: '' }],
    urls: linksForEditing(system.urls),
    character_builder_urls: linksForEditing(system.character_builder_urls),
    tags: system.tags || [],
    genres: system.genres || [],
    dice_materials: system.dice_materials || [],
    system_family: system.system_family || '',
    parent_system: system.parent_system || '',
    edition: system.edition || '',
    license: system.license || '',
    year: system.year ?? '',
    cover_book_id: system.cover_book_id || null,
    is_explicit: system.is_explicit || false,
  })
  // "Fetch metadata" only appears when a source is actually available, so the
  // button never promises something the server cannot do.
  const [hasSources, setHasSources] = useState(false)
  const [fetching, setFetching] = useState(false)

  useEffect(() => {
    api
      .get(`/systems/${system.id}/metadata-sources`)
      .then((data) => setHasSources((data.sources || []).length > 0))
      .catch(() => setHasSources(false))
  }, [system.id])

  // Merge applied fields into the form so the editor reflects them immediately,
  // and tell the parent so its copy of the system stays in step.
  const handleFetched = (fields) => {
    setForm((f) => ({ ...f, ...fields }))
    onSave(fields)
  }

  const familyOptions = families.map((f) => f.name)
  const parentSystemOptions = parentSystems.map((p) => p.name)
  const licenseOptions = licenses.map((l) => l.name)

  const setTags = (tags) => setForm((f) => ({ ...f, tags }))

  const handleSave = () => {
    const publishers = form.publishers.filter((p) => p.name.trim())
    const year = form.year === '' ? null : Number(form.year)
    const data = {
      ...form,
      publishers,
      urls: cleanLinks(form.urls),
      character_builder_urls: cleanLinks(form.character_builder_urls),
      year,
    }
    api.patch(`/systems/${system.id}`, data).then(() => onSave(data))
  }

  const setPublisher = (idx, key, value) =>
    setForm((f) => ({
      ...f,
      publishers: f.publishers.map((p, i) => (i === idx ? { ...p, [key]: value } : p)),
    }))

  const addPublisher = () =>
    setForm((f) => ({ ...f, publishers: [...f.publishers, { name: '', url: '' }] }))

  const removePublisher = (idx) =>
    setForm((f) => ({ ...f, publishers: f.publishers.filter((_, i) => i !== idx) }))

  const labeledBlock = (label, node) => (
    <div style={{ marginBottom: 12 }}>
      <label
        style={{ fontSize: 14, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}
      >
        {label}
      </label>
      {node}
    </div>
  )

  const field = (label, key, type = 'text') => (
    <div style={{ marginBottom: 12 }}>
      <label
        htmlFor={`system-field-${key}`}
        style={{ fontSize: 14, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}
      >
        {label}
      </label>
      {type === 'textarea' ? (
        <textarea
          id={`system-field-${key}`}
          value={form[key]}
          onChange={(e) => setForm({ ...form, [key]: e.target.value })}
          rows={3}
          style={{ width: '100%', resize: 'vertical' }}
        />
      ) : (
        <input
          id={`system-field-${key}`}
          type="text"
          value={form[key]}
          onChange={(e) => setForm({ ...form, [key]: e.target.value })}
          style={{ width: '100%' }}
        />
      )}
    </div>
  )

  return (
    <div
      className="fade-in"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: 24,
        marginBottom: 32,
      }}
    >
      <h4 style={{ fontSize: 16, marginBottom: 16 }}>{t('systemEditor.title')}</h4>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: '0 20px',
        }}
      >
        <div>
          {field(t('systemEditor.description'), 'description', 'textarea')}
          {/* System Family sits directly under the description. */}
          {labeledBlock(
            t('systemEditor.systemFamily'),
            <LookupCombobox
              id="system-family"
              value={form.system_family}
              onChange={(v) => setForm((f) => ({ ...f, system_family: v }))}
              options={familyOptions}
              placeholder={t('systemEditor.systemFamilyPlaceholder')}
            />
          )}
          {/* Dice / Materials sits under System Family. */}
          {labeledBlock(
            t('systemEditor.diceMaterials'),
            <DiceMaterialsPicker
              selected={form.dice_materials}
              onChange={(dice_materials) => setForm((f) => ({ ...f, dice_materials }))}
              groups={diceGroups}
              onCreate={reloadLookups}
            />
          )}
          {/* Genres are shown before tags per issue #202. */}
          <div style={{ marginBottom: 12 }}>
            <label
              style={{
                fontSize: 14,
                color: 'var(--text-muted)',
                display: 'block',
                marginBottom: 4,
              }}
            >
              {t('systemEditor.genres')}
            </label>
            <GenrePicker
              genreTree={genreTree}
              selected={form.genres}
              onChange={(genres) => setForm((f) => ({ ...f, genres }))}
              onGenreCreated={reloadLookups}
            />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label
              htmlFor="system-tag-input"
              style={{
                fontSize: 14,
                color: 'var(--text-muted)',
                display: 'block',
                marginBottom: 4,
              }}
            >
              {t('systemEditor.tags')}
            </label>
            <TagPicker
              value={form.tags}
              onChange={setTags}
              resourceType="system"
              placeholder={t('systemEditor.tagPlaceholder')}
            />
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
              {t('systemEditor.tagHint')}
            </div>
          </div>
        </div>
        <div>
          {/* Parent System (75%) + Edition (25%) above License + Year, e.g.
              "Dungeons & Dragons" + "5e". */}
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 3 }}>
              {labeledBlock(
                t('systemEditor.parentSystem'),
                <SingleSelectCombobox
                  id="parent-system"
                  value={form.parent_system}
                  onChange={(v) => setForm((f) => ({ ...f, parent_system: v }))}
                  options={parentSystemOptions}
                  placeholder={t('systemEditor.parentSystemPlaceholder')}
                  createEndpoint="/parent-systems"
                  onCreate={reloadLookups}
                  createLabel={(name) => t('systemEditor.createParentSystem', { name })}
                />
              )}
            </div>
            <div style={{ flex: 1 }}>
              {labeledBlock(
                t('systemEditor.edition'),
                <input
                  id="system-edition"
                  value={form.edition}
                  onChange={(e) => setForm((f) => ({ ...f, edition: e.target.value }))}
                  placeholder={t('systemEditor.editionPlaceholder')}
                  style={{ width: '100%' }}
                />
              )}
            </div>
          </div>
          {/* License + Year sit above Publishers. */}
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              {labeledBlock(
                t('systemEditor.license'),
                <LookupCombobox
                  id="system-license"
                  value={form.license}
                  onChange={(v) => setForm((f) => ({ ...f, license: v }))}
                  options={licenseOptions}
                  placeholder={t('systemEditor.licensePlaceholder')}
                />
              )}
            </div>
            <div style={{ flex: 1 }}>
              <label
                htmlFor="system-field-year"
                style={{
                  fontSize: 14,
                  color: 'var(--text-muted)',
                  display: 'block',
                  marginBottom: 4,
                }}
              >
                {t('systemEditor.year')}
              </label>
              <input
                id="system-field-year"
                type="number"
                value={form.year}
                onChange={(e) => setForm((f) => ({ ...f, year: e.target.value }))}
                style={{ width: '100%' }}
              />
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label
              style={{
                fontSize: 14,
                color: 'var(--text-muted)',
                display: 'block',
                marginBottom: 4,
              }}
            >
              {t('systemEditor.publishers')}
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {form.publishers.map((p, idx) => (
                <div
                  key={idx}
                  style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}
                >
                  <input
                    id={`publisher-name-${idx}`}
                    type="text"
                    value={p.name}
                    onChange={(e) => setPublisher(idx, 'name', e.target.value)}
                    placeholder={t('systemEditor.publisherNamePlaceholder')}
                    aria-label={t('systemEditor.publisherNamePlaceholder')}
                    style={{ flex: '1 1 140px', minWidth: 0 }}
                  />
                  <input
                    id={`publisher-url-${idx}`}
                    type="text"
                    value={p.url}
                    onChange={(e) => setPublisher(idx, 'url', e.target.value)}
                    placeholder={t('systemEditor.publisherUrlPlaceholder')}
                    aria-label={t('systemEditor.publisherUrlPlaceholder')}
                    style={{ flex: '1 1 180px', minWidth: 0 }}
                  />
                  <button
                    onClick={() => removePublisher(idx)}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--text-muted)',
                      display: 'flex',
                      padding: 4,
                    }}
                  >
                    <LuX size={14} />
                  </button>
                </div>
              ))}
              <button
                onClick={addPublisher}
                style={{
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
                }}
              >
                <LuPlus size={13} /> {t('systemEditor.addPublisher')}
              </button>
            </div>
          </div>
          {labeledBlock(
            t('systemEditor.urls'),
            <LinkListEditor
              links={form.urls}
              onChange={(urls) => setForm((f) => ({ ...f, urls }))}
              addLabel={t('systemEditor.addUrl')}
              labelPlaceholder={t('systemEditor.urlLabelPlaceholder')}
              urlPlaceholder={t('systemEditor.urlPlaceholder')}
              idPrefix="system-url"
            />
          )}
          {labeledBlock(
            t('systemEditor.characterBuilderUrls'),
            <LinkListEditor
              links={form.character_builder_urls}
              onChange={(character_builder_urls) =>
                setForm((f) => ({ ...f, character_builder_urls }))
              }
              addLabel={t('systemEditor.addCharacterBuilder')}
              labelPlaceholder={t('systemEditor.characterBuilderLabelPlaceholder')}
              urlPlaceholder={t('systemEditor.urlPlaceholder')}
              idPrefix="system-cb-url"
            />
          )}
          <div style={{ marginBottom: 12 }}>
            <label
              htmlFor="system-is-explicit"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                cursor: 'pointer',
                width: 'fit-content',
              }}
            >
              <input
                id="system-is-explicit"
                type="checkbox"
                checked={form.is_explicit}
                onChange={(e) => setForm((f) => ({ ...f, is_explicit: e.target.checked }))}
                style={{ width: 15, height: 15, cursor: 'pointer', accentColor: 'var(--gold)' }}
              />
              <span style={{ fontSize: 14, color: 'var(--text-dim)' }}>
                {t('systemEditor.markExplicit')}
              </span>
            </label>
          </div>
        </div>
      </div>
      <CoverPicker
        books={system.books}
        value={form.cover_book_id}
        onChange={(id) => setForm((f) => ({ ...f, cover_book_id: id }))}
      />

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          onClick={handleSave}
          style={{
            padding: '10px 24px',
            borderRadius: 6,
            background: 'var(--gold-dim)',
            color: 'var(--bg-deep)',
            fontSize: 16,
            fontWeight: 600,
            marginTop: 8,
          }}
        >
          {t('systemEditor.saveChanges')}
        </button>

        {hasSources && (
          <button
            onClick={() => setFetching(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '10px 18px',
              borderRadius: 6,
              background: 'none',
              border: '1px solid var(--border)',
              color: 'var(--text)',
              fontSize: 14,
              marginTop: 8,
              cursor: 'pointer',
            }}
          >
            <LuDownload size={14} />
            {t('systemEditor.fetchMetadata')}
          </button>
        )}
      </div>

      {fetching && (
        <MetadataFetchDialog
          resource={system}
          kind="systems"
          onApply={handleFetched}
          onClose={() => setFetching(false)}
        />
      )}
    </div>
  )
}
