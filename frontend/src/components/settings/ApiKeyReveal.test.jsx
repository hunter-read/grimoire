import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ApiKeyReveal from './ApiKeyReveal'
import { UISettingsProvider } from '../../context/UISettingsContext'

const apiKey = { id: 'k1', name: 'Homepage' }

beforeEach(() => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue() } })
})

describe('ApiKeyReveal', () => {
  it('shows the key once, with the warning and an example request', () => {
    render(<ApiKeyReveal apiKey={apiKey} secret="grim_secret" onClose={() => {}} />)
    expect(screen.getByText(/Your new key for .Homepage./)).toBeInTheDocument()
    expect(screen.getByText(/won't be able to see it again/)).toBeInTheDocument()
    expect(screen.getByTestId('api-key-secret')).toHaveTextContent('grim_secret')
    expect(screen.getByText(/X-API-Key: grim_secret/)).toBeInTheDocument()
  })

  it('hides the MCP command while the MCP server is off', () => {
    render(<ApiKeyReveal apiKey={apiKey} secret="grim_secret" onClose={() => {}} />)
    expect(screen.queryByTestId('api-key-mcp-example')).toBeNull()
  })

  it('shows how to connect Claude Code when the MCP server is on', () => {
    render(
      <UISettingsProvider value={{ mcp_enabled: true }}>
        <ApiKeyReveal apiKey={apiKey} secret="grim_secret" onClose={() => {}} />
      </UISettingsProvider>
    )
    expect(screen.getByText('Connect an AI assistant (Claude Code):')).toBeInTheDocument()
    expect(screen.getByTestId('api-key-mcp-example')).toHaveTextContent(
      `claude mcp add --transport http grimoire ${window.location.origin}/mcp --header "X-API-Key: grim_secret"`
    )
    expect(screen.getByText(/at least Read on Search/)).toBeInTheDocument()
  })

  it('copies the key to the clipboard', async () => {
    render(<ApiKeyReveal apiKey={apiKey} secret="grim_secret" onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy key' }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('grim_secret'))
    expect(await screen.findByText('Copied to clipboard')).toBeInTheDocument()
  })

  it('survives an unavailable clipboard', async () => {
    navigator.clipboard.writeText.mockRejectedValue(new Error('denied'))
    render(<ApiKeyReveal apiKey={apiKey} secret="grim_secret" onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy key' }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled())
    expect(screen.queryByText('Copied to clipboard')).toBeNull()
  })

  it('closes on Done', () => {
    const onClose = vi.fn()
    render(<ApiKeyReveal apiKey={apiKey} secret="grim_secret" onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onClose).toHaveBeenCalled()
  })
})
