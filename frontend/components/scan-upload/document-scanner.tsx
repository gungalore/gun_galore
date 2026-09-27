import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { NullDetector, type Detector } from '@/lib/scan-upload/pipeline/detector';
import { WorkerDetector } from '@/lib/scan-upload/pipeline/worker-detector';
import { decodeBlob, decodeFile, releaseScratch } from '@/lib/scan-upload/pipeline/decode';
import { imageDataToJpeg, nameFiles } from '@/lib/scan-upload/pipeline/output';
import { processStill, recropPage, renderVariant, rotatePage, sealPage, type ScanPage } from '@/lib/scan-upload/pipeline/process';
import type { DocumentScannerProps } from '@/lib/scan-upload/types';
import { usePickFiles } from './ui/PickFiles';
import { PreparingScreen, ProcessingScreen, UnsupportedScreen } from './ui/screens/MessageScreens';
import { PagesScreen } from './ui/screens/PagesScreen';
import { ReviewScreen, type ReviewMode } from './ui/screens/ReviewScreen';
import { StartScreen } from './ui/screens/StartScreen';
import { FixCornersScreen } from './ui/screens/FixCornersScreen';
import './ui/scanner.css';

// ────────────────────────────────────────────────────────────────────
// THE UPLOAD'S OWN CROP/ENHANCE CONTAINER.
//
// A trimmed fork of lib/scan-v3/ui/DocumentScanner.tsx, frozen at copy
// time (see lib/scan-upload/index.ts). The upload always arrives with
// files already picked, so the camera side is gone entirely: no
// `camera`/`blocked` steps, no CameraScreen, no start-on-camera, no
// live tracker, no diagnostics.
//
// What is kept, exactly as the scanner runs it: decode → processStill
// (detect outline, warp, straighten, normalise the light) → review →
// fix corners → pages → seal and hand back JPEGs. That is the tuned
// machinery the operator asked to keep, in the upload's own tree.
// ────────────────────────────────────────────────────────────────────

type Step =
  | { kind: 'start' }
  | { kind: 'processing' }
  | { kind: 'unsupported' }
  | { kind: 'review'; id: string; isNew: boolean; sealedImage?: ImageData | null }
  | { kind: 'fix'; id: string; isNew: boolean }
  | { kind: 'sealing' }
  | { kind: 'pages' }
  | { kind: 'preparing' };

interface Held {
  page: ScanPage;
  mode: ReviewMode;
  accepted: boolean;
}

export interface UploadScannerExtras {
  /** Swap the detector (tests inject one). Defaults to none. */
  detector?: Detector;
  /** Feed files as if the member had picked them. */
  initialFiles?: File[];
  /** Called with the pages about to be sent, before encoding. */
  onPagesReady?: (pages: ScanPage[]) => void;
  /** Every processed page, right after processing. */
  onPageProcessed?: (page: ScanPage, still?: ImageData) => void;
}

/**
 * The upload's cropper. A pure UI component: no auth, no network. It
 * produces `File[]` and hands them to `onDone`; whoever mounted it files
 * them. Portals to `document.body` and marks itself `data-blocking-overlay`
 * so a host page's click-outside logic leaves it alone.
 */
export function UploadScanner(props: DocumentScannerProps & UploadScannerExtras): ReactElement | null {
  const { title, subtitle, onDone, onClose, shape, autoStart, documentName, detector: detectorProp, initialFiles, onPagesReady, onPageProcessed } = props;
  const detector = useMemo(() => detectorProp ?? new NullDetector(), [detectorProp]);
  const [step, setStep] = useState<Step>({ kind: 'start' });
  const [held, setHeld] = useState<Held[]>([]);
  const heldRef = useRef(held);
  heldRef.current = held;

  const accepted = held.filter((h) => h.accepted);

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
        onPageProcessed?.(page, decoded.image);
        made.push(page);
      }
      if (!made.length) {
        setStep({ kind: 'unsupported' });
        return;
      }
      if (made.length === 1 && !made[0].passthrough) {
        addPage(made[0], false);
        setStep({ kind: 'review', id: made[0].id, isNew: true });
        return;
      }
      for (const p of made) addPage(p, true);
      setStep({ kind: 'pages' });
      void unsupported;
    },
    [addPage, detector, onPageProcessed, shape],
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
      setStep({ kind: 'review', id, isNew: false, sealedImage: img });
    } else {
      setStep({ kind: 'review', id, isNew: false });
    }
  }, []);

  let screen: ReactElement | null = null;
  switch (step.kind) {
    case 'start':
      screen = <StartScreen title={title} subtitle={subtitle} onPick={openPicker} onClose={onClose} />;
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
      screen = (
        <ReviewScreen
          page={h.page}
          mode={h.mode}
          fromCamera={false}
          sealedImage={step.sealedImage}
          onFixCorners={h.page.source && !h.page.sealed ? () => setStep({ kind: 'fix', id: h.page.id, isNew: step.isNew }) : undefined}
          onRotate={!h.page.sealed && !h.page.passthrough ? () => setHeld((all) => all.map((x) => (x.page.id === h.page.id ? { ...x, page: rotatePage(x.page) } : x))) : undefined}
          onMode={(m) => setHeld((all) => all.map((x) => (x.page.id === h.page.id ? { ...x, mode: m } : x)))}
          onUse={() => void keepPage(h)}
          onRetake={() => {
            setHeld((all) => all.filter((x) => x.page.id !== h.page.id || !step.isNew));
            if (step.isNew) openPicker();
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
      const { id, isNew } = step;
      screen = (
        <FixCornersScreen
          source={h.page.source}
          quad={h.page.quad}
          onCancel={() => setStep({ kind: 'review', id, isNew })}
          onDone={(quad) => {
            const page = recropPage(h.page, quad);
            setHeld((all) => all.map((x) => (x.page.id === id ? { ...x, page } : x)));
            setStep({ kind: 'review', id, isNew });
          }}
        />
      );
      break;
    }
    case 'pages':
      screen = (
        <PagesScreen
          pages={accepted}
          cameraAvailable={false}
          onOpen={(id) => void openKept(id)}
          onDelete={(id) => {
            setHeld((all) => all.filter((x) => x.page.id !== id));
            if (heldRef.current.filter((x) => x.accepted).length <= 1) setStep({ kind: 'start' });
          }}
          onAddCamera={openPicker}
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

  const dark = step.kind === 'processing' || step.kind === 'preparing' || step.kind === 'sealing' || step.kind === 'fix';
  return createPortal(
    <div className={`aos-root ${dark ? 'aos-dark' : ''}`} data-blocking-overlay="true" role="dialog" aria-modal="true" aria-label={title}>
      {screen}
      {pickInput}
    </div>,
    document.body,
  );
}

/** Where the model and the ONNX runtime live. Shared with the scanner; no new bytes. */
export const SCAN_ASSETS = '/scan/v3/';

let shared: WorkerDetector | null = null;

/**
 * One detector per page: the worker and its ~5 MB model are loaded once
 * and kept, so the upload's second file is instant. The model path is the
 * scanner's, so nothing is downloaded twice across the two features.
 */
export function uploadDetector(): WorkerDetector {
  if (!shared) {
    shared = new WorkerDetector({
      modelUrl: SCAN_ASSETS + 'docaligner-lcnet100.onnx',
      wasmPaths: SCAN_ASSETS,
      name: 'docaligner-lcnet100',
    });
  }
  return shared;
}
