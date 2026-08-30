// Shared "hovering" card elevation. A layered shadow (contact + mid + wide
// ambient) so every card reads as lifted off the page rather than flat.
// Used by the shared cardSx token (tokens.ts), the MUI Card/Paper overrides
// (iosTheme.ts), and PlexCommandCenter's local card style.

export const raisedCardShadow = (isDark: boolean): string =>
  isDark
    ? '0 1px 2px rgba(0,0,0,0.30), 0 8px 24px -6px rgba(0,0,0,0.55), 0 24px 48px -12px rgba(0,0,0,0.45)'
    : '0 1px 2px rgba(21,35,61,0.06), 0 10px 24px -8px rgba(21,35,61,0.18), 0 28px 56px -20px rgba(21,35,61,0.16)';

// iOS "squircle" corner radius, applied to cards, nav items and controls so the
// whole surface shares one geometry.
export const IOS_RADIUS = 14;
