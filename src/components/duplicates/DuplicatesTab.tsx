import { apiClient } from '../../services/apiClient'
import { CARD_RADIUS } from '../../theme/controls'
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Box, Typography, Button, CircularProgress, Snackbar, Alert, Tooltip,
} from '@mui/material'
import {
  Refresh as RefreshIcon,
  Warning as WarningIcon,
  CheckCircle as OkIcon,
} from '../../components/AppIcons'
import DuplicateGroupList from './DuplicateGroupList'
import DuplicateDetailPanel from './DuplicateDetailPanel'
import DeleteConfirmModal from './DeleteConfirmModal'
import AuditLogPanel from './AuditLogPanel'
import type {
  DuplicateGroup, DuplicateCopy, ScanResult, ServerConfig, DupPalette, DeleteResponse, SavingsSummary,
} from './types'
import { formatBytes, timeAgo } from './qualityScore'
import { mix, withAlpha, readableOn } from '../../theme/contrast'

interface Props {
  C: DupPalette
}

type SortKey = 'savings' | 'title' | 'year'

export default function DuplicatesTab({ C }: Props) {
  const [scan,        setScan]        = useState<ScanResult | null>(null)
  const [scanLoading, setScanLoading] = useState(false)
  const [scanError,   setScanError]   = useState<string | null>(null)

  const [serverConfig, setServerConfig] = useState<ServerConfig | null>(null)
  const [savings,      setSavings]      = useState<SavingsSummary | null>(null)

  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [sortKey,     setSortKey]     = useState<SortKey>('savings')

  // Delete modal state
  const [deleteOpen,   setDeleteOpen]   = useState(false)
  const [deleteGroup,  setDeleteGroup]  = useState<DuplicateGroup | null>(null)
  const [deleteCopy,   setDeleteCopy]   = useState<DuplicateCopy | null>(null)
  const [keeperCopy,   setKeeperCopy]   = useState<DuplicateCopy | null>(null)

  // Toast + audit refresh trigger
  const [toast, setToast] = useState<{ msg: string; severity: 'success' | 'error' } | null>(null)
  const [auditRefreshKey, setAuditRefreshKey] = useState(0)

  // Fetch server config once at mount.
  useEffect(() => {
    let cancelled = false
    apiClient.fetch('/api/plex/duplicates/server-config')
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((d: ServerConfig) => { if (!cancelled) setServerConfig(d) })
      .catch(() => { /* silent — banner just won't render */ })
    return () => { cancelled = true }
  }, [])

  // Cumulative savings — refreshed on mount and after each successful delete.
  const fetchSavings = useCallback(async () => {
    try {
      const resp = await apiClient.fetch('/api/plex/duplicates/savings')
      if (!resp.ok) return
      const data: SavingsSummary = await resp.json()
      setSavings(data)
    } catch { /* non-fatal */ }
  }, [])

  useEffect(() => { fetchSavings() }, [fetchSavings])

  const runScan = useCallback(async () => {
    setScanLoading(true)
    setScanError(null)
    try {
      const resp = await apiClient.fetch('/api/plex/duplicates/scan')
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const data: ScanResult = await resp.json()
      setScan(data)
      // If the currently-selected group is gone after re-scan, clear it.
      // (Functional setter — keeps runScan's identity stable so useEffect deps stay clean.)
      setSelectedKey(prev => {
        if (!prev) return prev
        const stillThere = data.groups.find(g => g.key === prev) || data.unmatchedGroups.find(g => g.key === prev)
        return stillThere ? prev : null
      })
    } catch (err: unknown) {
      setScanError(err instanceof Error ? err.message : String(err))
    } finally {
      setScanLoading(false)
    }
  }, [])

  // Initial scan on mount.
  useEffect(() => { runScan() }, [runScan])

  // The currently selected group (lookup is cheap, no need to memoize across renders).
  const selectedGroup: DuplicateGroup | null = useMemo(() => {
    if (!scan || !selectedKey) return null
    return scan.groups.find(g => g.key === selectedKey) || scan.unmatchedGroups.find(g => g.key === selectedKey) || null
  }, [scan, selectedKey])

  // Unified delete-request handler. Works for any copy in the group, including
  // the recommended keeper — the highest-quality REMAINING copy is picked as
  // the surviving keeper so we never delete the last file.
  //
  // CRITICAL: copy identity is (ratingKey, mediaId), not ratingKey alone.
  // When Plex stitches N files into one metadata record (multi-version
  // movies), every sibling Copy shares a ratingKey but has its own mediaId.
  // Filtering by ratingKey alone would falsely conclude "this is the only
  // copy in the group" when there are actually two or three siblings.
  //
  // partId goes one level finer: a single Media can itself hold several Parts
  // (a movie stacked across CD1/CD2 files), so ratingKey+mediaId is not unique
  // either. Without it, asking to delete one of those files filters its sibling
  // out of the keeper candidates too and the group can end up with no keeper.
  const copyIdentity = (c: DuplicateCopy) =>
    `${c.ratingKey}|${c.mediaId ?? ''}|${c.partId ?? c.filePath ?? ''}`

  const isSameCopy = (a: DuplicateCopy, b: DuplicateCopy) =>
    copyIdentity(a) === copyIdentity(b)

  const onRequestDelete = (group: DuplicateGroup, copy: DuplicateCopy) => {
    const keeper = [...group.copies]
      .filter(c => !isSameCopy(c, copy))
      .sort((a, b) => b.qualityScore - a.qualityScore)[0]
    if (!keeper) {
      setToast({ msg: 'Cannot delete — this is the only copy in the group.', severity: 'error' })
      return
    }
    setDeleteGroup(group)
    setDeleteCopy(copy)
    setKeeperCopy(keeper)
    setDeleteOpen(true)
  }

  const onDeleted = (response: DeleteResponse) => {
    // Capture before clearing modal state.
    const removedKey      = response.deletedRatingKey
    const removedMediaId  = deleteCopy?.mediaId ?? null
    const removedFilePath = response.deletedFilePath
    const affectedGroupKey    = deleteGroup?.key ?? null
    const affectedGroupCopies = deleteGroup?.copies ?? []

    setDeleteOpen(false)
    setDeleteCopy(null); setKeeperCopy(null); setDeleteGroup(null)
    setToast({
      msg: `Deleted ${response.title}${response.year ? ` (${response.year})` : ''}${response.deletedFileSize ? ` — saved ${formatBytes(response.deletedFileSize)}` : ''}.`,
      severity: 'success',
    })
    setAuditRefreshKey(k => k + 1)
    fetchSavings()

    // Surgically remove the deleted copy from the current scan — no re-scan needed.
    setScan(prev => {
      if (!prev) return prev

      function patchGroups(groups: DuplicateGroup[]): DuplicateGroup[] {
        return groups
          .map(g => {
            const remaining = g.copies.filter(c => !(
              c.ratingKey === removedKey
              && c.mediaId === removedMediaId
              && c.filePath === removedFilePath
            ))
            if (remaining.length === g.copies.length) return g   // copy wasn't in this group
            if (remaining.length <= 1) return null               // no longer a duplicate

            // Recalculate keeper / delete-target flags by quality score.
            const maxScore = Math.max(...remaining.map(c => c.qualityScore))
            const updatedCopies = remaining.map(c => ({
              ...c,
              isKeeper:       c.qualityScore === maxScore,
              isDeleteTarget: c.qualityScore !== maxScore,
            }))

            const keeperSize         = updatedCopies.find(c => c.isKeeper)?.fileSize ?? 0
            const totalSize          = updatedCopies.reduce((s, c) => s + c.fileSize, 0)
            const potentialSavingsBytes = totalSize - keeperSize

            return { ...g, copies: updatedCopies, potentialSavingsBytes }
          })
          .filter((g): g is DuplicateGroup => g !== null)
      }

      const newGroups    = patchGroups(prev.groups)
      const newUnmatched = patchGroups(prev.unmatchedGroups)
      const newTotalSavings = [...newGroups, ...newUnmatched]
        .reduce((s, g) => s + g.potentialSavingsBytes, 0)

      return {
        ...prev,
        groups:                     newGroups,
        unmatchedGroups:            newUnmatched,
        totalDuplicateGroups:       newGroups.length,
        totalUnmatchedGroups:       newUnmatched.length,
        totalDistinctFiles:         prev.totalDistinctFiles - 1,
        totalPotentialSavingsBytes: newTotalSavings,
      }
    })

    // If the affected group dropped to 1 copy (no longer a duplicate), clear the selection.
    if (affectedGroupKey && selectedKey === affectedGroupKey) {
      const remaining = affectedGroupCopies.filter(c => !(
        c.ratingKey === removedKey
        && c.mediaId === removedMediaId
        && c.filePath === removedFilePath
      ))
      if (remaining.length <= 1) setSelectedKey(null)
    }
  }

  const machineId = serverConfig?.machineId ?? null
  const allGroups = scan ? [...scan.groups, ...scan.unmatchedGroups] : []

  return (
    <Box>
      {/* Server-config banner.
          This sits outside a card, directly on the page wallpaper, so the fill
          has to be opaque — a low-alpha status tint let the photograph through
          and the text underneath it was unreadable. Tinting an opaque page
          surface keeps the green/red cue without the transparency. */}
      {serverConfig && (() => {
        const status = serverConfig.allowMediaDeletion ? C.green : C.red
        const plate  = mix(C.paper, status, 0.12)
        const text   = readableOn(status)
        return (
        <Box sx={{
          mb: 2, p: 1.2, borderRadius: '8px',
          display: 'flex', alignItems: 'center', gap: 1,
          bgcolor: plate,
          border: `1px solid ${withAlpha(status, 0.45)}`,
        }}>
          {serverConfig.allowMediaDeletion
            ? <OkIcon sx={{ color: text, fontSize: 18 }} />
            : <WarningIcon sx={{ color: text, fontSize: 18 }} />}
          <Typography sx={{ fontSize: '0.82rem', color: text, fontWeight: 600 }}>
            {serverConfig.allowMediaDeletion
              ? `Media deletion is enabled on Plex server${serverConfig.serverName ? ` "${serverConfig.serverName}"` : ''}. Deletes here will remove the underlying file from disk.`
              : `Media deletion is DISABLED on Plex server${serverConfig.serverName ? ` "${serverConfig.serverName}"` : ''}. Delete buttons are disabled. Enable "Allow media deletion" in Plex Settings → Library to allow deletes.`}
          </Typography>
        </Box>
        )
      })()}

      {/* Header strip */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', mb: 2 }}>
        <Button
          variant="contained"
          onClick={runScan}
          disabled={scanLoading}
          startIcon={scanLoading ? <CircularProgress size={14} sx={{ color: '#fff' }} /> : <RefreshIcon sx={{ fontSize: 16 }} />}
          sx={{
            bgcolor: C.rust, color: '#fff', textTransform: 'none', fontWeight: 600,
            '&:hover': { bgcolor: C.rust, opacity: 0.92 },
          }}
        >
          {scanLoading ? 'Scanning…' : 'Scan now'}
        </Button>

        {scan && (
          <>
            <Tooltip title={`Scanned ${scan.totalMoviesScanned.toLocaleString()} library rows → ${scan.totalDistinctFiles.toLocaleString()} distinct files after same-file collapse`}>
              <Typography sx={{ fontSize: '0.76rem', color: C.muted, fontFamily: '"JetBrains Mono", monospace' }}>
                Last scan: {timeAgo(scan.scannedAt)} · {scan.totalDistinctFiles.toLocaleString()} files
              </Typography>
            </Tooltip>
            <Box sx={{ display: 'flex', gap: 1.2, ml: 'auto', alignItems: 'center', flexWrap: 'wrap' }}>
              <StatTile C={C} label="duplicate groups" value={scan.totalDuplicateGroups.toLocaleString()} accent={C.rust} />
              <StatTile C={C} label="recoverable" value={formatBytes(scan.totalPotentialSavingsBytes)} accent={C.green} />
              <StatTile C={C} label="unmatched" value={scan.totalUnmatchedGroups.toLocaleString()} accent={C.amber} />
              {savings && savings.deleteCount > 0 && (
                <Tooltip title={`${savings.deleteCount.toLocaleString()} delete${savings.deleteCount === 1 ? '' : 's'} since ${new Date(savings.firstDeleteAt!).toLocaleDateString()}`}>
                  <Box>
                    <StatTile C={C} label="saved so far" value={formatBytes(savings.totalBytesSaved)} accent={C.blue} />
                  </Box>
                </Tooltip>
              )}
            </Box>
          </>
        )}
      </Box>

      {scanError && (
        <Box sx={{ p: 1.2, mb: 2, bgcolor: `${C.red}15`, border: `1px solid ${C.red}55`, borderRadius: '8px' }}>
          <Typography sx={{ fontSize: '0.82rem', color: C.red }}>Scan failed: {scanError}</Typography>
        </Box>
      )}

      {/* Main 2-column layout */}
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: '380px 1fr' },
        gap: 2,
        minHeight: 480,
      }}>
        {/* Left list */}
        <Box sx={{
          bgcolor: C.surface, border: `1px solid ${C.border}`, borderRadius: CARD_RADIUS,
          p: 1.2, height: { xs: 'auto', md: 640 }, display: 'flex', flexDirection: 'column',
        }}>
          {scanLoading && !scan ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1 }}>
              <CircularProgress size={24} sx={{ color: C.rust }} />
            </Box>
          ) : (
            <DuplicateGroupList
              groups={allGroups}
              selectedKey={selectedKey}
              onSelect={g => setSelectedKey(g.key)}
              C={C}
              sortKey={sortKey}
              onSortChange={setSortKey}
              emptyLabel={scan ? 'No duplicate movies found. 🎉' : 'Run a scan to find duplicates.'}
            />
          )}
        </Box>

        {/* Right detail */}
        <Box sx={{
          bgcolor: C.surface, border: `1px solid ${C.border}`, borderRadius: CARD_RADIUS,
          p: 2, height: { xs: 'auto', md: 640 }, overflow: 'hidden',
        }}>
          {selectedGroup ? (
            // key on selectedKey forces a clean unmount/remount whenever the
            // user picks a different group. Without it, React was preserving
            // stale CopyCard nodes from the previous selection because
            // multi-version siblings share a ratingKey and confuse the key-
            // based reconciliation.
            <DuplicateDetailPanel
              key={selectedGroup.key}
              group={selectedGroup}
              C={C}
              serverConfig={serverConfig}
              machineId={machineId}
              onRequestDelete={onRequestDelete}
            />
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
              <Typography sx={{ color: C.muted, fontSize: '0.9rem', textAlign: 'center', maxWidth: 360 }}>
                Select a duplicate group on the left to see side-by-side details of every copy.
              </Typography>
            </Box>
          )}
        </Box>
      </Box>

      {/* Audit log */}
      <AuditLogPanel C={C} refreshKey={auditRefreshKey} />

      {/* Delete confirmation modal */}
      <DeleteConfirmModal
        open={deleteOpen}
        group={deleteGroup}
        deleteTarget={deleteCopy}
        keeper={keeperCopy}
        C={C}
        serverConfig={serverConfig}
        onClose={() => setDeleteOpen(false)}
        onDeleted={onDeleted}
      />

      {/* Toast */}
      <Snackbar
        open={!!toast}
        autoHideDuration={5000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {toast ? (
          <Alert severity={toast.severity} onClose={() => setToast(null)} sx={{ fontWeight: 500 }}>
            {toast.msg}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Box>
  )
}

function StatTile({
  C, label, value, accent,
}: { C: DupPalette; label: string; value: string; accent: string }) {
  return (
    <Box sx={{
      px: 1.2, py: 0.6, borderRadius: '8px',
      bgcolor: C.paper, border: `1px solid ${C.border}`,
      display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
    }}>
      <Typography sx={{ fontSize: '0.6rem', color: C.muted, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: '0.95rem', fontWeight: 700, color: accent, lineHeight: 1.1 }}>
        {value}
      </Typography>
    </Box>
  )
}
