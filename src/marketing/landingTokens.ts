// Fixed "blueprint" palette for the logged-out marketing page. It renders light
// regardless of the app's saved appearance, matching the nintek house style
// (cairn/workshop/tabloom): pale ground with a faint grid, oversized display
// type with a rust accent phrase, mono letter-spaced eyebrows.

export const L = {
  bg: '#f5f7fa',
  ink: '#14213d',
  inkSoft: '#40536d',
  muted: '#687891',
  line: '#d5deea',
  paper: '#ffffff',
  rust: '#b94e29',
  rustDark: '#92391e',
  band: '#14213d',
  grid: 'rgba(20,33,61,0.06)',
} as const;

export const MONO = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace";

// Faint engineering-drawing grid used on the page ground.
export const blueprint = {
  backgroundColor: L.bg,
  backgroundImage: `linear-gradient(${L.grid} 1px, transparent 1px), linear-gradient(90deg, ${L.grid} 1px, transparent 1px)`,
  backgroundSize: '32px 32px',
} as const;

export const eyebrowSx = {
  fontFamily: MONO,
  fontSize: 12,
  letterSpacing: '0.22em',
  textTransform: 'uppercase',
  color: L.muted,
} as const;

// The large soft shadow that makes the mockup panels float.
export const floatSx = {
  bgcolor: L.paper,
  border: `1px solid ${L.line}`,
  borderRadius: '18px',
  boxShadow: '0 2px 4px rgba(21,35,61,0.04), 0 24px 48px -16px rgba(21,35,61,0.22), 0 48px 96px -32px rgba(21,35,61,0.18)',
} as const;
