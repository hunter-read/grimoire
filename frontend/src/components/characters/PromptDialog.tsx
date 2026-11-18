import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCheck } from 'react-icons/lu'
import { goldBtn, ghostBtn, scrim, card, helpText } from './characterStyles'
import { isComplete, numberDefault, promptContext, visibleSteps } from './sheetPrompts'
import type { Answers, PromptDocument, SheetPrompt } from './sheetPrompts'
import PromptStepControl from './PromptStepControl'
import type { BrowseEntries } from './promptStepShared'

export type { BrowseEntries } from './promptStepShared'

type Values = Record<string, unknown>

export interface PromptDialogProps {
  prompt: SheetPrompt
  document: PromptDocument | null | undefined
  data: Values | null | undefined
  // The sheet as its formulas read it.
  context: Values
  row?: Values | null
  sourceLabel?: string
  browse?: BrowseEntries
  onConfirm?: (answers: Answers) => void
  onSkip?: () => void
}

/**
 * Asks the questions of one of the sheet's `prompts`, all on one page: the
 * steps showing for the answers given so far, each with its own control.
 * Confirming needs every step showing answered; skipping is always allowed,
 * and the sheet keeps the prompt to open again later.
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
  onConfirm,
  onSkip,
}: PromptDialogProps) {
  const { t } = useTranslation()
  // Numbers start from their worked-out default, which counts as an answer.
  const [answers, setAnswers] = useState<Answers>(() => {
    const start: Answers = {}
    for (const step of prompt.steps || []) {
      if (step?.type !== 'number') continue
      const value = numberDefault(step, promptContext(context, start, row))
      if (value !== undefined) start[step.key] = value
    }
    return start
  })

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onSkip?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSkip])

  const steps = visibleSteps(prompt, context, answers, row)
  const complete = isComplete(prompt, context, answers, document, data, row)
  const answer = (key: string, value: unknown) =>
    setAnswers((prev) => {
      const next = { ...prev }
      if (value === undefined) delete next[key]
      else next[key] = value
      return next
    })

  // Each step reads the answers of the steps showing before it.
  const before: Answers = {}
  const rendered = steps.map((step) => {
    const stepContext = promptContext(context, { ...before }, row)
    before[step.key] = answers[step.key]
    return (
      <section key={step.key} style={{ display: 'grid', gap: 6 }}>
        {step.label ? <h3 style={{ margin: 0, fontSize: 14 }}>{step.label}</h3> : null}
        <PromptStepControl
          step={step}
          value={answers[step.key]}
          context={stepContext}
          document={document}
          data={data}
          browse={browse}
          onAnswer={(value) => answer(step.key, value)}
        />
      </section>
    )
  })

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
        </div>

        <div style={{ display: 'grid', gap: 16, overflowY: 'auto', paddingRight: 2 }}>
          {rendered}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onSkip} style={ghostBtn}>
            {t('characters.chooseLater')}
          </button>
          <button
            type="button"
            onClick={() => onConfirm?.(answers)}
            disabled={!complete}
            style={complete ? goldBtn : { ...goldBtn, opacity: 0.55, cursor: 'default' }}
          >
            <LuCheck size={14} />
            {t('characters.promptConfirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
