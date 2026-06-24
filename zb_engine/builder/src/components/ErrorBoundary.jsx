/**
 * ErrorBoundary.jsx — top-level crash guard for the builder.
 *
 * Without a boundary, ANY uncaught render error unmounts React's whole tree,
 * leaving a black screen with no clue what went wrong (see the graph Data Path
 * binding crash). This catches such errors, keeps the page alive, and shows the
 * message + stack so the failure is diagnosable instead of silent.
 */

import { Component } from 'react';
import PropTypes from 'prop-types';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Surface in the console for DevTools — the place a black screen used to
    // hide everything.
    console.error('[builder] Uncaught render error:', error, info?.componentStack);
  }

  handleReset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        role="alert"
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          padding: '32px',
          overflow: 'auto',
          background: 'var(--c-bg, #161618)',
          color: 'var(--c-text, #e8e8e8)',
          fontFamily: 'var(--font-sans, system-ui, sans-serif)',
        }}
      >
        <h1 style={{ margin: 0, fontSize: '18px' }}>Something went wrong</h1>
        <p style={{ margin: 0, opacity: 0.8, fontSize: '13px' }}>
          The builder hit an unexpected error and stopped rendering. Your work is
          still saved. Details below — please report them.
        </p>
        <pre
          style={{
            margin: 0,
            padding: '12px',
            background: 'var(--c-surface, #1f1f23)',
            border: '1px solid var(--c-border, #333)',
            borderRadius: 'var(--radius, 6px)',
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: '12px',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {String(error?.stack || error?.message || error)}
        </pre>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            Reload builder
          </button>
          <button className="btn" onClick={this.handleReset}>
            Try to continue
          </button>
        </div>
      </div>
    );
  }
}

ErrorBoundary.propTypes = {
  children: PropTypes.node,
};
