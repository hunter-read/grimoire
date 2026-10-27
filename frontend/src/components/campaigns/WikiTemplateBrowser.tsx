import { useCallback, useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react'
import { useTranslation } from 'react-i18next'
import { LuChevronRight, LuChevronDown, LuDownload, LuCheck } from 'react-icons/lu'
import { campaigns } from '../../api'
import Spinner from '../Spinner'
import PluginSourcePill from '../settings/PluginSourcePill'
import PluginSourceContextMenu from '../settings/PluginSourceContextMenu'
import AuthorByline from '../settings/AuthorByline'
import { row, rowDesc, systemTag, folderRow, emptyText, ghostBtn } from './wikiTemplateStyles'

// The community catalogue, as a collapsible folder tree. Folders come from the
// server already ordered (Generic first, then alphabetical) and start
// collapsed; the folder matching the campaign's system opens automatically.
const WikiTemplateBrowser = forwardRef(function WikiTemplateBrowser(
  { campaignId, campaignSystem, onDownloaded, onError },
  ref
) {
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
  const [contextMenu, setContextMenu] = useState(null)

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

  useImperativeHandle(
    ref,
    () => ({
      refresh: () => load(true),
    }),
    [load]
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

  const handleContextMenu = (e, tpl) => {
    e.preventDefault()
    if (!tpl.available_in || tpl.available_in.length <= 1) return
    setContextMenu({ x: e.clientX, y: e.clientY, tpl })
  }

  const download = async (templateId, indexUrl) => {
    setBusyId(templateId)
    onError(null)
    try {
      await campaigns.downloadWikiTemplate(campaignId, templateId, indexUrl)
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

  if (data === null) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 30 }}>
        <Spinner size={22} />
      </div>
    )
  }

  return (
    <div>
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
                      <div
                        key={tpl.id}
                        style={{
                          ...row,
                          padding: '12px 16px',
                          gap: 16,
                        }}
                        onContextMenu={(e) => handleContextMenu(e, tpl)}
                      >
                        <span
                          style={{
                            flex: 1,
                            minWidth: 0,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 4,
                          }}
                        >
                          <span
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              flexWrap: 'wrap',
                            }}
                          >
                            <span style={{ fontSize: 13, fontWeight: 600 }}>{tpl.name}</span>
                            <span style={systemTag}>{tpl.category}</span>
                          </span>
                          {tpl.description && <span style={rowDesc}>{tpl.description}</span>}
                          {tpl.index_url && (
                            <div style={{ marginTop: 2 }}>
                              <span
                                onClick={(e) => {
                                  if (tpl.available_in?.length > 1) {
                                    e.stopPropagation()
                                    handleContextMenu(e, tpl)
                                  }
                                }}
                                style={{
                                  cursor: tpl.available_in?.length > 1 ? 'pointer' : 'default',
                                }}
                              >
                                <PluginSourcePill
                                  url={tpl.index_url}
                                  isVerified={tpl.index_url === data?.default_index_url}
                                  trustedIndexUrls={data?.trusted_index_urls || []}
                                />
                              </span>
                            </div>
                          )}
                          <AuthorByline author={tpl.author} authorUrl={tpl.author_url} />
                        </span>
                        {/* Three states, so the result of a click is never
                            ambiguous: downloading, just-added (a green tick
                            that fades after a moment, and reappears on a
                            re-download), and the resting "you have this" hint. */}
                        <button
                          onClick={() => download(tpl.id, tpl.index_url)}
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

      {contextMenu && (
        <PluginSourceContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          isUpdate={false}
          sources={contextMenu.tpl.available_in}
          defaultIndexUrl={data?.default_index_url}
          trustedIndexUrls={data?.trusted_index_urls || []}
          onSelect={(indexUrl) => {
            download(contextMenu.tpl.id, indexUrl)
          }}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
})

export default WikiTemplateBrowser
