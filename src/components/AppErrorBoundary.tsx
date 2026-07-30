import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCcw } from 'lucide-react';
import { recoverFromStaleBundle } from '../lib/staleBundleRecovery';

type Props = {
  children: ReactNode;
};

type State = {
  error: Error | null;
  retryKey: number;
};

export class AppErrorBoundary extends Component<Props, State> {
  private recoveryAttempts = 0;

  state: State = { error: null, retryKey: 0 };

  static getDerivedStateFromError(error: Error): State {
    return { error, retryKey: 0 };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (recoverFromStaleBundle(error)) return;
    console.error('Full Circle screen error:', error, errorInfo);
    // A render can occasionally fail while a lazy screen is being replaced
    // after an update. Retry once quietly before showing any fallback UI.
    if (this.recoveryAttempts === 0) {
      this.recoveryAttempts += 1;
      window.setTimeout(() => {
        this.setState((state) => ({
          error: null,
          retryKey: state.retryKey + 1,
        }));
      }, 300);
    }
  }

  render() {
    if (!this.state.error) return <div key={this.state.retryKey}>{this.props.children}</div>;

    return (
      <div className="min-h-screen bg-bg text-ink flex items-center justify-center p-6">
        <div className="card max-w-xl w-full p-6 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-coral-soft text-coral">
            <AlertTriangle size={24} />
          </div>
          <h1 className="font-display text-xl font-semibold text-ink">We are reconnecting this screen</h1>
          <p className="mt-2 text-sm text-stone">
            Please try again. Your account and progress are safe.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <button type="button" onClick={() => {
              this.recoveryAttempts = 0;
              this.setState((state) => ({ error: null, retryKey: state.retryKey + 1 }));
            }} className="btn-primary">
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
