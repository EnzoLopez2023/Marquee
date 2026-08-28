import { CARD_RADIUS } from '../../theme/controls'
import { useState } from 'react'
import { Box, Typography, Chip, Button, Accordion, AccordionSummary, AccordionDetails, Tooltip } from '@mui/material'
import {
  ExpandMore as ExpandIcon,
  CheckCircle as KeeperIcon,
  ArrowDownward as DeleteRecIcon,
  HelpOutline as ManualIcon,
  OpenInNew as OpenIcon,
  DeleteOutline as TrashIcon,
  ContentCopy as CopyIcon,
} from '../../components/AppIcons'
import type { DuplicateGroup, DuplicateCopy, DupPalette, ServerConfig } from './types'
import { useReadOnly } from '../../context/UserPermissionsContext'
import { formatBytes, formatDuration, formatTimestamp, resolutionLabel } from './qualityScore'

interface Props {
  group:        DuplicateGroup
  C:            DupPalette
  serverConfig: ServerConfig | null
  machineId:    string | null
  // Called for every delete intent — keeper, recommended-remove, or manual pick.
  // The parent picks the surviving keeper and opens the confirmation modal.
  onRequestDelete: (group: DuplicateGroup, copy: DuplicateCopy) => void
}

export default function DuplicateDetailPanel({
  group, C, serverConfig, machineId, onRequestDelete,
}: Props) {

  return (
    <Box sx={{ height: '100%', overflowY: 'auto' }}>
      {/* Heading */}
      <Box sx={{ mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography sx={{ fontSize: '1.4rem', fontWeight: 700, color: C.ink, lineHeight: 1.2 }}>
            {group.title}{group.year ? ` (${group.year})` : ''}
          </Typography>
          {group.is3D && (
            <Box sx={{
              px: 0.8, py: 0.2, borderRadius: '6px',
              bgcolor: `${C.amber}22`, color: C.amber,
              fontSize: '0.7rem', fontWeight: 800, letterSpacing: '0.06em',
            }}>
              3D EDITION
            </Box>
          )}
        </Box>
        {group.guid && (
          <Typography sx={{ fontSize: '0.7rem', color: C.muted, fontFamily: '"JetBrains Mono", monospace', mt: 0.3 }}>
            {group.guid}
          </Typography>
        )}
        {group.manualReviewRequired && (
          <Box sx={{
            mt: 1.2, p: 1.2, bgcolor: `${C.amber}18`, border: `1px solid ${C.amber}55`,
            borderRadius: '8px', display: 'flex', alignItems: 'flex-start', gap: 0.8,
          }}>
            <ManualIcon sx={{ fontSize: 18, color: C.amber, mt: 0.2, flexShrink: 0 }} />
            <Box>
              <Typography sx={{ fontSize: '0.82rem', color: C.amber, fontWeight: 600 }}>
                Manual review required
              </Typography>
              <Typography sx={{ fontSize: '0.78rem', color: C.muted, mt: 0.2 }}>
                These copies are too similar to confidently recommend one for deletion (quality scores within 5% of each other). Inspect both files manually below. You can override and pick a delete-target on a card if you're sure.
              </Typography>
            </Box>
          </Box>
        )}
      </Box>

      {/* Cards */}
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: `repeat(${Math.min(group.copies.length, 2)}, 1fr)`, lg: `repeat(${Math.min(group.copies.length, 3)}, 1fr)` },
        gap: 2,
      }}>
        {group.copies.map(copy => (
          // Key must include mediaId because sibling Media under a single Plex
          // metadata record share a ratingKey, and partId because a single
          // Media can hold several Parts (stacked CD1/CD2 files). Falling back
          // to filePath keeps the key unique for unmapped metadata.
          <CopyCard
            key={`${copy.ratingKey}|${copy.mediaId ?? ''}|${copy.partId ?? copy.filePath ?? ''}`}
            group={group}
            copy={copy}
            C={C}
            serverConfig={serverConfig}
            machineId={machineId}
            onRequestDelete={onRequestDelete}
          />
        ))}
      </Box>
    </Box>
  )
}

