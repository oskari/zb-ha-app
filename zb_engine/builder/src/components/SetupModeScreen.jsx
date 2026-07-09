/**
 * SetupModeScreen.jsx — "How do you want to set up?" two-tile host
 *
 * Inserted after the canvas-size step for NEW widgets only
 * (welcome → gridSelect → setupMode → editor); existing widgets skip it. Also
 * re-openable later as an embedded modal from the Settings tab.
 *
 * Offers two tiles:
 *   • Using the mobile application (recommended) → AppSetupGuide
 *   • Self-host (advanced) → SelfHostSetupDialog
 * Neither tile is pre-selected: the user must pick one (which both highlights it
 * and opens its dialog) before "Continue to builder" will proceed — clicking
 * Continue with nothing chosen surfaces an inline error. The chosen dialog
 * renders over the tiles; its Close/OK returns to the chooser but keeps the
 * selection so Continue stays enabled.
 *
 * Same overlay family as WelcomeScreen / GridSizeSelector. Platform-agnostic
 * (core): the child dialogs read the injected pusher from uiStore themselves.
 */

import { useState } from 'react';
import PropTypes from 'prop-types';
import AppSetupGuide from './AppSetupGuide.jsx';
import SelfHostSetupDialog from './SelfHostSetupDialog.jsx';
import TablerIcon from './TablerIcon.jsx';
import { useDocStore } from '../store/docStore.js';
import { DISPLAY_PRESETS } from '../store/displayConfigStore.js';

export default function SetupModeScreen({ onContinue, embedded = false }) {
  const [mode, setMode] = useState('choose'); // 'choose' | 'app' | 'selfhost' — which dialog is open
  const [selected, setSelected] = useState(null); // null | 'app' | 'selfhost' — the persisted choice
  const [continueError, setContinueError] = useState('');
  const backToChoose = () => setMode('choose');

  // Picking a tile both records the choice (highlight + unlocks Continue) and
  // opens that tile's dialog.
  const choose = (which) => {
    setSelected(which);
    setContinueError('');
    setMode(which);
  };

  // App-guide OK returns to the two-tile chooser (both embedded and new-widget
  // flows). The "Using the mobile application" choice stays selected, so the user
  // lands back on the middle screen and presses "Continue to builder" to proceed.
  const handleGuideOk = backToChoose;

  // Continue requires a choice first (guarantees an intentional setup path).
  const handleContinue = () => {
    if (!selected) {
      setContinueError('Please choose how you want to set up above.');
      return;
    }
    onContinue();
  };

  // Self-host Send succeeded → go to the builder. Self-host widgets are always
  // full screen, so in the NEW-WIDGET (welcome) flow we pin the widget to the
  // full device screen at the size the sidebar toggle implies: sidebar on →
  // 720×480 (HA sidebar column reserved), off → 800×480 (whole screen). The
  // embedded Settings flow re-opens over an EXISTING widget, so it must never
  // resize — we skip the pin there and only navigate.
  const handleSelfHostContinue = (sidebar) => {
    if (!embedded) {
      const preset = sidebar ? DISPLAY_PRESETS.panel : DISPLAY_PRESETS.full;
      useDocStore.getState().setFocusedFullScreen(preset);
    }
    onContinue();
  };

  const tile = (which, { badge, icon, title, desc }) => (
    <button
      type="button"
      className={'setup-tile' + (selected === which ? ' setup-tile--selected' : '')}
      aria-pressed={selected === which}
      onClick={() => choose(which)}
    >
      <span className="setup-tile-badge">{badge}</span>
      <span className="setup-tile-icon" aria-hidden="true">
        <TablerIcon name={icon} size={32} />
      </span>
      <span className="setup-tile-title">{title}</span>
      <span className="setup-tile-desc">{desc}</span>
    </button>
  );

  const card = (
    <div className="setup-card" onClick={embedded ? (e) => e.stopPropagation() : undefined}>
      {embedded && (
        <button
          type="button"
          className="btn setup-close"
          onClick={onContinue}
          aria-label="Close"
          style={{ position: 'absolute', top: 'var(--sp-3)', right: 'var(--sp-3)' }}
        >
          ✕
        </button>
      )}

      <h2 className="setup-title">How do you want to set up?</h2>
      <p className="setup-subtitle">Choose how you&apos;ll connect your device.</p>

      <div className="setup-tiles">
        {tile('app', {
          badge: 'Recommended',
          icon: 'device-mobile',
          title: 'Using the mobile application',
          desc: 'Guided setup, straight from your phone.',
        })}
        {tile('selfhost', {
          badge: 'Advanced',
          icon: 'device-desktop',
          title: 'Self-host',
          desc: 'Send the config to a device on your LAN.',
        })}
      </div>

      {!embedded && (
        <>
          <button type="button" className="btn btn-primary setup-continue" onClick={handleContinue}>
            Continue to builder →
          </button>
          {continueError && (
            <p className="setup-continue-error" role="alert">
              {continueError}
            </p>
          )}
        </>
      )}

      {mode === 'app' && <AppSetupGuide onOk={handleGuideOk} />}
      {mode === 'selfhost' && (
        <SelfHostSetupDialog onClose={backToChoose} onContinue={handleSelfHostContinue} />
      )}
    </div>
  );

  if (embedded) {
    return (
      <div className="modal-overlay" onClick={onContinue}>
        {card}
      </div>
    );
  }
  return <div className="setup-overlay">{card}</div>;
}

SetupModeScreen.propTypes = {
  onContinue: PropTypes.func.isRequired,
  embedded: PropTypes.bool,
};
