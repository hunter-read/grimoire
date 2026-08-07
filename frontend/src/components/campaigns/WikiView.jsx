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
  LuListMusic,
} from 'react-icons/lu'
import { campaigns } from '../../api'
import { useAudioPlayer } from '../../context/AudioPlayerContext'
import useIsMobile from '../../hooks/useIsMobile'
import Spinner from '../Spinner'
import WikiMarkdown from './WikiMarkdown'
import WikiImportModal from './WikiImportModal'
import IconPicker from './IconPicker'
import { CampaignIcon } from './campaignIcons'
import { resolveIconColor } from './iconColors'
import VisibilityBadge from './VisibilityBadge'
import VisibilityEditor from './VisibilityEditor'
import RowVisibilityControl from './RowVisibilityControl'
import PageEditor from './PageEditor'
import useFillViewport from './useFillViewport'
import useResizableWidth from './useResizableWidth'
import { headingDomId } from './wikiHeadings'
import { descendantIds, ghostBtn, goldBtn } from './wikiShared'

// Ordered list of [[audio:ID]] embed ids in a note body, used for "play all".
const AUDIO_EMBED_RE = /\[\[audio:([^\]|]+?)(?:\|[^\]]+)?\]\]/g
function extractAudioEmbedIds(body) {
  if (!body) return []
  return Array.from(body.matchAll(AUDIO_EMBED_RE), (m) => m[1].trim()).filter(Boolean)
}

