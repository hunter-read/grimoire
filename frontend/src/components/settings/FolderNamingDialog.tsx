import { useEffect, useId, useRef, useState, type ComponentType, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { naming, type Schema } from '../../api'
import Spinner from '../Spinner'
import FolderTreeJs from '../files/FolderTree'
import ConfirmModal from './ConfirmModal'
import NamingPreviewTable from './NamingPreviewTable'
import { canChangeTitle, canRename, isActionable } from './namingPreview'
import { buttonStyle, failure, hintStyle, monoInputStyle } from './filenameRulesStyles'

type Rule = Schema<'FolderRuleOut'>
type Preview = Schema<'PreviewResponse'>

interface Props {
  // Set when editing an existing rule; the folder is then fixed.
  rule?: Rule
  fields: string[]
  onClose: () => void
  onSaved: (rule: Rule) => void
}

// How long the pattern must sit still before the preview refreshes. Long enough
// not to fire on every keystroke, short enough to feel live.
const PREVIEW_DELAY = 400

const inBooks = (path: string) => path === 'books' || path.startsWith('books/')

// FolderTree is still JavaScript, so TypeScript infers its props from the
// destructuring: every prop required, and `isBlocked` typed from its
// `() => false` default, without the path it is called with. This states what
// it actually accepts.
const FolderTree = FolderTreeJs as unknown as ComponentType<{
  selected: string | null
  onSelect: (path: string) => void
  isBlocked?: (path: string) => boolean
  blockedLabel?: string
  revealPath?: string
  testId?: string
}>

const outsideBooks = (path: string) => !inBooks(path)

const backdrop: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'var(--scrim)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1100,
  padding: 16,
}

const panel: CSSProperties = {
  background: 'var(--bg-panel)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: 20,
  width: 'min(860px, 100%)',
  maxHeight: 'calc(100vh - 32px)',
  overflowY: 'auto',
  boxSizing: 'border-box',
}

const label: CSSProperties = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }

/**
 * Create or edit one folder's naming pattern (issues #521 and #522).
 *
 * The preview runs against whatever is in the box, saved or not, so the admin
 * sees what a pattern reads before committing to it. The two apply actions use
 * the *saved* pattern - that is what the server applies - so they stay disabled
 * while the box holds an unsaved edit, rather than applying something other
 * than what the table shows.
 */
