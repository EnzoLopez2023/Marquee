import { raisedCardShadow } from './elevation';

export interface HearthTokens {
  bg: string;
  paper: string;
  surface: string;
  ink: string;
  inkSoft: string;
  muted: string;
  line: string;
  rust: string;
  rustDark: string;
  rustLight: string;
  champagne: string;
  green: string;
  red: string;
  amber: string;
  blue: string;
  purple: string;
  border: string;
  cardSx: Record<string, unknown>;
}

export function tokensFor(isDark: boolean, _palette?: unknown): HearthTokens {
  const colors = isDark
    ? { bg: '#111827', paper: '#182234', surface: '#202d42', ink: '#f4f7fb', inkSoft: '#c4d0df', muted: '#91a0b5', line: '#34445c', rust: '#f59e6c', rustDark: '#d66b3d', rustLight: '#ffb787', champagne: '#f9dca5' }
    : { bg: '#f5f7fa', paper: '#ffffff', surface: '#eef2f7', ink: '#14213d', inkSoft: '#40536d', muted: '#687891', line: '#d5deea', rust: '#b94e29', rustDark: '#92391e', rustLight: '#d86a40', champagne: '#926f25' };
  return {
    ...colors,
    green: isDark ? '#69d39b' : '#237a50',
    red: isDark ? '#ff8792' : '#ba3342',
    amber: isDark ? '#ffca70' : '#a46200',
    blue: isDark ? '#7fb8ff' : '#1769b0',
    purple: isDark ? '#c4a1ff' : '#7049a8',
    border: colors.line,
    cardSx: { bgcolor: colors.paper, border: `1px solid ${colors.line}`, boxShadow: raisedCardShadow(isDark) },
  };
}