function CopyCard({
  group, copy, C, serverConfig, machineId, onRequestDelete,
}: {
  group: DuplicateGroup
  copy:  DuplicateCopy
  C:     DupPalette
  serverConfig: ServerConfig | null
  machineId:    string | null
  onRequestDelete: (g: DuplicateGroup, c: DuplicateCopy) => void
}) {
  const [pathCopied, setPathCopied] = useState(false)

  const accentColor =
    copy.isKeeper        ? C.green :
    copy.isDeleteTarget  ? C.rust  :
    group.manualReviewRequired ? C.amber : C.muted

  const badge =
    copy.isKeeper       ? { icon: <KeeperIcon sx={{ fontSize: 14 }} />, label: 'KEEPER', color: C.green } :
    copy.isDeleteTarget ? { icon: <DeleteRecIcon sx={{ fontSize: 14 }} />, label: 'RECOMMENDED REMOVE', color: C.rust } :
    group.manualReviewRequired ? { icon: <ManualIcon sx={{ fontSize: 14 }} />, label: 'NEEDS REVIEW', color: C.amber } :
    null

  const plexUrl = machineId
    ? `https://app.plex.tv/desktop/#!/server/${machineId}/details?key=${encodeURIComponent('/library/metadata/' + copy.ratingKey)}`
    : null

  const copyPath = () => {
    if (!copy.filePath) return
    navigator.clipboard.writeText(copy.filePath).then(() => {
      setPathCopied(true)
      setTimeout(() => setPathCopied(false), 1500)
    }).catch(() => { /* clipboard denied */ })
  }

  // A view-only user sees the comparison but never the delete flow. Folding it
  // into the same flag the server's allowMediaDeletion setting uses keeps all
  // three delete affordances behind one condition.
  const readOnly = useReadOnly('plex-command-center')
  const deleteDisabled = readOnly || (serverConfig ? !serverConfig.allowMediaDeletion : false)
  const deleteBlockedReason = readOnly
    ? 'You have view-only access to Plex Command Center'
    : 'Plex server has media deletion disabled'

  return (
    <Box sx={{
      bgcolor: C.paper,
      border: `2px solid ${accentColor}55`,
      borderRadius: CARD_RADIUS,
      p: 1.8,
      display: 'flex', flexDirection: 'column', gap: 1,
      position: 'relative',
    }}>
      {badge && (
        <Box sx={{
          position: 'absolute', top: 8, right: 8,
          display: 'flex', alignItems: 'center', gap: 0.3,
          px: 0.8, py: 0.3, borderRadius: '6px',
          bgcolor: `${badge.color}22`, color: badge.color,
          fontSize: '0.66rem', fontWeight: 800, letterSpacing: '0.06em',
        }}>
          {badge.icon} {badge.label}
        </Box>
      )}

      {/* Library — may span multiple libraries that all index the same physical file */}
      <Box sx={{ pr: 14 }}>
        <Typography sx={{ fontSize: '0.7rem', color: C.muted, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          {copy.libraryTitles.join(' · ')}
        </Typography>
        {copy.libraryTitles.length > 1 && (
          <Typography sx={{ fontSize: '0.66rem', color: C.muted, fontStyle: 'italic', mt: 0.2 }}>
            same file — indexed by {copy.libraryTitles.length} libraries
          </Typography>
        )}
      </Box>

      {/* Spec chips */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
        <Chip label={resolutionLabel(copy.resolution)} size="small"
          sx={{ height: 22, fontSize: '0.7rem', bgcolor: `${C.blue}22`, color: C.blue, border: 'none', fontWeight: 700 }} />
        {copy.is3D && (
          <Chip label="3D" size="small"
            sx={{ height: 22, fontSize: '0.7rem', bgcolor: `${C.amber}22`, color: C.amber, border: 'none', fontWeight: 700 }} />
        )}
        <Chip label={copy.videoCodec || 'codec?'} size="small"
          sx={{ height: 22, fontSize: '0.7rem', bgcolor: `${C.purple}22`, color: C.purple, border: 'none' }} />
        <Chip label={`${copy.bitrate || 0} kbps`} size="small"
          sx={{ height: 22, fontSize: '0.7rem', bgcolor: `${C.amber}22`, color: C.amber, border: 'none' }} />
        <Chip label={`${copy.audioCodec || 'audio?'} ${copy.audioChannels || 0}ch`} size="small"
          sx={{ height: 22, fontSize: '0.7rem', bgcolor: `${C.green}22`, color: C.green, border: 'none' }} />
        {copy.container && (
          <Chip label={copy.container} size="small"
            sx={{ height: 22, fontSize: '0.7rem', bgcolor: `${C.muted}22`, color: C.muted, border: 'none' }} />
        )}
      </Box>

      {/* File size + duration */}
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.6, mt: 0.5 }}>
        <Box>
          <Typography sx={{ fontSize: '0.66rem', color: C.muted, fontWeight: 700, letterSpacing: '0.06em' }}>SIZE</Typography>
          <Typography sx={{ fontSize: '1.05rem', fontWeight: 700, color: C.ink }}>{formatBytes(copy.fileSize)}</Typography>
          <Typography sx={{ fontSize: '0.66rem', color: C.muted, fontFamily: '"JetBrains Mono", monospace' }}>
            {copy.fileSize.toLocaleString()} B
          </Typography>
        </Box>
        <Box>
          <Typography sx={{ fontSize: '0.66rem', color: C.muted, fontWeight: 700, letterSpacing: '0.06em' }}>RUNTIME</Typography>
          <Typography sx={{ fontSize: '1.05rem', fontWeight: 700, color: C.ink }}>{formatDuration(copy.duration)}</Typography>
        </Box>
      </Box>

      {/* File path */}
      <Box sx={{ mt: 0.5 }}>
        <Typography sx={{ fontSize: '0.66rem', color: C.muted, fontWeight: 700, letterSpacing: '0.06em', mb: 0.3 }}>FILE PATH</Typography>
        <Box sx={{
          display: 'flex', alignItems: 'center', gap: 0.5,
          p: 0.8, borderRadius: '6px',
          bgcolor: C.surface, border: `1px solid ${C.border}`,
        }}>
          <Typography sx={{
            flex: 1, fontSize: '0.72rem', color: C.ink,
            fontFamily: '"JetBrains Mono", "Fira Code", monospace',
            wordBreak: 'break-all', userSelect: 'text',
          }}>
            {copy.filePath || '(no file path)'}
          </Typography>
          {copy.filePath && (
            <Tooltip title={pathCopied ? 'Copied!' : 'Copy path'}>
              <Box onClick={copyPath} sx={{ cursor: 'pointer', color: pathCopied ? C.green : C.muted, '&:hover': { color: C.rust } }}>
                <CopyIcon sx={{ fontSize: 14 }} />
              </Box>
            </Tooltip>
          )}
        </Box>
      </Box>

      {/* Stats row */}
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.6, mt: 0.3 }}>
        <Box>
          <Tooltip
            arrow
            placement="top"
            title="This file's own date, from the Plex part record — roughly when the scanner last saw the file change. It is the only date here that differs between copies."
          >
            <Typography sx={{
              fontSize: '0.66rem', color: C.muted, fontWeight: 700, letterSpacing: '0.06em',
              textDecoration: 'underline dotted', textUnderlineOffset: '3px', cursor: 'help',
              display: 'inline-block',
            }}>
              FILE DATE
            </Typography>
          </Tooltip>
          <Typography sx={{ fontSize: '0.78rem', color: C.ink }}>
            {copy.fileUpdatedAt > 0 ? formatTimestamp(copy.fileUpdatedAt) : 'unknown'}
          </Typography>
        </Box>
        <Box>
          <Typography sx={{ fontSize: '0.66rem', color: C.muted, fontWeight: 700, letterSpacing: '0.06em' }}>LAST VIEWED</Typography>
          <Typography sx={{ fontSize: '0.78rem', color: C.ink }}>
            {copy.viewCount > 0 ? formatTimestamp(copy.lastViewedAt) : 'never'}
            {copy.viewCount > 0 && <span style={{ color: C.muted, fontSize: '0.7rem' }}> ({copy.viewCount}×)</span>}
          </Typography>
        </Box>
      </Box>

      {/* Plex hangs Added and Last viewed off the movie, not the file, so both
          copies of a title report the same values. Saying so stops the match
          reading as a bug and keeps the per-file date above unambiguous. */}
      <Typography sx={{ fontSize: '0.68rem', color: C.muted, mt: -0.2 }}>
        Movie added {formatTimestamp(copy.addedAt)} — added and last viewed are per movie, not per file.
      </Typography>

      {/* Why this copy? */}
      <Accordion disableGutters sx={{ bgcolor: 'transparent', boxShadow: 'none', '&:before': { display: 'none' }, mt: 0.3 }}>
        <AccordionSummary
          expandIcon={<ExpandIcon sx={{ color: C.muted, fontSize: 18 }} />}
          sx={{ p: 0, minHeight: 'auto', '& .MuiAccordionSummary-content': { my: 0.5 } }}
        >
          <Typography sx={{ fontSize: '0.74rem', color: C.muted, fontWeight: 600 }}>
            Quality breakdown — score {copy.qualityScore.toLocaleString()}
          </Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ p: 0, pt: 0.5 }}>
          {copy.qualityReasons.length === 0 ? (
            <Typography sx={{ fontSize: '0.74rem', color: C.muted }}>No quality signals reported.</Typography>
          ) : (
            <Box component="ul" sx={{ m: 0, pl: 2, color: C.ink, fontSize: '0.76rem' }}>
              {copy.qualityReasons.map((r, i) => <li key={i} style={{ marginBottom: 2 }}>{r}</li>)}
            </Box>
          )}
        </AccordionDetails>
      </Accordion>

      {/* Buttons */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.8, mt: 'auto', pt: 0.5 }}>
        {plexUrl && (
          <Button
            variant="outlined"
            size="small"
            href={plexUrl}
            target="_blank"
            rel="noopener noreferrer"
            startIcon={<OpenIcon sx={{ fontSize: 14 }} />}
            sx={{
              fontSize: '0.74rem', textTransform: 'none',
              borderColor: C.border, color: C.muted,
              '&:hover': { borderColor: C.rust, color: C.rust, bgcolor: 'transparent' },
            }}
          >
            Open in Plex
          </Button>
        )}

        {/* Delete affordance — every copy gets one, but the styling tiers it:
            • delete-target → prominent outlined rust button (the recommendation)
            • keeper        → less-prominent text button labelled as an override
            • manual-review → neutral text button, since nothing is recommended  */}
        {copy.isDeleteTarget && (
          <Tooltip title={deleteDisabled ? deleteBlockedReason : 'Walk through the safety-gated delete flow'}>
            <span style={{ marginLeft: 'auto' }}>
              <Button
                variant="outlined"
                size="small"
                disabled={deleteDisabled}
                onClick={() => onRequestDelete(group, copy)}
                startIcon={<TrashIcon sx={{ fontSize: 14 }} />}
                sx={{
                  fontSize: '0.74rem', textTransform: 'none', fontWeight: 600,
                  borderColor: C.rust, color: C.rust,
                  '&:hover': { borderColor: C.rust, color: C.rust, bgcolor: `${C.rust}10` },
                  '&.Mui-disabled': { borderColor: C.border, color: C.muted },
                }}
              >
                Delete this copy…
              </Button>
            </span>
          </Tooltip>
        )}

        {copy.isKeeper && (
          <Tooltip title={deleteDisabled ? deleteBlockedReason : 'Override: delete the recommended keeper. The next-best remaining copy becomes the new keeper.'}>
            <span style={{ marginLeft: 'auto' }}>
              <Button
                variant="text"
                size="small"
                disabled={deleteDisabled}
                onClick={() => onRequestDelete(group, copy)}
                startIcon={<TrashIcon sx={{ fontSize: 14 }} />}
                sx={{
                  fontSize: '0.72rem', textTransform: 'none', color: C.muted,
                  '&:hover': { color: C.rust, bgcolor: 'transparent' },
                  '&.Mui-disabled': { color: C.border },
                }}
              >
                Delete keeper instead…
              </Button>
            </span>
          </Tooltip>
        )}

        {group.manualReviewRequired && !copy.isKeeper && !copy.isDeleteTarget && (
          <Tooltip title={deleteDisabled ? deleteBlockedReason : 'Pick this copy to delete; the highest-quality remaining copy becomes the keeper'}>
            <span style={{ marginLeft: 'auto' }}>
              <Button
                variant="text"
                size="small"
                disabled={deleteDisabled}
                onClick={() => onRequestDelete(group, copy)}
                sx={{
                  fontSize: '0.72rem', textTransform: 'none', color: C.muted,
                  '&:hover': { color: C.rust, bgcolor: 'transparent' },
                }}
              >
                Pick this to delete…
              </Button>
            </span>
          </Tooltip>
        )}
      </Box>
    </Box>
  )
}
