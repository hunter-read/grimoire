import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  LuArrowLeft,
  LuChevronLeft,
  LuChevronRight,
  LuCombine,
  LuKeyboard,
  LuLayers,
  LuX,
} from 'react-icons/lu'

import { duplicates as dupesApi, type DuplicateType, type Schema } from '../api'
import { useAuth } from '../context/AuthContext'
import Spinner from '../components/Spinner'
import { kindsFor } from '../constants/variantKinds'
import PageFlipper from '../components/duplicates/PageFlipper'
import DiffTable from '../components/duplicates/DiffTable'
import MetadataCopyPanel from '../components/duplicates/MetadataCopyPanel'
import VariantFamilyNotice from '../components/duplicates/VariantFamilyNotice'
import MergeSummary, { type MergeResult } from '../components/duplicates/MergeSummary'
import ReviewColumn from '../components/duplicates/ReviewColumn'
import ShortcutHelp from '../components/duplicates/ShortcutHelp'
import useReviewQueue from '../hooks/useReviewQueue'
import { pickKeeper, type DuplicateGroup, type MatchStrength } from '../utils/duplicateGroups'

type CompareResult = Schema<'CompareResult'>
type CompareItem = Schema<'CompareItem'>

// The compare endpoint's cap. A larger group shows the keeper beside the other
// copies a few at a time.
const MAX_COLUMNS = 4

