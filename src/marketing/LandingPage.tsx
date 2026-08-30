import type { ReactNode } from 'react';
import { Box, Button, Stack, ThemeProvider, Typography } from '@mui/material';
import { motion } from 'framer-motion';
import { createIosTheme } from '../theme/iosTheme';
import { Parallax } from './Parallax';
import { L, MONO, blueprint, eyebrowSx, floatSx } from './landingTokens';

const landingTheme = createIosTheme('light');

const MODULES = [
  'Plex Library', 'Command Center', 'Duplicate Audit', 'Playlist Builder',
  'Sonarr Dashboard', 'Tautulli Insights', 'Watch Trends', 'Quality Scoring',
];

const STATS = [
  { k: 'Plex Library', v: 'Ratings, insights, and watch trends across the whole collection.' },
  { k: 'Command Center', v: 'Live sessions, bandwidth, and history in one operator view.' },
  { k: 'Duplicate Audit', v: 'Quality-scored groups with a reviewed, logged deletion workflow.' },
  { k: 'Sonarr Dashboard', v: 'Calendar, queue, and system health without leaving the app.' },
];

/* ------------------------------------------------------------------ mockups */

function Chrome({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box sx={{ ...floatSx, overflow: 'hidden', width: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1.75, py: 1.25, borderBottom: `1px solid ${L.line}` }}>
        {['#f0705a', '#f2b643', '#4fbf6b'].map(c => (
          <Box key={c} sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: c }} />
        ))}
        <Typography sx={{ ml: 1, fontFamily: MONO, fontSize: 11, color: L.muted, letterSpacing: '0.08em' }}>{label}</Typography>
      </Box>
      <Box sx={{ p: 1.75 }}>{children}</Box>
    </Box>
  );
}

function PosterGrid() {
  const tints = ['#c76a45', '#3a4a63', '#8f9bb0', '#b94e29', '#5a6b85', '#d3a06f', '#46566f', '#a7b2c4'];
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1 }}>
      {tints.map((t, i) => (
        <Box key={i} sx={{ aspectRatio: '2 / 3', borderRadius: '8px', bgcolor: t, opacity: 0.9 }} />
      ))}
    </Box>
  );
}

function MiniBars() {
  const bars = [38, 62, 45, 78, 91, 54, 67, 83, 49, 72, 60, 88];
  return (
    <Box>
      <Typography sx={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', color: L.ink }}>42,318</Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: 11, color: L.muted, mb: 1.25 }}>PLAYS · LAST 90 DAYS</Typography>
      <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.6, height: 68 }}>
        {bars.map((h, i) => (
          <Box key={i} sx={{ flex: 1, height: `${h}%`, borderRadius: '3px 3px 0 0', bgcolor: i === 4 ? L.rust : '#c3ccdb' }} />
        ))}
      </Box>
    </Box>
  );
}

function CalendarRows() {
  const rows = [
    ['Severance', 'S02E07', '#4fbf6b'],
    ['The Bear', 'S04E01', '#f2b643'],
    ['Andor', 'S02E10', '#c3ccdb'],
    ['Silo', 'S03E04', '#c3ccdb'],
  ];
  return (
    <Stack spacing={1}>
      {rows.map(([name, ep, dot]) => (
        <Box key={name} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 0.9, borderRadius: '10px', border: `1px solid ${L.line}` }}>
          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: dot }} />
          <Typography sx={{ fontSize: 13, fontWeight: 600, color: L.ink, flex: 1 }}>{name}</Typography>
          <Typography sx={{ fontFamily: MONO, fontSize: 11, color: L.muted }}>{ep}</Typography>
        </Box>
      ))}
    </Stack>
  );
}

