'use client';

import { useEffect, useState } from 'react';
import { SCAN_V3_ASSETS, scanDetector } from './document-scanner';

// ────────────────────────────────────────────────────────────────────
// THE NEW SCANNER'S SELF-TEST. Fetches its four assets the way a phone
// receives them, starts the detector worker with no camera, runs the model
// on a drawn test page and prints what happened, including the runtime's
// own error text when it could not start. Same purpose as the block above
// it on /scan/selftest: "unavailable" is not a diagnosis.
// ────────────────────────────────────────────────────────────────────

const ASSETS = ['ort.wasm.min.js', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm', 'docaligner-lcnet100.onnx'].map((f) => SCAN_V3_ASSETS + f);

interface AssetRow {
  url: string;
  status?: number;
  type?: string;
  bytes?: number;
  error?: string;
}

/** A white page on a dark table, a little askew: enough for the detector to find. */
function testFrame(): ImageData {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new ImageData(size, size);
  ctx.fillStyle = '#3a3532';
  ctx.fillRect(0, 0, size, size);
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.rotate((-4 * Math.PI) / 180);
  ctx.fillStyle = '#f3f1ec';
  ctx.fillRect(-70, -95, 140, 190);
  ctx.fillStyle = '#333';
  for (let i = 0; i < 9; i++) ctx.fillRect(-52, -70 + i * 18, 60 + ((i * 37) % 40), 4);
  ctx.restore();
  return ctx.getImageData(0, 0, size, size);
}

export default function ScanV3SelfTest() {
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [result, setResult] = useState<string[]>(['starting…']);

  useEffect(() => {
    let live = true;
    void (async () => {
      const rows: AssetRow[] = [];
      for (const url of ASSETS) {
        try {
          const res = await fetch(url, { cache: 'no-store' });
          const buf = await res.arrayBuffer();
          rows.push({ url, status: res.status, type: res.headers.get('content-type') ?? '', bytes: buf.byteLength });
        } catch (e) {
          rows.push({ url, error: (e as Error).message });
        }
        if (live) setAssets([...rows]);
      }
    })();

    void (async () => {
      const lines: string[] = [];
      const det = scanDetector();
      const t0 = performance.now();
      try {
        await det.ready();
        lines.push(`worker ready in ${Math.round(performance.now() - t0)} ms`);
        const t1 = performance.now();
        const found = await det.detect(testFrame(), 'still');
        lines.push(`inference ${Math.round(performance.now() - t1)} ms`);
        lines.push(found ? `document found, confidence ${found.confidence.toFixed(2)}, corners ${found.quad.map((p) => `(${Math.round(p.x)},${Math.round(p.y)})`).join(' ')}` : 'no document found in the test page (the model ran, but did not see it)');
      } catch (e) {
        lines.push(`error ${(e as Error)?.message ?? String(e)}`);
      }
      if (live) setResult(lines);
    })();
    return () => {
      live = false;
    };
  }, []);

  return (
    <section style={{ marginTop: 24 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700 }}>Scanner v3 (DocAligner)</h2>
      <p style={{ fontSize: 13, opacity: 0.8 }}>
        Flag NEXT_PUBLIC_SCANNER_V3 is {process.env.NEXT_PUBLIC_SCANNER_V3 === '1' ? 'ON: members get this scanner' : 'off: members get the previous scanner'}.
      </p>
      <ul style={{ fontFamily: 'monospace', fontSize: 12, listStyle: 'none', padding: 0 }}>
        {assets.map((a) => (
          <li key={a.url}>
            {a.url} — {a.error ? `error ${a.error}` : `${a.status} ${a.type} ${a.bytes} bytes`}
          </li>
        ))}
      </ul>
      <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{result.join('\n')}</pre>
    </section>
  );
}
