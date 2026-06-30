import React from 'react'

// Catches render-time exceptions anywhere below it so a thrown error shows a
// readable message instead of a blank white screen. The actual error is logged
// to the console for debugging.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Surface in the console so the real stack is visible in production too.
    console.error('Render error caught by ErrorBoundary:', error, info?.componentStack)
  }

  reset = () => {
    this.setState({ error: null })
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex items-center justify-center min-h-[60vh] p-6">
          <div className="max-w-md w-full bg-card border border-rule rounded-2xl shadow-card p-6 text-center">
            <h1 className="text-lg font-bold text-ink mb-1">Something went wrong</h1>
            <p className="text-sm text-gray-500 mb-4">This page hit an unexpected error. The details are in your browser console.</p>
            <pre className="text-left text-[11px] text-red-600 bg-red-50 border border-red-100 rounded-lg p-3 overflow-auto max-h-40 mb-4 whitespace-pre-wrap break-words">
              {String(this.state.error?.message || this.state.error)}
            </pre>
            <div className="flex items-center justify-center gap-2">
              <button onClick={this.reset} className="btn-secondary">Try again</button>
              <button onClick={() => { window.location.href = '/' }} className="btn-primary">Go to dashboard</button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