function DuplicateRows() {
  const rows = [
    ['Blade Runner 2049', '2160p · 54.2 GB', 'keep'],
    ['Blade Runner 2049', '1080p · 12.8 GB', 'remove'],
    ['Dune Part Two', '2160p · 61.7 GB', 'keep'],
    ['Dune Part Two', '1080p · 14.1 GB', 'remove'],
  ];
  return (
    <Stack spacing={0.75}>
      {rows.map(([title, meta, tag], i) => (
        <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.1, py: 0.9, borderRadius: '10px', bgcolor: tag === 'remove' ? 'rgba(185,78,41,0.07)' : '#f4f6fa' }}>
          <Typography sx={{ fontSize: 13, fontWeight: 600, color: L.ink, flex: 1 }}>{title}</Typography>
          <Typography sx={{ fontFamily: MONO, fontSize: 11, color: L.muted }}>{meta}</Typography>
          <Typography sx={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: tag === 'remove' ? L.rustDark : '#237a50' }}>{tag}</Typography>
        </Box>
      ))}
    </Stack>
  );
}

/* ------------------------------------------------------------------- pieces */

function Eyebrow({ children }: { children: ReactNode }) {
  return <Typography sx={eyebrowSx}>{children}</Typography>;
}

function CTA({ onClick, variant = 'primary', children }: { onClick: () => void; variant?: 'primary' | 'ghost'; children: ReactNode }) {
  return (
    <Button
      onClick={onClick}
      disableElevation
      sx={{
        px: 2.5,
        py: 1.25,
        fontSize: 15,
        fontWeight: 700,
        borderRadius: '12px',
        ...(variant === 'primary'
          ? { bgcolor: L.rust, color: '#fff', '&:hover': { bgcolor: L.rustDark } }
          : { color: L.ink, border: `1px solid ${L.line}`, bgcolor: 'transparent', '&:hover': { bgcolor: 'rgba(20,33,61,0.04)' } }),
      }}
    >
      {children}
    </Button>
  );
}

const FIGURES = [
  {
    fig: 'FIG. 01',
    eyebrow: 'PLEX LIBRARY',
    title: 'The collection, measured.',
    body: 'Every title carries its ratings, watch counts, and recency. Sort by what is actually being played, spot what has gone cold, and see the shape of the library at a glance.',
    bullets: ['IMDb / Rotten Tomatoes / audience side by side', 'Watch trend sparklines per title', 'Filter by codec, resolution, and file size'],
    mockup: <Chrome label="marquee / plex / library"><PosterGrid /></Chrome>,
  },
  {
    fig: 'FIG. 02',
    eyebrow: 'DUPLICATE AUDIT',
    title: 'Reclaim space, on the record.',
    body: 'Duplicates are grouped and quality-scored so the keeper is obvious. Deletions run through a confirmation step and land in an audit log you can hand to anyone who asks.',
    bullets: ['Deterministic quality score per copy', 'Two-step confirm before anything is removed', 'Every deletion written to the audit trail'],
    mockup: <Chrome label="marquee / duplicates"><DuplicateRows /></Chrome>,
  },
  {
    fig: 'FIG. 03',
    eyebrow: 'SONARR DASHBOARD',
    title: 'What is landing tonight.',
    body: 'The upcoming calendar, the download queue, and system health in one place — pulled straight from Sonarr, with no second tab and no context switch.',
    bullets: ['Air-date calendar with status dots', 'Queue progress and stalled-download flags', 'Disk, indexers, and health checks inline'],
    mockup: <Chrome label="marquee / sonarr / today"><CalendarRows /></Chrome>,
  },
];

/* --------------------------------------------------------------------- page */

