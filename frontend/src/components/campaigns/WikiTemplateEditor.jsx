import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuPlus, LuSave, LuFileText } from 'react-icons/lu'
import { campaigns } from '../../api'
import Spinner from '../Spinner'
import IconPicker from './IconPicker'
import { label, input, goldBtn } from './wikiTemplateStyles'

// Sentinel for the category dropdown's "add a new one" row. Not a category
// anyone can pick, so it can't collide with a real name.
const NEW_CATEGORY = '__new__'

const EMPTY = {
  name: '',
  category: '',
  description: '',
  body: '',
  defaults: { title: '', icon: '', icon_color: '', visibility: 'gm', page_type: 'note' },
}

// Write a new template, or edit one the campaign already has.
//
// The page defaults (starting title, icon, visibility) are stored as a YAML
// frontmatter block on the body, but shown here as ordinary form controls —
// the server splits the block out on read and rebuilds it on save, so a GM
// never has to see or write YAML.
export default function WikiTemplateEditor({
  campaignId,
  templateId,
  categories = [],
  onSaved,
  onError,
}) {
  const { t } = useTranslation()
  const [form, setForm] = useState(EMPTY)
  const [loading, setLoading] = useState(!!templateId)
  const [saving, setSaving] = useState(false)
  // Shown when the GM picks "New category…" from the dropdown.
  const [newCategory, setNewCategory] = useState(null)

  useEffect(() => {
    if (!templateId) return
    let cancelled = false
    campaigns
      .getWikiTemplate(campaignId, templateId)
      .then((tpl) => {
        if (cancelled) return
        setForm({
          name: tpl.name || '',
          category: tpl.category || '',
          description: tpl.description || '',
          body: tpl.body || '',
          defaults: { ...EMPTY.defaults, ...(tpl.defaults || {}) },
        })
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        onError(err.message)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [campaignId, templateId, onError])

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))
  const setDefault = (key, value) =>
    setForm((f) => ({ ...f, defaults: { ...f.defaults, [key]: value } }))

  const pickCategory = (e) => {
    const value = e.target.value
    if (value === NEW_CATEGORY) {
      setNewCategory('')
      setForm((f) => ({ ...f, category: '' }))
      return
    }
    setNewCategory(null)
    setForm((f) => ({ ...f, category: value }))
  }

  const save = async () => {
    if (!form.name.trim()) {
      onError(t('wiki.templateNameRequired'))
      return
    }
    setSaving(true)
    onError(null)
    const payload = {
      name: form.name,
      category: (newCategory ?? form.category) || '',
      description: form.description,
      body: form.body,
      defaults: form.defaults,
    }
    try {
      if (templateId) await campaigns.updateWikiTemplate(campaignId, templateId, payload)
      else await campaigns.createWikiTemplate(campaignId, payload)
      await onSaved()
    } catch (err) {
      onError(err.message)
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 30 }}>
        <Spinner size={22} />
      </div>
    )
  }

  // A category the template already carries but that isn't in the suggested
  // list (e.g. one downloaded from the community) still has to be selectable.
  const options = [...new Set([...categories, form.category].filter(Boolean))]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <label style={label}>
        {t('wiki.templateName')}
        <input value={form.name} onChange={set('name')} style={input} />
      </label>

      <label style={label}>
        {t('wiki.templateCategory')}
        <select
          value={newCategory === null ? form.category : NEW_CATEGORY}
          onChange={pickCategory}
          style={input}
        >
          <option value="">{t('wiki.templateCategoryNone')}</option>
          {options.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
          <option value={NEW_CATEGORY}>{t('wiki.templateCategoryNew')}</option>
        </select>
      </label>
      {newCategory !== null && (
        <input
          value={newCategory}
          onChange={(e) => setNewCategory(e.target.value)}
          placeholder={t('wiki.templateCategoryNewPlaceholder')}
          aria-label={t('wiki.templateCategoryNew')}
          style={input}
          autoFocus
        />
      )}

      <label style={label}>
        {t('wiki.templateDescription')}
        <input value={form.description} onChange={set('description')} style={input} />
      </label>

      {/* Page defaults — what a page made from this template starts out as. */}
      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div style={{ fontSize: 12, color: 'var(--text-dim)', fontWeight: 600 }}>
          {t('wiki.templateDefaultsHeading')}
        </div>

        <label style={label}>
          {t('wiki.templateDefaultTitle')}
          <input
            value={form.defaults.title}
            onChange={(e) => setDefault('title', e.target.value)}
            placeholder={form.name || t('wiki.templateDefaultTitlePlaceholder')}
            style={input}
          />
        </label>

        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
          <div style={{ ...label, flex: '0 0 auto' }}>
            {t('wiki.templateDefaultIcon')}
            <div style={{ paddingTop: 2 }}>
              <IconPicker
                value={form.defaults.icon}
                onChange={(icon) => setDefault('icon', icon || '')}
                color={form.defaults.icon_color}
                onColorChange={(c) => setDefault('icon_color', c || '')}
                fallback={<LuFileText size={15} aria-hidden="true" />}
                ariaLabel={t('wiki.templateDefaultIcon')}
              />
            </div>
          </div>

          <label style={{ ...label, flex: 1 }}>
            {t('wiki.templateDefaultVisibility')}
            <select
              value={form.defaults.visibility}
              onChange={(e) => setDefault('visibility', e.target.value)}
              style={input}
            >
              <option value="gm">{t('wiki.vis_gm')}</option>
              <option value="group">{t('wiki.vis_group')}</option>
              <option value="members">{t('wiki.vis_members')}</option>
            </select>
          </label>
        </div>
      </div>

      <label style={label}>
        {t('wiki.templateBody')}
        <textarea
          value={form.body}
          onChange={set('body')}
          rows={12}
          placeholder={t('wiki.templateBodyPlaceholder')}
          style={{ ...input, fontFamily: 'monospace', resize: 'vertical' }}
        />
      </label>

      {/* Right-aligned, where a form's confirming action belongs. */}
      <button onClick={save} disabled={saving} style={{ ...goldBtn, alignSelf: 'flex-end' }}>
        {templateId ? (
          <>
            <LuSave size={14} /> {t('common.save')}
          </>
        ) : (
          <>
            <LuPlus size={14} /> {t('wiki.templateCreate')}
          </>
        )}
      </button>
    </div>
  )
}
