import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import AccessLevelPicker from './AccessLevelPicker'
import { useAuth } from '../../context/AuthContext'

vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k, opts) => (opts?.level ? `${k}:${opts.level}` : k) }),
}))

const asRole = (role) => useAuth.mockReturnValue({ user: { role } })

beforeEach(() => vi.clearAllMocks())

describe('AccessLevelPicker', () => {
  it('renders nothing for a GM', () => {
    // Hidden rather than disabled: the backend rejects the write, so a picker
    // a GM cannot submit would be a lie.
    asRole('gm')
    const { container } = render(<AccessLevelPicker value={null} onChange={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for a player', () => {
    asRole('player')
    const { container } = render(<AccessLevelPicker value={null} onChange={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders for an admin', () => {
    asRole('admin')
    render(<AccessLevelPicker value={null} onChange={() => {}} />)
    expect(screen.getByLabelText('access.pickerLabel')).toBeInTheDocument()
  })

  it('offers the inherit option for books', () => {
    asRole('admin')
    render(<AccessLevelPicker value={null} onChange={() => {}} />)
    expect(screen.getByRole('option', { name: 'access.levels.inherit' })).toBeInTheDocument()
  })

  it('omits inherit for systems, which have nothing to inherit from', () => {
    asRole('admin')
    render(<AccessLevelPicker value="" allowInherit={false} onChange={() => {}} />)
    expect(screen.queryByRole('option', { name: 'access.levels.inherit' })).toBeNull()
  })

  it('shows a null value as inherit', () => {
    asRole('admin')
    render(<AccessLevelPicker value={null} onChange={() => {}} />)
    expect(screen.getByLabelText('access.pickerLabel')).toHaveValue('inherit')
  })

  it('shows an explicit open as open, not inherit', () => {
    asRole('admin')
    render(<AccessLevelPicker value="" onChange={() => {}} />)
    expect(screen.getByLabelText('access.pickerLabel')).toHaveValue('')
  })

  it('reports the chosen level', () => {
    asRole('admin')
    const onChange = vi.fn()
    render(<AccessLevelPicker value={null} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('access.pickerLabel'), { target: { value: 'gm' } })
    expect(onChange).toHaveBeenCalledWith('gm')
  })

  it('explains what an inherited level resolves to', () => {
    asRole('admin')
    render(<AccessLevelPicker value={null} effectiveLevel="admin" onChange={() => {}} />)
    expect(screen.getByText('access.inheritedAs:access.levels.admin')).toBeInTheDocument()
  })

  it('does not explain resolution for an explicit level', () => {
    asRole('admin')
    render(<AccessLevelPicker value="gm" effectiveLevel="gm" onChange={() => {}} />)
    expect(screen.queryByText(/access.inheritedAs/)).toBeNull()
  })
})
