/**
 * AppSetupGuide.jsx — "Using the mobile application" how-to guide
 *
 * Opened from the recommended tile on SetupModeScreen. For now the body is a
 * single cursive "coming soon :)" placeholder; the OK button hands control back
 * to the parent (which enters the canvas builder on the new-widget flow, or just
 * returns to the tile chooser when re-opened from Settings).
 *
 * Follows the ConfirmModal `modal-overlay` pattern — all feedback is in-app, no
 * browser dialogs (Constraint U2). Platform-agnostic (core).
 */

import PropTypes from 'prop-types';

// TODO(copy): replace "coming soon :)" with real numbered steps later.
export default function AppSetupGuide({ onOk }) {
  return (
    <div className="modal-overlay">
      <div
        className="setup-guide-modal"
        style={{
          background: 'var(--c-surface)',
          borderRadius: 'var(--radius)',
          boxShadow: 'var(--shadow)',
          padding: 'var(--sp-6)',
          maxWidth: '440px',
          width: '90%',
          textAlign: 'center',
        }}
      >
        <h2 className="setup-title" style={{ marginTop: 0, fontSize: 'var(--text-lg)' }}>
          Using the mobile application
        </h2>
        <p className="setup-guide-comingsoon">coming soon :)</p>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <button type="button" className="btn btn-primary" onClick={onOk}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

AppSetupGuide.propTypes = {
  onOk: PropTypes.func.isRequired,
};
