import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCcw } from 'lucide-react';

type Props = {
  children: ReactNode;
};

type State = {
  error: Error | null;
  retryKey: number;
};

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null, retryKey: 0 };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Full Circle screen error:', error, errorInfo);
  }

  render() {
    if (!this.state.error) return <div key={this.state.retryKey}>{this.props.children}</div>;

    return (
      <div className="min-h-screen bg-bg text-ink flex items-center justify-center p-6">
        <div className="card max-w-xl w-full p-6 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-coral-soft text-coral">
            <AlertTriangle size={24} />
          </div>
          <h1 className="font-display text-xl font-semibold text-ink">The screen hit an error</h1>
          <p className="mt-2 text-sm text-stone">
            Refresh once. If it appears again, send this message so I can fix the exact line.
          </p>
          <pre className="mt-4 max-h-44 overflow-auto rounded-lg border border-border bg-surface-2 p-3 text-left text-xs text-stone">
            {this.state.error.message}
          </pre>
          <div className="mt-4 flex justify-center gap-2">
            <button type="button" onClick={() => this.setState((state) => ({ error: null, retryKey: state.retryKey + 1 }))} className="btn-primary">
              <RefreshCcw size={16} /> Try Again
            </button>
            <button type="button" onClick={() => window.location.reload()} className="btn-secondary">
              Reload App
            </button>
          </div>
        </div>
      </div>
    );
  }
}
