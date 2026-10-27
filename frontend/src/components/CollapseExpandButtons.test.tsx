import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CollapseExpandButtons from './CollapseExpandButtons'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k) => ({ 'common.collapseAll': 'Collapse All', 'common.expandAll': 'Expand All' })[k] || k,
  }),
}))

describe('CollapseExpandButtons', () => {
  it('fires the collapse and expand callbacks', async () => {
    const onCollapseAll = vi.fn()
    const onExpandAll = vi.fn()
    render(<CollapseExpandButtons onCollapseAll={onCollapseAll} onExpandAll={onExpandAll} />)
    await userEvent.click(screen.getByText('Collapse All'))
    await userEvent.click(screen.getByText('Expand All'))
    expect(onCollapseAll).toHaveBeenCalled()
    expect(onExpandAll).toHaveBeenCalled()
  })

  it('disables each button independently', () => {
    render(
      <CollapseExpandButtons
        onCollapseAll={() => {}}
        onExpandAll={() => {}}
        collapseDisabled
        expandDisabled={false}
      />
    )
    expect(screen.getByText('Collapse All').closest('button')).toBeDisabled()
    expect(screen.getByText('Expand All').closest('button')).not.toBeDisabled()
  })
})
