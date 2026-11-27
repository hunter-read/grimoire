import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuArrowLeft, LuArrowRight, LuCheck } from 'react-icons/lu'
import { goldBtn, ghostBtn, scrim, card, helpText } from './characterStyles'
import { numberDefault, promptContext, stepLabel } from './sheetPrompts'
import type { Answers, PromptDocument, SheetPrompt } from './sheetPrompts'
import { catalogKey, loadCatalog } from './promptCatalog'
import type { CatalogRead } from './promptCatalog'
import { promptPages, promptState } from './promptPages'
import type { PromptPage, StepState } from './promptPages'
import PromptStepControl from './PromptStepControl'
import type { BrowseEntries } from './promptStepShared'

export type { BrowseEntries } from './promptStepShared'

type Values = Record<string, unknown>

/** How a prompt was confirmed, besides its answers. */
export interface PromptOutcome {
  // The `later` prompts of the pages skipped: kept among the choices to make.
  later: string[]
  // The pages skipped, by name: to open the prompt again as it was confirmed.
  skipped: string[]
}

export interface PromptDialogProps {
  prompt: SheetPrompt
  document: PromptDocument | null | undefined
  data: Values | null | undefined
  // The sheet as its formulas read it.
  context: Values
  row?: Values | null
  sourceLabel?: string
  browse?: BrowseEntries
  // A prompt opened again to be answered anew: its answers, the pages it
  // skipped, and whether to start on its last page.
  initialAnswers?: Answers
  initialSkipped?: string[]
  startAtEnd?: boolean
  onConfirm?: (answers: Answers, outcome: PromptOutcome) => void
  onSkip?: () => void
  // Back from a paged prompt's first page: take back the prompt before it.
  onBack?: () => void
}

const disabledGold = { ...goldBtn, opacity: 0.55, cursor: 'default' }

// The pages with a step showing, each with its steps.
function shownPages(pages: PromptPage[], steps: StepState[]) {
  const byKey = new Map(steps.map((state) => [state.step.key, state]))
  return pages
    .map((page) => ({
      page,
      steps: page.keys.map((key) => byKey.get(key)).filter((state): state is StepState => !!state),
    }))
    .filter((shown) => shown.steps.length)
}

/**
 * Asks the questions of one of the sheet's `prompts`: the steps showing for
 * the answers given so far, each with its own control. A `paged` prompt shows
 * them a page at a time, with Back and Next; Next waits for the page's own
 * answers, and a page `pages` gives a `later` prompt can be skipped, to be
 * chosen later. Confirming needs every step showing answered, skipped pages
 * aside; putting the whole prompt off is always allowed, and the sheet keeps
 * it to open again later.
 *
 * The catalog each catalog step chooses from is read once, as the dialog
 * opens, and its `filter` worked out again at every answer.
 *
 * Like the `choose` dialog it extends, it knows nothing about what it asks:
 * every question, option and limit comes from the sheet's data.
 */
