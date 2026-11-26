import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * FIELD SURFACE CONTRAST — measured, not eyeballed.
 *
 * Operator report, 2026-11-26: "anywhere where a user has to fill in
 * something is the same color as the background with a box which makes it
 * hard to see. Change the dark mode color to a much lighter shade of the
 * background and the light mode to a darker shade of the background
 * throught the website."
 *
 * The rule this spec locks in: in LIGHT mode a field fill must be DARKER
 * than the page/card it sits on, and in DARK mode it must be LIGHTER. It
 * also holds the placeholder and value ink above WCAG AA, and checks the
 * Desk (admin) pins its own field tokens instead of inheriting the shop's.
 *
 * The values are READ FROM app/globals.css and app/admin/admin.css — never
 * duplicated here — so moving a token is a one-file change and this spec
 * follows it. If the numbers drift below the thresholds, the field boxes are
 * quietly dissolving back into the page and the suite says so.
 */

const CSS = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const ADMIN_CSS = readFileSync(new URL('../app/admin/admin.css', import.meta.url), 'utf8');

/** First block matching `selector { ... }` as a map of custom properties.
 *  `mustContain` picks a later block when a selector is declared twice (e.g.
 *  .surface-dark is defined once for its original aliases and once for its
 *  field tokens). */
function tokenBlock(css: string, selector: RegExp, mustContain?: string): Record<string, string> {
  const re = new RegExp(`${selector.source}\\s*\\{([\\s\\S]*?)\\n\\}`, 'g');
  for (const match of css.matchAll(re)) {
    if (mustContain && !match[1].includes(mustContain)) continue;
    const out: Record<string, string> = {};
    for (const m of match[1].matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)) {
      out[m[1]] = m[2].trim();
    }
    return out;
  }
  throw new Error(`Token block not found: ${selector}`);
}

const light = tokenBlock(CSS, /:root/);
const dark = tokenBlock(CSS, /\[data-theme="dark"\]/);
const admin = tokenBlock(ADMIN_CSS, /\.admin-os/);