export default function WikiView({ campaign, isOwner, onViewingNoteChange }) {
  const { t } = useTranslation()
  const { playQueue } = useAudioPlayer()
  const isMobile = useIsMobile()
  const [pages, setPages] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [page, setPage] = useState(null)
  const [editing, setEditing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createParentId, setCreateParentId] = useState('')
  const [query, setQuery] = useState('')
  const [importing, setImporting] = useState(false)
  // Heading a [[Page:#Heading]] link asked for, pending the target page loading.
  const [pendingHeading, setPendingHeading] = useState(null)
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
  // Size the two-pane row to the viewport so the page tree scrolls in its own
  // container instead of riding the window scroll with the note (#288). On
  // phones the tree and the note swap full-screen, so the page flow is left
  // alone — there the list is the whole screen and scrolls on its own already.
  // While the editor is open it does its own viewport fill (#298) and needs the
  // natural flow around it, so the row steps back and lets it size itself.
  const rowRef = useRef(null)
  const fillHeight = useFillViewport(rowRef, {
    enabled: !isMobile && !editing && !creating,
    // The row replaces a loading spinner, so there's nothing to measure until
    // the page list has arrived.
    ready: pages !== null,
    min: 320,
  })
  // Sidebar width, dragged from the divider between the panes and remembered
  // for the session. Per campaign, so a wiki with deep page trees can keep a
  // wider list than one with short titles.
  const {
    width: sidebarWidth,
    dragging: resizing,
    handleProps: resizeHandleProps,
  } = useResizableWidth(`grimoire_wiki_sidebar_w_${campaign.id}`, { initial: 240 })
  // Live drop indicator: { id, where: 'before' | 'after' | 'inside' }.
  const [dropTarget, setDropTarget] = useState(null)
  // Id of the tree row under the cursor — drives the hover-only row controls
  // (add-subpage, and the visibility glyph on fully-visible pages).
  const [hoveredRow, setHoveredRow] = useState(null)

  // Importing writes pages into the campaign, so it needs manage rights and a
  // campaign that isn't frozen. Exporting only reads and stays available to all.
  const canImport = isOwner && !campaign.is_archived

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

  // Kept identity-stable (the current selection is read through the state
  // updater rather than closed over) because it feeds `openPage`, which reaches
  // the memoized ReactMarkdown component map in WikiMarkdown — see the note
  // there. `isMobile` is read via a ref for the same reason.
  const isMobileRef = useRef(isMobile)
  isMobileRef.current = isMobile
  const loadList = useCallback(
    (selectId) => {
      campaigns.listWikiPages(campaign.id).then((list) => {
        setPages(list)
        setSelectedId((current) => {
          if (selectId) return selectId
          // Desktop auto-opens the first page so the pane isn't empty. On mobile the
          // tree and note swap full-screen, so auto-opening would drop the user into
          // a note instead of the page list — land them on the list instead.
          if (list.length && !current && !isMobileRef.current) return list[0].id
          return current
        })
      })
    },
    [campaign.id]
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

  // Tell the parent when the note pane is shown full-screen on mobile, so it can
  // hide its own header (campaign title / back-to-overview) and give the note the
  // whole screen. Only meaningful on mobile; desktop shows both panes.
  const viewingNoteOnMobile = isMobile && (creating || editing || !!page)
  useEffect(() => {
    onViewingNoteChange?.(viewingNoteOnMobile)
  }, [viewingNoteOnMobile, onViewingNoteChange])

  // Follow a [[link]]. WikiMarkdown has already resolved the target page (by id
  // when the link is pinned, else by title); a null target means it isn't visible
  // to this user or doesn't exist yet, so we refresh in case the list is stale.
  // `heading` is the link's :#Heading suffix — held until the target page's body
  // has rendered, then scrolled to by the effect below.
  //
  // Memoized because it reaches WikiMarkdown, where it feeds the memoized
  // ReactMarkdown component map. A new identity here rebuilds that map, which
  // remounts every embed in the note — resetting the book title an EmbedCard
  // has fetched back to the generic label. Any parent re-render (hovering a
  // sidebar row) would otherwise make the titles flicker.
  const openPage = useCallback(
    (target, heading) => {
      if (!target) {
        loadList()
        return
      }
      setPendingHeading(heading || null)
      setSelectedId(target.id)
    },
    [loadList]
  )

  // Scroll to the heading a cross-page [[Page:#Heading]] link asked for, once the
  // destination body is on screen. Cleared after one attempt so it doesn't fire
  // again on an unrelated re-render.
  useEffect(() => {
    if (!pendingHeading || !page) return
    const id = headingDomId(pendingHeading)
    // Wait a frame so ReactMarkdown has committed the heading elements.
    const raf = requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
      setPendingHeading(null)
    })
    return () => cancelAnimationFrame(raf)
  }, [pendingHeading, page])

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

  // Quick icon/tint change without entering the full editor. Updates the list
  // (and the open page, if it's the one changed) so the change shows immediately.
  const patchPage = async (pageId, patch) => {
    await campaigns.updateWikiPage(campaign.id, pageId, patch)
    loadList(selectedId)
    if (page?.id === pageId) setPage((p) => (p ? { ...p, ...patch } : p))
  }
  const changeIcon = (pageId, icon) => patchPage(pageId, { icon: icon || '' })
  const changeIconColor = (pageId, iconColor) => patchPage(pageId, { icon_color: iconColor || '' })

  // Change a page's visibility from its row glyph or the header badge. Switching
  // away from "members" clears the share list to mirror PageEditor's save
  // behaviour.
  const changePageVisibility = async (pageId, visibility) => {
    const payload = { visibility }
    if (visibility !== 'members') payload.shared_user_ids = []
    await campaigns.updateWikiPage(campaign.id, pageId, payload)
    if (page?.id === pageId) {
      setPage((p) =>
        p
          ? { ...p, visibility, shared_user_ids: visibility === 'members' ? p.shared_user_ids : [] }
          : p
      )
    }
    loadList(selectedId)
  }
  const changeVisibility = (visibility) =>
    page ? changePageVisibility(page.id, visibility) : undefined

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
    const hovered = hoveredRow === p.id
    // Restricted pages read slightly dimmer than fully-visible ones, so limited
    // access is legible without relying on the icon's colour.
    const restricted = p.visibility !== 'group'
    return (
      <div key={p.id}>
        <div
          draggable={canDrag}
          onDragStart={(e) => onPageDragStart(e, p.id)}
          onDragOver={canDrag ? (e) => onPageDragOver(e, p) : undefined}
          onDragLeave={canDrag ? () => setDropTarget(null) : undefined}
          onDrop={canDrag ? (e) => onDropOnPage(e, p) : undefined}
          onMouseEnter={() => setHoveredRow(p.id)}
          onMouseLeave={() => setHoveredRow((id) => (id === p.id ? null : id))}
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
                color={p.icon_color}
                onColorChange={(c) => changeIconColor(p.id, c)}
                fallback={<LuFileText size={14} aria-hidden="true" />}
                ariaLabel={t('wiki.iconLabel')}
                compact
              />
            </div>
          ) : (
            <CampaignIcon
              name={p.icon}
              fallback={LuFileText}
              size={12}
              style={{ flexShrink: 0, color: resolveIconColor(p.icon_color) }}
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
              opacity: restricted && !active ? 0.72 : 1,
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
              onFocus={() => setHoveredRow(p.id)}
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
                // Hover-only, to keep the resting list uncluttered. Kept in the
                // layout (not unmounted) so rows don't reflow on hover.
                opacity: hovered ? 1 : 0,
                transition: 'opacity 120ms ease',
              }}
            >
              <LuPlus size={13} />
            </button>
          )}
          {/* Visibility lives at the far right of the row. */}
          <RowVisibilityControl
            visibility={p.visibility}
            canEdit={p.can_edit}
            isOwner={isOwner}
            rowHovered={hovered}
            onSetVisibility={(v) => changePageVisibility(p.id, v)}
          />
        </div>
        {hasKids && !isCollapsed && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 2 }}>
            {kids.map((c) => renderRow(c, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  // On phones the tree and note can't share a row (the note ends up ~50px wide),
  // so we swap between them full-screen: show the tree until a page is opened
  // (or a create/edit starts), then show only the note with a "Pages" button
  // back to the list. On desktop both panes render side by side as before.
  const showMainOnMobile = creating || editing || !!page
  const showList = !isMobile || !showMainOnMobile
  const showMain = !isMobile || showMainOnMobile
  const backToList = () => {
    setCreating(false)
    setEditing(false)
    setSelectedId(null)
    setPage(null)
  }

  return (
    <div
      ref={rowRef}
      style={{
        display: 'flex',
        // The divider carries its own spacing, so the row gap closes up on
        // desktop and the drag target sits between the panes.
        gap: isMobile ? 20 : 0,
        alignItems: 'flex-start',
        // While dragging, keep the pointer's cursor and stop the drag from
        // selecting the page titles it sweeps across.
        cursor: resizing ? 'col-resize' : undefined,
        userSelect: resizing ? 'none' : undefined,
        // Filling the viewport is what lets each pane own its scroll: neither
        // the tree nor the note can move the window, so they stop dragging each
        // other around. Falls back to the original page flow when there isn't
        // room (short window, mobile).
        height: fillHeight ?? undefined,
        minHeight: 0,
      }}
    >
      {/* Page list. New Page and search stay pinned at the top, the tree scrolls
          in the middle, and import/export sit at the bottom of the column. */}
      <div
        style={{
          flex: isMobile ? '1 1 auto' : `0 0 ${sidebarWidth}px`,
          maxWidth: isMobile ? '100%' : sidebarWidth,
          width: isMobile ? '100%' : undefined,
          display: showList ? 'flex' : 'none',
          flexDirection: 'column',
          height: fillHeight ? '100%' : undefined,
          minHeight: 0,
        }}
      >
        <button
          onClick={() => startCreate('')}
          style={{
            ...goldBtn,
            width: '100%',
            justifyContent: 'center',
            marginBottom: 10,
            flexShrink: 0,
          }}
        >
          <LuPlus size={14} /> {t('wiki.newPage')}
        </button>

        <div style={{ position: 'relative', marginBottom: 10, flexShrink: 0 }}>
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

        {/* The scrolling region. It owns the leftover height, so a long tree
            scrolls here rather than moving the note — and the scroll position
            survives selecting a different page, since this element stays
            mounted across the re-render. */}
        <div
          data-testid="wiki-page-tree"
          style={{
            flex: fillHeight ? '1 1 auto' : undefined,
            minHeight: 0,
            overflowY: fillHeight ? 'auto' : undefined,
            // Room for the row hover controls so they aren't clipped by the
            // scroll container's edge.
            paddingRight: fillHeight ? 2 : undefined,
          }}
        >
          {pages.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 4px' }}>
              {t('wiki.noPages')}
            </div>
          ) : (
            <div
              // Dropping in the empty space below the tree moves a page to the root.
              onDragOver={isOwner ? (e) => e.preventDefault() : undefined}
              onDrop={isOwner ? onDropOnRoot : undefined}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                // Fill the scroll area so the drop-to-root zone covers the empty
                // space under a short tree, as it did in the page-flow layout.
                minHeight: fillHeight ? '100%' : 40,
              }}
            >
              {searching
                ? matches.map((p) => renderRow(p, 0, true))
                : roots.map((p) => renderRow(p, 0))}
            </div>
          )}
        </div>

        {/* Export is open to every member — a player can take their own copy of
            the campaign with them, including from an archived one. Import writes,
            so it stays owner-only and disappears once the campaign is archived. */}
        <div
          style={{
            marginTop: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => exportWiki('md')}
              title={t('wiki.exportMd')}
              style={{ ...dashedBtn, flex: 1 }}
            >
              <LuDownload size={13} /> {t('wiki.export')}
            </button>
            {canImport && (
              <button
                onClick={() => setImporting(true)}
                title={t('wiki.importTitle')}
                style={{ ...dashedBtn, flex: 1 }}
              >
                <LuUpload size={13} /> {t('wiki.import')}
              </button>
            )}
          </div>
          <button onClick={() => exportWiki('json')} style={{ ...dashedBtn, fontSize: 11 }}>
            {t('wiki.exportJson')}
          </button>
        </div>
      </div>

      {/* Drag handle between the panes. Desktop only — on mobile the panes swap
          full-screen, so there's no divider to grab. The hit area is wider than
          the visible line so it's easy to catch with the mouse. */}
      {!isMobile && showList && showMain && (
        <div
          {...resizeHandleProps}
          aria-label={t('wiki.resizeSidebar')}
          title={t('wiki.resizeSidebar')}
          style={{
            flex: '0 0 auto',
            alignSelf: 'stretch',
            width: 9,
            margin: '0 5px',
            cursor: 'col-resize',
            background: 'transparent',
            border: 'none',
            padding: 0,
            display: 'flex',
            justifyContent: 'center',
            touchAction: 'none',
          }}
        >
          {/* The line itself: a hairline at rest, brightening while dragged or
              hovered so the divider reads as grabbable. */}
          <div
            style={{
              width: resizing ? 2 : 1,
              height: '100%',
              borderRadius: 1,
              background: resizing ? 'var(--gold)' : 'var(--border)',
              transition: 'background 120ms ease',
            }}
          />
        </div>
      )}

      {/* Main pane. Scrolls inside itself when the row is viewport-sized, so a
          long note stays clear of the page tree next to it. */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: showMain ? 'block' : 'none',
          height: fillHeight ? '100%' : undefined,
          minHeight: 0,
          overflowY: fillHeight ? 'auto' : undefined,
        }}
      >
        {/* In the note-reading view the "Pages" button shares the title's action
            row (below); here it only fronts the create/edit editors. */}
        {isMobile && (creating || editing) && (
          <button onClick={backToList} style={mobileBackBtn}>
            <LuArrowLeft size={14} /> {t('wiki.backToPages')}
          </button>
        )}
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
            {(() => {
              const audioIds = extractAudioEmbedIds(page.body)
              const hasActions = page.can_edit || audioIds.length > 0
              const actionButtons = hasActions && (
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  {audioIds.length > 0 && (
                    <button
                      onClick={() => playQueue(audioIds.map((id) => ({ id })))}
                      style={ghostBtn}
                      title={t('audio.playAll')}
                    >
                      <LuListMusic size={13} /> {t('audio.playAll')}
                    </button>
                  )}
                  {page.can_edit && (
                    <>
                      <button onClick={() => setEditing(true)} style={ghostBtn}>
                        <LuPencil size={13} /> {t('common.edit')}
                      </button>
                      <button
                        onClick={handleDelete}
                        style={{ ...ghostBtn, color: 'var(--danger)' }}
                      >
                        <LuTrash2 size={13} />
                      </button>
                    </>
                  )}
                </div>
              )
              const titleBlock = (
                <div>
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 6px' }}
                  >
                    {page.can_edit ? (
                      <IconPicker
                        value={page.icon}
                        onChange={(icon) => changeIcon(page.id, icon)}
                        color={page.icon_color}
                        onColorChange={(c) => changeIconColor(page.id, c)}
                        fallback={<LuFileText size={20} aria-hidden="true" />}
                        ariaLabel={t('wiki.iconLabel')}
                        compact
                        size={20}
                      />
                    ) : (
                      <CampaignIcon
                        name={page.icon}
                        fallback={LuFileText}
                        size={20}
                        style={{ color: resolveIconColor(page.icon_color) }}
                      />
                    )}
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
              )

              // Mobile: a single toolbar row (← Pages | actions) above the title,
              // so the title gets the full width on the line below.
              if (isMobile) {
                return (
                  <>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        marginBottom: 12,
                      }}
                    >
                      <button onClick={backToList} style={mobileBackBtn}>
                        <LuArrowLeft size={14} /> {t('wiki.backToPages')}
                      </button>
                      {actionButtons}
                    </div>
                    <div style={{ marginBottom: 12 }}>{titleBlock}</div>
                  </>
                )
              }

              // Desktop: title block on the left, actions on the right.
              return (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 12,
                    marginBottom: 12,
                  }}
                >
                  {titleBlock}
                  {actionButtons}
                </div>
              )
            })()}

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
                pages={pages}
                currentPageId={page.id}
                onOpenPage={openPage}
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

const mobileBackBtn = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  flexShrink: 0,
  padding: '7px 12px',
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--text-dim)',
  cursor: 'pointer',
  fontSize: 13,
}
