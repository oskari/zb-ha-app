/**
 * SelfHostSetupDialog.test.jsx — required-field gate, URL auto-fill, backend gate.
 *
 * Send stays clickable so pressing it surfaces the per-field "Please enter a
 * value" errors (empty/NaN Device IP, Image URL, Sleep interval, Full-refresh).
 * The Image URL is pre-filled from the resolved HA host endpoint. Covers the
 * error-on-Send + clear-on-edit behaviour, a malformed IP not dialing, a
 * form-valid send, and the null-pusher disable.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import SelfHostSetupDialog from '../SelfHostSetupDialog.jsx';
import { useUiStore } from '../../store/uiStore.js';

const HOST_IP = '192.168.1.77';
const HOST_PORT = 8000;
const AUTO_URL = `http://${HOST_IP}:${HOST_PORT}/image.bin`;

const setPusher = (handler) => useUiStore.setState({ deviceConfigPusher: handler });
const setHost = (ip, port) => useUiStore.setState({ hostIp: ip, hostPort: port });

function renderDialog(onContinue = () => {}, onClose = () => {}) {
  render(<SelfHostSetupDialog onClose={onClose} onContinue={onContinue} />);
  return {
    ipInput: screen.getByPlaceholderText('192.168.1.42'),
    urlInput: screen.getByDisplayValue(AUTO_URL),
    sendBtn: screen.getByRole('button', { name: 'Send' }),
  };
}

describe('SelfHostSetupDialog — required-field gate + URL auto-fill', () => {
  let pusher;
  beforeEach(() => {
    pusher = vi.fn(async () => ({ ok: true, status: 200, configured: true }));
    setPusher(pusher);
    setHost(HOST_IP, HOST_PORT);
  });
  afterEach(() => {
    cleanup();
    setPusher(null);
    setHost(null, null);
    vi.restoreAllMocks();
  });

  it('pre-fills the Image URL with the add-on endpoint from the resolved host IP', () => {
    const { urlInput } = renderDialog();
    expect(urlInput.value).toBe(AUTO_URL);
  });

  it('keeps Send enabled and shows no error before a Send attempt', () => {
    const { sendBtn } = renderDialog();
    expect(sendBtn.disabled).toBe(false);
    expect(screen.queryByText('Please enter a value')).toBeNull();
  });

  it('clicking Send with an empty Device IP shows the required error and never dials', () => {
    const { sendBtn } = renderDialog();
    fireEvent.click(sendBtn);
    expect(screen.getByText('Please enter a value')).toBeTruthy();
    expect(pusher).not.toHaveBeenCalled();
  });

  it('clears the Device IP error as soon as the user edits the field', () => {
    const { ipInput, sendBtn } = renderDialog();
    fireEvent.click(sendBtn);
    expect(screen.getByText('Please enter a value')).toBeTruthy();
    fireEvent.change(ipInput, { target: { value: '1' } });
    expect(screen.queryByText('Please enter a value')).toBeNull();
  });

  it('flags an empty Image URL on Send', () => {
    const { ipInput, urlInput, sendBtn } = renderDialog();
    fireEvent.change(ipInput, { target: { value: '192.168.1.42' } });
    fireEvent.change(urlInput, { target: { value: '' } });
    fireEvent.click(sendBtn);
    expect(screen.getByText('Please enter a value')).toBeTruthy();
    expect(pusher).not.toHaveBeenCalled();
  });

  it('flags an empty Sleep interval on Send', () => {
    const { ipInput, sendBtn } = renderDialog();
    fireEvent.change(ipInput, { target: { value: '192.168.1.42' } });
    fireEvent.change(screen.getByDisplayValue('900'), { target: { value: '' } });
    fireEvent.click(sendBtn);
    expect(screen.getByText('Please enter a value')).toBeTruthy();
    expect(pusher).not.toHaveBeenCalled();
  });

  it('a malformed (leading-zero) IP is not dialed on Send', () => {
    const { ipInput, sendBtn } = renderDialog();
    fireEvent.change(ipInput, { target: { value: '010.0.0.1' } });
    fireEvent.click(sendBtn);
    expect(pusher).not.toHaveBeenCalled();
  });

  it('a form-valid IP sends and forwards the auto-filled URL', async () => {
    const { ipInput, sendBtn } = renderDialog();
    fireEvent.change(ipInput, { target: { value: '8.8.8.8' } });
    fireEvent.click(sendBtn);
    expect(pusher).toHaveBeenCalledTimes(1);
    expect(pusher.mock.calls[0][0].config.url).toBe(AUTO_URL);
    expect(await screen.findByText(/Device configured|Sent/)).toBeTruthy();
  });

  it('before success the header ✕ returns to the chooser (onClose), not the builder', () => {
    const onClose = vi.fn();
    const onContinue = vi.fn();
    render(<SelfHostSetupDialog onClose={onClose} onContinue={onContinue} />);
    // Pre-success both the ✕ (aria-label "Close") and the footer button resolve
    // to the accessible name "Close"; the ✕ is the one whose glyph is "✕".
    const x = screen.getAllByRole('button', { name: 'Close' }).find((b) => b.textContent === '✕');
    fireEvent.click(x);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onContinue).not.toHaveBeenCalled();
  });
});

describe('SelfHostSetupDialog — success flips Send → Continue', () => {
  let pusher;
  beforeEach(() => {
    pusher = vi.fn(async () => ({ ok: true, status: 200, configured: true }));
    setPusher(pusher);
    setHost(HOST_IP, HOST_PORT);
  });
  afterEach(() => {
    cleanup();
    setPusher(null);
    setHost(null, null);
    vi.restoreAllMocks();
  });

  // Drive a form-valid send to a <400 reply, returning once the success banner
  // (status → ok) is on screen. `onContinue` is the go-to-builder spy.
  async function sendOk(onContinue = () => {}) {
    const { ipInput, sendBtn } = renderDialog(onContinue);
    fireEvent.change(ipInput, { target: { value: '192.168.1.42' } });
    fireEvent.click(sendBtn);
    await screen.findByText(/Device configured|Sent/);
  }

  it('turns Send into Continue and hides the footer Close on a <400 reply', async () => {
    await sendOk();
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy();
    // The footer "Close" (text) is gone; the header ✕ (aria-label only) remains.
    expect(screen.queryByText('Close')).toBeNull();
  });

  it('Continue calls onContinue with the sidebar value (default true)', async () => {
    const onContinue = vi.fn();
    await sendOk(onContinue);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onContinue).toHaveBeenCalledWith(true);
  });

  it('the header ✕ mirrors Continue after success (→ onContinue, not onClose)', async () => {
    const onContinue = vi.fn();
    const onClose = vi.fn();
    render(<SelfHostSetupDialog onClose={onClose} onContinue={onContinue} />);
    fireEvent.change(screen.getByPlaceholderText('192.168.1.42'), { target: { value: '192.168.1.42' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText(/Device configured|Sent/);
    // After success the only element named "Close" is the ✕ (footer Close is gone).
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('forwards sidebar=false to Continue when the box is unchecked before sending', async () => {
    const onContinue = vi.fn();
    const { ipInput, sendBtn } = renderDialog(onContinue);
    fireEvent.click(screen.getByRole('checkbox', { name: /Sidebar column/ }));
    fireEvent.change(ipInput, { target: { value: '192.168.1.42' } });
    fireEvent.click(sendBtn);
    await screen.findByText(/Device configured|Sent/);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onContinue).toHaveBeenCalledWith(false);
  });

  it('locks the IP + config inputs read-only after success', async () => {
    await sendOk();
    expect(screen.getByPlaceholderText('192.168.1.42').readOnly).toBe(true);
    expect(screen.getByDisplayValue(AUTO_URL).readOnly).toBe(true);
    expect(screen.getByDisplayValue('900').readOnly).toBe(true);
    expect(screen.getByRole('checkbox', { name: /Sidebar column/ }).disabled).toBe(true);
  });
});

describe('SelfHostSetupDialog — a non-success reply keeps Send', () => {
  afterEach(() => {
    cleanup();
    setPusher(null);
    setHost(null, null);
    vi.restoreAllMocks();
  });

  it('a device-rejected 4xx keeps Send (no Continue) and leaves fields editable', async () => {
    setPusher(vi.fn(async () => ({ ok: true, status: 400, body: { error: 'bad config' } })));
    setHost(HOST_IP, HOST_PORT);
    const { ipInput, sendBtn } = renderDialog();
    fireEvent.change(ipInput, { target: { value: '192.168.1.42' } });
    fireEvent.click(sendBtn);
    expect(await screen.findByText(/rejected the config/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    expect(screen.getByPlaceholderText('192.168.1.42').readOnly).toBe(false);
  });

  it('a proxy/network error keeps Send (no Continue)', async () => {
    setPusher(vi.fn(async () => { throw new Error('unreachable'); }));
    setHost(HOST_IP, HOST_PORT);
    const { ipInput, sendBtn } = renderDialog();
    fireEvent.change(ipInput, { target: { value: '192.168.1.42' } });
    fireEvent.click(sendBtn);
    expect(await screen.findByText('unreachable')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    expect(screen.getByPlaceholderText('192.168.1.42').readOnly).toBe(false);
  });
});

describe('SelfHostSetupDialog — no backend', () => {
  afterEach(() => {
    cleanup();
    setPusher(null);
    setHost(null, null);
  });

  it('disables Send when deviceConfigPusher is null even for a valid IP', () => {
    setPusher(null);
    setHost(HOST_IP, HOST_PORT);
    render(<SelfHostSetupDialog onClose={() => {}} onContinue={() => {}} />);
    const ipInput = screen.getByPlaceholderText('192.168.1.42');
    const sendBtn = screen.getByRole('button', { name: 'Send' });
    fireEvent.change(ipInput, { target: { value: '192.168.1.42' } });
    expect(sendBtn.disabled).toBe(true);
  });
});
