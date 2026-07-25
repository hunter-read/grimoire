import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CodexModeProvider, useCodexMode } from './CodexModeContext'

function Probe() {
  const { codex, toggleCodex, setCodex } = useCodexMode()
  return (
    <div>
      <div data-testid="state">{String(codex)}</div>
      <button onClick={toggleCodex}>toggle</button>
      <button onClick={() => setCodex(true)}>on</button>
      <button onClick={() => setCodex(false)}>off</button>
    </div>
  )
}

function renderProbe() {
  return render(
    <CodexModeProvider>
      <Probe />
    </CodexModeProvider>
  )
}

describe('CodexModeContext', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-mode')
  })

  it('defaults to off with no provider', () => {
    render(<Probe />)
    expect(screen.getByTestId('state').textContent).toBe('false')
  })

  it('starts off and applies no data-mode attribute', () => {
    renderProbe()
    expect(screen.getByTestId('state').textContent).toBe('false')
    expect(document.documentElement.getAttribute('data-mode')).toBe(null)
  })

  it('toggles on, sets the data-mode attribute, and persists', () => {
    renderProbe()
    fireEvent.click(screen.getByText('toggle'))
    expect(screen.getByTestId('state').textContent).toBe('true')
    expect(document.documentElement.getAttribute('data-mode')).toBe('codex')
    expect(localStorage.getItem('grimoire_codex_mode')).toBe('true')
  })

  it('toggles back off and clears the attribute', () => {
    renderProbe()
    fireEvent.click(screen.getByText('toggle'))
    fireEvent.click(screen.getByText('toggle'))
    expect(screen.getByTestId('state').textContent).toBe('false')
    expect(document.documentElement.getAttribute('data-mode')).toBe(null)
    expect(localStorage.getItem('grimoire_codex_mode')).toBe('false')
  })

  it('setCodex explicitly enables and disables', () => {
    renderProbe()
    fireEvent.click(screen.getByText('on'))
    expect(screen.getByTestId('state').textContent).toBe('true')
    fireEvent.click(screen.getByText('off'))
    expect(screen.getByTestId('state').textContent).toBe('false')
  })

  it('reads the initial value from localStorage', () => {
    localStorage.setItem('grimoire_codex_mode', 'true')
    renderProbe()
    expect(screen.getByTestId('state').textContent).toBe('true')
    expect(document.documentElement.getAttribute('data-mode')).toBe('codex')
  })
})
