// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import FilePickerButton from '@/components/file-picker-button';

// ────────────────────────────────────────────────────────────────────
// THE TWO BRANCHES OF THE FLAG, AND THE FILE THAT MUST SURVIVE BOTH.
//
// NEXT_PUBLIC_SCANNER_V3 is read once, at module load, and decides whether
// this component is the old picker or the picker-plus-scanner. The whole
// point of the off branch is that it is IDENTICAL to today — no overlay, no
// detector, no asset fetch — so it is asserted, not assumed.
//
// ⚠️ THE SCANNER ITSELF IS MOCKED, AND THE MOCK IS WHAT MAKES THE TEST
// ABOUT THIS COMPONENT. Real detection needs an ONNX model and a worker;
// what is being checked here is the wiring — that a picked file reaches the
// overlay, and that the overlay's output reaches onFiles.
//
// ⚠️ THE LAST CASE IS THE ONE THAT MATTERS MOST. A file the browser cannot
// decode used to reach the server raw; behind the scanner it would be
// dropped with "We could not open that file". That is a document lost to an
// enhancement, so it is pinned.
// ────────────────────────────────────────────────────────────────────

// next/dynamic -> React.lazy, so the overlay is a real (Suspense-wrapped) child.
vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<unknown>) => {
    const Lazy = React.lazy(loader as never) as React.ComponentType<Record<string, unknown>>;
    return (props: Record<string, unknown>) =>
      React.createElement(React.Suspense, { fallback: null }, React.createElement(Lazy, props));
  },
}));

// The overlay stub surfaces the files it was handed and lets the test stand in
// for the member pressing "Use": onDone with what the scanner would produce.
// "use" mirrors the real overlay, which closes itself once onDone settles —
// see the finally in document-enhance-overlay.tsx.
vi.mock('@/components/scan-upload/document-enhance-overlay', () => ({
  default: ({ files, onDone, onClose }: { files: File[]; onDone: (f: File[]) => void; onClose: () => void }) =>
    React.createElement(
      'div',
      { 'data-testid': 'overlay' },
      React.createElement('span', null, `overlay:${files.length}`),
      React.createElement(
        'button',
        {
          type: 'button',
          onClick: () => {
            onDone([new File(['done'], 'scan.jpg', { type: 'image/jpeg' })]);
            onClose();
          },
        },
        'use',
      ),
      React.createElement('button', { type: 'button', onClick: onClose }, 'close'),
    ),
}));

/** Import the component fresh, with the flag pinned to the state under test. */
async function loadEnhancer(v3: boolean) {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_SCANNER_V3', v3 ? '1' : '');
  const mod = await import('./document-enhancer');
  return mod.default;
}

