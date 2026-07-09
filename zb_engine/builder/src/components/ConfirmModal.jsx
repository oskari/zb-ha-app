/**
 * ConfirmModal.jsx — Modal replacement for browser confirm() dialog
 *
 * ENGINEERING_CONSTRAINTS: NO BROWSER DIALOGS. This component replaces all confirm()
 * calls throughout the builder. Uses existing modal CSS classes from
 * the WG2 core (index.css).
 */

import PropTypes from 'prop-types';

export default function ConfirmModal({ message, onConfirm, onCancel }) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="confirm-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--c-surface)',
          borderRadius: 'var(--radius)',
          boxShadow: 'var(--shadow)',
          padding: 'var(--sp-6)',
          maxWidth: '400px',
          width: '90%',
        }}
      >
        <p style={{ margin: '0 0 var(--sp-5) 0', fontSize: 'var(--text-base)', lineHeight: 1.5, whiteSpace: 'pre-line' }}>
          {message}
        </p>
        <div style={{ display: 'flex', gap: 'var(--sp-2)', justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn"
            onClick={onConfirm}
            style={{
              background: 'var(--c-danger)',
              color: '#fff',
              borderColor: 'var(--c-danger)',
            }}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

ConfirmModal.propTypes = {
  message: PropTypes.string.isRequired,
  onConfirm: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
};
