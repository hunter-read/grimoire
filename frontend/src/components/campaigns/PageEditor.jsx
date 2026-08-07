import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  LuLink2,
  LuBookOpen,
  LuEye,
  LuEyeOff,
  LuFileText,
  LuBold,
  LuItalic,
  LuStrikethrough,
  LuHeading,
  LuList,
  LuQuote,
} from 'react-icons/lu'
import { campaigns } from '../../api'
import WikiMarkdown from './WikiMarkdown'
import GrimoireEmbedPicker from './GrimoireEmbedPicker'
import IconPicker from './IconPicker'
import WikiLinkAutocomplete, { findActiveLinkQuery } from './WikiLinkAutocomplete'
import { buildTitleTrie } from './wikiLinkTarget'
import { caretCoordinates } from './caretPosition'
import {
  descendantIds,
  toolbarControl,
  toolbarGroup,
  iconBtn,
  toolbarBtn,
  toolbarBtnActive,
  paneLabel,
  ghostBtn,
  goldBtn,
} from './wikiShared'

/** Full create/edit form for a wiki page: metadata, markdown toolbar, live preview. */
export default function PageEditor({
  campaign,
  isOwner,
  page,
  allPages,
  defaultParentId,
  onSaved,
  onCancel,
}) {
  const { t } = useTranslation()
  const isNew = !page?.id
  const [title, setTitle] = useState(page?.title ?? '')
  const [body, setBody] = useState(page?.body ?? '')
  const [visibility, setVisibility] = useState(page?.visibility ?? (isOwner ? 'gm' : 'group'))
  const [sharedIds, setSharedIds] = useState(page?.shared_user_ids ?? [])
  const [parentId, setParentId] = useState(page?.parent_id ?? defaultParentId ?? '')
  const [icon, setIcon] = useState(page?.icon ?? '')
  const [iconColor, setIconColor] = useState(page?.icon_color ?? '')

  // Pages eligible as a parent: every page except this one and its descendants.
  const excluded = page?.id ? descendantIds(page.id, allPages) : new Set()
  const parentOptions = allPages
    .filter((p) => !excluded.has(p.id))
    .sort((a, b) => (a.title || '').localeCompare(b.title || ''))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [showEmbedPicker, setShowEmbedPicker] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const bodyRef = useRef(null)

  // --- [[link]] autocomplete (issue #196) ---
  // Titles come from the dedicated endpoint rather than `allPages` because they
  // carry each page's headings and an `ambiguous` flag, which drive heading
  // completions and the `:id-` disambiguator respectively.
  const [linkTargets, setLinkTargets] = useState([])
  const [suggest, setSuggest] = useState(null) // { query, start, end, top, left }
  const [suggestIndex, setSuggestIndex] = useState(0)

  useEffect(() => {
    let cancelled = false
    // A failed (or unavailable) lookup just means no completions — the editor
    // stays fully usable, so this never surfaces an error to the user.
    Promise.resolve()
      .then(() => campaigns.wikiTitles?.(campaign.id))
      .then((list) => {
        if (!cancelled) setLinkTargets(list || [])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [campaign.id])

  // Trie over titles + headings, rebuilt only when the page set changes; lookup
  // then costs what the user typed rather than what the campaign holds.
  const linkTrie = useMemo(() => buildTitleTrie(linkTargets), [linkTargets])
  const suggestMatches = useMemo(
    () => (suggest ? linkTrie.search(suggest.query, 8) : []),
    [linkTrie, suggest]
  )

  const closeSuggest = useCallback(() => setSuggest(null), [])

  // Re-evaluate whether the caret sits inside an open "[[" after any edit or
  // cursor move, and position the dropdown under it.
  const refreshSuggest = useCallback((ta) => {
    if (!ta) return
    const active = findActiveLinkQuery(ta.value, ta.selectionStart ?? 0)
    if (!active) {
      setSuggest(null)
      return
    }
    const coords = caretCoordinates(ta, active.start)
    setSuggest({
      ...active,
      // Without real layout (jsdom, or a browser that can't measure), fall back
      // to a spot just under the field rather than pinning the popup at 0,0.
      top: coords ? coords.top : 24,
      left: coords ? coords.left : 8,
    })
    setSuggestIndex(0)
  }, [])

  // Replace the "[[query" span with the chosen target and close the link.
  const acceptSuggestion = useCallback(
    (match) => {
      if (!suggest) return
      const ta = bodyRef.current
      // Reuse a "]]" that's already sitting at the caret rather than adding a
      // second one — the Link page button inserts an empty "[[]]" pair, and
      // editing inside an existing link leaves its closer in place.
      const rest = body.slice(suggest.end)
      const closed = rest.startsWith(']]')
      const insert = `[[${match.target}]]`
      const next = body.slice(0, suggest.start) + insert + (closed ? rest.slice(2) : rest)
      setBody(next)
      setSuggest(null)
      const pos = suggest.start + insert.length
      requestAnimationFrame(() => {
        ta?.focus()
        ta?.setSelectionRange(pos, pos)
      })
    },
    [body, suggest]
  )

  // Arrow/Enter/Tab drive the dropdown while it's open; Escape dismisses it.
  // Everything else falls through to normal typing.
  const onBodyKeyDown = useCallback(
    (e) => {
      if (!suggest || !suggestMatches.length) return
      if (e.key === 'Escape') {
        e.preventDefault()
        closeSuggest()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSuggestIndex((i) => (i + 1) % suggestMatches.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSuggestIndex((i) => (i - 1 + suggestMatches.length) % suggestMatches.length)
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        acceptSuggestion(suggestMatches[suggestIndex] || suggestMatches[0])
      }
    },
    [suggest, suggestMatches, suggestIndex, acceptSuggestion, closeSuggest]
  )

  const members = (campaign.members || []).filter((m) => !m.is_owner)

  const insertAtCursor = useCallback(
    (text) => {
      const ta = bodyRef.current
      if (!ta) {
        setBody((b) => b + text)
        return
      }
      const start = ta.selectionStart ?? body.length
      const end = ta.selectionEnd ?? body.length
      setBody((b) => b.slice(0, start) + text + b.slice(end))
      requestAnimationFrame(() => {
        ta.focus()
        const pos = start + text.length
        ta.setSelectionRange(pos, pos)
      })
    },
    [body.length]
  )

  // Wrap the current selection in before/after markers (or insert the empty pair
  // and drop the cursor between them when nothing is selected).
  const wrapSelection = useCallback(
    (before, after) => {
      const ta = bodyRef.current
      if (!ta) {
        setBody((b) => b + before + after)
        return
      }
      const start = ta.selectionStart ?? body.length
      const end = ta.selectionEnd ?? body.length
      const selected = body.slice(start, end)
      setBody((b) => b.slice(0, start) + before + selected + after + b.slice(end))
      requestAnimationFrame(() => {
        ta.focus()
        const pos = start + before.length + selected.length
        ta.setSelectionRange(pos, pos)
      })
    },
    [body]
  )

  // Prefix each line touched by the selection with `marker` (e.g. "# ", "- ",
  // "> "). With nothing selected the current line is prefixed. Toggling off when
  // every touched line already has the marker keeps the buttons idempotent.
  const prefixLines = useCallback(
    (marker) => {
      const ta = bodyRef.current
      const start = ta?.selectionStart ?? body.length
      const end = ta?.selectionEnd ?? body.length
      const lineStart = body.lastIndexOf('\n', start - 1) + 1
      let lineEnd = body.indexOf('\n', end)
      if (lineEnd === -1) lineEnd = body.length
      const block = body.slice(lineStart, lineEnd)
      const lines = block.split('\n')
      const allMarked = lines.every((l) => l.startsWith(marker))
      const next = lines.map((l) => (allMarked ? l.slice(marker.length) : marker + l)).join('\n')
      setBody((b) => b.slice(0, lineStart) + next + b.slice(lineEnd))
      requestAnimationFrame(() => {
        ta?.focus()
        ta?.setSelectionRange(lineStart, lineStart + next.length)
      })
    },
    [body]
  )

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const payload = {
        title: title.trim() || t('wiki.untitled'),
        body,
        visibility,
        shared_user_ids: visibility === 'members' ? sharedIds : [],
        parent_id: parentId || '',
        icon: icon || '',
        icon_color: iconColor || '',
      }
      const result = isNew
        ? await campaigns.createWikiPage(campaign.id, payload)
        : await campaigns.updateWikiPage(campaign.id, page.id, payload)
      onSaved(result)
    } catch (e) {
      setError(e.message)
      setSaving(false)
    }
  }

  const toggleShared = (userId) =>
    setSharedIds((ids) =>
      ids.includes(userId) ? ids.filter((i) => i !== userId) : [...ids, userId]
    )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
        <IconPicker
          value={icon}
          onChange={setIcon}
          color={iconColor}
          onColorChange={setIconColor}
          fallback={<LuFileText size={16} aria-hidden="true" />}
          ariaLabel={t('wiki.iconLabel')}
        />
        <input
          aria-label={t('wiki.titleLabel')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('wiki.titlePlaceholder')}
          autoFocus
          style={{
            flex: 1,
            fontSize: 20,
            fontWeight: 700,
            background: 'var(--bg-deep)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            color: 'var(--text)',
            padding: '8px 12px',
            minWidth: 0,
          }}
        />
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          value={visibility}
          onChange={(e) => setVisibility(e.target.value)}
          disabled={!isOwner}
          aria-label={t('wiki.visibilityLabel')}
          style={toolbarControl}
        >
          {isOwner && <option value="gm">{t('wiki.vis_gm')}</option>}
          <option value="group">{t('wiki.vis_group')}</option>
          {isOwner && <option value="members">{t('wiki.vis_members')}</option>}
        </select>

        <select
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
          aria-label={t('wiki.parentLabel')}
          style={toolbarControl}
        >
          <option value="">{t('wiki.noParent')}</option>
          {parentOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>

        <span style={toolbarGroup}>
          <button
            type="button"
            onClick={() => wrapSelection('**', '**')}
            title={t('wiki.bold')}
            aria-label={t('wiki.bold')}
            style={iconBtn}
          >
            <LuBold size={14} />
          </button>
          <button
            type="button"
            onClick={() => wrapSelection('_', '_')}
            title={t('wiki.italic')}
            aria-label={t('wiki.italic')}
            style={iconBtn}
          >
            <LuItalic size={14} />
          </button>
          <button
            type="button"
            onClick={() => wrapSelection('~~', '~~')}
            title={t('wiki.strikethrough')}
            aria-label={t('wiki.strikethrough')}
            style={iconBtn}
          >
            <LuStrikethrough size={14} />
          </button>
          <button
            type="button"
            onClick={() => prefixLines('## ')}
            title={t('wiki.heading')}
            aria-label={t('wiki.heading')}
            style={iconBtn}
          >
            <LuHeading size={14} />
          </button>
          <button
            type="button"
            onClick={() => prefixLines('- ')}
            title={t('wiki.bulletList')}
            aria-label={t('wiki.bulletList')}
            style={iconBtn}
          >
            <LuList size={14} />
          </button>
          <button
            type="button"
            onClick={() => prefixLines('> ')}
            title={t('wiki.quote')}
            aria-label={t('wiki.quote')}
            style={iconBtn}
          >
            <LuQuote size={14} />
          </button>
        </span>

        {/* Drops the caret between the brackets, which opens the completion
            dropdown on the empty query — so the button now browses pages too. */}
        <button
          type="button"
          onClick={() => {
            insertAtCursor('[[]]')
            const ta = bodyRef.current
            requestAnimationFrame(() => {
              if (!ta) return
              const pos = (ta.selectionStart ?? 0) - 2
              ta.setSelectionRange(pos, pos)
              refreshSuggest(ta)
            })
          }}
          style={toolbarBtn}
        >
          <LuLink2 size={13} /> {t('wiki.insertLink')}
        </button>
        <button type="button" onClick={() => setShowEmbedPicker(true)} style={toolbarBtn}>
          <LuBookOpen size={13} /> {t('wiki.insertEmbed')}
        </button>
        {isOwner && (
          <button
            type="button"
            onClick={() => wrapSelection('||', '||')}
            title={t('wiki.insertSecretHint')}
            style={toolbarBtn}
          >
            <LuEyeOff size={13} /> {t('wiki.insertSecret')}
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowPreview((v) => !v)}
          aria-pressed={showPreview}
          style={showPreview ? { ...toolbarBtn, ...toolbarBtnActive } : toolbarBtn}
        >
          <LuEye size={13} /> {t('wiki.preview')}
        </button>
      </div>

      {/* Members share picker */}
      {isOwner && visibility === 'members' && (
        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '10px 12px',
            background: 'var(--bg-deep)',
          }}
        >
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
            {t('wiki.shareWith')}
          </div>
          {members.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('wiki.noMembers')}</div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {members.map((m) => (
                <label
                  key={m.user_id}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={sharedIds.includes(m.user_id)}
                    onChange={() => toggleShared(m.user_id)}
                  />
                  {m.character_name || m.display_name || m.username}
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Editor + live preview */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 360px', minWidth: 280, position: 'relative' }}>
          <div style={paneLabel}>{t('wiki.markdown')}</div>
          <textarea
            ref={bodyRef}
            value={body}
            onChange={(e) => {
              setBody(e.target.value)
              refreshSuggest(e.target)
            }}
            onKeyDown={onBodyKeyDown}
            // Cursor moves (clicks, arrows) can leave or enter a "[[", so
            // re-evaluate after the selection has settled.
            onSelect={(e) => refreshSuggest(e.target)}
            onBlur={closeSuggest}
            placeholder={t('wiki.bodyPlaceholder')}
            rows={20}
            aria-label={t('wiki.markdown')}
            aria-autocomplete="list"
            aria-expanded={!!suggest && suggestMatches.length > 0}
            style={{
              width: '100%',
              padding: '12px 14px',
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              color: 'var(--text)',
              fontSize: 14,
              lineHeight: 1.6,
              resize: 'vertical',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              boxSizing: 'border-box',
            }}
          />
          {suggest && (
            <WikiLinkAutocomplete
              matches={suggestMatches}
              position={{ top: suggest.top, left: suggest.left }}
              activeIndex={suggestIndex}
              onActiveIndexChange={setSuggestIndex}
              onAccept={acceptSuggestion}
            />
          )}
        </div>
        {showPreview && (
          <div style={{ flex: '1 1 360px', minWidth: 280 }}>
            <div style={paneLabel}>
              <LuEye size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              {t('wiki.preview')}
            </div>
            <div
              style={{
                padding: '12px 14px',
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                minHeight: 200,
              }}
            >
              <WikiMarkdown
                body={body}
                campaignId={campaign.id}
                pages={allPages}
                currentPageId={page?.id ?? null}
              />
            </div>
          </div>
        )}
      </div>

      {error && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} style={ghostBtn}>
          {t('common.cancel')}
        </button>
        <button type="button" onClick={save} disabled={saving} style={goldBtn}>
          {saving ? t('wiki.saving') : t('common.save')}
        </button>
      </div>

      {showEmbedPicker && (
        <GrimoireEmbedPicker
          campaignId={campaign.id}
          onInsert={(token) => {
            insertAtCursor(token)
            setShowEmbedPicker(false)
          }}
          onClose={() => setShowEmbedPicker(false)}
        />
      )}
    </div>
  )
}
