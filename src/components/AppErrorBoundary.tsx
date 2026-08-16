import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCcw } from 'lucide-react';
import { recoverFromStaleBundle, reloadFreshApp } from '../lib/staleBundleRecovery';

type Props = {
  children: ReactNode;
};

type State = {
  error: Error | null;
  retryKey: number;
};

export class AppErrorBoundary extends Component<Props, State> {
  private recoveryAttempts = 0;
  private retryTimer: number | undefined;

  state: State = { error: null, retryKey: 0 };

  static getDerivedStateFromError(error: Error): State {
    return { error, retryKey: 0 };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (recoverFromStaleBundle(error)) return;
    console.error('Full Circle screen error:', error, errorInfo);
    this.retryQuietly();
  }

  componentDidUpdate(_: Props, previousState: State) {
    if (previousState.error && !this.state.error) this.recoveryAttempts = 0;
  }

  componentWillUnmount() {
    if (this.retryTimer) window.clearTimeout(this.retryTimer);
  }

  private retryQuietly() {
    // Let Vite finish replacing a screen after a hot update before conceding
    // to the fallback. This avoids trapping an already-fixed screen in error UI.
    const delays = [300, 1200, 3000];
    const delay = delays[this.recoveryAttempts];
    if (delay === undefined) return;

    this.recoveryAttempts += 1;
    this.retryTimer = window.setTimeout(() => {
      this.setState((state) => ({
        error: null,
        retryKey: state.retryKey + 1,
      }));
    }, delay);
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
              if (this.retryTimer) window.clearTimeout(this.retryTimer);
              this.setState((state) => ({ error: null, retryKey: state.retryKey + 1 }));
            }} className="btn-primary">
              <RefreshCcw size={16} /> Try Again
            </button>
            <button type="button" onClick={() => void reloadFreshApp()} className="btn-secondary">
              Reload App
            </button>
          </div>
        </div>
      </div>
    );
  }
}
