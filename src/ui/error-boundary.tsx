import { Component, type ErrorInfo, type ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

interface ErrorBoundaryState {
  failed: boolean;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Agent Benchmarks UI crashed", error, info.componentStack);
  }

  override render() {
    if (!this.state.failed) {
      return this.props.children;
    }
    return (
      <div className="mx-auto mt-16 max-w-xl px-4">
        <Alert variant="destructive">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>
            Agent Benchmarks hit an unexpected error while drawing this page. Your archive is untouched;
            reloading usually clears it.
          </AlertDescription>
          <Button className="mt-4" onClick={() => window.location.reload()} type="button">
            Reload Agent Benchmarks
          </Button>
        </Alert>
      </div>
    );
  }
}
