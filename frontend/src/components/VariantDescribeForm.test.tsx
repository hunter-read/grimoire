import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const describeVariant = vi.fn()
vi.mock('../api', () => ({
  duplicates: { describe: (...a: unknown[]) => describeVariant(...a) },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => {
      if (k === 'variants.mainVersion') return 'Main version'
      if (k === 'variants.renameKind') return 'Type'
      if (k === 'variants.renameLabel') return 'Label'
      if (k === 'common.save') return 'Save'
      if (k === 'common.cancel') return 'Cancel'
      if (k === 'common.error') return 'Something went wrong'
      if (k.startsWith('variants.kind.')) return k.replace('variants.kind.', '')
      return k
    },
  }),
}))

import VariantDescribeForm from './VariantDescribeForm'
import type { VariantOption } from './useVariantOptions'

const renderForm = (option: VariantOption, extra = {}) => {
  const onSaved = vi.fn()
  const onCancel = vi.fn()
  render(
    <VariantDescribeForm
      option={option}
      resourceType="map"
      onSaved={onSaved}
      onCancel={onCancel}
      {...extra}
    />
  )
  return { onSaved, onCancel }
}

const optionsOf = () =>
  [...screen.getByLabelText<HTMLSelectElement>('Type').options].map((o) => o.value)

beforeEach(() => {
  describeVariant.mockReset().mockImplementation((_t, id, desc) => Promise.resolve({ id, ...desc }))
})

describe('VariantDescribeForm', () => {
  it('offers "Main version" as the first choice for the main entry', () => {
    renderForm({ id: 'm', isMain: true, kind: '', label: '' })
    expect(optionsOf()[0]).toBe('')
    expect(screen.getByLabelText('Type')).toHaveValue('')
    expect(screen.getByRole('option', { name: 'Main version' })).toBeInTheDocument()
  })

  it('offers only real kinds for a variant', () => {
    renderForm({ id: 'v', isMain: false, kind: 'gridded', label: '' })
    expect(optionsOf()).not.toContain('')
    expect(optionsOf()).toContain('gridless')
    expect(screen.getByLabelText('Type')).toHaveValue('gridded')
  })

  it('submits a variant with no stored kind as "other"', async () => {
    const { onSaved } = renderForm({ id: 'v', isMain: false, kind: '', label: '' })
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(describeVariant).toHaveBeenCalledWith('map', 'v', { kind: 'other', label: '' })
    )
    expect(onSaved).toHaveBeenCalledWith({ kind: 'other', label: '' })
  })

  it('saves the chosen kind and label for the main entry', async () => {
    const { onSaved } = renderForm({ id: 'm', isMain: true, kind: '', label: '' })
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'gridless')
    await userEvent.type(screen.getByLabelText('Label'), 'night')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(describeVariant).toHaveBeenCalledWith('map', 'm', { kind: 'gridless', label: 'night' })
    )
    expect(onSaved).toHaveBeenCalledWith({ kind: 'gridless', label: 'night' })
  })

  it('falls back to what it sent when the response is empty', async () => {
    describeVariant.mockResolvedValue(undefined)
    const { onSaved } = renderForm({ id: 'm', isMain: true, kind: 'video', label: ' x ' })
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ kind: 'video', label: 'x' }))
  })

  it('shows the error and stays open when the save fails', async () => {
    describeVariant.mockRejectedValue(new Error('Nope'))
    const { onSaved } = renderForm({ id: 'm', isMain: true, kind: '', label: '' })
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Nope')
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('uses a generic message for an error without one', async () => {
    describeVariant.mockRejectedValue({})
    renderForm({ id: 'm', isMain: true, kind: '', label: '' })
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong')
  })

  it('cancels', async () => {
    const { onCancel } = renderForm({ id: 'm', isMain: true, kind: '', label: '' })
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
  })
})
