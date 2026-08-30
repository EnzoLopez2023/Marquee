import type { HearthTokens } from './tokens';

export const CARD_RADIUS = 14;
export const PAGE_GUTTER = 24;
export const CARD_HOVER_SX = { transition: 'transform 160ms ease, box-shadow 160ms ease', '&:hover': { transform: 'translateY(-2px)', boxShadow: '0 14px 30px rgba(15, 23, 42, .14)' } };
export const pageShellSx = (_compact = false) => ({ maxWidth: 1500, mx: 'auto', px: { xs: 1.5, sm: 2.5, md: 3 }, py: { xs: 2, md: 3 } });
export const onAccent = (_color: string) => '#fff';
export const accentHover = (accent: string, _isDark: boolean) => accent;
export const toggleGroupSx = (t: HearthTokens) => ({ '& .MuiToggleButton-root': { color: t.inkSoft, borderColor: t.line, textTransform: 'none' }, '& .Mui-selected': { bgcolor: `${t.rust}18 !important`, color: `${t.rust} !important` } });
