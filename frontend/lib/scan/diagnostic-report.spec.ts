import { describe, expect, it } from 'vitest';
import { buildReport, redact } from './diagnostic-report';

describe('redact', () => {
  it('⚠️ MASKS AN SA IDENTITY NUMBER — the whole reason this exists', () => {
    // This report gets pasted into a chat window. An identity number printed
    // there cannot be unprinted.
    expect(redact('ID Number: 8905125220089')).not.toContain('8905125220089');
    expect(redact('ID Number: 8905125220089')).toContain('[13-digits]');
  });

  it('keeps unit standards, which are public SAQA codes', () => {
    // These are the POINT of the OCR and identify nobody.
    const t = redact('119650 - Handle and Use a Self-loading rifle, 117705 knowledge');
    expect(t).toContain('119650');
    expect(t).toContain('117705');
  });

  it('masks a six-digit run that is not a registered standard', () => {
    expect(redact('Certificate 482913')).toContain('[6-digits]');
  });

  it('masks serials and emails', () => {
    expect(redact('Serial B477423')).toContain('[serial]');
    expect(redact('mail a.person@example.co.za here')).toContain('[email]');
  });

  it('leaves ordinary prose alone', () => {
    const t = 'Licence To Possess a Firearm, Firearms Control Act';
    expect(redact(t)).toBe(t);
  });
});

describe('buildReport', () => {
  it('works from almost nothing', () => {
    const r = buildReport({ shape: 'a4' });
    expect(r).toContain('DIAGNOSTIC REPORT');
    expect(r).toContain('a4');
    expect(r).toContain('end of report');
  });

  it('omits sections it has no data for, rather than printing blanks', () => {
    const r = buildReport({ shape: 'card' });
    expect(r).not.toContain('── OCR ──');
    expect(r).not.toContain('── camera ──');
  });

  it('carries the numbers that decided a licence-card outcome', () => {
    // The two detector settings that took licence cards from 0/16 to 4/8, and
    // the arbitration that decides which quad crops. If a future report cannot
    // answer "why did this crop", it is not doing its job.
    const r = buildReport({
      shape: 'card',
      capture: {
        source: 'detected',
        pickedBy: 'mask',
        arbitration: { worstSide: 0.82, support: 0.91 },
        maskFit: { coverage: 0.31, aspect: 1.59, residual: 0.8, rectangularity: 0.96 },
        refined: { moved: 4.2, skipped: 0 },
      },
      ocr: { engine: 'PP-OCRv3', unclipRatio: 3.5, boxThresh: 0.3, chars: 335, lines: 21 },
    });
    expect(r).toContain('chosen by');
    expect(r).toContain('mask');
    expect(r).toContain('worst side');
    expect(r).toContain('det unclip');
    expect(r).toContain('3.50');
  });

  it('⚠️ REDACTS THE OCR SAMPLE, always', () => {
    const r = buildReport({
      shape: 'card',
      ocr: { sample: 'GJPFOURIE 8905125220089 SECTION15 119650' },
    });
    expect(r).not.toContain('8905125220089');
    expect(r).toContain('119650');
  });

  it('reports a dropped detector loudly, because it is never normal', () => {
    const r = buildReport({ shape: 'a4', live: { status: 'running', detectorOff: true } });
    expect(r).toContain('YES (dropped)');
  });

  it('says when no document type was chosen rather than printing a number', () => {
    const r = buildReport({ shape: 'a4', geometry: { dpi: null } });
    expect(r).toContain('no document type chosen');
  });

  it('sorts timings worst first, since that is what gets read', () => {
    const r = buildReport({ shape: 'a4', timings: { decode: 40, rectify: 900, enhance: 120 } });
    const lines = r.split('\n');
    const i = (k: string) => lines.findIndex((l) => l.startsWith(k));
    expect(i('rectify')).toBeLessThan(i('enhance'));
    expect(i('enhance')).toBeLessThan(i('decode'));
  });

  it('renders an event trace in order', () => {
    const r = buildReport({
      shape: 'a4',
      events: [
        { t: 0, what: 'camera opened' },
        { t: 1200, what: 'first detection' },
      ],
    });
    expect(r.indexOf('camera opened')).toBeLessThan(r.indexOf('first detection'));
  });
});
