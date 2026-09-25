import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportClientError } from '../lib/clientErrorReporting';

type Props = {
  children: ReactNode;
  name: string;
};

type State = {
  failed: boolean;
};

export class NonBlockingErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`Full Circle optional feature failed (${this.props.name}):`, error, errorInfo);
    reportClientError(error, errorInfo.componentStack, `optional:${this.props.name}`);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
