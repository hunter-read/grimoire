import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  LuChevronRight,
  LuChevronDown,
  LuDownload,
  LuRefreshCw,
  LuLink,
  LuCheck,
} from 'react-icons/lu'
import { SiGithub } from 'react-icons/si'
import { campaigns } from '../../api'
import Spinner from '../Spinner'
import {
  row,
  rowDesc,
  rowAuthor,
  systemTag,
  folderRow,
  iconBtn,
  emptyText,
  input,
  goldBtn,
  ghostBtn,
} from './wikiTemplateStyles'

// The community catalogue, as a collapsible folder tree. Folders come from the
// server already ordered (Generic first, then alphabetical) and start
// collapsed; the folder matching the campaign's system opens automatically.
export default function WikiTemplateBrowser({ campaignId, campaignSystem, onDownloaded, onError }) {
  const { t } = useTranslation()
  const [data, setData] = useState(null)
  const [expanded, setExpanded] = useState(() => new Set())
  const [busyId, setBusyId] = useState(null)
  const [done, setDone] = useState(() => new Set())
  // Id of the template just downloaded, shown as a tick for a couple of seconds
  // so the click has a visible result even when the row already said "you have
  // this". Held in a ref too, so the timer can be cleared on unmount.
  const [justAdded, setJustAdded] = useState(null)
  const addedTimer = useRef(null)
  const [editingUrl, setEditingUrl] = useState(false)
  const [urlDraft, setUrlDraft] = useState('')

  useEffect(() => () => clearTimeout(addedTimer.current), [])

  const load = useCallback(
    async (refresh) => {
      setData(null)
      try {
        const res = await campaigns.browseWikiTemplates(campaignId, refresh)
        setData(res)
        setDone(new Set(res.downloaded_ids || []))
        const match = (res.folders || []).find((f) =>
          f.templates?.some((tpl) => tpl.system && tpl.system === campaignSystem)
        )
        setExpanded(new Set(match ? [match.path] : []))
      } catch (err) {
        onError(err.message)
        setData({ folders: [] })
      }
    },
    [campaignId, campaignSystem, onError]
  )

  useEffect(() => {
    load(false)
  }, [load])

  const toggle = (path) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(path) ? next.delete(path) : next.add(path)
      return next
    })

  const download = async (templateId) => {
    setBusyId(templateId)
    onError(null)
    try {
      await campaigns.downloadWikiTemplate(campaignId, templateId)
      setDone((prev) => new Set(prev).add(templateId))
      // Re-arm the tick even if this template was already held, so a repeat
      // download still reads as "that worked".
      setJustAdded(templateId)
      clearTimeout(addedTimer.current)
      addedTimer.current = setTimeout(() => setJustAdded(null), 2500)
      await onDownloaded()
    } catch (err) {
      onError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  const saveUrl = async (value) => {
    onError(null)
    try {
      await campaigns.setWikiTemplateSource(campaignId, value)
      setEditingUrl(false)
      await load(true)
    } catch (err) {
      onError(err.message)
    }
  }

  if (data === null) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 30 }}>
        <Spinner size={22} />
      </div>
    )
  }

  return (
    <div>
      {/* The default catalogue is right for almost everyone, so the URL field
          stays behind a button rather than occupying the panel. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', flex: 1, minWidth: 0 }}>
          {data.is_custom_url ? t('wiki.templateSourceCustom') : t('wiki.templateSourceDefault')}
        </span>
        <button onClick={() => load(true)} aria-label={t('wiki.templateRefresh')} style={iconBtn}>
          <LuRefreshCw size={13} />
        </button>
        <button
          onClick={() => {
            setUrlDraft(data.index_url || '')
            setEditingUrl((v) => !v)
          }}
          aria-label={t('wiki.templateChangeSource')}
          title={t('wiki.templateChangeSource')}
          style={iconBtn}
        >
          <LuLink size={13} />
        </button>
      </div>

      {editingUrl && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, alignItems: 'stretch' }}>
          {/* The URL is long, so the input takes the leftover width and shrinks
              (minWidth:0 — a flex item won't shrink below its content
              otherwise). The buttons keep their natural width so their labels
              never wrap. */}
          <input
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            placeholder={t('wiki.templateSourcePlaceholder')}
            aria-label={t('wiki.templateChangeSource')}
            style={{ ...input, flex: 1, minWidth: 0 }}
          />
          <button onClick={() => saveUrl(urlDraft)} style={{ ...goldBtn, flexShrink: 0 }}>
            {t('common.save')}
          </button>
          <button onClick={() => saveUrl('')} style={{ ...ghostBtn, flexShrink: 0 }}>
            {t('wiki.templateSourceReset')}
          </button>
        </div>
      )}

      {!data.folders?.length ? (
        <p style={emptyText}>{t('wiki.templatesCatalogueEmpty')}</p>
      ) : (
        data.folders.map((folder) => {
          const open = expanded.has(folder.path)
          return (
            <div key={folder.path || '__root__'} style={{ marginBottom: 4 }}>
              <button onClick={() => toggle(folder.path)} aria-expanded={open} style={folderRow}>
                {open ? <LuChevronDown size={14} /> : <LuChevronRight size={14} />}
                <span style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>{folder.name}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {folder.templates.length}
                </span>
              </button>
              {open && (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    padding: '6px 0 6px 22px',
                  }}
                >
                  {folder.templates.map((tpl) => {
                    const have = done.has(tpl.id)
                    return (
                      <div key={tpl.id} style={row}>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>
                            {tpl.name}
                            <span style={systemTag}>{tpl.category}</span>
                          </span>
                          {tpl.description && <span style={rowDesc}>{tpl.description}</span>}
                          {tpl.author && (
                            <span style={rowAuthor}>
                              {t('addons.byAuthor', { author: tpl.author })}
                              {/* The name stays plain text; only the icon links,
                                  and only to a resolved GitHub profile. */}
                              {tpl.author_url && (
                                <a
                                  href={tpl.author_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title={t('addons.githubProfile', { author: tpl.author })}
                                  aria-label={t('addons.githubProfile', { author: tpl.author })}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    marginLeft: 4,
                                    color: 'inherit',
                                  }}
                                >
                                  <SiGithub size={11} />
                                </a>
                              )}
                            </span>
                          )}
                        </span>
                        {/* Three states, so the result of a click is never
                            ambiguous: downloading, just-added (a green tick
                            that fades after a moment, and reappears on a
                            re-download), and the resting "you have this" hint. */}
                        <button
                          onClick={() => download(tpl.id)}
                          disabled={busyId !== null}
                          style={{
                            ...ghostBtn,
                            flexShrink: 0,
                            ...(justAdded === tpl.id
                              ? { borderColor: 'var(--green)', color: 'var(--green)' }
                              : null),
                          }}
                        >
                          {busyId === tpl.id ? (
                            <>
                              <Spinner size={13} /> {t('wiki.templateDownloading')}
                            </>
                          ) : justAdded === tpl.id ? (
                            <>
                              <LuCheck size={13} /> {t('wiki.templateDownloaded')}
                            </>
                          ) : (
                            <>
                              <LuDownload size={13} />{' '}
                              {have ? t('wiki.templateDownloadAgain') : t('wiki.templateDownload')}
                            </>
                          )}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}
