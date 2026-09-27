// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import DocumentCentreAdd, { type KindGroupSpec } from './document-centre-add';
import type { CredentialKind } from '@/lib/licence-centre-api';

// ────────────────────────────────────────────────────────────────────
// ONE UPLOADER, AND "WORK IT OUT FOR ME" IS STILL THE FIRST THING IN IT.
//
// The Evidence panel is gone: there is no separate input that asks the member
// to name a document before anything has looked at it. What remains is this
// menu — two buttons, one list — and the list's first entry must keep being
// "Work it out for me", because the classifier is good and the common case
// must not become slower than it already was.
//
// ⚠️ AND PICKING IT MUST OPEN THE FILE DIALOG IN THE SAME GESTURE. iOS Safari
// refuses a programmatic file dialog that is not attached to a user gesture,
// so `pick()` calls the input's click() synchronously inside the button's own
// onClick. Deferring it — behind a state update or an await — is the bug this
// test pins shut, and it is invisible on a desktop where the dialog opens
// anyway.
//
// ⚠️ NOTHING IS POLISHED HERE ANY MORE. This component used to run the
// scanner treatment on the way to `onFiles`, before the server had seen the
// bytes. It does not now: the role of a file is not known until the model has
// answered, and an evidence photograph must never be cropped or deshadowed.
// These tests hand over the very File objects that were picked — the page is
// responsible for the treatment, after identify, and only for documents.
// ────────────────────────────────────────────────────────────────────

const GROUPS: KindGroupSpec[] = [
  {
    label: 'Your licences',
    kinds: ['FIREARM_LICENCE', 'COMPETENCY_CERTIFICATE'] as CredentialKind[],
  },
];

const noop = () => undefined;

function open(over: Partial<React.ComponentProps<typeof DocumentCentreAdd>> = {}) {
  const props = {
    groups: GROUPS,
    busy: false,
    onFiles: vi.fn(),
    onHandoffArrived: noop,
    ...over,
  };
  const utils = render(<DocumentCentreAdd {...props} />);
  const upload = screen.getByRole('button', { name: 'Upload' });
  fireEvent.click(upload);
  return { ...utils, props, upload };
}

describe('the one uploader\u2019s menu', () => {
  it('\u26a0\ufe0f OFFERS "WORK IT OUT FOR ME" FIRST', () => {
    open();
    const panel = screen.getByLabelText('What are you adding?');
    const buttons = Array.from(panel.querySelectorAll('button'));
    expect(buttons[0]?.textContent).toContain('Work it out for me');
  });

  it('\u26a0\ufe0f OPENS THE FILE DIALOG IN THE SAME GESTURE', () => {
    // The click() must happen synchronously inside the React event, before any
    // re-render — that is what "still on the user gesture" means to Safari.
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click');
    const { container } = open();
    clickSpy.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Work it out for me/ }));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).toBeTruthy();
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(clickSpy.mock.instances[0]).toBe(input);
    clickSpy.mockRestore();
  });

  it('hands the picked files over to be classified, with no kind chosen', () => {
    const onFiles = vi.fn();
    const { container } = open({ onFiles });
    fireEvent.click(screen.getByRole('button', { name: /Work it out for me/ }));
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
    fireEvent.click(screen.getByRole('button', { name: /Work it out for me/ }));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const hunt = new File(['bytes'], 'hunt.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [hunt] } });
    expect(onFiles.mock.calls[0][0][0]).toBe(hunt);
  });

  it('opens the dialog straight away for an ordinary kind too', () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click');
    open();
    clickSpy.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Firearm licence/ }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
  });

  it('\u26a0\ufe0f STOPS AT THE ADVICE FOR THE SAFE PHOTOGRAPHS, RATHER THAN THE DIALOG', () => {
    // "Add several: the safe closed, half open..." is the last screen before
    // the phone is in the member's hand, and the dialog must not open over it.
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click');
    open({
      groups: [
        { label: 'Your safe', kinds: ['SAFE_PHOTOGRAPHS'] as CredentialKind[] },
      ],
    });
    clickSpy.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Photographs of my safe/ }));
    expect(clickSpy).not.toHaveBeenCalled();
    expect(screen.getByText(/the safe closed, half open/i)).toBeTruthy();
    clickSpy.mockRestore();
  });
});
