'use client';

import { useEffect, useState } from 'react';
import { LiveDetector } from '@/lib/scan/live-detector';
import ScanV3SelfTest from '@/components/scan-v3/self-test';

// ────────────────────────────────────────────────────────────────────
// THE SCANNER'S SELF-TEST. Open it on any phone: it fetches the four
// detector assets, starts the worker with no camera, runs the model on a
// drawn test document and prints what happened — including the runtime's
// own error text when it could not start.
//
// ⚠️ THIS PAGE EXISTS BECAUSE "unavailable" IS NOT A DIAGNOSIS. On
// 2026-09-05 both of the operator's phones reported the live detector
// unavailable and nothing said why; the cause (webpack rewriting the
// runtime's dynamic import) took a build cycle to find. This page answers
// in one tap, on the device that failed, without a camera or a sign-in.
// It touches no member data.
// ────────────────────────────────────────────────────────────────────

const ASSETS = [
  '/scan/v2/ort.wasm.min.js',
  '/scan/v2/ort-wasm-simd-threaded.mjs',
  '/scan/v2/ort-wasm-simd-threaded.wasm',
  '/scan/v2/doccornernet_lean.ort',
];

interface AssetRow {
  url: string;
  status?: number;
  type?: string;
  bytes?: number;
  error?: string;
}

export default function ScanSelfTest() {
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [result, setResult] = useState<string>('starting…');
  const [env, setEnv] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    setEnv([
      `ua ${navigator.userAgent}`,
      `crossOriginIsolated ${String((globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated ?? false)}`,
      `SharedArrayBuffer ${typeof SharedArrayBuffer !== 'undefined'}`,
      `WebAssembly ${typeof WebAssembly !== 'undefined'}`,
      `OffscreenCanvas ${typeof OffscreenCanvas !== 'undefined'}`,
      `Worker ${typeof Worker !== 'undefined'}`,
      `cores ${navigator.hardwareConcurrency ?? '?'}`,
      `dpr ${window.devicePixelRatio}`,
    ]);

    // The assets, as the phone actually receives them. A 200 with text/html
    // is the middleware trap; a 404 is a missing file; anything else is the
    // network.
    void (async () => {
      const rows: AssetRow[] = [];
      for (const url of ASSETS) {
        try {
          const res = await fetch(url, { cache: 'no-store' });
          const buf = await res.arrayBuffer();
          rows.push({
            url,
            status: res.status,
            type: res.headers.get('content-type') ?? '',
            bytes: buf.byteLength,
          });
        } catch (e) {
          rows.push({ url, error: (e as Error).message });
        }
        if (live) setAssets([...rows]);
      }
    })();

    const det = new LiveDetector();
    void det.selfTest().then((r) => {
      if (!live) return;
      const lines = [`status ${r.status.state}`];
      if (r.error) lines.push(`error ${r.error}`);
      if (r.ms !== undefined) lines.push(`inference ${r.ms}ms (both passes)`);
      if (r.score !== undefined) lines.push(`presence ${r.score.toFixed(3)} via ${r.region}`);
      if (r.quad) {
        lines.push(
          `quad ${r.quad.map((p) => `(${p.x.toFixed(2)}, ${p.y.toFixed(2)})`).join(' ')}`,
        );
        lines.push('expected roughly (0.20, 0.28) (0.80, 0.28) (0.80, 0.72) (0.20, 0.72)');
      }
      setResult(lines.join('\n'));
      det.stop();
    });
    return () => {
      live = false;
      det.stop();
    };
  }, []);

  return (
    <main
      style={{
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 13,
        padding: 16,
        maxWidth: 720,
        margin: '0 auto',
        color: '#111',
        background: '#fff',
        minHeight: '100vh',
      }}
    >
      <h1 style={{ fontSize: 17, fontWeight: 500, margin: '0 0 12px' }}>Scanner self-test</h1>
      <p style={{ margin: '0 0 16px', color: '#555' }}>
        Loads the document detector without a camera. Copy this whole page into a message
        if the scanner is not drawing its box.
      </p>
      <h2 style={{ fontSize: 14, fontWeight: 500, margin: '16px 0 6px' }}>detector</h2>
      <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{result}</pre>
      <h2 style={{ fontSize: 14, fontWeight: 500, margin: '16px 0 6px' }}>assets</h2>
      <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
        {assets.length === 0
          ? 'fetching…'
          : assets
              .map((a) =>
                a.error
                  ? `${a.url}\n   FAILED ${a.error}`
                  : `${a.url}\n   ${a.status} ${a.type} ${a.bytes} bytes`,
              )
              .join('\n')}
      </pre>
      <h2 style={{ fontSize: 14, fontWeight: 500, margin: '16px 0 6px' }}>device</h2>
      <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{env.join('\n')}</pre>
      <ScanV3SelfTest />
    </main>
  );
}
