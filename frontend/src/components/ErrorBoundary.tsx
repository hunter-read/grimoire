import { Component } from 'react'
import type { ReactNode } from 'react'
import ErrorFallback from './ErrorFallback'

interface ErrorBoundaryProps {
  children: ReactNode
  /** Clears a caught error when it changes - the location, so navigating away recovers. */
  resetKey?: unknown
}

interface ErrorBoundaryState {
  failed: boolean
}

/**
 * Catches an error thrown while rendering the routed content and shows a
 * recovery panel in its place. Without it React 19 unmounts the whole root and
 * leaves a blank page. The sidebar sits outside, so navigation keeps working.
 *
 * Logging is left to the root's `onCaughtError` (see main.tsx), which React
 * calls for every error a boundary catches.
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true }
  }

  override componentDidUpdate(prev: ErrorBoundaryProps) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) {
      this.setState({ failed: false })
    }
  }

  override render() {
    return this.state.failed ? <ErrorFallback /> : this.props.children
  }
}
