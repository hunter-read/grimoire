import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuX, LuUpload } from 'react-icons/lu'
import { campaigns } from '../../api'
import WikiTemplateList from './WikiTemplateList'
import WikiTemplateBrowser from './WikiTemplateBrowser'
import WikiTemplateEditor from './WikiTemplateEditor'
import { backdrop, panel, closeBtn, scrollArea, chip, dashedBtn } from './wikiTemplateStyles'

const TABS = ['mine', 'browse', 'create']

// Manage a campaign's wiki note templates: use one to start a page, browse and
// download from the community catalogue, write your own, or upload/export a
// `.md`. Templates are per-campaign copies, so editing one here never touches
// another campaign's — and a server with downloading disabled still gets the
// authoring and upload paths.
export default function WikiTemplateModal({ campaignId, onClose, onUsed }) {
  const { t } = useTranslation()
  const [tab, setTab] = useState('mine')
  // Set while editing an existing template; the editor panel doubles as "new".
  const [editingId, setEditingId] = useState(null)
  const [owned, setOwned] = useState(null)
  const [campaignSystem, setCampaignSystem] = useState('')
  const [downloadsEnabled, setDownloadsEnabled] = useState(true)
  const [categories, setCategories] = useState([])
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const uploadRef = useRef(null)

  const loadOwned = useCallback(async () => {
    const res = await campaigns.wikiTemplates(campaignId)
    setOwned(res.templates)
    setCampaignSystem(res.campaign_system || '')
    setDownloadsEnabled(res.downloads_enabled !== false)
    setCategories(res.categories || [])
  }, [campaignId])

  useEffect(() => {
    loadOwned().catch((err) => setError(err.message))
  }, [loadOwned])

  const show = (name) => {
    setTab(name)
    setEditingId(null)
    setError(null)
  }

  // Picking a template does *not* create the page. It fetches the template's
  // content and hands it to the caller, which opens an unsaved editor — so a
  // mis-click costs nothing and the GM can edit before committing (or cancel
  // and leave no page behind).
  const use = async (templateId) => {
    setBusyId(templateId)
    setError(null)
    try {
      const tpl = await campaigns.getWikiTemplate(campaignId, templateId)
      const defaults = tpl.defaults || {}
      onUsed?.({
        // Deliberately no `id`: PageEditor treats an id-less page as new, so
        // this opens as a draft and only becomes a page when the GM saves.
        title: defaults.title || tpl.name || '',
        body: tpl.body || '',
        visibility: defaults.visibility || 'gm',
        page_type: defaults.page_type || 'note',
        icon: defaults.icon || '',
        icon_color: defaults.icon_color || '',
      })
    } catch (err) {
      setError(err.message)
      setBusyId(null)
    }
  }

  const remove = async (tpl) => {
    if (!confirm(t('wiki.templateDeleteConfirm', { name: tpl.name }))) return
    setError(null)
    try {
      await campaigns.deleteWikiTemplate(campaignId, tpl.id)
      await loadOwned()
    } catch (err) {
      setError(err.message)
    }
  }

  const exportOne = async (tpl) => {
    setError(null)
    try {
      await campaigns.exportWikiTemplate(campaignId, tpl.id, tpl.source_id || tpl.name)
    } catch (err) {
      setError(err.message)
    }
  }

  const upload = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    try {
      await campaigns.uploadWikiTemplate(campaignId, file)
      await loadOwned()
      show('mine')
    } catch (err) {
      setError(err.message)
    }
  }

  const afterSave = async () => {
    await loadOwned()
    show('mine')
  }

  // Downloading is off server-side, so don't offer the tab at all.
  const tabs = TABS.filter((name) => name !== 'browse' || downloadsEnabled)

  return (
    <div style={backdrop} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={panel}>
        <button onClick={onClose} aria-label={t('common.close')} style={closeBtn}>
          <LuX size={18} />
        </button>
        <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 12px', flexShrink: 0 }}>
          {t('wiki.templatesTitle')}
        </h3>

        <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexShrink: 0 }}>
          {tabs.map((name) => (
            <button
              key={name}
              onClick={() => show(name)}
              aria-pressed={tab === name && !editingId}
              style={chip(tab === name && !editingId)}
            >
              {t(`wiki.templateTab.${name}`)}
            </button>
          ))}
        </div>

        {error && (
          <p style={{ fontSize: 13, color: 'var(--danger)', margin: '0 0 12px', flexShrink: 0 }}>
            {error}
          </p>
        )}

        <div style={scrollArea}>
          {editingId ? (
            <WikiTemplateEditor
              campaignId={campaignId}
              templateId={editingId}
              categories={categories}
              onSaved={afterSave}
              onError={setError}
            />
          ) : tab === 'mine' ? (
            <WikiTemplateList
              templates={owned}
              busyId={busyId}
              onUse={use}
              onDelete={remove}
              onExport={exportOne}
              onEdit={(tpl) => {
                setEditingId(tpl.id)
                setError(null)
              }}
            />
          ) : tab === 'browse' ? (
            <WikiTemplateBrowser
              campaignId={campaignId}
              campaignSystem={campaignSystem}
              onDownloaded={loadOwned}
              onError={setError}
            />
          ) : (
            <WikiTemplateEditor
              campaignId={campaignId}
              categories={categories}
              onSaved={afterSave}
              onError={setError}
            />
          )}
        </div>

        {tab === 'mine' && !editingId && (
          <div style={{ marginTop: 12, flexShrink: 0 }}>
            <button onClick={() => uploadRef.current?.click()} style={dashedBtn}>
              <LuUpload size={13} /> {t('wiki.templateUpload')}
            </button>
            <input
              ref={uploadRef}
              type="file"
              accept=".md,.markdown,.txt,.zip"
              onChange={upload}
              style={{ display: 'none' }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
