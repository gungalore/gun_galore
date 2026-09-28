// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import DocumentCentreAdd from './document-centre-add';

// ────────────────────────────────────────────────────────────────────
// TWO BUTTONS, AND NO TYPE MENU.
//
// Operator, 2026-09-27: "I want this selection dropdown removed from the
// upload and Scan with phone. The AI already decides what document it is.
// Upload button open the file list automatically and the scan button opens
// the QR code."
//
// Upload opens the OS dialog IN THE SAME GESTURE (iOS Safari refuses a
// programmatic dialog that is not attached to a tap) and hands the raw File
// objects over with no declared kind. Scan mounts ScanButton, which picks the
// QR or the camera itself.
// ────────────────────────────────────────────────────────────────────

// The real ScanButton pulls in next/dynamic and the media-device probe; this
// stub exists only to prove WHEN it is mounted and with what.
vi.mock('@/components/scan/scan-button', async () => {
  const React = await import('react');
  return {
    default: (props: { autoStart?: boolean; onClosed?: () => void }) =>
      React.createElement(
        'button',
        {
          'data-testid': 'scan-button',
          'data-autostart': String(props.autoStart),
          onClick: props.onClosed,
        },
        'scan',
      ),
  };
});

const noop = () => undefined;

function open(over: Partial<React.ComponentProps<typeof DocumentCentreAdd>> = {}) {
  const props = {
    busy: false,
    onFiles: vi.fn(),
    onHandoffArrived: noop,
    ...over,
  };
  const utils = render(<DocumentCentreAdd {...props} />);
  return { ...utils, props };
}

describe('the two-button uploader', () => {
  it('\u26a0\ufe0f OPENS THE FILE DIALOG IN THE SAME GESTURE', () => {
    // The click() must happen synchronously inside the React event, before any
    // re-render — that is what "still on the user gesture" means to Safari.
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click');
    const { container } = open();
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).toBeTruthy();
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(clickSpy.mock.instances[0]).toBe(input);
    clickSpy.mockRestore();
  });

  it('\u26a0\ufe0f SHOWS NO TYPE MENU WHEN UPLOAD IS PRESSED', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    expect(screen.queryByText(/work it out for me/i)).toBeNull();
    expect(screen.queryByText(/what are you adding/i)).toBeNull();
  });

  it('hands the picked files over to be classified, with no kind declared', () => {
    const onFiles = vi.fn();
    const { container } = open({ onFiles });
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const photo = new File(['x'], 'licence.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [photo] } });
    expect(onFiles).toHaveBeenCalledWith([photo], '');
  });

  it('\u26a0\ufe0f HANDS OVER THE RAW FILE — NOTHING IS POLISHED IN THIS COMPONENT', () => {
    // The exact same object, byte for byte. If the treatment ever moves back
    // into this file, evidence photographs start arriving cropped.
    const onFiles = vi.fn();
    const { container } = open({ onFiles });
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const hunt = new File(['bytes'], 'hunt.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [hunt] } });
    expect(onFiles.mock.calls[0][0][0]).toBe(hunt);
  });

  it('\u26a0\ufe0f SCAN MOUNTS THE SCANNER ON AUTO-START — NO MENU FIRST', () => {
    open();
    expect(screen.queryByTestId('scan-button')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Scan with phone' }));
    const scan = screen.getByTestId('scan-button');
    expect(scan.getAttribute('data-autostart')).toBe('true');
    // Closing the scanner takes the buttons back to Upload / Scan.
    fireEvent.click(scan);
    expect(screen.queryByTestId('scan-button')).toBeNull();
  });

  it('disables both buttons while busy', () => {
    open({ busy: true });
    expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Scan with phone' })).toBeDisabled();
  });
});
