import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import type { CameraError, CameraOpener } from '../camera/camera';
import { cameraSupport } from '../camera/support';
import { NullDetector, type Detector } from '../pipeline/detector';
import { decodeBlob, decodeFile, releaseScratch } from '../pipeline/decode';
import type { Quad } from '../pipeline/geometry';
import type { LiveOutline } from '../pipeline/locate';
import { imageDataToJpeg, nameFiles } from '../pipeline/output';
import { processStill, recropPage, renderVariant, rotatePage, sealPage, type ScanPage } from '../pipeline/process';
import type { DocumentScannerProps } from '../types';
import { usePickFiles } from './PickFiles';
import { CameraScreen, type CaptureMeta, type DiagSample } from './screens/CameraScreen';
import { PermissionBlockedScreen, PreparingScreen, ProcessingScreen, UnsupportedScreen } from './screens/MessageScreens';
import { PagesScreen } from './screens/PagesScreen';
import { ReviewScreen, type ReviewMode } from './screens/ReviewScreen';
import { StartScreen } from './screens/StartScreen';
import { FixCornersScreen } from './screens/FixCornersScreen';

type Step =
  | { kind: 'start' }
  | { kind: 'camera' }
  | { kind: 'blocked'; reason: CameraError }
  | { kind: 'processing' }
  | { kind: 'unsupported' }
  | { kind: 'review'; id: string; fromCamera: boolean; isNew: boolean; sealedImage?: ImageData | null }
  | { kind: 'fix'; id: string; fromCamera: boolean; isNew: boolean }
  | { kind: 'sealing' }
  | { kind: 'pages' }
  | { kind: 'preparing' };

interface Held {
  page: ScanPage;
  mode: ReviewMode;
  accepted: boolean;
}

export interface DocumentScannerExtras {
  /** Swap the detector (the harness injects real ones). Defaults to none. */
  detector?: Detector;
  /** Feed files as if the member had picked them (harness and tests). */
  initialFiles?: File[];
  /** Live numbers for a diagnostics panel. */
  onDiag?: (d: DiagSample) => void;
  /** Called with the pages about to be sent, before encoding, for the harness. */
  onPagesReady?: (pages: ScanPage[]) => void;
  /** Replace the rear camera (the harness injects a simulated one). */
  openCamera?: CameraOpener;
  /** Every processed page, right after processing, with its diagnostics. */
  onPageProcessed?: (page: ScanPage, capture: CaptureMeta | null, still?: ImageData) => void;
}

/**
 * The scanner. A pure UI component: no auth, no network. It produces `File[]`
 * and hands them to `onDone`; whoever mounted it does the uploading.
 * Portals to `document.body` and marks itself `data-blocking-overlay` so a
 * host page's click-outside logic leaves it alone.
 */
