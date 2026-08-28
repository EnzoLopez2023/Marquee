import { apiClient } from '../services/apiClient'
// Natural-language Plex playlist builder, embeddable as a dialog.
//
// Flow: query → Azure OpenAI title list → confirm → match each title against
// the Plex library (SSE log) → confirm matches → create + populate playlist
// (SSE log). Reuses the existing /api/playlist-creator/* endpoints.

import { useState, useRef, useEffect } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions, IconButton,
  Box, Typography, TextField, Button, Chip, Card, CardContent,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  LinearProgress, Fade, Zoom,
} from '@mui/material'
import {
  Close as CloseIcon,
  Search as SearchIcon,
  PlaylistAdd as PlaylistAddIcon,
  Movie as MovieIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Info as InfoIcon,
} from '../components/AppIcons'
import { logger } from '../utils/logger'

interface MovieInfo {
  title: string
  year: number
  director?: string
}

interface PlexMovie {
  title: string
  year: number
  key: string
  guid: string
  ratingKey: string
  section: string
}

interface LogEntry {
  id: number
  timestamp: string
  message: string
  type: 'info' | 'success' | 'error' | 'warning'
}

type WorkflowStep = 'search' | 'process' | 'verify' | 'create' | 'complete'

interface PlaylistBuilderDialogProps {
  open: boolean
  onClose: () => void
}

