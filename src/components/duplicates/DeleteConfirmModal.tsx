import { apiClient } from '../../services/apiClient'
import { apiErrorMessage } from '../../services/apiError'
import { CARD_RADIUS } from '../../theme/controls'
import { useState, useEffect, useRef } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Box, Typography, Button, CircularProgress,
} from '@mui/material'
import { Warning as WarningIcon } from '../../components/AppIcons'
import type { DuplicateGroup, DuplicateCopy, DupPalette, ServerConfig, DeleteResponse } from './types'
import { formatBytes, resolutionLabel } from './qualityScore'

interface Props {
  open:         boolean
  group:        DuplicateGroup | null
  deleteTarget: DuplicateCopy | null    // the copy to be deleted
  keeper:       DuplicateCopy | null    // the copy that will remain
  C:            DupPalette
  serverConfig: ServerConfig | null
  onClose:     () => void
  onDeleted:   (response: DeleteResponse) => void
}

export default function DeleteConfirmModal({
  open, group, deleteTarget, keeper, C, serverConfig, onClose, onDeleted,
}: Props) {
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const cancelRef = useRef<HTMLButtonElement | null>(null)

  // Reset state every time the modal opens. Focus Cancel by default (the safe choice).
  useEffect(() => {
    if (open) {
      setSubmitting(false)
      setServerError(null)
      setTimeout(() => cancelRef.current?.focus(), 0)
    }
  }, [open])

  if (!group || !deleteTarget || !keeper) return null

  const deletionAllowed = serverConfig?.allowMediaDeletion !== false
  const canDelete = deletionAllowed && !submitting

  async function handleDelete() {
    if (!canDelete || !group || !deleteTarget || !keeper) return
    setSubmitting(true)
    setServerError(null)
    try {
      const resp = await apiClient.fetch('/api/plex/duplicates/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deleteRatingKey:       deleteTarget.ratingKey,
          expectedGuid:          group.guid,
          expectedTitle:         group.title,
          expectedYear:          group.year,
          expectedFilePath:      deleteTarget.filePath,
          expectedMediaId:       deleteTarget.mediaId,
          expectedLibraryTitles: deleteTarget.libraryTitles,
          expectedRatingKeys:    deleteTarget.ratingKeys,
          keeperRatingKey:       keeper.ratingKey,
          keeperMediaId:         keeper.mediaId,
          keeperFilePath:        keeper.filePath,
          expectedResolution:    group.resolution,
          expectedIs3D:          group.is3D,
          confirmToken:          'DELETE',
        }),
      })
      const data = await resp.json()
      if (!resp.ok) {
        setServerError(apiErrorMessage(data, `Delete failed (HTTP ${resp.status})`))
        setSubmitting(false)
        return
      }
      onDeleted(data as DeleteResponse)
    } catch (err: unknown) {
      setServerError(err instanceof Error ? err.message : String(err))
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={submitting ? undefined : onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: { bgcolor: C.bg, border: `2px solid ${C.rust}`, borderRadius: CARD_RADIUS },
      }}
    >
      <DialogTitle sx={{
        color: C.ink, display: 'flex', alignItems: 'center', gap: 1,
        borderBottom: `1px solid ${C.border}`, py: 1.5,
      }}>
        <WarningIcon sx={{ color: C.rust }} />
        Permanently delete this file?
      </DialogTitle>

      <DialogContent sx={{ pt: 2 }}>
        {/* Override banner — fires when the user is deleting the recommended keeper. */}
        {deleteTarget.isKeeper && (
          <Box sx={{
            mb: 2, p: 1.2, borderRadius: '8px',
            bgcolor: `${C.amber}15`, border: `1.5px solid ${C.amber}88`,
            display: 'flex', alignItems: 'flex-start', gap: 0.8,
          }}>
            <WarningIcon sx={{ fontSize: 18, color: C.amber, mt: 0.2, flexShrink: 0 }} />
            <Box>
              <Typography sx={{ fontSize: '0.85rem', color: C.amber, fontWeight: 700 }}>
                Overriding the recommendation
              </Typography>
              <Typography sx={{ fontSize: '0.78rem', color: C.ink, mt: 0.3 }}>
                You're deleting the copy the quality scorer marked as the <strong>keeper</strong>. The next-best remaining copy ({keeper.libraryTitles.join(' · ')} · {keeper.resolution || '?'}) will become the surviving copy. Make sure that's really what you want.
              </Typography>
            </Box>
          </Box>
        )}

        {/* Side-by-side recap */}
        <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.08em', color: C.muted, mb: 1 }}>
          REVIEW BOTH COPIES ONE MORE TIME
        </Typography>
        <Box sx={{
          display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 1.5, mb: 2,
        }}>
          <RecapCard
            copy={keeper}
            tone="keep"
            heading="WILL KEEP"
            C={C}
          />
          <RecapCard
            copy={deleteTarget}
            tone="delete"
            heading="WILL DELETE"
            C={C}
          />
        </Box>

        {/* Full path */}
        <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.08em', color: C.muted, mb: 0.5 }}>
          FULL PATH OF FILE TO DELETE
        </Typography>
        <Box sx={{
          p: 1, mb: 2, borderRadius: '6px',
          bgcolor: `${C.rust}10`, border: `1px solid ${C.rust}55`,
        }}>
          <Typography sx={{
            fontFamily: '"JetBrains Mono", "Fira Code", monospace',
            fontSize: '0.78rem', color: C.ink, wordBreak: 'break-all', userSelect: 'text',
          }}>
            {deleteTarget.filePath}
          </Typography>
        </Box>

        {/* Consequences */}
        <Box component="ul" sx={{
          m: 0, mb: 2, pl: 2.5, color: C.ink, fontSize: '0.82rem',
          '& li': { mb: 0.3 },
        }}>
          <li>
            The file <code style={{ background: C.surface, padding: '0 4px', borderRadius: 3 }}>
              {deleteTarget.filePath}
            </code> will be permanently removed from disk by Plex.
          </li>
          <li>This action is logged and <strong>cannot be undone from this app</strong>.</li>
          <li>The keeper at <code style={{ background: C.surface, padding: '0 4px', borderRadius: 3 }}>
              {keeper.filePath || '(no path)'}
            </code> will remain.</li>
          <li>Plex may take a few seconds to update internally. The duplicate list updates in place — run a new scan when you're ready to refresh from Plex.</li>
        </Box>

        {!deletionAllowed && (
          <Box sx={{
            p: 1.2, mb: 2, borderRadius: '8px',
            bgcolor: `${C.red}15`, border: `1px solid ${C.red}66`,
            display: 'flex', alignItems: 'flex-start', gap: 0.8,
          }}>
            <WarningIcon sx={{ fontSize: 16, color: C.red, mt: 0.2 }} />
            <Typography sx={{ fontSize: '0.8rem', color: C.red }}>
              Plex server has "Allow media deletion" disabled. Enable it in Plex Settings → Library before deleting.
            </Typography>
          </Box>
        )}

        {serverError && (
          <Box sx={{
            mt: 1.2, p: 1.2, borderRadius: '8px',
            bgcolor: `${C.red}15`, border: `1px solid ${C.red}66`,
          }}>
            <Typography sx={{ fontSize: '0.78rem', color: C.red, fontWeight: 600, mb: 0.2 }}>
              Delete failed
            </Typography>
            <Typography sx={{ fontSize: '0.8rem', color: C.red, fontFamily: '"JetBrains Mono", monospace' }}>
              {serverError}
            </Typography>
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ borderTop: `1px solid ${C.border}`, px: 2.5, py: 1.5, gap: 1 }}>
        <Button
          ref={cancelRef}
          onClick={onClose}
          disabled={submitting}
          variant="contained"
          sx={{
            textTransform: 'none', fontWeight: 600,
            bgcolor: C.green, color: '#fff',
            '&:hover': { bgcolor: C.green, opacity: 0.92 },
          }}
        >
          Cancel
        </Button>
        <Button
          onClick={handleDelete}
          disabled={!canDelete}
          variant="outlined"
          startIcon={submitting ? <CircularProgress size={14} sx={{ color: C.rust }} /> : null}
          sx={{
            textTransform: 'none', fontWeight: 600, ml: 1,
            borderColor: C.rust, color: C.rust,
            '&:hover': { borderColor: C.rust, bgcolor: `${C.rust}10` },
            '&.Mui-disabled': { borderColor: C.border, color: C.muted },
          }}
        >
          {submitting ? 'Deleting…' : 'Delete permanently'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function RecapCard({
  copy, tone, heading, C,
}: {
  copy:    DuplicateCopy
  tone:   'keep' | 'delete'
  heading: string
  C:       DupPalette
}) {
  const color = tone === 'keep' ? C.green : C.rust
  return (
    <Box sx={{
      p: 1.2, borderRadius: CARD_RADIUS,
      bgcolor: `${color}10`, border: `1.5px solid ${color}77`,
    }}>
      <Typography sx={{ fontSize: '0.7rem', fontWeight: 800, letterSpacing: '0.08em', color, mb: 0.4 }}>
        {heading}
      </Typography>
      <Typography sx={{ fontSize: '0.82rem', color: C.ink, fontWeight: 600, mb: 0.2 }}>
        {copy.libraryTitles.join(' · ')}
      </Typography>
      {copy.libraryTitles.length > 1 && (
        <Typography sx={{ fontSize: '0.68rem', color: C.muted, fontStyle: 'italic', mb: 0.3 }}>
          (one physical file, indexed by {copy.libraryTitles.length} libraries)
        </Typography>
      )}
      <Typography sx={{ fontSize: '0.74rem', color: C.muted, fontFamily: '"JetBrains Mono", monospace', mb: 0.6, wordBreak: 'break-all' }}>
        {copy.filePath}
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.4, fontSize: '0.72rem', color: C.muted }}>
        <Box sx={{ px: 0.5, py: 0.1, bgcolor: `${color}22`, color, borderRadius: '4px', fontWeight: 700 }}>
          {resolutionLabel(copy.resolution)}{copy.is3D ? ' 3D' : ''}
        </Box>
        <Box sx={{ px: 0.5, py: 0.1, bgcolor: C.surface, borderRadius: '4px' }}>
          {copy.videoCodec || 'codec?'}
        </Box>
        <Box sx={{ px: 0.5, py: 0.1, bgcolor: C.surface, borderRadius: '4px' }}>
          {copy.bitrate} kbps
        </Box>
        <Box sx={{ px: 0.5, py: 0.1, bgcolor: C.surface, borderRadius: '4px' }}>
          {copy.audioCodec} {copy.audioChannels}ch
        </Box>
        <Box sx={{ px: 0.5, py: 0.1, bgcolor: C.surface, borderRadius: '4px', fontWeight: 700, color: C.ink }}>
          {formatBytes(copy.fileSize)}
        </Box>
      </Box>
    </Box>
  )
}
