// ⚠️ 2026-11 MARKETPLACE audit: these three public, token-scoped capture routes
// previously had NO @Throttle — only the shared global bucket — so a script
// could hammer token guesses and photo uploads. Each route must carry its own
// per-IP limit (mirroring dealer-portal: 30/min read, 10/min upload, 20/min
// delete). This test reads the throttler decorator metadata, so removing or
// loosening a limit fails here.
import 'reflect-metadata';
import { CaptureController } from './capture.controller';

const LIMIT = 'THROTTLER:LIMITdefault';
const TTL = 'THROTTLER:TTLdefault';
const MINUTE = 60_000;

function throttleOf(fn: unknown) {
  return {
    limit: Reflect.getMetadata(LIMIT, fn as object),
    ttl: Reflect.getMetadata(TTL, fn as object),
  };
}

describe('CaptureController — public token routes are throttled', () => {
  const proto = CaptureController.prototype;

  it('GET /v/capture/:token — 30/min', () => {
    expect(throttleOf(proto.getState)).toEqual({ limit: 30, ttl: MINUTE });
  });

  it('POST /v/capture/:token/photos — 10/min', () => {
    expect(throttleOf(proto.addPhoto)).toEqual({ limit: 10, ttl: MINUTE });
  });

  it('DELETE /v/capture/:token/photos/:photoId — 20/min', () => {
    expect(throttleOf(proto.removePhoto)).toEqual({ limit: 20, ttl: MINUTE });
  });
});