export default function LandingPage({ onSignIn }: { onSignIn: () => void }) {
  const toFeatures = () => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' });

  return (
    <ThemeProvider theme={landingTheme}>
      <Box sx={{ ...blueprint, minHeight: '100vh', color: L.ink, fontFamily: landingTheme.typography.fontFamily, overflowX: 'hidden' }}>
        <Box sx={{ maxWidth: 1180, mx: 'auto', px: { xs: 3, md: 6 } }}>

          {/* top bar */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 2.5 }}>
            <Typography sx={{ fontWeight: 850, fontSize: 20, letterSpacing: '-0.02em' }}>Marquee</Typography>
            <CTA onClick={onSignIn} variant="ghost">Sign in</CTA>
          </Box>

          {/* hero */}
          <Box
            component={motion.section}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
            sx={{
              position: 'relative',
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: '1.05fr 0.95fr' },
              gap: { xs: 5, md: 4 },
              alignItems: 'center',
              pt: { xs: 4, md: 8 },
              pb: { xs: 8, md: 12 },
            }}
          >
            {/* corner crop marks */}
            {[
              { top: 0, left: 0, bt: 2, bl: 2 },
              { top: 0, right: 0, bt: 2, br: 2 },
              { bottom: 0, left: 0, bb: 2, bl: 2 },
              { bottom: 0, right: 0, bb: 2, br: 2 },
            ].map((m, i) => (
              <Box key={i} aria-hidden sx={{
                position: 'absolute', width: 18, height: 18, pointerEvents: 'none',
                top: m.top, bottom: m.bottom, left: m.left, right: m.right,
                borderTop: m.bt ? `2px solid ${L.line}` : undefined,
                borderBottom: m.bb ? `2px solid ${L.line}` : undefined,
                borderLeft: m.bl ? `2px solid ${L.line}` : undefined,
                borderRight: m.br ? `2px solid ${L.line}` : undefined,
              }} />
            ))}

            <Box>
              <Eyebrow>Independent Plex · Tautulli · Sonarr ops</Eyebrow>
              <Typography component="h1" sx={{ mt: 2, fontWeight: 850, letterSpacing: '-0.035em', lineHeight: 1.03, fontSize: 'clamp(2.6rem, 6.5vw, 4.6rem)' }}>
                Run the library.<br />
                <Box component="span" sx={{ color: L.rust }}>Know the numbers.</Box>
              </Typography>
              <Typography sx={{ mt: 3, maxWidth: 520, fontSize: 18, lineHeight: 1.6, color: L.inkSoft }}>
                Marquee is a self-contained operations console for your media stack — the Plex library,
                a live command center, the duplicate audit and deletion workflow, playlist building, and
                the Sonarr dashboard, on one app-owned database.
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 4 }}>
                <CTA onClick={onSignIn}>Sign in with Microsoft</CTA>
                <CTA onClick={toFeatures} variant="ghost">See what&rsquo;s inside</CTA>
              </Stack>
              <Typography sx={{ mt: 2.5, fontFamily: MONO, fontSize: 12, color: L.muted }}>
                Entra ID sign-in · progress stays on your deployment
              </Typography>
            </Box>

            {/* floating mockup cluster */}
            <Box sx={{ position: 'relative', minHeight: { xs: 380, md: 460 }, display: { xs: 'none', sm: 'block' } }}>
              <Parallax distance={40} style={{ position: 'absolute', top: 0, right: 0, width: '86%' }}>
                <Chrome label="marquee / plex / library"><PosterGrid /></Chrome>
              </Parallax>
              <Parallax distance={80} style={{ position: 'absolute', top: 150, left: 0, width: '62%' }}>
                <Box sx={{ ...floatSx, p: 2 }}><MiniBars /></Box>
              </Parallax>
              <Parallax distance={120} style={{ position: 'absolute', bottom: 0, right: 12, width: '70%' }}>
                <Chrome label="sonarr / today"><CalendarRows /></Chrome>
              </Parallax>
            </Box>
          </Box>
        </Box>

        {/* ticker band */}
        <Box sx={{
          bgcolor: L.band,
          color: '#e7edf6',
          py: 1.75,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          '@keyframes mq-scroll': { from: { transform: 'translateX(0)' }, to: { transform: 'translateX(-50%)' } },
          '& .mq-track': { display: 'inline-flex', gap: 0, animation: 'mq-scroll 32s linear infinite' },
          '@media (prefers-reduced-motion: reduce)': { '& .mq-track': { animation: 'none' } },
        }}>
          <Box className="mq-track">
            {[0, 1].map(dup => (
              <Box key={dup} component="span" sx={{ display: 'inline-flex' }}>
                {MODULES.map(m => (
                  <Box component="span" key={`${dup}-${m}`} sx={{ px: 3, fontFamily: MONO, fontSize: 13, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#aeb9cc' }}>
                    {m} <Box component="span" sx={{ color: L.rust, ml: 3 }}>/</Box>
                  </Box>
                ))}
              </Box>
            ))}
          </Box>
        </Box>

        <Box sx={{ maxWidth: 1180, mx: 'auto', px: { xs: 3, md: 6 } }}>

          {/* stat row */}
          <Box sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' },
            gap: { xs: 3, md: 2 },
            py: { xs: 6, md: 9 },
            borderBottom: `1px solid ${L.line}`,
          }}>
            {STATS.map(s => (
              <Box key={s.k}>
                <Typography sx={{ fontWeight: 800, fontSize: 17, letterSpacing: '-0.015em' }}>{s.k}</Typography>
                <Typography sx={{ mt: 0.75, fontSize: 13.5, lineHeight: 1.55, color: L.inkSoft }}>{s.v}</Typography>
              </Box>
            ))}
          </Box>

          {/* feature figures */}
          <Box id="features" sx={{ py: { xs: 6, md: 10 } }}>
            <Stack spacing={{ xs: 10, md: 16 }}>
              {FIGURES.map((f, i) => (
                <Box key={f.fig} sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
                  gap: { xs: 4, md: 8 },
                  alignItems: 'center',
                }}>
                  <Box sx={{ order: { md: i % 2 === 1 ? 2 : 1 } }}>
                    <Eyebrow>{f.fig} · {f.eyebrow}</Eyebrow>
                    <Typography component="h2" sx={{ mt: 1.5, fontWeight: 850, letterSpacing: '-0.03em', lineHeight: 1.1, fontSize: 'clamp(1.9rem, 3.6vw, 2.7rem)' }}>
                      {f.title}
                    </Typography>
                    <Typography sx={{ mt: 2, fontSize: 16.5, lineHeight: 1.6, color: L.inkSoft }}>{f.body}</Typography>
                    <Stack component="ul" spacing={1} sx={{ mt: 2.5, pl: 0, listStyle: 'none' }}>
                      {f.bullets.map(b => (
                        <Box component="li" key={b} sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start' }}>
                          <Box sx={{ mt: '7px', width: 6, height: 6, borderRadius: '50%', bgcolor: L.rust, flexShrink: 0 }} />
                          <Typography sx={{ fontSize: 14.5, color: L.inkSoft }}>{b}</Typography>
                        </Box>
                      ))}
                    </Stack>
                  </Box>
                  <Box sx={{ order: { md: i % 2 === 1 ? 1 : 2 } }}>
                    <Parallax distance={50}>{f.mockup}</Parallax>
                  </Box>
                </Box>
              ))}
            </Stack>
          </Box>

          {/* closing CTA */}
          <Box sx={{ textAlign: 'center', py: { xs: 8, md: 14 }, borderTop: `1px solid ${L.line}` }}>
            <Eyebrow>One sign-in</Eyebrow>
            <Typography component="h2" sx={{ mt: 1.5, fontWeight: 850, letterSpacing: '-0.03em', fontSize: 'clamp(2rem, 4.5vw, 3.2rem)' }}>
              Stand up your <Box component="span" sx={{ color: L.rust }}>media operations</Box>.
            </Typography>
            <Stack direction="row" justifyContent="center" sx={{ mt: 4 }}>
              <CTA onClick={onSignIn}>Sign in with Microsoft</CTA>
            </Stack>
          </Box>

          {/* footer */}
          <Box sx={{ py: 5, borderTop: `1px solid ${L.line}`, textAlign: 'center' }}>
            <Typography sx={{ fontFamily: MONO, fontSize: 12, letterSpacing: '0.1em', color: L.muted }}>
              MARQUEE · INDEPENDENT PLEX, TAUTULLI, AND SONARR OPERATIONS
            </Typography>
          </Box>
        </Box>
      </Box>
    </ThemeProvider>
  );
}