export default function PlaylistBuilderDialog({ open, onClose }: PlaylistBuilderDialogProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [currentStep, setCurrentStep] = useState<WorkflowStep>('search')
  const [movieList, setMovieList] = useState<MovieInfo[]>([])
  const [foundMovies, setFoundMovies] = useState<PlexMovie[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [playlistTitle, setPlaylistTitle] = useState('')
  const [playlistId, setPlaylistId] = useState('')

  const logContainerRef = useRef<HTMLDivElement>(null)
  const logIdCounter = useRef(0)

  const addLog = (message: string, type: LogEntry['type'] = 'info') => {
    const newLog: LogEntry = {
      id: ++logIdCounter.current,
      timestamp: new Date().toLocaleTimeString(),
      message,
      type,
    }
    // Keep a generous rolling window so large playlists don't lose early entries
    setLogs(prev => [...prev, newLog].slice(-500))
  }

  // Auto-scroll the log to the bottom on new entries
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [logs])

  // Reset everything whenever the dialog is closed so the next open is fresh
  useEffect(() => {
    if (!open) {
      setSearchQuery('')
      setCurrentStep('search')
      setMovieList([])
      setFoundMovies([])
      setLogs([])
      setPlaylistTitle('')
      setPlaylistId('')
      setLoading(false)
    }
  }, [open])

  // ── 1. Ask Azure OpenAI for the canonical title list ────────────────────
  const searchMovieCollection = async () => {
    if (!searchQuery.trim()) return

    setLoading(true)
    setCurrentStep('search')
    addLog(`🔍 Searching for "${searchQuery}" movie collection...`, 'info')

    try {
      const response = await apiClient.fetch('/api/playlist-creator/search-collection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery }),
      })

      if (!response.ok) {
        let msg = `HTTP ${response.status}`
        try {
          const errorData = await response.json()
          msg = errorData.error || msg
        } catch { /* leave msg */ }
        addLog(`❌ Error: ${msg}`, 'error')
        return
      }

      const data = await response.json()
      if (data.movies && Array.isArray(data.movies)) {
        setMovieList(data.movies)
        addLog(`✅ Found ${data.movies.length} movies in the collection`, 'success')
        setCurrentStep('process')
      } else {
        addLog('❌ Invalid response format: missing movies array', 'error')
      }
    } catch (err) {
      logger.error('Search collection error:', err)
      addLog(`❌ Network error: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  // ── 2. Match each title against the Plex library (SSE) ──────────────────
  const processMovies = async () => {
    if (movieList.length === 0) return

    setLoading(true)
    setCurrentStep('process')
    addLog('🎬 Searching the Plex library...', 'info')

    try {
      const response = await apiClient.fetch('/api/playlist-creator/process-movies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ movies: movieList }),
      })

      if (!response.ok) throw new Error('Failed to process movies')

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            if (data.type === 'log') {
              addLog(data.message, data.logType || 'info')
            } else if (data.type === 'movie_found') {
              setFoundMovies(prev => [...prev, data.movie])
            } else if (data.type === 'complete') {
              setCurrentStep('verify')
              addLog(`🎯 Found ${data.totalFound} of ${movieList.length} movies on Plex`, 'success')
            }
          } catch (err) {
            logger.error('Error parsing SSE data:', err)
          }
        }
      }
    } catch (err) {
      addLog(`❌ Error processing movies: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  // ── 3. Create the playlist with the matched movies (SSE) ────────────────
  const createPlaylist = async () => {
    if (foundMovies.length === 0) return

    setLoading(true)
    setCurrentStep('create')
    addLog('🎭 Generating creative playlist title...', 'info')

    try {
      const response = await apiClient.fetch('/api/playlist-creator/create-playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ movies: foundMovies, originalQuery: searchQuery }),
      })

      if (!response.ok) throw new Error('Failed to create playlist')

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            if (data.type === 'log') {
              addLog(data.message, data.logType || 'info')
            } else if (data.type === 'title_generated') {
              setPlaylistTitle(data.title)
              addLog(`🎬 Generated title: "${data.title}"`, 'success')
            } else if (data.type === 'playlist_created') {
              setPlaylistId(data.playlistId)
              addLog(`📋 Playlist created with ID: ${data.playlistId}`, 'success')
            } else if (data.type === 'complete') {
              setCurrentStep('complete')
              const finalTitle = data.title || playlistTitle
              setPlaylistTitle(finalTitle)
              addLog(`🎉 Playlist "${finalTitle}" created with ${data.movieCount || foundMovies.length} movies!`, 'success')
            }
          } catch (err) {
            logger.error('Error parsing SSE data:', err)
          }
        }
      }
    } catch (err) {
      addLog(`❌ Error creating playlist: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  // ── helpers ─────────────────────────────────────────────────────────────
  const resetForAnotherRun = () => {
    setSearchQuery('')
    setCurrentStep('search')
    setMovieList([])
    setFoundMovies([])
    setLogs([])
    setPlaylistTitle('')
    setPlaylistId('')
    addLog('🔄 Ready for another playlist.', 'info')
  }

  const getLogIcon = (type: LogEntry['type']) => {
    switch (type) {
      case 'success': return <CheckCircleIcon sx={{ color: 'success.main', fontSize: 16 }} />
      case 'error':   return <ErrorIcon sx={{ color: 'error.main', fontSize: 16 }} />
      case 'warning': return <ErrorIcon sx={{ color: 'warning.main', fontSize: 16 }} />
      default:        return <InfoIcon sx={{ color: 'info.main', fontSize: 16 }} />
    }
  }

  const getStepColor = (step: WorkflowStep) => {
    const order: WorkflowStep[] = ['search', 'process', 'verify', 'create', 'complete']
    const currentIdx = order.indexOf(currentStep)
    const stepIdx = order.indexOf(step)
    if (stepIdx < currentIdx) return 'success' as const
    if (stepIdx === currentIdx) return 'primary' as const
    return 'default' as const
  }

  return (
    <Dialog
      open={open}
      onClose={loading ? undefined : onClose}
      maxWidth="lg"
      fullWidth
      slotProps={{ paper: { sx: { borderRadius: 2, minHeight: '70vh' } } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pr: 6 }}>
        <PlaylistAddIcon color="primary" />
        <Typography variant="h6" sx={{ flex: 1, fontWeight: 600 }}>
          Build a Playlist from a Collection
        </Typography>
        <IconButton
          onClick={onClose}
          disabled={loading}
          sx={{ position: 'absolute', right: 8, top: 8 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        {/* Workflow steps */}
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
          <Chip label="1. Search collection"   size="small" color={getStepColor('search')}   variant={currentStep === 'search'   ? 'filled' : 'outlined'} />
          <Chip label="2. Match on Plex"        size="small" color={getStepColor('process')}  variant={currentStep === 'process'  ? 'filled' : 'outlined'} />
          <Chip label="3. Review matches"       size="small" color={getStepColor('verify')}   variant={currentStep === 'verify'   ? 'filled' : 'outlined'} />
          <Chip label="4. Create playlist"      size="small" color={getStepColor('create')}   variant={currentStep === 'create'   ? 'filled' : 'outlined'} />
          <Chip label="5. Done"                 size="small" color={getStepColor('complete')} variant={currentStep === 'complete' ? 'filled' : 'outlined'} />
        </Box>

        <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', md: 'row' } }}>
          {/* ── Left: action panel ── */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {currentStep === 'search' && (
              <Fade in timeout={400}>
                <Card variant="outlined" sx={{ mb: 2 }}>
                  <CardContent>
                    <Typography variant="subtitle2" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <SearchIcon fontSize="small" /> Collection name
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                      e.g., "Mission Impossible", "Star Wars", "Marvel Cinematic Universe"
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1.5 }}>
                      <TextField
                        autoFocus
                        fullWidth
                        size="small"
                        placeholder="Enter a movie collection or franchise…"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') searchMovieCollection() }}
                        disabled={loading}
                      />
                      <Button
                        variant="contained"
                        onClick={searchMovieCollection}
                        disabled={loading || !searchQuery.trim()}
                        startIcon={<SearchIcon />}
                      >
                        Search
                      </Button>
                    </Box>
                  </CardContent>
                </Card>
              </Fade>
            )}

            {movieList.length > 0 && (
              <Zoom in timeout={400}>
                <Card variant="outlined" sx={{ mb: 2 }}>
                  <CardContent>
                    <Typography variant="subtitle2" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <MovieIcon fontSize="small" /> {movieList.length}-movie collection
                    </Typography>
                    <TableContainer sx={{ maxHeight: 240 }}>
                      <Table size="small" stickyHeader>
                        <TableHead>
                          <TableRow>
                            <TableCell sx={{ width: 32 }}>#</TableCell>
                            <TableCell>Title</TableCell>
                            <TableCell sx={{ width: 64 }}>Year</TableCell>
                            <TableCell>Director</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {movieList.map((movie, index) => (
                            <TableRow key={index}>
                              <TableCell>{index + 1}</TableCell>
                              <TableCell>{movie.title}</TableCell>
                              <TableCell>{movie.year}</TableCell>
                              <TableCell>{movie.director || '—'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                    {currentStep === 'process' && (
                      <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end' }}>
                        <Button
                          variant="contained"
                          onClick={processMovies}
                          disabled={loading}
                        >
                          Match against Plex
                        </Button>
                      </Box>
                    )}
                  </CardContent>
                </Card>
              </Zoom>
            )}

            {currentStep === 'verify' && foundMovies.length > 0 && (
              <Fade in timeout={400}>
                <Card variant="outlined" sx={{ mb: 2 }}>
                  <CardContent sx={{ textAlign: 'center' }}>
                    <Typography variant="subtitle1" gutterBottom>
                      Ready to create
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                      {foundMovies.length} of {movieList.length} movies matched on the Plex library.
                    </Typography>
                    <Button
                      variant="contained"
                      color="success"
                      onClick={createPlaylist}
                      disabled={loading}
                      startIcon={<PlaylistAddIcon />}
                    >
                      Create playlist
                    </Button>
                  </CardContent>
                </Card>
              </Fade>
            )}

            {currentStep === 'complete' && (
              <Zoom in timeout={400}>
                <Card variant="outlined" sx={{ mb: 2 }}>
                  <CardContent sx={{ textAlign: 'center' }}>
                    <CheckCircleIcon sx={{ fontSize: 56, color: 'success.main', mb: 1 }} />
                    <Typography variant="h6" color="success.main" gutterBottom>
                      Playlist created
                    </Typography>
                    <Typography variant="subtitle1" sx={{ mb: 0.5 }}>
                      "{playlistTitle}"
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                      {foundMovies.length} movies added · ID {playlistId}
                    </Typography>
                    <Button variant="outlined" onClick={resetForAnotherRun}>
                      Build another
                    </Button>
                  </CardContent>
                </Card>
              </Zoom>
            )}

            {loading && <LinearProgress sx={{ mb: 2 }} />}
          </Box>

          {/* ── Right: streaming log ── */}
          <Card
            variant="outlined"
            sx={{ width: { xs: '100%', md: 420 }, height: 'fit-content', flexShrink: 0 }}
          >
            <CardContent>
              <Typography variant="subtitle2" gutterBottom>
                Activity log
              </Typography>
              <Box
                ref={logContainerRef}
                sx={{
                  height: 420,
                  overflowY: 'auto',
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1,
                  p: 1,
                  backgroundColor: 'action.hover',
                  fontFamily: 'monospace',
                  '&::-webkit-scrollbar': { width: 6 },
                  '&::-webkit-scrollbar-track': { background: 'transparent' },
                  '&::-webkit-scrollbar-thumb': { background: 'rgba(0,0,0,0.3)', borderRadius: 2 },
                }}
              >
                {logs.length === 0 ? (
                  <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                    Activity will appear here as we work…
                  </Typography>
                ) : (
                  logs.map(log => (
                    <Box key={log.id} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 0.5 }}>
                      {getLogIcon(log.type)}
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', fontSize: '0.7rem' }}>
                          {log.timestamp}
                        </Typography>
                        <Typography variant="body2" sx={{ fontSize: '0.78rem', lineHeight: 1.35, whiteSpace: 'pre-wrap' }}>
                          {log.message}
                        </Typography>
                      </Box>
                    </Box>
                  ))
                )}
              </Box>
            </CardContent>
          </Card>
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={loading}>
          {currentStep === 'complete' ? 'Close' : 'Cancel'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