export default function FolderNamingDialog({ rule, fields, onClose, onSaved }: Props) {
  const { t } = useTranslation()
  const patternId = useId()
  const [path, setPath] = useState<string | null>(rule?.path ?? null)
  const [pattern, setPattern] = useState(rule?.pattern ?? '')
  const [savedPattern, setSavedPattern] = useState<string | null>(rule?.pattern ?? null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [confirmRename, setConfirmRename] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const request = useRef(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (busy || confirmRename) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, confirmRename, onClose])

  const trimmed = pattern.trim()

  useEffect(() => {
    if (!path || !trimmed) {
      setPreview(null)
      setPreviewError('')
      return
    }
    // Numbered so a slow response to an older pattern cannot overwrite a newer one.
    const mine = ++request.current
    setLoading(true)
    const timer = setTimeout(() => {
      naming
        .preview(path, trimmed)
        .then((body) => {
          if (mine !== request.current) return
          setPreview(body)
          setPreviewError('')
          setSelected(new Set(body.rows.filter(isActionable).map((r) => r.id)))
        })
        .catch((err: unknown) => {
          if (mine !== request.current) return
          setPreview(null)
          setPreviewError(failure(err) || t('filenameRules.preview.failed'))
        })
        .finally(() => {
          if (mine === request.current) setLoading(false)
        })
    }, PREVIEW_DELAY)
    return () => clearTimeout(timer)
  }, [path, trimmed, refresh, t])

  const insertField = (field: string) => {
    const el = input.current
    const token = `{${field}}`
    const start = el?.selectionStart ?? pattern.length
    const end = el?.selectionEnd ?? pattern.length
    setPattern(pattern.slice(0, start) + token + pattern.slice(end))
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + token.length, start + token.length)
    })
  }

  const save = async () => {
    if (!path || !trimmed) return
    setBusy(true)
    setMessage(null)
    try {
      const saved = await naming.saveFolder(path, trimmed)
      setSavedPattern(saved.pattern)
      setPattern(saved.pattern)
      onSaved(saved)
      setMessage({ tone: 'ok', text: t('filenameRules.dialog.saved') })
    } catch (err) {
      setMessage({ tone: 'error', text: failure(err) || t('filenameRules.dialog.saveFailed') })
    } finally {
      setBusy(false)
    }
  }

  const rows = preview?.rows ?? []
  const titleIds = rows.filter((r) => selected.has(r.id) && canChangeTitle(r)).map((r) => r.id)
  const renameIds = rows.filter((r) => selected.has(r.id) && canRename(r)).map((r) => r.id)
  const isSaved = savedPattern !== null && savedPattern === trimmed
  const canWrite = preview?.writable !== false

  const report = (done: string, skipped: number) => {
    const text = skipped
      ? `${done} ${t('filenameRules.preview.skipped', { count: skipped })}`
      : done
    setMessage({ tone: 'ok', text })
    setRefresh((n) => n + 1)
  }

  const applyTitles = async () => {
    if (!path || titleIds.length === 0) return
    setBusy(true)
    setMessage(null)
    try {
      const res = await naming.applyTitles(path, titleIds)
      report(
        t('filenameRules.preview.titlesDone', { count: res.updated.length }),
        res.skipped.length
      )
    } catch (err) {
      setMessage({ tone: 'error', text: failure(err) || t('filenameRules.preview.failed') })
    } finally {
      setBusy(false)
    }
  }

  const applyRenames = async () => {
    setConfirmRename(false)
    if (!path || renameIds.length === 0) return
    setBusy(true)
    setMessage(null)
    try {
      const res = await naming.rename(path, renameIds)
      report(
        t('filenameRules.preview.renameDone', { count: res.renamed.length }),
        res.skipped.length
      )
    } catch (err) {
      setMessage({ tone: 'error', text: failure(err) || t('filenameRules.preview.failed') })
    } finally {
      setBusy(false)
    }
  }

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const title = rule
    ? t('filenameRules.dialog.titleEdit', { path: rule.path })
    : t('filenameRules.dialog.titleNew')

  return (
    <>
      <div style={backdrop} onClick={() => !busy && onClose()}>
        <div
          style={panel}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 14 }}>{title}</h3>

          {!rule && (
            <div style={{ marginBottom: 16 }}>
              <span style={label}>{t('filenameRules.dialog.folder')}</span>
              <FolderTree
                testId="naming-folder-tree"
                selected={path}
                onSelect={(p) => {
                  if (inBooks(p)) setPath(p)
                }}
                isBlocked={outsideBooks}
                blockedLabel={t('filenameRules.dialog.notBooks')}
                revealPath="books"
              />
              <p style={{ ...hintStyle, marginTop: 6 }}>
                {path ? <code>{path}</code> : t('filenameRules.dialog.pickFolder')}
                {' - '}
                {t('filenameRules.dialog.folderHint')}
              </p>
            </div>
          )}
          {rule && (
            <p style={{ ...hintStyle, marginBottom: 14 }}>{t('filenameRules.dialog.folderHint')}</p>
          )}

          <label htmlFor={patternId} style={label}>
            {t('filenameRules.dialog.pattern')}
          </label>
          <input
            id={patternId}
            ref={input}
            type="text"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder={t('filenameRules.dialog.patternPlaceholder')}
            spellCheck={false}
            autoComplete="off"
            style={monoInputStyle}
          />
          <div
            role="group"
            aria-label={t('filenameRules.dialog.fieldsLabel')}
            style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}
          >
            {[...fields, '*'].map((field) => (
              <button
                key={field}
                type="button"
                onClick={() => insertField(field)}
                aria-label={t('filenameRules.dialog.insertField', { field: `{${field}}` })}
                style={{
                  ...buttonStyle(),
                  padding: '2px 8px',
                  fontSize: 12,
                  fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
                }}
              >
                {`{${field}}`}
              </button>
            ))}
          </div>
          <p style={{ ...hintStyle, marginTop: 8 }}>{t('filenameRules.dialog.syntaxHint')}</p>

          <div style={{ marginTop: 18, minHeight: 60 }}>
            {loading && !preview && <Spinner size={18} />}
            {previewError && (
              <div role="alert" style={{ color: 'var(--danger)', fontSize: 13 }}>
                {previewError}
              </div>
            )}
            {preview && (
              <div style={{ opacity: loading ? 0.6 : 1 }}>
                <NamingPreviewTable
                  preview={preview}
                  selected={selected}
                  onToggle={toggle}
                  onToggleAll={(on) =>
                    setSelected(
                      on ? new Set(rows.filter(isActionable).map((r) => r.id)) : new Set()
                    )
                  }
                />
              </div>
            )}
          </div>

          {preview && !isSaved && (
            <p style={{ ...hintStyle, marginTop: 10 }}>{t('filenameRules.dialog.unsaved')}</p>
          )}
          {preview && isSaved && preview.renderable && !canWrite && (
            <p style={{ ...hintStyle, marginTop: 10 }}>
              {t('filenameRules.preview.readOnlyLibrary')}
            </p>
          )}

          {message && (
            <div
              role={message.tone === 'error' ? 'alert' : 'status'}
              style={{
                marginTop: 12,
                fontSize: 13,
                color: message.tone === 'error' ? 'var(--danger)' : 'var(--green)',
              }}
            >
              {message.text}
            </div>
          )}

          <div
            style={{
              display: 'flex',
              gap: 8,
              justifyContent: 'flex-end',
              flexWrap: 'wrap',
              marginTop: 16,
            }}
          >
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              style={buttonStyle(false, busy)}
            >
              {t('common.close')}
            </button>
            {isSaved && (
              <button
                type="button"
                onClick={applyTitles}
                disabled={busy || titleIds.length === 0}
                style={buttonStyle(false, busy || titleIds.length === 0)}
              >
                {t('filenameRules.preview.applyTitles', { count: titleIds.length })}
              </button>
            )}
            {isSaved && preview?.renderable && (
              <button
                type="button"
                onClick={() => setConfirmRename(true)}
                disabled={busy || !canWrite || renameIds.length === 0}
                style={buttonStyle(false, busy || !canWrite || renameIds.length === 0)}
              >
                {t('filenameRules.preview.rename', { count: renameIds.length })}
              </button>
            )}
            <button
              type="button"
              onClick={save}
              disabled={busy || !path || !trimmed || isSaved}
              style={buttonStyle(true, busy || !path || !trimmed || isSaved)}
            >
              {busy && <Spinner size={13} />}
              {t('filenameRules.dialog.save')}
            </button>
          </div>
        </div>
      </div>

      {/* Outside the backdrop: React bubbles a click inside it up the component
        tree, and the backdrop would take it as a click outside the dialog. */}
      {confirmRename && (
        <ConfirmModal
          title={t('filenameRules.preview.renameTitle')}
          message={t('filenameRules.preview.renameConfirm', { count: renameIds.length })}
          onConfirm={applyRenames}
          onClose={() => setConfirmRename(false)}
        />
      )}
    </>
  )
}
