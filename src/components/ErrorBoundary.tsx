/**
 * Top-level error boundary.
 *
 * Catches render-phase exceptions from any component in the tree and displays
 * a useful fallback (instead of a blank white screen) plus a "Reload" button.
 *
 * React does NOT catch errors thrown inside event handlers, async callbacks,
 * setTimeout, or the Web Audio graph — those still need try/catch at the call
 * site. But component-level crashes (bad state, unexpected undefined, AlphaTab
 * initialization failures after a prop change) are handled here.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null, errorInfo: null };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log with enough context to debug from DevTools → Console.
    console.error('[OmniTab] render error caught by boundary:', error);
    console.error('[OmniTab] component stack:', errorInfo.componentStack);
    this.setState({ errorInfo });
  }

  private handleReload = (): void => {
    // Full reload gets us out of any stuck client-side state.
    window.location.reload();
  };

  private handleReset = (): void => {
    // Clear the error so the component tree re-renders. Useful if the error
    // was caused by a transient input the user has now changed.
    this.setState({ error: null, errorInfo: null });
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <div
        className="h-full flex items-center justify-center p-6 bg-amp-bg text-amp-text"
        role="alert"
        aria-live="assertive"
      >
        <div className="max-w-xl w-full bg-amp-panel border border-amp-error rounded-lg p-6">
          <div className="flex items-start gap-3 mb-4">
            <div className="text-4xl" aria-hidden="true">
              💥
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-bold text-amp-error mb-1">
                Oups, quelque chose a planté
              </h2>
              <p className="text-sm text-amp-muted">
                Un composant a levé une exception. Tes données ne sont pas
                perdues — elles sont stockées localement. Tu peux essayer de
                continuer, ou recharger l'app pour repartir d'une base propre.
              </p>
            </div>
          </div>

          <details className="mb-4 text-xs">
            <summary className="cursor-pointer text-amp-muted hover:text-amp-text mb-2">
              Détails techniques
            </summary>
            <pre className="bg-amp-bg p-3 rounded border border-amp-border overflow-auto max-h-64 font-mono text-amp-error">
              {this.state.error.message}
              {'\n\n'}
              {this.state.error.stack}
              {this.state.errorInfo?.componentStack}
            </pre>
          </details>

          <div className="flex gap-2 flex-wrap">
            <button
              onClick={this.handleReset}
              className="bg-amp-panel-2 hover:bg-amp-border text-amp-text px-4 py-2 rounded text-sm transition-colors"
            >
              Essayer de continuer
            </button>
            <button
              onClick={this.handleReload}
              className="bg-amp-accent hover:bg-amp-accent-hover text-amp-bg font-bold px-4 py-2 rounded text-sm transition-colors"
            >
              <span aria-hidden="true">🔄 </span>Recharger l'app
            </button>
          </div>
        </div>
      </div>
    );
  }
}
