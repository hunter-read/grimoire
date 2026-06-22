import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import {
  LuPlus,
  LuSearch,
  LuPencil,
  LuTrash2,
  LuArrowLeft,
  LuFileText,
  LuDownload,
  LuUpload,
  LuChevronRight,
  LuChevronDown,
} from 'react-icons/lu'
import { campaigns } from '../../api'
import Spinner from '../Spinner'
import WikiMarkdown from './WikiMarkdown'
import WikiImportModal from './WikiImportModal'
import IconPicker from './IconPicker'
import { CampaignIcon } from './campaignIcons'
import VisibilityBadge from './VisibilityBadge'
import VisibilityEditor from './VisibilityEditor'
import PageEditor from './PageEditor'
import { descendantIds, VIS_META, ghostBtn, goldBtn } from './wikiShared'

export default function WikiView({ campaign, isOwner }) {
  const { t } = useTranslation()
  const [pages, setPages] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [page, setPage] = useState(null)
  const [editing, setEditing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createParentId, setCreateParentId] = useState('')
  const [query, setQuery] = useState('')
  const [importing, setImporting] = useState(false)
  // Ids of parent pages whose children are collapsed in the sidebar tree,
  // persisted per campaign (per browser) so the choice survives navigation.
  const collapseKey = `grimoire_wiki_collapsed_${campaign.id}`
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(collapseKey) || '[]'))
    } catch {
      return new Set()
    }
  })
  const dragId = useRef(null)
  // Live drop indicator: { id, where: 'before' | 'after' | 'inside' }.
  const [dropTarget, setDropTarget] = useState(null)

  const exportWiki = async (format) => {
    try {
      await campaigns.exportWiki(campaign.id, format)
    } catch (e) {
      alert(e.message)
    }
  }

  const toggleCollapse = (id) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      try {
        localStorage.setItem(collapseKey, JSON.stringify([...next]))
      } catch {
        // localStorage unavailable (private mode); collapse state stays in memory only.
      }
      return next
    })

  const loadList = useCallback(
    (selectId) => {
      campaigns.listWikiPages(campaign.id).then((list) => {
        setPages(list)
        if (selectId) setSelectedId(selectId)
        else if (!selectId && list.length && !selectedId) setSelectedId(list[0].id)
      })
    },
    [campaign.id, selectedId]
  )

  useEffect(() => {
    loadList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign.id])

  useEffect(() => {
    if (!selectedId) {
      setPage(null)
      return
    }
    setEditing(false)
    campaigns
      .getWikiPage(campaign.id, selectedId)
      .then(setPage)
      .catch(() => setPage(null))
  }, [campaign.id, selectedId])

  const openSlug = (slug) => {
    const match = pages?.find((p) => p.slug === slug)
    if (match) {
      setSelectedId(match.id)
    } else {
      // The target isn't visible to this user (or doesn't exist yet); refresh list.
      loadList()
    }
  }

  const handleSaved = (saved) => {
    setCreating(false)
    setEditing(false)
    loadList(saved.id)
    setSelectedId(saved.id)
    campaigns.getWikiPage(campaign.id, saved.id).then(setPage)
  }

  const handleDelete = async () => {
    if (!page || !confirm(t('wiki.deleteConfirm', { title: page.title }))) return
    await campaigns.deleteWikiPage(campaign.id, page.id)
    setSelectedId(null)
    setPage(null)
    loadList()
  }

  // Quick icon change without entering the full editor. Updates the list (and the
  // open page, if it's the one changed) so the new icon shows immediately.
  const changeIcon = async (pageId, icon) => {
    await campaigns.updateWikiPage(campaign.id, pageId, { icon: icon || '' })
    loadList(selectedId)
    if (page?.id === pageId) setPage((p) => (p ? { ...p, icon: icon || '' } : p))
  }

  // Change the open page's visibility from its badge. Switching away from
  // "members" clears the share list to mirror PageEditor's save behaviour.
  const changeVisibility = async (visibility) => {
    if (!page) return
    const payload = { visibility }
    if (visibility !== 'members') payload.shared_user_ids = []
    await campaigns.updateWikiPage(campaign.id, page.id, payload)
    setPage((p) =>
      p
        ? { ...p, visibility, shared_user_ids: visibility === 'members' ? p.shared_user_ids : [] }
        : p
    )
    loadList(selectedId)
  }

  // Toggle which members can access the open Private page.
  const changeShares = async (sharedIds) => {
    if (!page) return
    await campaigns.updateWikiPage(campaign.id, page.id, { shared_user_ids: sharedIds })
    setPage((p) => (p ? { ...p, shared_user_ids: sharedIds } : p))
  }

  const startCreate = (parentId = '') => {
    setCreateParentId(parentId)
    setCreating(true)
    setEditing(false)
    setPage(null)
    setSelectedId(null)
  }

  // The pages in their current sidebar display order (depth-first, siblings by
  // sort_order then title) — the basis for computing a new manual order on drop.
  const orderedSiblings = (parentId) =>
    pages
      .filter((p) => (p.parent_id || null) === (parentId || null))
      .sort(
        (a, b) =>
          (a.sort_order || 0) - (b.sort_order || 0) || (a.title || '').localeCompare(b.title || '')
      )

  // Depth-first walk producing the full ordered id list, used as the payload for
  // the reorder endpoint (sort_order is global, so we persist the whole order).
  const flattenOrder = (siblingsByParent) => {
    const out = []
    const walk = (parentId) => {
      for (const p of siblingsByParent(parentId)) {
        out.push(p.id)
        walk(p.id)
      }
    }
    walk(null)
    return out
  }

  // --- Drag to reorder / reparent pages (owner only) ---
  const onPageDragStart = (e, id) => {
    dragId.current = id
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
  }

  // Classify the pointer within a row: top/bottom thirds reorder as a sibling
  // before/after the target; the middle third nests under it.
  const dropZone = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - r.top
    if (y < r.height / 3) return 'before'
    if (y > (r.height * 2) / 3) return 'after'
    return 'inside'
  }

  const onPageDragOver = (e, target) => {
    e.preventDefault()
    const id = dragId.current
    if (!id || id === target.id) return
    setDropTarget({ id: target.id, where: dropZone(e) })
  }

  // Drop onto the top-level zone: move the dragged page to the root (end of list).
  const onDropOnRoot = async () => {
    const id = dragId.current
    dragId.current = null
    setDropTarget(null)
    if (!id) return
    const dragged = pages.find((p) => p.id === id)
    if (!dragged) return
    if (dragged.parent_id) {
      await campaigns.updateWikiPage(campaign.id, id, { parent_id: '' })
    }
    // Reorder to the end of the root list.
    const order = flattenOrder((pid) =>
      orderedSiblings(pid)
        .filter((p) => p.id !== id)
        .concat(pid === null ? [dragged] : [])
    )
    await campaigns.reorderWikiPages(campaign.id, order)
    loadList()
  }

  // Drop onto a page: nest under it (middle) or place as a sibling before/after.
  // No-op if it would create a cycle (the server guards too).
  const onDropOnPage = async (e, target) => {
    e.preventDefault()
    e.stopPropagation()
    const id = dragId.current
    dragId.current = null
    const where = dropTarget?.where || 'inside'
    setDropTarget(null)
    if (!id || id === target.id) return
    if (descendantIds(id, pages).has(target.id)) return
    const dragged = pages.find((p) => p.id === id)
    if (!dragged) return

    if (where === 'inside') {
      if ((dragged.parent_id || null) !== target.id) {
        await campaigns.updateWikiPage(campaign.id, id, { parent_id: target.id })
      }
      loadList()
      return
    }

    // Sibling reorder: adopt the target's parent, then sit just before/after it.
    const newParent = target.parent_id || null
    if ((dragged.parent_id || null) !== newParent) {
      await campaigns.updateWikiPage(campaign.id, id, { parent_id: newParent || '' })
    }
    const movedDragged = { ...dragged, parent_id: newParent }
    const order = flattenOrder((pid) => {
      const sibs = orderedSiblings(pid).filter((p) => p.id !== id)
      if (pid !== newParent) return sibs
      const idx = sibs.findIndex((p) => p.id === target.id)
      const at = where === 'before' ? idx : idx + 1
      return [...sibs.slice(0, at), movedDragged, ...sibs.slice(at)]
    })
    await campaigns.reorderWikiPages(campaign.id, order)
    loadList()
  }

  if (pages === null)
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
        <Spinner size={24} />
      </div>
    )

  const searching = !!query.trim()
  const matches = searching
    ? pages.filter((p) => p.title.toLowerCase().includes(query.trim().toLowerCase()))
    : pages

  // Build the child lookup for the tree. While searching we flatten to the matching
  // rows (a filtered tree would hide parents of matches), so the list stays useful.
  const childrenOf = {}
  for (const p of pages) (childrenOf[p.parent_id || '__root__'] ||= []).push(p)
  const idSet = new Set(pages.map((p) => p.id))
  // A page whose parent_id points nowhere (e.g. its parent was filtered out by
  // visibility) is treated as a root so it never disappears.
  const rootKey = (p) => (p.parent_id && idSet.has(p.parent_id) ? p.parent_id : '__root__')
  const roots = pages.filter((p) => rootKey(p) === '__root__')

  const renderRow = (p, depth, flat = false) => {
    const active = p.id === selectedId && !creating
    const meta = VIS_META[p.visibility] || VIS_META.gm
    const { Icon } = meta
    // In the flat search view, nesting and chevrons are suppressed.
    const kids = flat ? [] : (childrenOf[p.id] || []).filter((c) => idSet.has(c.id))
    const hasKids = kids.length > 0
    const isCollapsed = collapsed.has(p.id)
    const selectPage = () => {
      setCreating(false)
      setSelectedId(p.id)
    }
    // Reordering only applies in the nested tree, not the flattened search view.
    const canDrag = isOwner && !flat
    const indicator = dropTarget?.id === p.id ? dropTarget.where : null
    return (
      <div key={p.id}>
        <div
          draggable={canDrag}
          onDragStart={(e) => onPageDragStart(e, p.id)}
          onDragOver={canDrag ? (e) => onPageDragOver(e, p) : undefined}
          onDragLeave={canDrag ? () => setDropTarget(null) : undefined}
          onDrop={canDrag ? (e) => onDropOnPage(e, p) : undefined}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            width: '100%',
            padding: '7px 10px',
            paddingLeft: 10 + depth * 14,
            background:
              indicator === 'inside' ? 'var(--bg-card)' : active ? 'var(--bg-card)' : 'transparent',
            borderLeft: active ? '1px solid var(--border)' : '1px solid transparent',
            borderRight: active ? '1px solid var(--border)' : '1px solid transparent',
            borderTop:
              indicator === 'before'
                ? '2px solid var(--gold)'
                : active
                  ? '1px solid var(--border)'
                  : '1px solid transparent',
            borderBottom:
              indicator === 'after'
                ? '2px solid var(--gold)'
                : active
                  ? '1px solid var(--border)'
                  : '1px solid transparent',
            borderRadius: 8,
            color: active ? 'var(--text)' : 'var(--text-dim)',
            cursor: canDrag ? 'grab' : 'pointer',
            fontSize: 13,
            boxSizing: 'border-box',
          }}
        >
          {/* Expand/collapse chevron, or a spacer to keep rows aligned. */}
          {hasKids ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                toggleCollapse(p.id)
              }}
              aria-label={t(isCollapsed ? 'wiki.expand' : 'wiki.collapse')}
              style={{
                flexShrink: 0,
                display: 'inline-flex',
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                color: 'var(--text-muted)',
              }}
            >
              {isCollapsed ? <LuChevronRight size={13} /> : <LuChevronDown size={13} />}
            </button>
          ) : (
            <span style={{ flexShrink: 0, width: 13 }} aria-hidden="true" />
          )}
          {/* The icon is its own popover control on editable rows; the wrapper is
              non-draggable and stops propagation so grabbing or clicking the icon
              doesn't start a drag or select the row. */}
          {p.can_edit ? (
            <div
              draggable={false}
              onDragStart={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              style={{ flexShrink: 0, display: 'inline-flex' }}
            >
              <IconPicker
                value={p.icon}
                onChange={(icon) => changeIcon(p.id, icon)}
                fallback={<Icon size={14} aria-hidden="true" />}
                ariaLabel={t('wiki.iconLabel')}
                compact
                color={meta.color}
              />
            </div>
          ) : (
            <CampaignIcon
              name={p.icon}
              fallback={Icon}
              size={12}
              style={{ flexShrink: 0, color: meta.color }}
            />
          )}
          <button
            type="button"
            onClick={selectPage}
            style={{
              flex: 1,
              minWidth: 0,
              textAlign: 'left',
              background: 'transparent',
              border: 'none',
              color: 'inherit',
              cursor: 'pointer',
              font: 'inherit',
              padding: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {p.title}
          </button>
          {isOwner && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                startCreate(p.id)
              }}
              aria-label={t('wiki.addSubpage')}
              title={t('wiki.addSubpage')}
              style={{
                flexShrink: 0,
                display: 'inline-flex',
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                color: 'var(--text-muted)',
              }}
            >
              <LuPlus size={13} />
            </button>
          )}
        </div>
        {hasKids && !isCollapsed && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 2 }}>
            {kids.map((c) => renderRow(c, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
      {/* Page list */}
      <div style={{ flex: '0 0 240px', maxWidth: 240 }}>
        <button
          onClick={() => startCreate('')}
          style={{ ...goldBtn, width: '100%', justifyContent: 'center', marginBottom: 10 }}
        >
          <LuPlus size={14} /> {t('wiki.newPage')}
        </button>

        <div style={{ position: 'relative', marginBottom: 10 }}>
          <LuSearch
            size={13}
            style={{
              position: 'absolute',
              left: 9,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-muted)',
            }}
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('wiki.searchPlaceholder')}
            style={{
              width: '100%',
              padding: '6px 8px 6px 28px',
              background: 'var(--bg-deep)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              color: 'var(--text)',
              fontSize: 13,
              boxSizing: 'border-box',
            }}
          />
        </div>

        {pages.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 4px' }}>
            {t('wiki.noPages')}
          </div>
        ) : (
          <div
            // Dropping in the empty space below the tree moves a page to the root.
            onDragOver={isOwner ? (e) => e.preventDefault() : undefined}
            onDrop={isOwner ? onDropOnRoot : undefined}
            style={{ display: 'flex', flexDirection: 'column', gap: 2, minHeight: 40 }}
          >
            {searching
              ? matches.map((p) => renderRow(p, 0, true))
              : roots.map((p) => renderRow(p, 0))}
          </div>
        )}

        {isOwner && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => exportWiki('md')}
                title={t('wiki.exportMd')}
                style={{ ...dashedBtn, flex: 1 }}
              >
                <LuDownload size={13} /> {t('wiki.export')}
              </button>
              <button
                onClick={() => setImporting(true)}
                title={t('wiki.importTitle')}
                style={{ ...dashedBtn, flex: 1 }}
              >
                <LuUpload size={13} /> {t('wiki.import')}
              </button>
            </div>
            <button onClick={() => exportWiki('json')} style={{ ...dashedBtn, fontSize: 11 }}>
              {t('wiki.exportJson')}
            </button>
          </div>
        )}
      </div>

      {/* Main pane */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {creating ? (
          <PageEditor
            campaign={campaign}
            isOwner={isOwner}
            page={null}
            allPages={pages}
            defaultParentId={createParentId}
            onSaved={handleSaved}
            onCancel={() => setCreating(false)}
          />
        ) : !page ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 14, padding: 20 }}>
            {t('wiki.selectPrompt')}
          </div>
        ) : editing ? (
          <PageEditor
            campaign={campaign}
            isOwner={isOwner}
            page={page}
            allPages={pages}
            onSaved={handleSaved}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: 12,
                marginBottom: 12,
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 6px' }}>
                  {(() => {
                    const visColor = (VIS_META[page.visibility] || VIS_META.gm).color
                    return page.can_edit ? (
                      <IconPicker
                        value={page.icon}
                        onChange={(icon) => changeIcon(page.id, icon)}
                        fallback={<LuFileText size={20} aria-hidden="true" />}
                        ariaLabel={t('wiki.iconLabel')}
                        compact
                        size={20}
                        color={visColor}
                      />
                    ) : (
                      <CampaignIcon
                        name={page.icon}
                        fallback={LuFileText}
                        size={20}
                        style={{ color: visColor }}
                      />
                    )
                  })()}
                  <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{page.title}</h2>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  {page.can_edit ? (
                    <VisibilityEditor
                      campaign={campaign}
                      isOwner={isOwner}
                      page={page}
                      onSetVisibility={changeVisibility}
                      onSetShares={changeShares}
                    />
                  ) : (
                    <VisibilityBadge visibility={page.visibility} />
                  )}
                  {page.created_by_name && (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {t('wiki.byAuthor', { name: page.created_by_name })}
                    </span>
                  )}
                </div>
              </div>
              {page.can_edit && (
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <button onClick={() => setEditing(true)} style={ghostBtn}>
                    <LuPencil size={13} /> {t('common.edit')}
                  </button>
                  <button onClick={handleDelete} style={{ ...ghostBtn, color: 'var(--danger)' }}>
                    <LuTrash2 size={13} />
                  </button>
                </div>
              )}
            </div>

            <div
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: '20px 24px',
              }}
            >
              <WikiMarkdown
                body={page.body}
                campaignId={campaign.id}
                pageSlugs={pages.map((p) => p.slug)}
                onOpenSlug={openSlug}
              />
            </div>

            {page.backlinks?.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div
                  style={{
                    fontSize: 12,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    color: 'var(--text-muted)',
                    fontWeight: 600,
                    marginBottom: 8,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <LuArrowLeft size={13} /> {t('wiki.backlinks')}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {page.backlinks.map((b) => (
                    <button
                      key={b.id}
                      onClick={() => setSelectedId(b.id)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        padding: '5px 10px',
                        background: 'var(--bg-deep)',
                        border: '1px solid var(--border)',
                        borderRadius: 16,
                        color: 'var(--text-dim)',
                        cursor: 'pointer',
                        fontSize: 12,
                      }}
                    >
                      {b.title}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {importing && (
        <WikiImportModal
          campaignId={campaign.id}
          onClose={() => setImporting(false)}
          onImported={() => loadList()}
        />
      )}
    </div>
  )
}

const dashedBtn = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  width: '100%',
  justifyContent: 'center',
  padding: '6px 10px',
  background: 'transparent',
  border: '1px dashed var(--border)',
  borderRadius: 8,
  color: 'var(--text-muted)',
  cursor: 'pointer',
  fontSize: 12,
}