function pickJpeg() {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
  fireEvent.change(input, { target: { files: [file] } });
  return file;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('DocumentEnhancer — flag off', () => {
  it('hands picked files straight to onFiles, with no overlay', async () => {
    const DocumentEnhancer = await loadEnhancer(false);
    const onFiles = vi.fn();
    render(<DocumentEnhancer onFiles={onFiles} title="Photograph a document" />);

    const file = pickJpeg();

    await waitFor(() => expect(onFiles).toHaveBeenCalledTimes(1));
    expect(onFiles).toHaveBeenCalledWith([file]);
    expect(screen.queryByTestId('overlay')).toBeNull();
  });

  // ⚠️ THE OFF BRANCH IS TODAY'S BEHAVIOUR, NOT A DEGRADED MODE. The flag's
  // resting state may well be off in production, so a stray prop here is a
  // visible change on the default path. showPicked in particular was passed
  // once and added a filename caption the legacy picker never rendered.
  it('renders exactly what the legacy picker renders, caption included', async () => {
    const DocumentEnhancer = await loadEnhancer(false);

    // A pick, because the caption this guards against only appears once a
    // file is chosen — comparing the resting state alone would miss it.
    const a = render(<DocumentEnhancer onFiles={vi.fn()} title="Photograph a document" />);
    pickJpeg();
    const enhancerText = a.container.textContent;
    a.unmount();

    // Same props and no children, so both fall back to the same label.
    // textContent, not innerHTML: React's useId differs between two renders'
    // id attributes, and the caption is a text node.
    const b = render(<FilePickerButton onFiles={vi.fn()} />);
    pickJpeg();
    const legacyText = b.container.textContent;

    expect(enhancerText).toBe(legacyText);
  });
});

describe('DocumentEnhancer — flag on', () => {
  beforeEach(() => {
    // ⚠️ THE REAL DECODE TEST, STOOD IN FOR. jsdom has no image codec, so the
    // hook's `isImage` probe is answered here: a file named `licence.jpg` is a
    // `.jpg` whose bytes do not decode, everything else resolves. This is the
    // switch the hook reads INSTEAD of the MIME type and extension.
    // `photo.heic` is the off-list type and `licence.jpg` is the mislabeled
    // one; both must fail to decode. `photo.jpg` is the normal photograph.
    const UNDECODABLE = new Set(['photo.heic', 'licence.jpg']);
    vi.stubGlobal('createImageBitmap', (blob: Blob) =>
      UNDECODABLE.has((blob as File)?.name)
        ? Promise.reject(new Error('not an image'))
        : Promise.resolve({ close: () => {} }),
    );
  });

  it('routes a picked file through the overlay and forwards the scanner output', async () => {
    const DocumentEnhancer = await loadEnhancer(true);
    const onFiles = vi.fn();
    render(<DocumentEnhancer onFiles={onFiles} title="Photograph a document" />);

    // Nothing is fetched or mounted until the member actually picks.
    expect(screen.queryByTestId('overlay')).toBeNull();

    pickJpeg();
    const overlay = await screen.findByTestId('overlay');
    expect(overlay.textContent).toContain('overlay:1');
    // The RAW file has not been uploaded — it is being enhanced first.
    expect(onFiles).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('use'));
    await waitFor(() => expect(onFiles).toHaveBeenCalledTimes(1));
    // What arrives is the scanner's JPEG, not the picked original.
    expect((onFiles.mock.calls[0][0] as File[])[0].name).toBe('scan.jpg');
    // The overlay closes once the scanner is done.
    await waitFor(() => expect(screen.queryByTestId('overlay')).toBeNull());
  });

  it('closes the overlay without uploading when the member cancels', async () => {
    const DocumentEnhancer = await loadEnhancer(true);
    const onFiles = vi.fn();
    render(<DocumentEnhancer onFiles={onFiles} title="Photograph a document" />);

    pickJpeg();
    await screen.findByTestId('overlay');
    fireEvent.click(screen.getByText('close'));

    await waitFor(() => expect(screen.queryByTestId('overlay')).toBeNull());
    expect(onFiles).not.toHaveBeenCalled();
  });

  it('passes a file the browser cannot decode straight through rather than losing it', async () => {
    const DocumentEnhancer = await loadEnhancer(true);
    const onFiles = vi.fn();
    render(<DocumentEnhancer onFiles={onFiles} title="Photograph a document" />);

    // An off-list type: canDecode probes createImageBitmap, which rejects.
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'photo.heic', { type: 'image/heic' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(onFiles).toHaveBeenCalledWith([file]));
    expect(screen.queryByTestId('overlay')).toBeNull();
  });

  // ⚠️ THE TYPE IS NOT THE TEST — THE DECODE IS. This is the class the
  // extension/MIME short-circuit used to swallow: a `.jpg` whose bytes do not
  // decode (truncated download, half-written screenshot, a PNG renamed to
  // `.jpg`). It reaches the overlay, `decodeFile` returns `unsupported`, and
  // the only offer is "We could not open that file" — the document is gone.
  // It must upload raw instead, exactly as an off-list type does.
  it('passes a file whose name claims an image but whose bytes do not decode', async () => {
    const DocumentEnhancer = await loadEnhancer(true);
    const onFiles = vi.fn();
    render(<DocumentEnhancer onFiles={onFiles} title="Photograph a document" />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['not actually a jpeg'], 'licence.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(onFiles).toHaveBeenCalledWith([file]));
    expect(screen.queryByTestId('overlay')).toBeNull();
  });

  // ⚠️ THE BOUNDARY IS decodeFile's, NOT createImageBitmap's. These bytes DO
  // decode — the stub resolves them — but the type is one the scanner's own
  // `decodeFile` refuses before it ever draws them (decode.ts:17: a non-empty
  // MIME that is not image/* is `unsupported`). A file that decodes here but
  // not there would be routed into the overlay and dropped behind "We could
  // not open that file". The door is real: `accept` is a chooser filter, not
  // validation, and several Android/cloud providers report stored images as
  // octet-stream.
  it('passes through a decodable file whose MIME type the scanner would refuse', async () => {
    const DocumentEnhancer = await loadEnhancer(true);
    const onFiles = vi.fn();
    render(<DocumentEnhancer onFiles={onFiles} title="Photograph a document" />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['real jpeg bytes'], 'scan.bin', { type: 'application/octet-stream' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(onFiles).toHaveBeenCalledWith([file]));
    expect(screen.queryByTestId('overlay')).toBeNull();
  });

  // The other half of the same boundary: a PDF is a passthrough, and it is one
  // by type OR by name, exactly as decode.ts:16 reads it.
  it('passes a PDF through, by its type and by its name alone', async () => {
    const DocumentEnhancer = await loadEnhancer(true);
    const onFiles = vi.fn();
    render(<DocumentEnhancer onFiles={onFiles} title="Photograph a document" />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const typed = new File(['%PDF-1.4'], 'report', { type: 'application/pdf' });
    const named = new File(['%PDF-1.4'], 'report.pdf', { type: '' });
    fireEvent.change(input, { target: { files: [typed, named] } });

    await waitFor(() => expect(onFiles).toHaveBeenCalledWith([typed, named]));
    expect(screen.queryByTestId('overlay')).toBeNull();
  });
});