const isTextEntry = (el: Element | null) => {
  if (!el) return false
  const html = el as HTMLElement
  if (html.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true
  return el.tagName === 'INPUT' && !['radio', 'checkbox'].includes((el as HTMLInputElement).type)
}

/**
 * The duplicate review queue (issue #589): every copy in a group side by side,
 * and one decision that settles the whole group.
 *
 * Opened on a group from the list (`?group=`), it walks the list in place:
 * merging, linking or dismissing moves straight on to the next group, with a
 * counter and Back/Skip, rather than returning to the list after each one.
 * Everything is reachable from the keyboard - pick the keeper with 1-4, then
 * M, L or D - so a run of obvious duplicates is a couple of keys apiece.
 *
 * Merging is the default answer because it loses nothing: what pointed at the
 * other copies moves to the keeper. Its dry run is always on screen, so what M
 * will do is visible before it is pressed. A member that does not belong can be
 * left out with its checkbox; transitive grouping can pull in a lookalike.
 *
 * Opened with `?ids=` (or the older `?left=&right=`) it compares just those
 * copies, outside the queue, and returns to the list afterwards.
 */
export default function DuplicateCompareView() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const isAdmin = useAuth()?.user?.role === 'admin'
  const { resourceType = 'book' } = useParams() as { resourceType?: DuplicateType }
  const [params] = useSearchParams()
  const groupId = params.get('group')
  const filterType = params.get('type') || ''
  const filterMatch = (params.get('match') || '') as MatchStrength | ''
  const queue = useReviewQueue(isAdmin ? groupId : null, { type: filterType, match: filterMatch })

  const adHoc =
    params.get('ids') || [params.get('left'), params.get('right')].filter(Boolean).join(',')
  const groupMembers = queue.group?.members
  const memberIds = useMemo(
    () => (groupId ? (groupMembers || []).map((m) => m.id) : adHoc.split(',').filter(Boolean)),
    [groupId, groupMembers, adHoc]
  )
  const memberKey = memberIds.join(',')

  const [keeper, setKeeper] = useState('')
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set())
  const [memberPage, setMemberPage] = useState(0)
  const [page, setPage] = useState(1)
  const [kinds, setKinds] = useState<Record<string, { kind: string; label: string }>>({})
  // null until the user picks one: until then it follows the keeper.
  const [parentKind, setParentKind] = useState<string | null>(null)
  const [deleteFiles, setDeleteFiles] = useState(false)
  const [sourceId, setSourceId] = useState('')
  const [data, setData] = useState<CompareResult | null>(null)
  const [report, setReport] = useState<MergeResult | null>(null)
  const [reportLoading, setReportLoading] = useState(false)
  // Bumped after a metadata copy, so the dry run reflects the new values.
  const [version, setVersion] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showHelp, setShowHelp] = useState(false)
  const [finished, setFinished] = useState(false)

  // A new set of copies starts every decision afresh.
  useEffect(() => {
    setKeeper(groupId ? pickKeeper(queue.group)?.id || '' : '')
    setExcluded(new Set())
    setMemberPage(0)
    setPage(1)
    setKinds({})
    setParentKind(null)
    setSourceId('')
    setReport(null)
    setError(null)
    setFinished(false)
    // Keyed on the members alone: the group object is rebuilt on every load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberKey])

  const validKeeper = memberIds.includes(keeper) ? keeper : ''
  const others = memberIds.filter((id) => id !== validKeeper)
  const included = others.filter((id) => !excluded.has(id))
  const perPage = MAX_COLUMNS - 1
  const paged = memberIds.length > MAX_COLUMNS
  const pageCount = paged ? Math.ceil(others.length / perPage) : 1
  const visibleIds = useMemo(() => {
    if (!paged || !validKeeper) return memberIds.slice(0, MAX_COLUMNS)
    const start = Math.min(memberPage, pageCount - 1) * perPage
    return [validKeeper, ...others.slice(start, start + perPage)]
    // `others` follows from the members and the keeper.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberKey, validKeeper, paged, memberPage, pageCount])
  const visibleKey = visibleIds.join(',')

  useEffect(() => {
    if (!isAdmin || visibleIds.length < 2) {
      setLoading(false)
      return undefined
    }
    let cancelled = false
    setLoading(true)
    dupesApi
      .compare(resourceType, visibleIds)
      .then((res) => {
        if (cancelled) return
        setData(res)
        // Outside the queue there is no group ranking: the comparison's own
        // advisory pick seeds the keeper.
        setKeeper((k) => k || res.suggested_parent_id || visibleIds[0])
        setError(null)
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message || t('maintenance.dupes.loadFailed'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // `t` is excluded: a language switch is no reason to refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, resourceType, visibleKey])

  const includedKey = included.join(',')
  useEffect(() => {
    if (!isAdmin || !validKeeper || included.length === 0) {
      setReport(null)
      return undefined
    }
    let cancelled = false
    setReportLoading(true)
    dupesApi
      .merge({
        resource_type: resourceType,
        keep_id: validKeeper,
        merge_ids: included,
        delete_files: deleteFiles,
        dry_run: true,
      })
      .then((res) => {
        if (!cancelled) setReport(res)
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message || t('maintenance.dupes.actionFailed'))
      })
      .finally(() => {
        if (!cancelled) setReportLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, resourceType, validKeeper, includedKey, deleteFiles, version])

  const itemFor = (id: string): CompareItem | undefined => data?.items.find((i) => i.id === id)
  const memberFor = (id: string) => groupMembers?.find((m) => m.id === id)

  // A copy's kind and label: what the user typed, else the scan's reading of
  // its filename against the others.
  const kindFor = (id: string) => {
    const chosen = kinds[id]
    if (chosen) return chosen
    const hint = memberFor(id) ?? itemFor(id)
    const options = kindsFor(resourceType, itemFor(id)?.variant_kind || '') as string[]
    const suggested = hint?.suggested_kind || ''
    return {
      kind: options.includes(suggested) ? suggested : 'other',
      label: hint?.suggested_label || '',
    }
  }
  const setKindFor = (id: string, patch: Partial<{ kind: string; label: string }>) =>
    setKinds((prev) => ({ ...prev, [id]: { ...kindFor(id), ...patch } }))

  const keeperItem = itemFor(validKeeper)
  const keeperHint = memberFor(validKeeper)?.suggested_kind ?? keeperItem?.suggested_kind ?? ''
  const derivedParentKind =
    (keeperItem && !keeperItem.variant_parent_id ? keeperItem.variant_kind || '' : '') ||
    (keeperHint === 'other' ? '' : keeperHint)
  const shownParentKind = parentKind ?? derivedParentKind
  const parentKindOptions = ['', ...kindsFor(resourceType, keeperItem?.variant_kind || '')]

  const filterQs = new URLSearchParams({
    ...(filterType ? { type: filterType } : {}),
    ...(filterMatch ? { match: filterMatch } : {}),
  }).toString()
  const backToList = () => navigate(`/settings/duplicates${filterQs ? `?${filterQs}` : ''}`)
  const openGroup = (g: DuplicateGroup) =>
    navigate(
      `/settings/duplicates/compare/${g.resource_type}?group=${encodeURIComponent(g.id)}` +
        (filterQs ? `&${filterQs}` : '')
    )

  // Settled: on to the next group, or the end of the queue. Outside the queue
  // there is nothing to move on to, so back to the list.
  const advance = () => {
    if (!groupId) {
      backToList()
      return
    }
    const nextGroup = queue.afterResolve()
    queue.markResolved(groupId)
    if (nextGroup) openGroup(nextGroup)
    else setFinished(true)
  }

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
      setBusy(false)
      advance()
    } catch (e) {
      setError((e as Error).message || t('maintenance.dupes.actionFailed'))
      setBusy(false)
    }
  }

  const canAct = !!validKeeper && included.length > 0 && !busy

  const merge = () =>
    canAct &&
    act(() =>
      dupesApi.merge({
        resource_type: resourceType,
        keep_id: validKeeper,
        merge_ids: included,
        delete_files: deleteFiles,
      })
    )

  // Linking files each included copy under the keeper as a version. A copy
  // that heads a family of its own cannot be linked - that would stack a third
  // level - so its whole family moves across with a promote instead.
  const link = () =>
    canAct &&
    act(async () => {
      const hasFamily = (id: string) => (itemFor(id)?.variants || []).length > 0
      const plain = included.filter((id) => !hasFamily(id))
      const parentDesc = { kind: shownParentKind, label: keeperItem?.variant_label || '' }
      if (plain.length) {
        const res = await dupesApi.link(
          resourceType,
          validKeeper,
          plain.map((id) => ({ id, ...kindFor(id) })),
          parentDesc
        )
        if (res.errors?.length) {
          throw new Error(res.errors.map((e) => String(e.detail ?? '')).join(' '))
        }
      }
      for (const id of included.filter(hasFamily)) {
        await dupesApi.promote(resourceType, {
          newParentId: validKeeper,
          oldParentId: id,
          ...kindFor(id),
        })
      }
      if (!plain.length && shownParentKind !== (keeperItem?.variant_kind || '')) {
        await dupesApi.describe(resourceType, validKeeper, parentDesc)
      }
    })

  const dismiss = () =>
    !busy && memberIds.length >= 2 && act(() => dupesApi.dismiss(resourceType, memberIds))

  // A copy already filed under some third item: the whole family moves across
  // instead (see VariantFamilyNotice).
  const promoteOverFamily = (item: CompareItem) =>
    act(() =>
      dupesApi.promote(resourceType, {
        newParentId: validKeeper,
        oldParentId: item.variant_main?.id || '',
        ...kindFor(item.id),
      })
    )
  const compareWithMain = (item: CompareItem) =>
    navigate(
      `/settings/duplicates/compare/${resourceType}?ids=` +
        encodeURIComponent(`${validKeeper},${item.variant_main?.id || ''}`)
    )

  const skip = () => {
    if (!groupId || busy) return
    const target = queue.next ?? queue.afterResolve()
    if (target && target.id !== groupId) openGroup(target)
  }
  const goBack = () => {
    if (groupId && !busy && queue.prev) openGroup(queue.prev)
  }

  const visibleOthers = visibleIds.filter((id) => id !== validKeeper)
  const source = visibleOthers.includes(sourceId) ? sourceId : visibleOthers[0]

  const copyMetadata = async (fields: string[]) => {
    setBusy(true)
    try {
      // From a copy being merged away onto the keeper: rescuing a curated
      // value that the blank-filling merge would not overwrite.
      await dupesApi.mergeMetadata({
        resource_type: resourceType,
        source_id: source,
        target_id: validKeeper,
        fields,
        overwrite: true,
      })
      setData(await dupesApi.compare(resourceType, visibleIds))
      setVersion((v) => v + 1)
      setError(null)
    } catch (e) {
      setError((e as Error).message || t('maintenance.dupes.actionFailed'))
    } finally {
      setBusy(false)
    }
  }

  // Re-bound every render, so each key acts on the state on screen.
  useEffect(() => {
    if (!isAdmin) return undefined
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      if (isTextEntry(document.activeElement)) return
      if (document.querySelector('[role="dialog"]')) return
      if (e.key === '?') {
        e.preventDefault()
        setShowHelp((v) => !v)
        return
      }
      if (busy || finished) return
      const n = Number(e.key)
      if (Number.isInteger(n) && n >= 1 && n <= visibleIds.length) {
        setKeeper(visibleIds[n - 1])
        return
      }
      switch (e.key.toLowerCase()) {
        case 'm':
          merge()
          break
        case 'l':
          link()
          break
        case 'd':
          dismiss()
          break
        case 's':
        case 'arrowright':
          skip()
          break
        case 'arrowleft':
          goBack()
          break
        default:
          return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!isAdmin) {
    return <div style={centered}>{t('maintenance.dupes.adminOnly')}</div>
  }

  if (finished) {
    return (
      <div style={centered}>
        <div style={{ fontSize: 17, color: 'var(--text)', marginBottom: 6 }}>
          {t('maintenance.dupes.review.finished')}
        </div>
        <div style={{ marginBottom: 14 }}>{t('maintenance.dupes.review.finishedHint')}</div>
        <button onClick={backToList} style={ghostBtn}>
          <LuArrowLeft size={14} /> {t('maintenance.dupes.backToList')}
        </button>
      </div>
    )
  }

  const items = visibleIds.map(itemFor).filter((i): i is CompareItem => !!i)
  const ready = memberIds.length >= 2 && items.length === visibleIds.length

  if (!ready) {
    const stillLoading = queue.loading || loading
    return (
      <div style={centered}>
        {stillLoading ? (
          <Spinner size={20} />
        ) : (
          <>
            <div style={{ marginBottom: 12 }}>
              {error ||
                queue.error ||
                (groupId
                  ? t('maintenance.dupes.review.notInQueue')
                  : t('maintenance.dupes.loadFailed'))}
            </div>
            <button onClick={backToList} style={ghostBtn}>
              <LuArrowLeft size={14} /> {t('maintenance.dupes.backToList')}
            </button>
          </>
        )}
      </div>
    )
  }

  const maxPage = data?.page_count_min || 0
  const shownPage = Math.min(memberPage, pageCount - 1)
  const inQueue = !!groupId && queue.index >= 0

  return (
    <div
      style={{
        padding: '16px 24px 40px',
        maxWidth: 1600,
        width: '100%',
        margin: '0 auto',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
          marginBottom: 6,
        }}
      >
        <button onClick={backToList} style={ghostBtn}>
          <LuArrowLeft size={14} /> {t('maintenance.dupes.backToList')}
        </button>
        <span style={{ flex: 1 }} />
        {inQueue && (
          <>
            <span aria-live="polite" style={{ fontSize: 13, color: 'var(--text-dim)' }}>
              {t('maintenance.dupes.review.counter', {
                current: queue.index + 1,
                total: queue.total,
              })}
            </span>
            <button onClick={goBack} disabled={!queue.prev || busy} style={ghostBtn}>
              <LuChevronLeft size={14} aria-hidden="true" /> {t('maintenance.dupes.review.back')}
            </button>
            <button onClick={skip} disabled={queue.total < 2 || busy} style={ghostBtn}>
              {t('maintenance.dupes.review.skip')} <LuChevronRight size={14} aria-hidden="true" />
            </button>
          </>
        )}
        <button
          onClick={() => setShowHelp((v) => !v)}
          aria-expanded={showHelp}
          style={ghostBtn}
          title={t('maintenance.dupes.review.shortcutsTitle')}
        >
          <LuKeyboard size={14} aria-hidden="true" /> {t('maintenance.dupes.review.shortcuts')}
        </button>
      </div>

      <h2 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 6px' }}>
        {t('maintenance.dupes.review.title', { count: memberIds.length })}
      </h2>
      <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 16, lineHeight: 1.6 }}>
        {queue.group?.reason_text && <span style={reasonBadge}>{queue.group.reason_text}</span>}
        {t('maintenance.dupes.review.description')}
      </p>

      {showHelp && <ShortcutHelp />}

      {error && (
        <div role="alert" style={{ fontSize: 14, color: 'var(--danger)', marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${items.length > 2 ? 300 : 420}px), 1fr))`,
          gap: 16,
          marginBottom: 16,
          opacity: loading ? 0.6 : 1,
        }}
      >
        {items.map((item, i) => (
          <ReviewColumn
            key={item.id}
            resourceType={resourceType}
            item={item}
            position={i + 1}
            isKeeper={item.id === validKeeper}
            included={!excluded.has(item.id)}
            page={page}
            kind={kindFor(item.id).kind}
            label={kindFor(item.id).label}
            kindOptions={kindsFor(resourceType, item.variant_kind || '')}
            busy={busy}
            onMakeKeeper={() => setKeeper(item.id)}
            onToggleInclude={() =>
              setExcluded((prev) => {
                const next = new Set(prev)
                if (next.has(item.id)) next.delete(item.id)
                else next.add(item.id)
                return next
              })
            }
            onKind={(kind) => setKindFor(item.id, { kind })}
            onLabel={(label) => setKindFor(item.id, { label })}
            familyNotice={
              item.id !== validKeeper && item.variant_main && keeperItem ? (
                <VariantFamilyNotice
                  main={item.variant_main}
                  keeper={keeperItem}
                  busy={busy}
                  onPromote={() => promoteOverFamily(item)}
                  onCompareMain={() => compareWithMain(item)}
                />
              ) : null
            }
          />
        ))}
      </div>

      {paged && pageCount > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <button
            onClick={() => setMemberPage(shownPage - 1)}
            disabled={shownPage === 0}
            style={ghostBtn}
            aria-label={t('maintenance.dupes.review.prevCopies')}
          >
            <LuChevronLeft size={14} aria-hidden="true" />
          </button>
          <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>
            {t('maintenance.dupes.review.copiesPage', {
              from: shownPage * perPage + 1,
              to: Math.min((shownPage + 1) * perPage, others.length),
              total: others.length,
            })}
          </span>
          <button
            onClick={() => setMemberPage(shownPage + 1)}
            disabled={shownPage >= pageCount - 1}
            style={ghostBtn}
            aria-label={t('maintenance.dupes.review.nextCopies')}
          >
            <LuChevronRight size={14} aria-hidden="true" />
          </button>
        </div>
      )}

      {maxPage > 1 && <PageFlipper page={page} maxPage={maxPage} onChange={setPage} />}

      <DiffTable differences={data?.differences || []} />

      {visibleOthers.length > 1 && (data?.mergeable_fields || []).length > 0 && (
        <label
          style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 8 }}
        >
          {t('maintenance.dupes.review.copyFrom')}
          <select value={source} onChange={(e) => setSourceId(e.target.value)} style={select}>
            {visibleOthers.map((id) => {
              const it = itemFor(id)
              return (
                <option key={id} value={id}>
                  {it?.title || it?.filename || id}
                </option>
              )
            })}
          </select>
        </label>
      )}
      <MetadataCopyPanel
        fields={data?.mergeable_fields || []}
        differences={data?.differences || []}
        source={itemFor(source)}
        target={keeperItem}
        onCopy={copyMetadata}
        busy={busy}
      />

      {/* The decision bar. Merge is first: it is the answer that loses
          nothing, and its dry run sits right above the button. */}
      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 16,
          background: 'var(--bg-card)',
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
          {t('maintenance.dupes.review.mergePreview')}
        </div>
        <div aria-live="polite" style={{ opacity: reportLoading ? 0.5 : 1, minHeight: 24 }}>
          {included.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: '0 0 8px' }}>
              {t('maintenance.dupes.review.nothingIncluded')}
            </p>
          ) : (
            report && <MergeSummary results={[report]} />
          )}
        </div>

        <div
          style={{
            display: 'flex',
            gap: 16,
            flexWrap: 'wrap',
            alignItems: 'flex-end',
            margin: '12px 0 14px',
          }}
        >
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={deleteFiles}
              disabled={busy}
              onChange={(e) => setDeleteFiles(e.target.checked)}
            />
            {t('merge.deleteFiles')}
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 13 }}>
            {t('maintenance.dupes.parentKindLabel')}
            <select
              value={shownParentKind}
              disabled={busy}
              onChange={(e) => setParentKind(e.target.value)}
              style={select}
            >
              {parentKindOptions.map((k) => (
                <option key={k || 'main'} value={k}>
                  {k ? t(`variants.kind.${k}`, { defaultValue: k }) : t('variants.mainVersion')}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            disabled={!canAct}
            onClick={merge}
            style={{ ...primaryBtn, opacity: canAct ? 1 : 0.6 }}
          >
            {busy ? <Spinner size={13} /> : <LuCombine size={13} aria-hidden="true" />}{' '}
            {t('maintenance.dupes.review.merge', { count: included.length })}
            <kbd style={kbdOnGold}>M</kbd>
          </button>
          <button
            type="button"
            disabled={!canAct}
            onClick={link}
            style={{ ...secondaryBtn, opacity: canAct ? 1 : 0.6 }}
          >
            <LuLayers size={13} aria-hidden="true" /> {t('maintenance.dupes.linkAs')}
            <kbd style={kbdStyle}>L</kbd>
          </button>
          <button type="button" disabled={busy} onClick={dismiss} style={secondaryBtn}>
            <LuX size={13} aria-hidden="true" /> {t('maintenance.dupes.dismiss')}
            <kbd style={kbdStyle}>D</kbd>
          </button>
        </div>
      </div>
    </div>
  )
}

const centered: CSSProperties = { padding: 40, textAlign: 'center', color: 'var(--text-dim)' }

const ghostBtn: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '7px 12px',
  borderRadius: 6,
  fontSize: 13,
  cursor: 'pointer',
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--text-dim)',
}

const primaryBtn: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  background: 'var(--gold-dim)',
  color: 'var(--bg-deep)',
  border: 'none',
  borderRadius: 6,
  padding: '8px 18px',
  cursor: 'pointer',
  fontSize: 13,
}

const secondaryBtn: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  borderRadius: 6,
  padding: '8px 16px',
  cursor: 'pointer',
  fontSize: 13,
}

const select: CSSProperties = {
  background: 'var(--bg-deep)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  borderRadius: 6,
  padding: '7px 10px',
  fontSize: 13,
  minWidth: 190,
}

const kbdStyle: CSSProperties = {
  fontSize: 11,
  padding: '0 5px',
  borderRadius: 4,
  border: '1px solid var(--border)',
  color: 'var(--text-muted)',
  fontFamily: 'inherit',
  marginLeft: 2,
}

const kbdOnGold: CSSProperties = {
  ...kbdStyle,
  border: '1px solid rgba(0,0,0,0.25)',
  color: 'var(--bg-deep)',
}

const reasonBadge: CSSProperties = {
  fontSize: 11,
  padding: '1px 7px',
  borderRadius: 8,
  marginRight: 8,
  color: 'var(--variant)',
  background: 'rgba(79,209,197,0.12)',
  border: '1px solid rgba(79,209,197,0.35)',
}
