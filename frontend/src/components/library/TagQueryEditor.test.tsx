import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TagQueryEditor from './TagQueryEditor'
import { FILTER_NONE } from './specialFilters'

// The `t` mock echoes the key, interpolating {{field}} / {{n}} so the per-row
// labels stay distinguishable.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k, opts) => {
      if (opts?.field) return `${k}:${opts.field}`
      if (opts?.n) return `${k}:${opts.n}`
      return k
    },
  }),
}))

const options = [
  { value: 'building', label: 'building' },
  { value: 'store', label: 'store' },
  { value: 'shop', label: 'shop' },
]

function Harness({ initial, onChange }) {
  const [value, setValue] = useState(initial)
  return (
    <TagQueryEditor
      value={value}
      onChange={(next) => {
        setValue(next)
        onChange?.(next)
      }}
      options={options}
      label="Tags"
      emptyLabel="No tags"
    />
  )
}

// Open a group's dropdown and tick one or more tags. The panel stays open
// across ticks, so a group holding several alternatives is built in one pass.
const pick = async (user, rowIndex, ...tags) => {
  await user.click(screen.getByLabelText(`sortFilter.tagGroupTags:${rowIndex + 1}`))
  for (const tag of tags) await user.click(screen.getByLabelText(tag))
}

describe('TagQueryEditor', () => {
  it('renders one empty group when nothing is selected', () => {
    render(<Harness initial={undefined} />)
    expect(screen.getByLabelText('sortFilter.tagGroupTags:1')).toBeInTheDocument()
    expect(screen.queryByLabelText('sortFilter.tagGroupTags:2')).not.toBeInTheDocument()
  })

  it('emits an include group when a tag is picked', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness initial={undefined} onChange={onChange} />)
    await pick(user, 0, 'building')
    expect(onChange).toHaveBeenLastCalledWith([{ mode: 'include', tags: ['building'] }])
  })

  it('builds building AND (store OR shop) across two groups', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness initial={[{ mode: 'include', tags: ['building'] }]} onChange={onChange} />)
    await user.click(screen.getByText('sortFilter.tagGroupAdd'))
    await pick(user, 1, 'store', 'shop')
    expect(onChange).toHaveBeenLastCalledWith([
      { mode: 'include', tags: ['building'] },
      { mode: 'include', tags: ['store', 'shop'] },
    ])
  })

  it('switches a group to exclude', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness initial={[{ mode: 'include', tags: ['building'] }]} onChange={onChange} />)
    await user.selectOptions(screen.getByLabelText('sortFilter.tagGroupMode:1'), 'exclude')
    expect(onChange).toHaveBeenLastCalledWith([{ mode: 'exclude', tags: ['building'] }])
  })

  it('removes a group', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <Harness
        initial={[
          { mode: 'include', tags: ['building'] },
          { mode: 'include', tags: ['shop'] },
        ]}
        onChange={onChange}
      />
    )
    await user.click(screen.getByLabelText('sortFilter.tagGroupRemove:2'))
    expect(onChange).toHaveBeenLastCalledWith([{ mode: 'include', tags: ['building'] }])
  })

  it('clears to undefined when the last group is removed', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness initial={[{ mode: 'include', tags: ['building'] }]} onChange={onChange} />)
    await user.click(screen.getByLabelText('sortFilter.tagGroupRemove:1'))
    expect(onChange).toHaveBeenLastCalledWith(undefined)
    // A row is still there to type into.
    expect(screen.getByLabelText('sortFilter.tagGroupTags:1')).toBeInTheDocument()
  })

  it('normalises a legacy flat list on first edit', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness initial={['building']} onChange={onChange} />)
    await user.selectOptions(screen.getByLabelText('sortFilter.tagGroupMode:1'), 'exclude')
    expect(onChange).toHaveBeenLastCalledWith([{ mode: 'exclude', tags: ['building'] }])
  })

  it('shows a readable summary of the expression', () => {
    render(
      <Harness
        initial={[
          { mode: 'include', tags: ['building'] },
          { mode: 'include', tags: ['store', 'shop'] },
        ]}
      />
    )
    expect(
      screen.getByText('building sortFilter.tagQueryAnd (store sortFilter.tagQueryOr shop)')
    ).toBeInTheDocument()
  })

  it('offers the presence sentinels inside a group', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness initial={undefined} onChange={onChange} />)
    await user.click(screen.getByLabelText('sortFilter.tagGroupTags:1'))
    await user.click(screen.getByLabelText('sortFilter.specialNone:Tags'))
    expect(onChange).toHaveBeenLastCalledWith([{ mode: 'include', tags: [FILTER_NONE] }])
  })

  it('keeps an added empty group visible until it is filled in', async () => {
    const user = userEvent.setup()
    render(<Harness initial={[{ mode: 'include', tags: ['building'] }]} />)
    await user.click(screen.getByText('sortFilter.tagGroupAdd'))
    expect(screen.getByLabelText('sortFilter.tagGroupTags:2')).toBeInTheDocument()
  })
})
