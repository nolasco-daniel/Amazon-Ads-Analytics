import { Component } from 'react';

// Catches render/runtime errors from any child so one broken chart or table
// doesn't blank out the whole dashboard. Shows a small recoverable panel and
// lets the user retry without a full page reload.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('UI crashed:', error, info?.componentStack);
  }

  handleReset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="error">
        <strong>Something went wrong rendering the dashboard.</strong>
        <div style={{ marginTop: 6, fontSize: 13 }}>{this.state.error.message}</div>
        <button className="btn" style={{ marginTop: 10 }} onClick={this.handleReset}>
          Try again
        </button>
      </div>
    );
  }
}
