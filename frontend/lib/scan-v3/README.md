# scan-v3

The AO Scan document scanner, copied from the standalone repo (C:\dev\Scanner,
packages/scanner/src) by `scripts/sync-website.mjs` there. Do not edit here:
change it upstream and re-run the sync. Only the detector worker differs from
upstream (it loads the ONNX runtime from /scan/v3/ with importScripts), and the
sync applies that rewrite.

Runtime files under public/scan/v3/: the DocAligner LCNet-100 model
(docaligner-lcnet100.onnx, Apache-2.0, DocsaidLab) and ONNX Runtime Web 1.29
(ort.wasm.min.js, ort-wasm-simd-threaded.mjs, ort-wasm-simd-threaded.wasm, MIT).
