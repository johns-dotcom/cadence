import React from 'react'

// Catches render-time exceptions anywhere below it so a thrown error shows a
// readable message instead of a blank white screen. The actual error is logged
// to the console for debugging.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null, stack: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Surface in the console so the real stack is visible in production too
    // (sourcemaps are enabled, so this points at the actual file:line).
    console.error('Render error caught by ErrorBoundary:', error, info?.componentStack)
    this.setState({ stack: info?.componentStack || null })
  }

  // A hard reload pulls the current build (fixes stale-chunk crashes after a
  // deploy) and clears any bad transient state.
  reset = () => { window.location.reload() }

  render() {
    if (this.state.error) {
      return (
        <div className="flex items-center justify-center min-h-[60vh] p-6">
          <div className="max-w-md w-full bg-card border border-rule rounded-2xl shadow-card p-6 text-center">
            <h1 className="text-lg font-bold text-ink mb-1">Something went wrong</h1>
            <p className="text-sm text-gray-500 mb-4">This page hit an unexpected error. The details are in your browser console.</p>
            <pre className="text-left text-[11px] text-red-600 bg-red-50 border border-red-100 rounded-lg p-3 overflow-auto max-h-40 mb-3 whitespace-pre-wrap break-words">
              {String(this.state.error?.message || this.state.error)}
            </pre>
            {this.state.stack && (
              <details className="text-left mb-4">
                <summary className="text-[11px] text-gray-400 cursor-pointer">Where this happened</summary>
                <pre className="text-[10px] text-gray-500 bg-gray-50 border border-rule rounded-lg p-3 overflow-auto max-h-40 mt-1 whitespace-pre-wrap break-words">{this.state.stack.trim()}</pre>
              </details>
            )}
            <div className="flex items-center justify-center gap-2">
              <button onClick={this.reset} className="btn-secondary">Reload</button>
              <button onClick={() => { window.location.href = '/' }} className="btn-primary">Go to dashboard</button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
