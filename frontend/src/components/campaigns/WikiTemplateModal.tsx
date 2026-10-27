import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { LuX, LuUpload, LuRefreshCw } from 'react-icons/lu'
import { campaigns, type Schema } from '../../api'
import WikiTemplateList from './WikiTemplateList'
import WikiTemplateBrowser, { type WikiTemplateBrowserHandle } from './WikiTemplateBrowser'
import WikiTemplateEditor from './WikiTemplateEditor'
import {
  backdrop,
  panel,
  closeBtn,
  scrollArea,
  chip,
  dashedBtn,
  iconBtn,
} from './wikiTemplateStyles'

type Tab = 'mine' | 'browse' | 'create'

const TABS: Tab[] = ['mine', 'browse', 'create']

// Manage a campaign's wiki note templates: use one to start a page, browse and
// download from the community catalogue, write your own, or upload/export a
// `.md`. Templates are per-campaign copies, so editing one here never touches
// another campaign's — and a server with downloading disabled still gets the
// authoring and upload paths.
type Template = Schema<'WikiTemplateSummaryOut'>

/** A new page's starting fields, from the chosen template. */
export interface TemplateDraft {
  title: string
  body: string
  visibility: string
  page_type: string
  icon: string
  icon_color: string
}

interface WikiTemplateModalProps {
  campaignId: string
  onClose: () => void
  onUsed?: (draft: TemplateDraft) => void
}

export default function WikiTemplateModal({ campaignId, onClose, onUsed }: WikiTemplateModalProps) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('mine')
  // Set while editing an existing template; the editor panel doubles as "new".
  const [editingId, setEditingId] = useState<string | null>(null)
  const [owned, setOwned] = useState<Template[] | null>(null)
  const [campaignSystem, setCampaignSystem] = useState('')
  const [downloadsEnabled, setDownloadsEnabled] = useState(true)
  const [categories, setCategories] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const uploadRef = useRef<HTMLInputElement>(null)
  const browserRef = useRef<WikiTemplateBrowserHandle>(null)

  const loadOwned = useCallback(async () => {
    const res = await campaigns.wikiTemplates(campaignId)
    setOwned(res.templates)
    setCampaignSystem(res.campaign_system || '')
    setDownloadsEnabled(res.downloads_enabled !== false)
    setCategories(res.categories || [])
  }, [campaignId])

  useEffect(() => {
    loadOwned().catch((err) => setError((err as Error).message))
  }, [loadOwned])

  const show = (name: Tab) => {
    setTab(name)
    setEditingId(null)
    setError(null)
  }

  // Picking a template does *not* create the page. It fetches the template's
  // content and hands it to the caller, which opens an unsaved editor — so a
  // mis-click costs nothing and the GM can edit before committing (or cancel
  // and leave no page behind).
  const use = async (templateId: string) => {
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
      setError((err as Error).message)
      setBusyId(null)
    }
  }

  const remove = async (tpl: Template) => {
    if (!confirm(t('wiki.templateDeleteConfirm', { name: tpl.name }))) return
    setError(null)
    try {
      await campaigns.deleteWikiTemplate(campaignId, tpl.id)
      await loadOwned()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const exportOne = async (tpl: Template) => {
    setError(null)
    try {
      await campaigns.exportWikiTemplate(campaignId, tpl.id, tpl.source_id || tpl.name)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const upload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    try {
      await campaigns.uploadWikiTemplate(campaignId, file)
      await loadOwned()
      show('mine')
    } catch (err) {
      setError((err as Error).message)
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

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            marginBottom: 14,
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
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
          {tab === 'browse' && !editingId && (
            <button
              onClick={() => browserRef.current?.refresh()}
              aria-label={t('wiki.templateRefresh')}
              title={t('wiki.templateRefresh')}
              style={{ ...iconBtn, padding: 6, borderRadius: 6 }}
            >
              <LuRefreshCw size={14} />
            </button>
          )}
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
              ref={browserRef}
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
