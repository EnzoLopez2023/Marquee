import { createTheme, type Theme } from '@mui/material';
import { IOS_RADIUS, raisedCardShadow } from './elevation';

// Force the whole app into an iOS-native visual language on top of MUI:
// SF system font stack, 14px "squircle" geometry everywhere, iOS system colors,
// Apple-style (0.2s ease-in-out) hover transitions, and a raised card shadow so
// surfaces float. This is the MUI equivalent of Ionic's `mode: 'ios'` switch —
// one factory that every `ThemeProvider` in the app consumes.

const SF_STACK =
  "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', 'Segoe UI', Roboto, system-ui, sans-serif";

const APPLE_EASE = 'background 0.2s ease-in-out';

export function createIosTheme(mode: 'light' | 'dark'): Theme {
  const dark = mode === 'dark';
  const glassBg = dark ? 'rgba(24,34,52,0.55)' : 'rgba(255,255,255,0.4)';
  const glassBorder = dark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.5)';
  const hoverLayer = dark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.06)';
  const selectedLayer = dark ? 'rgba(245,158,108,0.16)' : 'rgba(185,78,41,0.12)';

  return createTheme({
    palette: {
      mode,
      primary: { main: dark ? '#f59e6c' : '#b94e29' },
      info: { main: dark ? '#0A84FF' : '#007AFF' },
      background: {
        default: dark ? '#111827' : '#f5f7fa',
        paper: dark ? '#182234' : '#ffffff',
      },
    },
    // `shape.borderRadius` is the MULTIPLIER MUI applies to numeric `borderRadius`
    // values in the `sx` prop (`sx={{ borderRadius: 8 }}` -> 8 * base). This app
    // consistently passes real pixel values there (CARD_RADIUS = 14, progress
    // bars = 99, …), so the base has to stay 1 or every corner blows up ~14x.
    // The 14px "squircle" geometry is applied explicitly in the component
    // styleOverrides below instead.
    shape: { borderRadius: 1 },
    typography: {
      fontFamily: SF_STACK,
      h1: { letterSpacing: '-0.021em', fontWeight: 700 },
      h2: { letterSpacing: '-0.021em', fontWeight: 700 },
      h3: { letterSpacing: '-0.02em', fontWeight: 700 },
      h4: { letterSpacing: '-0.019em', fontWeight: 700 },
      h5: { letterSpacing: '-0.017em', fontWeight: 700 },
      h6: { letterSpacing: '-0.014em', fontWeight: 700 },
      button: { textTransform: 'none', fontWeight: 600, letterSpacing: 0 },
    },
    components: {
      MuiCard: {
        styleOverrides: {
          root: {
            borderRadius: IOS_RADIUS,
            backgroundImage: 'none',
            boxShadow: raisedCardShadow(dark),
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          // Only the geometry + flat surface globally; heavy shadows stay opt-in
          // (Card above, or the shared cardSx token) so menus/popovers stay light.
          root: { backgroundImage: 'none' },
          rounded: { borderRadius: IOS_RADIUS },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { borderRadius: 12, transition: APPLE_EASE },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 10,
            transition: APPLE_EASE,
            '&:hover': { backgroundColor: hoverLayer },
            '&.Mui-selected': {
              backgroundColor: selectedLayer,
              '&:hover': { backgroundColor: selectedLayer },
            },
          },
        },
      },
      MuiMenuItem: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            transition: APPLE_EASE,
            '&:hover': { backgroundColor: hoverLayer },
          },
        },
      },
      MuiToggleButton: {
        styleOverrides: { root: { borderRadius: 10, textTransform: 'none' } },
      },
      MuiChip: {
        styleOverrides: { root: { borderRadius: 10 } },
      },
      // Inputs and alerts derive their radius from `shape.borderRadius`, which is
      // now 1, so restore an explicit squircle for them.
      MuiOutlinedInput: {
        styleOverrides: { root: { borderRadius: 10 } },
      },
      MuiAlert: {
        styleOverrides: { root: { borderRadius: 10 } },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundColor: glassBg,
            backgroundImage: 'none',
            borderRight: `1px solid ${glassBorder}`,
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
          },
        },
      },
    },
  });
}
