import { CARD_RADIUS } from '../../theme/controls'
import { Box, Typography, Chip, FormControl, Select, MenuItem } from '@mui/material'
import { Warning as WarningIcon, LayersOutlined as LayersIcon } from '../../components/AppIcons'
import type { DuplicateGroup, DupPalette } from './types'
import { formatBytes } from './qualityScore'

type SortKey = 'savings' | 'title' | 'year'

interface Props {
  groups:       DuplicateGroup[]
  selectedKey:  string | null
  onSelect:    (group: DuplicateGroup) => void
  C:            DupPalette
  sortKey:      SortKey
  onSortChange: (s: SortKey) => void
  emptyLabel?:  string
}

export default function DuplicateGroupList({
  groups, selectedKey, onSelect, C, sortKey, onSortChange, emptyLabel,
}: Props) {

  const sorted = [...groups].sort((a, b) => {
    if (sortKey === 'title') return a.title.localeCompare(b.title)
    if (sortKey === 'year')  return (b.year ?? 0) - (a.year ?? 0)
    return b.potentialSavingsBytes - a.potentialSavingsBytes
  })

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.08em', color: C.muted, flex: 1 }}>
          {groups.length} GROUP{groups.length === 1 ? '' : 'S'}
        </Typography>
        <FormControl size="small">
          <Select
            value={sortKey}
            onChange={e => onSortChange(e.target.value as SortKey)}
            sx={{ bgcolor: C.paper, fontSize: '0.75rem', color: C.ink, minWidth: 130 }}
          >
            <MenuItem value="savings">Most savings</MenuItem>
            <MenuItem value="title">Title A–Z</MenuItem>
            <MenuItem value="year">Newest year</MenuItem>
          </Select>
        </FormControl>
      </Box>

      {sorted.length === 0 ? (
        <Box sx={{
          p: 3, textAlign: 'center', bgcolor: C.paper, border: `1px dashed ${C.border}`,
          borderRadius: CARD_RADIUS,
        }}>
          <LayersIcon sx={{ fontSize: 28, color: C.muted, mb: 0.5 }} />
          <Typography sx={{ color: C.muted, fontSize: '0.82rem' }}>
            {emptyLabel ?? 'No duplicates found.'}
          </Typography>
        </Box>
      ) : (
        <Box sx={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 0.8, pr: 0.5 }}>
          {sorted.map(group => {
            const isSelected = group.key === selectedKey
            const accentColor = group.manualReviewRequired ? C.amber : C.rust
            return (
              <Box
                key={group.key}
                onClick={() => onSelect(group)}
                sx={{
                  p: 1.2, cursor: 'pointer',
                  bgcolor: isSelected ? `${accentColor}18` : C.paper,
                  border: `1px solid ${isSelected ? accentColor : C.border}`,
                  borderRadius: CARD_RADIUS,
                  transition: 'all 0.12s',
                  '&:hover': { borderColor: accentColor, bgcolor: `${accentColor}10` },
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, mb: 0.3 }}>
                  {group.manualReviewRequired && (
                    <WarningIcon sx={{ fontSize: 14, color: C.amber }} />
                  )}
                  <Typography sx={{ color: C.ink, fontWeight: 600, fontSize: '0.88rem', flex: 1, lineHeight: 1.2,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {group.title}{group.year ? ` (${group.year})` : ''}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.4, alignItems: 'center' }}>
                  <Chip
                    label={`${group.copies.length} file${group.copies.length === 1 ? '' : 's'}`}
                    size="small"
                    sx={{ height: 18, fontSize: '0.66rem', bgcolor: `${C.blue}22`, color: C.blue, border: 'none' }}
                  />
                  {group.resolution && (
                    <Chip
                      label={group.resolution === '4k' ? '4K' : group.resolution === 'sd' ? 'SD' : group.resolution === 'unknown' ? '?' : `${group.resolution}p`}
                      size="small"
                      sx={{ height: 18, fontSize: '0.66rem', bgcolor: `${C.purple}22`, color: C.purple, border: 'none', fontWeight: 700 }}
                    />
                  )}
                  {group.is3D && (
                    <Chip
                      label="3D"
                      size="small"
                      sx={{ height: 18, fontSize: '0.66rem', bgcolor: `${C.amber}22`, color: C.amber, border: 'none', fontWeight: 700 }}
                    />
                  )}
                  {!group.manualReviewRequired && group.potentialSavingsBytes > 0 && (
                    <Chip
                      label={`Save ${formatBytes(group.potentialSavingsBytes)}`}
                      size="small"
                      sx={{ height: 18, fontSize: '0.66rem', bgcolor: `${C.green}22`, color: C.green, border: 'none', fontWeight: 700 }}
                    />
                  )}
                  {group.manualReviewRequired && (
                    <Chip
                      label="Manual review"
                      size="small"
                      sx={{ height: 18, fontSize: '0.66rem', bgcolor: `${C.amber}22`, color: C.amber, border: 'none' }}
                    />
                  )}
                </Box>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.3, mt: 0.5 }}>
                  {[...new Set(group.copies.flatMap(c => c.libraryTitles))].map(lib => (
                    <Typography
                      key={lib}
                      sx={{ fontSize: '0.66rem', color: C.muted, fontFamily: '"JetBrains Mono", monospace',
                        bgcolor: `${C.muted}10`, px: 0.6, py: 0.1, borderRadius: '4px' }}
                    >
                      {lib}
                    </Typography>
                  ))}
                </Box>
              </Box>
            )
          })}
        </Box>
      )}
    </Box>
  )
}
