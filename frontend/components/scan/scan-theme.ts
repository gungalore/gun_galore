// ────────────────────────────────────────────────────────────────────
// THE SCANNER'S OWN TOKENS, LIFTED FROM THE APP'S.
//
// ⚠️ VALUES, NOT var() REFERENCES, AND THAT IS DELIBERATE. Most of this
// scanner draws on a black full-screen overlay that is black on every device
// regardless of theme, and several surfaces are painted into a canvas where a
// CSS custom property means nothing at all. A half-var/half-literal file is
// how the three silent custom-property traps in this codebase happened.
//
// Every value below is the resolved value from app/globals.css. If that file
// moves, these move with it — they are a copy, and the copy is on purpose.
// ────────────────────────────────────────────────────────────────────

export const T = {
  /** Paper surfaces. */
  bg: '#FFFFFF',
  card: '#FFFFFF',
  inset: '#F4F2EC',
  hover: '#FAF9F5',

  border: '#DDD8CC',
  divider: '#EDEAE1',

  ink: '#1A1613',
  ink2: '#4A443C',
  ink3: '#7A7267',

  red: '#C8102E',
  redHover: '#A00D24',
  redWash: 'rgba(200, 16, 46, 0.09)',
  link: '#B10E28',

  /** Semantic. */
  good: '#1F7A50',
  goodWash: 'rgba(31, 122, 80, 0.08)',
  goodLine: 'rgba(31, 122, 80, 0.35)',
  warn: '#8F6E0F',
  warnWash: 'rgba(168, 123, 20, 0.10)',
  warnLine: 'rgba(168, 123, 20, 0.38)',
  danger: '#C8102E',

  /** On the black camera overlay. */
  onDark: '#F4F1ED',
  onDarkMuted: 'rgba(244, 241, 237, 0.72)',
  onDarkLine: 'rgba(244, 241, 237, 0.28)',

  /** The tracked quad. Amber while seeking, green when it will fire. */
  seeking: '#F5C518',
  ready: '#3DDC84',
  handle: '#2A6FB0',

  r: { sm: 6, md: 8, lg: 12 },

  /**
   * ⚠️ 44 IS A FLOOR, NOT A SUGGESTION. Everything here is operated one-handed
   * on a phone, often by somebody holding a document with the other hand.
   */
  tap: 44,

  font: "'Public Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  head: "'Archivo', 'Public Sans', system-ui, sans-serif",
} as const;

/** A filled primary button. */
export const primaryBtn: React.CSSProperties = {
  minHeight: 48,
  borderRadius: T.r.md,
  border: 'none',
  background: T.red,
  color: '#fff',
  fontSize: 15,
  fontWeight: 600,
  fontFamily: 'inherit',
  cursor: 'pointer',
};

/** An outlined button on paper. */
export const quietBtn: React.CSSProperties = {
  minHeight: 48,
  borderRadius: T.r.md,
  border: `1px solid ${T.border}`,
  background: T.card,
  color: T.ink,
  fontSize: 15,
  fontFamily: 'inherit',
  cursor: 'pointer',
};

/** An outlined button on the black overlay. */
export const darkBtn: React.CSSProperties = {
  minHeight: 48,
  borderRadius: T.r.md,
  border: `1px solid ${T.onDarkLine}`,
  background: 'transparent',
  color: T.onDark,
  fontSize: 15,
  fontFamily: 'inherit',
  cursor: 'pointer',
};
