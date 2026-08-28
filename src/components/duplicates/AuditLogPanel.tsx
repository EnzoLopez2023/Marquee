import { apiClient } from '../../services/apiClient'
import { useState, useEffect, useCallback } from 'react'
import {
  Box, Typography, Chip, IconButton, Tooltip, CircularProgress,
  Accordion, AccordionSummary, AccordionDetails,
  ToggleButton, ToggleButtonGroup,
} from '@mui/material'
import {
  Refresh as RefreshIcon,
  ExpandMore as ExpandIcon,
  History as HistoryIcon,
} from '../../components/AppIcons'
import type { AuditLogEntry, AuditLogResponse, DupPalette } from './types'
import { formatBytes, formatTimestampMs } from './qualityScore'

interface Props {
  C:          DupPalette
  refreshKey: number   // bumped by parent after a successful delete to trigger reload
}

export default function AuditLogPanel({ C, refreshKey }: Props) {
  const [entries,  setEntries]  = useState<AuditLogEntry[]>([])
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [filter,   setFilter]   = useState<'all' | 'delete' | 'delete_attempt' | 'scan'>('all')

  const fetchLog = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      params.set('limit', '200')
      if (filter !== 'all') params.set('action', filter)
      const resp = await apiClient.fetch(`/api/plex/duplicates/audit?${params.toString()}`)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const data: AuditLogResponse = await resp.json()
      setEntries(data.entries)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => { fetchLog() }, [fetchLog, refreshKey])

  return (
    <Box sx={{ mt: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.2, flexWrap: 'wrap' }}>
        <HistoryIcon sx={{ fontSize: 18, color: C.muted }} />
        <Typography sx={{ fontSize: '0.95rem', fontWeight: 700, color: C.ink, flex: '0 0 auto' }}>
          Action history
        </Typography>
        <Typography sx={{ fontSize: '0.72rem', color: C.muted, fontFamily: '"JetBrains Mono", monospace' }}>
          {entries.length} entries
        </Typography>

        <Box sx={{ flex: 1 }} />

        <ToggleButtonGroup
          value={filter}
          exclusive
          size="small"
          onChange={(_, v) => v && setFilter(v)}
          sx={{
            '& .MuiToggleButton-root': {
              // Unselected uses ink rather than muted: at this size muted reads
              // as disabled rather than merely unselected.
              px: 1.2, py: 0.3, textTransform: 'none', fontSize: '0.72rem',
              color: C.ink, borderColor: C.border,
              '&.Mui-selected': { bgcolor: C.rustBg, color: C.rust, borderColor: C.rust + '88', fontWeight: 600 },
            },
          }}
        >
          <ToggleButton value="all">All</ToggleButton>
          <ToggleButton value="delete">Deletes</ToggleButton>
          <ToggleButton value="delete_attempt">Attempts</ToggleButton>
          <ToggleButton value="scan">Scans</ToggleButton>
        </ToggleButtonGroup>

        <Tooltip title="Refresh audit log">
          <IconButton onClick={fetchLog} size="small" sx={{ color: C.muted, '&:hover': { color: C.rust } }}>
            <RefreshIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      </Box>

      {error && (
        <Box sx={{ p: 1, mb: 1, bgcolor: `${C.red}15`, border: `1px solid ${C.red}44`, borderRadius: '6px' }}>
          <Typography sx={{ fontSize: '0.78rem', color: C.red }}>Failed to load audit log: {error}</Typography>
        </Box>
      )}

      {loading && entries.length === 0 ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
          <CircularProgress size={20} sx={{ color: C.rust }} />
        </Box>
      ) : entries.length === 0 ? (
        <Box sx={{
          p: 2, textAlign: 'center',
          bgcolor: C.paper, border: `1px dashed ${C.border}`, borderRadius: '8px',
        }}>
          <Typography sx={{ color: C.muted, fontSize: '0.82rem' }}>
            No actions logged yet.
          </Typography>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.6 }}>
          {entries.map(entry => <AuditRow key={entry.id} entry={entry} C={C} />)}
        </Box>
      )}
    </Box>
  )
}

