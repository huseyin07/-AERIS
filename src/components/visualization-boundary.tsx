"use client";

import {Component, type ErrorInfo, type ReactNode} from "react";

type Props = {children: ReactNode};
type State = {failed: boolean};

export class VisualizationBoundary extends Component<Props, State> {
  state: State = {failed: false};

  static getDerivedStateFromError(): State {
    return {failed: true};
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("AERIS visualization unavailable", error, info.componentStack);
  }

  render() {
    if (this.state.failed) {
      return <div className="sceneFallback" role="status">Visualization temporarily unavailable</div>;
    }
    return this.props.children;
  }
}
