"use client";

import {Component, type ErrorInfo, type ReactNode} from "react";

type Props = {children: ReactNode; fallback?: ReactNode; onFailure?: () => void};
type State = {failed: boolean};

export class VisualizationBoundary extends Component<Props, State> {
  state: State = {failed: false};

  static getDerivedStateFromError(): State {
    return {failed: true};
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("AERIS visualization unavailable", error, info.componentStack);
    this.props.onFailure?.();
  }

  render() {
    if (this.state.failed) {
      return <div className="sceneFallback" role="status">{this.props.fallback ?? "Visualization temporarily unavailable"}</div>;
    }
    return this.props.children;
  }
}
