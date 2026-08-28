import type { ReactNode } from 'react';
import { Box, Typography } from '@mui/material';
import { motion } from 'framer-motion';
import { useThemeMode } from '../context/ThemeContext';
import { tokensFor } from '../theme/tokens';

interface PageHeroProps { eyebrow?: string; title: string; accentPhrase?: string; subtitle?: ReactNode; actions?: ReactNode; compact?: boolean; }
export default function PageHero({ title, accentPhrase, subtitle, actions, compact }: PageHeroProps) {
  const { mode, palette } = useThemeMode();
  const t = tokensFor(mode === 'dark', palette);
  const [before, after] = accentPhrase && title.includes(accentPhrase) ? title.split(accentPhrase, 2) : [title, ''];
  return <Box component={motion.header} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .28 }} sx={{ mb: compact ? 2 : 3, display: 'flex', gap: 2, alignItems: { xs: 'stretch', sm: 'center' }, justifyContent: 'space-between', flexDirection: { xs: 'column', sm: 'row' } }}>
    <Box>
      <Typography component="h1" sx={{ color: t.ink, fontSize: compact ? { xs: '1.5rem', md: '1.85rem' } : { xs: '1.8rem', md: '2.4rem' }, fontWeight: 800, letterSpacing: '-.035em', lineHeight: 1.1 }}>
        {before}{after && <Box component="span" sx={{ color: mode === 'dark' ? t.rustLight : t.rustDark }}>{accentPhrase}</Box>}{after}
      </Typography>
      {subtitle && <Typography sx={{ color: t.inkSoft, mt: 1, maxWidth: 760, lineHeight: 1.6 }}>{subtitle}</Typography>}
    </Box>
    {actions && <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>{actions}</Box>}
  </Box>;
}
