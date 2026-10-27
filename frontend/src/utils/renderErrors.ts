import type { ErrorInfo } from 'react'

/**
 * A `createRoot` error hook (`onCaughtError` / `onUncaughtError`) that logs the
 * error with the page it happened on and the component stack, which the bare
 * error React would otherwise log does not say. There is no endpoint to send
 * client errors to, so the console is where they go.
 */
export function logRenderError(kind: 'caught' | 'uncaught') {
  return (error: unknown, info: Pick<ErrorInfo, 'componentStack'>): void => {
    console.error(
      `Grimoire: ${kind} render error on ${window.location.pathname}`,
      error,
      info.componentStack ?? ''
    )
  }
}
