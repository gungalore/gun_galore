// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render } from '@testing-library/react';
import LicenceCardCapture from './licence-card-capture';

// ────────────────────────────────────────────────────────────────────
// THE WRAPPER THAT RUNS THE SCANNER TWICE.
//
// ⚠️ THE TWO SCANNERS FINISH DIFFERENTLY AND THIS FILE HAD NO SPEC, which is
// how the mismatch reached production. V2 treated "finished a shot" and "close
// the camera" as ONE event — finish() called onClose() and THEN onDone(),
// synchronously, one file at a time. V3 collects PAGES, hands them over in a
// single onDone(files), and never calls onClose() at all.
//
// Moving the consent page to V3 on 2026-09-08 therefore produced three
// symptoms with one cause: the camera never returned to the form, a member who
// shot both sides in one pass had the back silently dropped, and "Give my
// consent" stayed disabled forever because `photographed` needs both.
//
// So these assert the CONTRACT, not the pixels: what the wrapper does with one
// file, with two, and with more than two.
// ────────────────────────────────────────────────────────────────────

type ScannerProps = {
  onDone: (files: File[]) => void;
  onClose: () => void;
  title: string;
  subtitle?: string;
};

const scanner = vi.hoisted(() => ({ current: null as ScannerProps | null }));

// `dynamic()` is how the scanner is loaded, and which scanner it resolves to is
// a build-time flag. Replacing it with a stub lets the test drive either
// contract by hand.
vi.mock('next/dynamic', () => ({
  default: () => (props: ScannerProps) => {
    scanner.current = props;
    return <div data-testid="scanner" />;
  },
}));

const file = (name: string) =>
  new File(['x'], name, { type: 'image/jpeg' });

beforeEach(() => {
  scanner.current = null;
});

function mount() {
  const onSide = vi.fn();
  const onDone = vi.fn();
  const onClose = vi.fn();
  render(
    <LicenceCardCapture onSide={onSide} onDone={onDone} onClose={onClose} />,
  );
  return { onSide, onDone, onClose };
}

describe('V3 — both sides arrive together', () => {
  it('⚠️ TAKES THE FRONT AND THE BACK, not just files[0]', async () => {
    const { onDone, onSide } = mount();
    await act(async () => {
      scanner.current!.onDone([file('a.jpg'), file('b.jpg')]);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
    const pair = onDone.mock.calls[0][0];
    expect(pair.front.name).toBe('a.jpg');
    expect(pair.back.name).toBe('b.jpg');
    // Both sides are handed to the early read, in order.
    expect(onSide.mock.calls.map((c) => c[0])).toEqual(['front', 'back']);
  });

  it('⚠️ CLOSES THE CAMERA ITSELF, because V3 never calls onClose', async () => {
    const { onClose } = mount();
    await act(async () => {
      scanner.current!.onDone([file('a.jpg'), file('b.jpg')]);
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('⚠️ TAKES TWO AND NO MORE — a third page is not a third side', async () => {
    const { onDone } = mount();
    await act(async () => {
      scanner.current!.onDone([file('a.jpg'), file('b.jpg'), file('c.jpg')]);
    });
    const pair = onDone.mock.calls[0][0];
    expect(pair.front.name).toBe('a.jpg');
    expect(pair.back.name).toBe('b.jpg');
  });
});

describe('V2 — one side at a time', () => {
  it('still runs the two-pass flow and closes at the end', async () => {
    const { onDone, onClose } = mount();
    await act(async () => {
      scanner.current!.onDone([file('front.jpg')]);
    });
    // Front only: not finished, and the surface stays up for the back.
    expect(onDone).not.toHaveBeenCalled();

    await act(async () => {
      scanner.current!.onDone([file('back.jpg')]);
    });
    const pair = onDone.mock.calls[0][0];
    expect(pair.front.name).toBe('front.jpg');
    expect(pair.back.name).toBe('back.jpg');
    expect(onClose).toHaveBeenCalled();
  });
});

describe('what it refuses to treat as an error', () => {
  it('⚠️ NO FILE IS NOT AN ERROR TO SHOW A STRANGER', async () => {
    // Permission withdrawn mid-flow, a cancelled review. Leave them where they
    // were rather than throwing a dialog at somebody doing a favour.
    const { onDone } = mount();
    await act(async () => {
      scanner.current!.onDone([]);
    });
    expect(onDone).not.toHaveBeenCalled();
  });

  it('says there are two pictures, on both passes', () => {
    mount();
    expect(scanner.current!.subtitle).toMatch(/[Tt]wo pictures/);
  });
});