function AuditRow({ entry, C }: { entry: AuditLogEntry; C: DupPalette }) {
  const statusColor = (
    entry.status === 'success'       ? C.green :
    entry.status === 'failed'        ? C.red   :
    entry.status === 'verify_failed' ? C.red   :
    entry.status === 'cancelled'     ? C.amber :
    C.muted
  )
  const actionLabel = entry.action.replace(/_/g, ' ')

  return (
    <Accordion
      disableGutters
      sx={{
        bgcolor: C.paper, border: `1px solid ${C.border}`, borderRadius: '8px',
        boxShadow: 'none', '&:before': { display: 'none' },
        '&.Mui-expanded': { borderColor: statusColor + '77' },
      }}
    >
      <AccordionSummary
        expandIcon={<ExpandIcon sx={{ color: C.muted, fontSize: 18 }} />}
        sx={{ px: 1.2, minHeight: 'auto', '& .MuiAccordionSummary-content': { my: 0.6, gap: 1, alignItems: 'center', flexWrap: 'wrap' } }}
      >
        <Typography sx={{ fontSize: '0.72rem', fontFamily: '"JetBrains Mono", monospace', color: C.muted, minWidth: 130 }}>
          {formatTimestampMs(entry.ts)}
        </Typography>
        <Chip
          label={actionLabel}
          size="small"
          sx={{ height: 18, fontSize: '0.66rem', bgcolor: `${C.rust}18`, color: C.rust, border: 'none', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em' }}
        />
        <Chip
          label={entry.status.replace(/_/g, ' ')}
          size="small"
          sx={{ height: 18, fontSize: '0.66rem', bgcolor: `${statusColor}22`, color: statusColor, border: 'none', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em' }}
        />
        <Typography sx={{ fontSize: '0.82rem', color: C.ink, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {entry.title ? `${entry.title}${entry.year ? ` (${entry.year})` : ''}` : (entry.action === 'scan' ? '(scan summary)' : '(no title)')}
        </Typography>
        {entry.library_title && (
          <Typography sx={{ fontSize: '0.7rem', color: C.muted, fontFamily: '"JetBrains Mono", monospace' }}>
            {entry.library_title}
          </Typography>
        )}
        {entry.file_size != null && (
          <Typography sx={{ fontSize: '0.72rem', color: C.muted, fontWeight: 600 }}>
            {formatBytes(entry.file_size)}
          </Typography>
        )}
      </AccordionSummary>
      <AccordionDetails sx={{ borderTop: `1px solid ${C.border}`, p: 1.5 }}>
        <Box sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' },
          gap: 0.4, fontSize: '0.78rem',
        }}>
          <Field C={C} label="Rating key"   value={entry.rating_key} mono />
          <Field C={C} label="GUID"         value={entry.movie_guid} mono />
          <Field C={C} label="File path"    value={entry.file_path}  mono fullWidth />
          <Field C={C} label="File size"    value={entry.file_size != null ? `${formatBytes(entry.file_size)} (${entry.file_size.toLocaleString()} B)` : null} />
          <Field C={C} label="Duration"     value={entry.duration_ms != null ? `${entry.duration_ms.toLocaleString()} ms` : null} />
          <Field C={C} label="Resolution"   value={entry.resolution} />
          <Field C={C} label="Bitrate"      value={entry.bitrate_kbps != null ? `${entry.bitrate_kbps} kbps` : null} />
          <Field C={C} label="Video codec"  value={entry.video_codec} />
          <Field C={C} label="Audio"        value={entry.audio_codec ? `${entry.audio_codec} ${entry.audio_channels || ''}ch` : null} />
          <Field C={C} label="Container"    value={entry.container} />
          <Field C={C} label="Library"      value={entry.library_title} />
          <Field C={C} label="Library ID"   value={entry.library_id} mono />
          <Field C={C} label="Kept copy"    value={entry.kept_rating_key} mono />
          <Field C={C} label="Kept path"    value={entry.kept_file_path} mono fullWidth />
          <Field C={C} label="User"         value={entry.user_email} />
        </Box>

        {entry.error_message && (
          <Box sx={{
            mt: 1, p: 1, borderRadius: '6px',
            bgcolor: `${C.red}15`, border: `1px solid ${C.red}55`,
          }}>
            <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: C.red, mb: 0.3, letterSpacing: '0.08em' }}>
              ERROR
            </Typography>
            <Typography sx={{ fontSize: '0.78rem', color: C.red, fontFamily: '"JetBrains Mono", monospace' }}>
              {entry.error_message}
            </Typography>
          </Box>
        )}

        {entry.snapshot && (
          <Accordion disableGutters sx={{ mt: 1, bgcolor: 'transparent', boxShadow: 'none', '&:before': { display: 'none' } }}>
            <AccordionSummary
              expandIcon={<ExpandIcon sx={{ color: C.muted, fontSize: 16 }} />}
              sx={{ p: 0, minHeight: 'auto', '& .MuiAccordionSummary-content': { my: 0.4 } }}
            >
              <Typography sx={{ fontSize: '0.72rem', color: C.muted, fontWeight: 600 }}>
                Full Plex metadata snapshot at the moment of action
              </Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ p: 0 }}>
              <Box sx={{
                p: 1, borderRadius: '6px',
                bgcolor: C.surface, border: `1px solid ${C.border}`,
                maxHeight: 360, overflow: 'auto',
              }}>
                <Typography component="pre" sx={{
                  fontFamily: '"JetBrains Mono", monospace', fontSize: '0.7rem',
                  color: C.ink, m: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                }}>
                  {JSON.stringify(entry.snapshot, null, 2)}
                </Typography>
              </Box>
            </AccordionDetails>
          </Accordion>
        )}
      </AccordionDetails>
    </Accordion>
  )
}

function Field({
  label, value, C, mono = false, fullWidth = false,
}: {
  label:    string
  value:    string | number | null | undefined
  C:        DupPalette
  mono?:    boolean
  fullWidth?: boolean
}) {
  if (value == null || value === '') return null
  return (
    <Box sx={{ gridColumn: fullWidth ? '1 / -1' : undefined, display: 'flex', gap: 0.6 }}>
      <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: C.muted, letterSpacing: '0.05em', minWidth: 100, textTransform: 'uppercase' }}>
        {label}
      </Typography>
      <Typography sx={{
        fontSize: '0.78rem', color: C.ink, flex: 1, wordBreak: 'break-all',
        fontFamily: mono ? '"JetBrains Mono", monospace' : undefined,
      }}>
        {value}
      </Typography>
    </Box>
  )
}
