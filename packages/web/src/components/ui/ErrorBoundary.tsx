import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertCircle, RefreshCw, Home } from 'lucide-react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught error:', error, info.componentStack)
  }

  handleReload = () => {
    window.location.reload()
  }

  handleGoHome = () => {
    window.location.href = '/dashboard'
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-off-white flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-lg border border-light-gray p-8 max-w-md w-full text-center">
            <div className="mx-auto w-12 h-12 bg-red-100 dark:bg-red-900/40 rounded-full flex items-center justify-center mb-4">
              <AlertCircle className="w-6 h-6 text-red-600 dark:text-red-400" />
            </div>
            <h1 className="text-xl font-semibold text-charcoal mb-2">Something went wrong</h1>
            <p className="text-warm-gray text-sm mb-6">
              An unexpected error occurred. Your data is safe — try going back to the dashboard or refreshing the page.
            </p>
            {this.state.error && (
              <details className="mb-6 text-left">
                <summary className="text-xs text-warm-gray cursor-pointer hover:text-charcoal">
                  Error details
                </summary>
                <pre className="mt-2 text-xs text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg p-3 overflow-auto max-h-32">
                  {this.state.error.message}
                </pre>
              </details>
            )}
            <div className="flex gap-3 justify-center">
              <button
                onClick={this.handleGoHome}
                className="flex items-center gap-2 px-4 py-2 bg-slate-blue text-white rounded-lg hover:bg-slate-blue/90 text-sm font-medium"
              >
                <Home size={16} />
                Go to Dashboard
              </button>
              <button
                onClick={this.handleRetry}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-light-gray text-charcoal rounded-lg hover:bg-off-white text-sm font-medium"
              >
                <RefreshCw size={16} />
                Try Again
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
