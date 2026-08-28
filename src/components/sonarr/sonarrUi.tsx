import type { ReactNode } from 'react';
import { Box, Chip, Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { CARD_HOVER_SX, CARD_RADIUS } from '../../theme/controls';
import type { HearthTokens } from '../../theme/tokens';
import { toneColor } from './sonarrFormat';
import type { SonarrTone } from './sonarrFormat';

export function Panel({
  children,
  t,
  sx,
  component = 'section',
}: {
  children: ReactNode;
  t: HearthTokens;
  sx?: SxProps<Theme>;
  component?: React.ElementType;
}) {
  return (
    <Box
      component={component}
      sx={{
        borderRadius: CARD_RADIUS,
        background: t.paper,
        border: `1px solid ${t.line}`,
        ...CARD_HOVER_SX,
        ...sx,
      }}
    >
      {children}
    </Box>
  );
}

export function SectionTitle({
  title,
  detail,
  action,
  t,
}: {
  title: string;
  detail?: ReactNode;
  action?: ReactNode;
  t: HearthTokens;
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, mb: 1.5 }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography component="h2" sx={{ color: t.ink, fontSize: '1rem', lineHeight: 1.25, fontWeight: 800 }}>
          {title}
        </Typography>
        {detail && (
          <Typography sx={{ color: t.muted, mt: 0.35, fontSize: '0.76rem', lineHeight: 1.45 }}>
            {detail}
          </Typography>
        )}
      </Box>
      {action}
    </Box>
  );
}

export function StatusChip({
  label,
  tone,
  t,
  isDark,
}: {
  label: string;
  tone: SonarrTone;
  t: HearthTokens;
  isDark: boolean;
}) {
  const color = toneColor(tone, isDark, t);
  return (
    <Chip
      size="small"
      label={label}
      sx={{
        height: 22,
        color,
        bgcolor: `${color}18`,
        border: `1px solid ${color}44`,
        fontSize: '0.68rem',
        fontWeight: 700,
        '& .MuiChip-label': { px: 0.9 },
      }}
    />
  );
}

export function EmptyState({
  title,
  detail,
  t,
}: {
  title: string;
  detail: string;
  t: HearthTokens;
}) {
  return (
    <Box sx={{ py: 4, px: 2, textAlign: 'center' }}>
      <Typography sx={{ color: t.ink, fontWeight: 700, fontSize: '0.9rem' }}>{title}</Typography>
      <Typography sx={{ color: t.muted, fontSize: '0.78rem', mt: 0.5, maxWidth: 520, mx: 'auto' }}>
        {detail}
      </Typography>
    </Box>
  );
}