export default function PromptDialog({
  prompt,
  document,
  data,
  context,
  row,
  sourceLabel,
  browse,
  initialAnswers,
  initialSkipped,
  startAtEnd = false,
  onConfirm,
  onSkip,
  onBack,
}: PromptDialogProps) {
  const { t } = useTranslation()
  // Numbers start from their worked-out default, which counts as an answer.
  // A prompt opened again keeps its answers, and a number it lacks - on a
  // page skipped before - starts from its default too.
  const [answers, setAnswers] = useState<Answers>(() => {
    const start: Answers = { ...(initialAnswers || {}) }
    for (const step of prompt.steps || []) {
      if (step?.type !== 'number' || step.key in start) continue
      const value = numberDefault(step, promptContext(context, start, row))
      if (value !== undefined) start[step.key] = value
    }
    return start
  })
  const pages = useMemo(() => promptPages(prompt), [prompt])
  // Where it opens: its first page, or its last when taken back to be
  // answered again - asked again, should that page have been skipped.
  const [opening] = useState(() => {
    const steps = promptState(prompt, { context, answers, row, document, data }).steps
    const first = shownPages(pages, steps)
    const page = (startAtEnd ? first[first.length - 1] : first[0])?.page.name ?? ''
    return { page, skipped: (initialSkipped || []).filter((name) => name !== page) }
  })
  const [skipped, setSkipped] = useState(() => new Set(opening.skipped))
  const [pageName, setPageName] = useState(opening.page)
  const [catalogs, setCatalogs] = useState<Record<string, CatalogRead>>({})
  const paged = Boolean(prompt.paged)

  // Every catalog the prompt reads, read once as it opens; two steps asking
  // for the same content type with the same fixed filters share a read.
  useEffect(() => {
    let cancelled = false
    const wanted = new Map<string, (typeof prompt.steps)[number]>()
    for (const step of prompt.steps || []) {
      const key = step ? catalogKey(step) : undefined
      if (key && !wanted.has(key)) wanted.set(key, step)
    }
    for (const [key, step] of wanted) {
      const read: Promise<CatalogRead> = browse
        ? loadCatalog(step, browse).catch((e: Error) => ({ error: e.message }))
        : Promise.resolve([])
      void read.then((found) => {
        if (!cancelled) setCatalogs((prev) => ({ ...prev, [key]: found }))
      })
    }
    return () => {
      cancelled = true
    }
  }, [browse, prompt])

  const state = promptState(prompt, {
    context,
    answers,
    row,
    document,
    data,
    catalogs,
    skipped,
  })

  // A choice the `filter` no longer lets through - its prerequisite unticked,
  // an earlier answer changed - is let go.
  const dropped = state.dropped
  useEffect(() => {
    if (!Object.keys(dropped).length) return
    setAnswers((prev) => {
      const next = { ...prev }
      for (const [key, value] of Object.entries(dropped)) {
        if (value === undefined) delete next[key]
        else next[key] = value
      }
      return next
    })
  }, [dropped])

  const shown = shownPages(pages, state.steps)
  // The page on show; should it no longer have a step showing, the next one
  // that does, in the prompt's order.
  let index = shown.findIndex((item) => item.page.name === pageName)
  if (index < 0) {
    const order = pages.findIndex((page) => page.name === pageName)
    index = shown.findIndex((item) => pages.indexOf(item.page) >= order)
    if (index < 0) index = shown.length - 1
  }
  const current = shown[index]
  const last = index >= shown.length - 1
  const pageDone = Boolean(current?.steps.every((step) => step.answered))
  const complete = shown.length > 0 && state.steps.every((step) => step.answered)

  // A new page is announced from its top.
  const bodyRef = useRef<HTMLDivElement>(null)
  const firstPage = useRef(true)
  useEffect(() => {
    if (firstPage.current) {
      firstPage.current = false
      return
    }
    bodyRef.current?.scrollTo?.({ top: 0 })
    bodyRef.current?.focus()
  }, [pageName])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onSkip?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSkip])

  const answer = (key: string, value: unknown) =>
    setAnswers((prev) => {
      const next = { ...prev }
      if (value === undefined) delete next[key]
      else next[key] = value
      return next
    })

  const outcome = (skippedNow: Set<string>): PromptOutcome => {
    const pagesSkipped = shown.map((item) => item.page).filter((page) => skippedNow.has(page.name))
    return {
      later: [
        ...new Set(pagesSkipped.map((page) => page.later).filter((name): name is string => !!name)),
      ],
      skipped: pagesSkipped.map((page) => page.name),
    }
  }

  const goTo = (target: number) => {
    const page = shown[target]?.page
    if (!page) return
    // A skipped page gone back to is asked again.
    if (skipped.has(page.name)) {
      setSkipped((prev) => {
        const next = new Set(prev)
        next.delete(page.name)
        return next
      })
    }
    setPageName(page.name)
  }

  const back = () => {
    if (index > 0) goTo(index - 1)
    else onBack?.()
  }

  // Skipping a page drops what it was answering; its `later` prompt asks it
  // again. Skipping the last page confirms, when nothing else is waiting.
  const skipPage = () => {
    if (!current) return
    const nextSkipped = new Set(skipped).add(current.page.name)
    const nextAnswers = { ...answers }
    for (const key of current.page.keys) delete nextAnswers[key]
    setSkipped(nextSkipped)
    setAnswers(nextAnswers)
    if (!last) {
      goTo(index + 1)
      return
    }
    const after = promptState(prompt, {
      context,
      answers: nextAnswers,
      row,
      document,
      data,
      catalogs,
      skipped: nextSkipped,
    })
    if (after.steps.length && after.steps.every((step) => step.answered)) {
      onConfirm?.(after.answers, outcome(nextSkipped))
    }
  }

  const rendered = (current?.steps || []).map((item) => {
    const heading = stepLabel(item.step, item.context)
    return (
      <section key={item.step.key} style={{ display: 'grid', gap: 6 }}>
        {heading ? <h3 style={{ margin: 0, fontSize: 14 }}>{heading}</h3> : null}
        <PromptStepControl
          // The heading it shows, so a control named after its step (a
          // number's input) is announced as it reads.
          step={heading ? { ...item.step, label: heading } : item.step}
          value={item.answer}
          context={item.context}
          document={document}
          data={data}
          options={item.options}
          failed={item.failed}
          onAnswer={(value) => answer(item.step.key, value)}
        />
      </section>
    )
  })

  const skippable = paged && Boolean(current?.page.later)
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={prompt.label}
      style={{ ...scrim, zIndex: 1200 }}
    >
      <div
        style={{
          ...card,
          background: 'var(--bg-panel)',
          width: '100%',
          maxWidth: 520,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 16 }}>{prompt.label}</h2>
          {sourceLabel ? (
            <p style={helpText}>{t('characters.chooseFrom', { source: sourceLabel })}</p>
          ) : null}
          {paged && shown.length > 1 ? (
            <p style={helpText}>
              {t('characters.promptPageOf', { page: index + 1, pages: shown.length })}
              {current?.page.label ? ` · ${current.page.label}` : ''}
            </p>
          ) : null}
        </div>

        <div
          ref={bodyRef}
          tabIndex={-1}
          // A page is a group named after it, so moving to one says where.
          role={paged ? 'group' : undefined}
          aria-label={paged ? current?.page.label || prompt.label : undefined}
          style={{ display: 'grid', gap: 16, overflowY: 'auto', paddingRight: 2, outline: 'none' }}
        >
          {rendered}
        </div>

        <div
          style={{
            display: 'flex',
            gap: 8,
            justifyContent: 'space-between',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {paged && (index > 0 || onBack) ? (
              <button type="button" onClick={back} style={ghostBtn}>
                <LuArrowLeft size={14} />
                {t('characters.promptBack')}
              </button>
            ) : null}
            <button type="button" onClick={skippable ? skipPage : onSkip} style={ghostBtn}>
              {skippable ? t('characters.promptSkipPage') : t('characters.chooseLater')}
            </button>
          </div>
          {last ? (
            <button
              type="button"
              onClick={() => onConfirm?.(state.answers, outcome(skipped))}
              disabled={!complete}
              style={complete ? goldBtn : disabledGold}
            >
              <LuCheck size={14} />
              {t('characters.promptConfirm')}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => goTo(index + 1)}
              disabled={!pageDone}
              style={pageDone ? goldBtn : disabledGold}
            >
              {t('characters.promptNext')}
              <LuArrowRight size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