export function DocumentScanner(props: DocumentScannerProps & DocumentScannerExtras): ReactElement | null {
  const { title, subtitle, onDone, onClose, shape, autoStart, documentName, detector: detectorProp, initialFiles, onDiag, onPagesReady, openCamera, onPageProcessed } = props;
  const support = useMemo(() => cameraSupport(), []);
  const detector = useMemo(() => detectorProp ?? new NullDetector(), [detectorProp]);
  const [step, setStep] = useState<Step>(() => (autoStart === 'camera' && support.camera ? { kind: 'camera' } : { kind: 'start' }));
  const [held, setHeld] = useState<Held[]>([]);
  const heldRef = useRef(held);
  heldRef.current = held;

  const accepted = held.filter((h) => h.accepted);
  const cameraAvailable = support.camera;

  const goCamera = useCallback(() => setStep(cameraAvailable ? { kind: 'camera' } : { kind: 'start' }), [cameraAvailable]);

  const addPage = useCallback((page: ScanPage, accept: boolean): void => {
    setHeld((h) => [...h.filter((x) => x.page.id !== page.id), { page, mode: 'auto', accepted: accept }]);
  }, []);

  /** Files chosen from the photo library or the file system. */
  const handleFiles = useCallback(
    async (files: File[]): Promise<void> => {
      if (!files.length) return;
      setStep({ kind: 'processing' });
      const made: ScanPage[] = [];
      let unsupported = 0;
      for (const f of files) {
        const decoded = await decodeFile(f);
        if (decoded.kind === 'pdf') {
          made.push({
            id: `pdf${Date.now().toString(36)}${made.length}`,
            base: new ImageData(1, 1),
            normalized: new ImageData(1, 1),
            quad: null,
            shape: 'other',
            aspect: null,
            autoMode: 'color',
            quality: { level: 'good', label: 'PDF', sharpness: 0, brightness: 0, glare: 0 },
            passthrough: f,
            variants: {},
            diag: { detectMs: null, confidence: null, source: 'file', stillSource: 'file', stillWidth: 0, stillHeight: 0, refineShift: null, refinedEdges: null, usedLiveQuad: false, detectStage: 'none', detectPasses: 0, coarseQuad: null, workWidth: 0, workHeight: 0 },
          });
          continue;
        }
        if (decoded.kind === 'unsupported') {
          unsupported++;
          continue;
        }
        const page = await processStill(decoded.image, { detector, source: 'file', shapeHint: shape, stillSource: 'file' });
        onPageProcessed?.(page, null, decoded.image);
        made.push(page);
      }
      if (!made.length) {
        setStep({ kind: 'unsupported' });
        return;
      }
      if (made.length === 1 && !made[0].passthrough) {
        addPage(made[0], false);
        setStep({ kind: 'review', id: made[0].id, fromCamera: false, isNew: true });
        return;
      }
      for (const p of made) addPage(p, true);
      setStep({ kind: 'pages' });
      void unsupported;
    },
    [addPage, detector, shape],
  );

  const { input: pickInput, open: openPicker } = usePickFiles((files) => void handleFiles(files));

  const initialDone = useRef(false);
  useEffect(() => {
    if (initialFiles?.length && !initialDone.current) {
      initialDone.current = true;
      void handleFiles(initialFiles);
    } else if (autoStart === 'pick' && !initialDone.current) {
      initialDone.current = true;
      openPicker();
    }
  }, [autoStart, handleFiles, initialFiles, openPicker]);

  const onCaptured = useCallback(
    async (still: ImageData, live: LiveOutline | null, meta: CaptureMeta): Promise<void> => {
      if (still.width < 64 || still.height < 64) {
        goCamera();
        return;
      }
      setStep({ kind: 'processing' });
      const page = await processStill(still, { detector, source: 'camera', shapeHint: shape, live, stillSource: meta.source });
      onPageProcessed?.(page, meta, still);
      addPage(page, false);
      setStep({ kind: 'review', id: page.id, fromCamera: true, isNew: true });
    },
    [addPage, detector, goCamera, onPageProcessed, shape],
  );

  const send = useCallback(async (): Promise<void> => {
    const pages = heldRef.current.filter((h) => h.accepted);
    if (!pages.length) return;
    setStep({ kind: 'preparing' });
    onPagesReady?.(pages.map((p) => p.page));
    const files: File[] = [];
    for (const { page, mode } of pages) {
      if (page.passthrough) {
        files.push(page.passthrough);
        continue;
      }
      const blob = page.sealed ? page.sealed.blob : await imageDataToJpeg(renderVariant(page, mode));
      files.push(new File([blob], 'scan.jpg', { type: 'image/jpeg', lastModified: Date.now() }));
    }
    // Name the files after the caller's document name, else after what was recognised.
    const shapes = new Set(pages.map((p) => p.page.shape));
    const recognised = shapes.size === 1 && shapes.has('card') ? 'Licence card' : shapes.size === 1 && shapes.has('a4') ? 'A4 document' : 'Scan';
    await onDone(nameFiles(files, documentName ?? (title === 'Scan a document' ? recognised : title)));
  }, [documentName, onDone, onPagesReady, title]);

  // Lock page scroll behind the overlay; let go of scratch canvases when the scanner closes.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
      releaseScratch();
    };
  }, []);

  /** Keep a page: encode it now and drop the big buffers, so many pages fit in a phone's memory. */
  const keepPage = useCallback(async (h: Held): Promise<void> => {
    if (!h.page.sealed && !h.page.passthrough) {
      setStep({ kind: 'sealing' });
      await sealPage(h.page, h.mode);
    }
    setHeld((all) => all.map((x) => (x.page.id === h.page.id ? { ...x, accepted: true } : x)));
    setStep({ kind: 'pages' });
  }, []);

  /** Open a kept page for a look: decode its JPEG for the screen. */
  const openKept = useCallback(async (id: string): Promise<void> => {
    const h = heldRef.current.find((x) => x.page.id === id);
    if (!h) return;
    if (h.page.sealed) {
      setStep({ kind: 'processing' });
      const img = await decodeBlob(h.page.sealed.blob, 1600);
      setStep({ kind: 'review', id, fromCamera: false, isNew: false, sealedImage: img });
    } else {
      setStep({ kind: 'review', id, fromCamera: false, isNew: false });
    }
  }, []);

  let screen: ReactElement | null = null;
  switch (step.kind) {
    case 'start':
      screen = <StartScreen title={title} subtitle={subtitle} cameraAvailable={cameraAvailable} onCamera={goCamera} onPick={openPicker} onClose={onClose} />;
      break;
    case 'camera':
      screen = (
        <CameraScreen
          detector={detector}
          pagesCount={accepted.length}
          onCaptured={(still, quad, meta) => void onCaptured(still, quad, meta)}
          onError={(reason) => setStep({ kind: 'blocked', reason })}
          onPick={accepted.length ? () => setStep({ kind: 'pages' }) : openPicker}
          onClose={accepted.length ? () => setStep({ kind: 'pages' }) : onClose}
          onDiag={onDiag}
          openCamera={openCamera}
        />
      );
      break;
    case 'blocked':
      screen = <PermissionBlockedScreen reason={step.reason} onPick={openPicker} onRetry={goCamera} onClose={onClose} />;
      break;
    case 'processing':
      screen = <ProcessingScreen />;
      break;
    case 'sealing':
      screen = <ProcessingScreen label="Keeping this page" />;
      break;
    case 'unsupported':
      screen = <UnsupportedScreen onPick={openPicker} onClose={accepted.length ? () => setStep({ kind: 'pages' }) : onClose} />;
      break;
    case 'preparing':
      screen = <PreparingScreen count={accepted.length} />;
      break;
    case 'review': {
      const h = held.find((x) => x.page.id === step.id);
      if (!h) {
        screen = null;
        break;
      }
      const { fromCamera } = step;
      screen = (
        <ReviewScreen
          page={h.page}
          mode={h.mode}
          fromCamera={fromCamera}
          sealedImage={step.sealedImage}
          onFixCorners={h.page.source && !h.page.sealed ? () => setStep({ kind: 'fix', id: h.page.id, fromCamera, isNew: step.isNew }) : undefined}
          onRotate={!h.page.sealed && !h.page.passthrough ? () => setHeld((all) => all.map((x) => (x.page.id === h.page.id ? { ...x, page: rotatePage(x.page) } : x))) : undefined}
          onMode={(m) => setHeld((all) => all.map((x) => (x.page.id === h.page.id ? { ...x, mode: m } : x)))}
          onUse={() => void keepPage(h)}
          onRetake={() => {
            setHeld((all) => all.filter((x) => x.page.id !== h.page.id || !step.isNew));
            if (fromCamera) goCamera();
            else if (step.isNew) openPicker();
            else setStep({ kind: 'pages' });
          }}
          onDiscard={() => {
            setHeld((all) => all.filter((x) => x.page.id !== h.page.id));
            const rest = heldRef.current.filter((x) => x.accepted && x.page.id !== h.page.id);
            setStep(rest.length ? { kind: 'pages' } : { kind: 'start' });
          }}
        />
      );
      break;
    }
    case 'fix': {
      const h = held.find((x) => x.page.id === step.id);
      if (!h || !h.page.source) {
        screen = null;
        break;
      }
      const { id, fromCamera, isNew } = step;
      screen = (
        <FixCornersScreen
          source={h.page.source}
          quad={h.page.quad}
          onCancel={() => setStep({ kind: 'review', id, fromCamera, isNew })}
          onDone={(quad) => {
            const page = recropPage(h.page, quad);
            setHeld((all) => all.map((x) => (x.page.id === id ? { ...x, page } : x)));
            setStep({ kind: 'review', id, fromCamera, isNew });
          }}
        />
      );
      break;
    }
    case 'pages':
      screen = (
        <PagesScreen
          pages={accepted}
          cameraAvailable={cameraAvailable}
          onOpen={(id) => void openKept(id)}
          onDelete={(id) => {
            setHeld((all) => all.filter((x) => x.page.id !== id));
            if (heldRef.current.filter((x) => x.accepted).length <= 1) setStep({ kind: 'start' });
          }}
          onAddCamera={goCamera}
          onAddPick={openPicker}
          onSend={() => void send()}
          onStartOver={() => {
            setHeld([]);
            setStep({ kind: 'start' });
          }}
          onClose={onClose}
        />
      );
      break;
  }

  const dark = step.kind === 'camera' || step.kind === 'processing' || step.kind === 'preparing' || step.kind === 'sealing' || step.kind === 'fix';
  return createPortal(
    <div className={`aos-root ${dark ? 'aos-dark' : ''}`} data-blocking-overlay="true" role="dialog" aria-modal="true" aria-label={title}>
      {screen}
      {pickInput}
    </div>,
    document.body,
  );
}