function hex(value: string, name: string): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(value.trim());
  if (!m) throw new Error(`${name} is not a 6-digit hex token: "${value}"`);
  return value.trim().toLowerCase();
}

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance, 0 (black) … 1 (white). */
function luminance(value: string): number {
  const h = hex(value, 'colour');
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(h.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 … 21. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function token(theme: Record<string, string>, name: string): string {
  const value = theme[name];
  if (!value) throw new Error(`missing token ${name}`);
  return hex(value, name);
}

describe('field surface tokens — light theme (darker than the background)', () => {
  const bg = token(light, '--bg');
  const card = token(light, '--bg-card');
  const field = token(light, '--field-bg');
  const hover = token(light, '--field-bg-hover');
  const focus = token(light, '--field-bg-focus');
  const disabled = token(light, '--field-bg-disabled');
  const placeholder = token(light, '--field-placeholder');
  const ink = token(light, '--text-primary');

  it('field fill is darker than both the page and the card', () => {
    expect(luminance(field)).toBeLessThan(luminance(bg));
    expect(luminance(field)).toBeLessThan(luminance(card));
  });

  it('field fill is measurably distinct from the card (>= 1.25:1)', () => {
    expect(contrast(field, card)).toBeGreaterThanOrEqual(1.25);
    expect(contrast(field, bg)).toBeGreaterThanOrEqual(1.15);
  });

  it('hover and focus step further away from the surface, never back into it', () => {
    expect(luminance(hover)).toBeLessThan(luminance(field));
    expect(luminance(focus)).toBeLessThan(luminance(hover));
    expect(contrast(focus, card)).toBeGreaterThan(contrast(field, card));
  });

  it('disabled is still a field (darker than the card) but flatter than rest', () => {
    expect(luminance(disabled)).toBeLessThan(luminance(card));
    expect(contrast(disabled, card)).toBeLessThan(contrast(field, card));
  });

  it('placeholder and value ink stay readable on the fill (AA 4.5:1)', () => {
    expect(contrast(placeholder, field)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(ink, field)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('field surface tokens — dark theme (lighter than the background)', () => {
  const bg = token(dark, '--bg');
  const card = token(dark, '--bg-card');
  const field = token(dark, '--field-bg');
  const hover = token(dark, '--field-bg-hover');
  const focus = token(dark, '--field-bg-focus');
  const disabled = token(dark, '--field-bg-disabled');
  const placeholder = token(dark, '--field-placeholder');
  const ink = token(dark, '--text-primary');

  it('field fill is lighter than both the page and the card', () => {
    expect(luminance(field)).toBeGreaterThan(luminance(bg));
    expect(luminance(field)).toBeGreaterThan(luminance(card));
  });

  it('field fill is measurably distinct from the card (>= 1.25:1)', () => {
    expect(contrast(field, card)).toBeGreaterThanOrEqual(1.25);
    expect(contrast(field, bg)).toBeGreaterThanOrEqual(1.3);
  });

  it('hover and focus step further away from the surface, never back into it', () => {
    expect(luminance(hover)).toBeGreaterThan(luminance(field));
    expect(luminance(focus)).toBeGreaterThan(luminance(hover));
    expect(contrast(focus, card)).toBeGreaterThan(contrast(field, card));
  });

  it('disabled is still a field (lighter than the card) but flatter than rest', () => {
    expect(luminance(disabled)).toBeGreaterThan(luminance(card));
    expect(contrast(disabled, card)).toBeLessThan(contrast(field, card));
  });

  it('placeholder and value ink stay readable on the fill (AA 4.5:1)', () => {
    expect(contrast(placeholder, field)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(ink, field)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('field tokens are wired into the base rules', () => {
  it('the base input/textarea/select rule paints --field-bg', () => {
    expect(CSS).toMatch(
      /input:not\([\s\S]*?textarea:not\(\[data-field-flat\]\),\s*select:not\(\[data-field-flat\]\)\s*\{\s*background-color:\s*var\(--field-bg\);/,
    );
  });

  it('autofill repaints with the field fill, not the page fill', () => {
    const autofill = CSS.slice(CSS.indexOf('input:-webkit-autofill'));
    const rule = autofill.slice(0, autofill.indexOf('}'));
    expect(rule).toMatch(/var\(--field-bg\)/);
    expect(rule).not.toMatch(/var\(--bg\)\s*inset/);
  });

  it('placeholder rules read the measured placeholder token', () => {
    expect(CSS).toMatch(/input::placeholder,[\s\S]*?textarea::placeholder\s*\{[^}]*var\(--field-placeholder\)/);
  });

  it('the scanner and .surface-dark pin their own field tokens', () => {
    // Fixed-theme surfaces must not inherit the shop's theme-direction fills.
    const scanner = tokenBlock(CSS, /\.gg-scan-root,\s*\.aos-root/);
    const surfaceDark = tokenBlock(CSS, /\.surface-dark/, '--field-bg');
    for (const block of [scanner, surfaceDark]) {
      expect(block['--field-bg']).toBeTruthy();
      expect(block['--field-placeholder']).toBeTruthy();
    }
  });
});

describe('the Desk (admin) pins its own field surface', () => {
  const bg = token(admin, '--adm-bg');
  const field = token(admin, '--adm-field-bg');
  const focus = token(admin, '--adm-field-bg-focus');
  const placeholderValue = admin['--field-placeholder'];

  it('Desk field fill is a much lighter shade of the near-black ground', () => {
    expect(luminance(field)).toBeGreaterThan(luminance(bg));
    expect(contrast(field, bg)).toBeGreaterThanOrEqual(1.35);
  });

  it('Desk focus steps lighter still', () => {
    expect(luminance(focus)).toBeGreaterThan(luminance(field));
  });

  it('Desk placeholder reads the Desk ink token, and the shop base rules resolve through it', () => {
    expect(placeholderValue).toContain('--adm-ink-2');
    expect(admin['--field-bg']).toContain('--adm-field-bg');
    expect(ADMIN_CSS).toMatch(/\.adm-input,[\s\S]*?\.adm-textarea\s*\{[^}]*var\(--adm-field-bg\)/);
  });

  it('the Desk declares its own color-scheme so native pickers follow it', () => {
    expect(ADMIN_CSS).toMatch(/\.admin-os\s*\{[\s\S]*?color-scheme:\s*dark;/);
  });
});
