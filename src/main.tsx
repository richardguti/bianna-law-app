import { StrictMode, Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (this.state.error) {
      const err = this.state.error as Error
      return (
        <div style={{ padding: 32, fontFamily: 'monospace', background: '#fff', color: '#333', minHeight: '100vh' }}>
          <h2 style={{ color: '#c00', marginBottom: 8 }}>Senior Law Partner — Error</h2>
          <p style={{ marginBottom: 16, fontSize: 13 }}>
            The app hit a JavaScript error. Please send a screenshot of this page for support.
          </p>
          <pre style={{ background: '#f5f5f5', padding: 16, borderRadius: 8, fontSize: 11, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
            {err.message}{'\n\n'}{err.stack}
          </pre>
          <button onClick={() => window.location.reload()}
            style={{ marginTop: 16, padding: '8px 20px', background: '#007AFF', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            Reload App
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
