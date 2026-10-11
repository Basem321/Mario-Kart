import { Component } from "react";

// A CDN/HDR/model failure must never blank the whole game. Wrap the canvas
// (and async screens) so failures show a retry card instead of white screen.
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Game canvas crashed:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100vh",
            gap: 12,
            background: "#0b1020",
            color: "#fff",
            padding: 24,
            textAlign: "center",
          }}
          role="alert"
        >
          <h1 style={{ fontSize: 28 }}>Something went wrong loading the race</h1>
          <p style={{ opacity: 0.8, maxWidth: 520 }}>
            A 3D asset or effect failed to load (this can happen offline on the
            first visit). Your progress is safe — retry the race.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: "10px 22px",
              fontSize: 16,
              borderRadius: 10,
              border: "none",
              cursor: "pointer",
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
