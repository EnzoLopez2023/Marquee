import { scoreCopy } from './qualityScore.js'

export const normalizeTitle = (value: unknown) => String(value || '').trim().toLowerCase()
export const normalizePath = (value: unknown) => String(value || '').trim().toLowerCase()

export function normalizeResolution(value: unknown) {
  const resolution = String(value || '').toLowerCase()
  if (resolution === '4k' || resolution === '2160') return '4k'
  if (resolution === '1080') return '1080'
  if (resolution === '720') return '720'
  if (resolution === '480' || resolution === '576' || resolution === 'sd') return 'sd'
  return resolution || 'unknown'
}

export const detectThreeD = (filePath: unknown) => /\b3D\b/i.test(String(filePath || ''))

export function partTimestamp(part: any) {
  const match = /^\/library\/parts\/\d+\/(\d+)\//.exec(part?.key || '')
  const value = match?.[1] ? Number(match[1]) : 0
  return Number.isFinite(value) && value > 0 ? value : 0
}

export function findMediaAndPart(metadata: any, mediaId?: unknown, filePath?: unknown) {
  for (const media of metadata?.Media || []) {
    if (mediaId && String(media.id) !== String(mediaId)) continue
    for (const part of media.Part || []) {
      if (filePath && part.file !== filePath) continue
      return { media, part }
    }
    if (!filePath) return { media, part: media.Part?.[0] || null }
  }
  return { media: null, part: null }
}

interface FileEntry {
  metadata: any
  media: any
  part: any
  ratingKeys: string[]
  mediaIds: string[]
  libraryIds: string[]
  libraryTitles: string[]
}

function copyRecord(entry: FileEntry) {
  const metadata = entry.metadata
  const media = entry.media
  const part = entry.part
  const quality = scoreCopy(media)
  return {
    ratingKey: String(metadata.ratingKey),
    ratingKeys: [...entry.ratingKeys],
    mediaId: media?.id == null ? null : String(media.id),
    mediaIds: [...entry.mediaIds],
    libraryId: entry.libraryIds[0],
    libraryIds: [...entry.libraryIds],
    libraryTitle: entry.libraryTitles[0],
    libraryTitles: [...entry.libraryTitles],
    is3D: detectThreeD(part?.file),
    partId: part?.id == null ? null : String(part.id),
    filePath: part?.file || null,
    fileSize: Number(part?.size) || 0,
    resolution: media?.videoResolution || null,
    bitrate: Number(media?.bitrate) || 0,
    videoCodec: media?.videoCodec || null,
    audioCodec: media?.audioCodec || null,
    audioChannels: Number(media?.audioChannels) || 0,
    container: media?.container || null,
    duration: Number(media?.duration ?? metadata.duration) || 0,
    fileUpdatedAt: partTimestamp(part),
    addedAt: Number(metadata.addedAt) || 0,
    updatedAt: Number(metadata.updatedAt) || 0,
    viewCount: Number(metadata.viewCount) || 0,
    lastViewedAt: Number(metadata.lastViewedAt) || 0,
    thumb: metadata.thumb || null,
    art: metadata.art || null,
    summary: metadata.summary || null,
    qualityScore: quality.score,
    qualityReasons: quality.reasons,
    isKeeper: false,
    isDeleteTarget: false,
  }
}

export function groupDuplicates(sectionResults: Array<{ section: any; metadata: any[] }>) {
  const fileMap = new Map<string, FileEntry>()
  let totalMoviesScanned = 0
  for (const { section, metadata } of sectionResults) {
    totalMoviesScanned += metadata.length
    for (const item of metadata) {
      if (!item.title) continue
      for (const media of item.Media || []) {
        for (const part of media.Part || []) {
          if (!part?.file) continue
          const key = normalizePath(part.file)
          const existing = fileMap.get(key)
          if (!existing) {
            fileMap.set(key, {
              metadata: item,
              media,
              part,
              ratingKeys: [String(item.ratingKey)],
              mediaIds: media.id == null ? [] : [String(media.id)],
              libraryIds: [String(section.key)],
              libraryTitles: [section.title],
            })
            continue
          }
          const ratingKey = String(item.ratingKey)
          const mediaId = media.id == null ? null : String(media.id)
          if (!existing.ratingKeys.includes(ratingKey)) existing.ratingKeys.push(ratingKey)
          if (mediaId && !existing.mediaIds.includes(mediaId)) existing.mediaIds.push(mediaId)
          if (!existing.libraryIds.includes(String(section.key))) {
            existing.libraryIds.push(String(section.key))
            existing.libraryTitles.push(section.title)
          }
        }
      }
    }
  }

  const matched = new Map<string, any>()
  const unmatched = new Map<string, any>()
  for (const entry of fileMap.values()) {
    const metadata = entry.metadata
    const copy = copyRecord(entry)
    const resolution = normalizeResolution(entry.media?.videoResolution)
    const edition = copy.is3D ? '|3d' : ''
    const identity = `${normalizeTitle(metadata.title)}|${metadata.year || ''}|${resolution}${edition}`
    const target = metadata.guid ? matched : unmatched
    const key = metadata.guid ? `${metadata.guid}|${identity}` : identity
    if (!target.has(key)) {
      target.set(key, {
        key,
        title: metadata.title,
        year: metadata.year || null,
        guid: metadata.guid || null,
        resolution,
        is3D: copy.is3D,
        copies: [],
      })
    }
    target.get(key).copies.push(copy)
  }

  const groups: any[] = []
  for (const group of matched.values()) {
    if (group.copies.length < 2) continue
    const maxDuration = Math.max(...group.copies.map((copy: any) => copy.duration || 0))
    if (maxDuration > 0) {
      for (const copy of group.copies) {
        if (copy.duration > 0 && copy.duration < maxDuration * 0.3) {
          const percent = Math.round(copy.duration / maxDuration * 100)
          copy.qualityScore -= 1_000_000
          copy.qualityReasons.push(
            `Short runtime - ${percent}% of longest copy, likely sample/trailer (-1000000)`,
          )
        }
      }
    }
    group.copies.sort((left: any, right: any) => right.qualityScore - left.qualityScore)
    const top = group.copies[0]
    const second = group.copies[1]
    const manualReviewRequired = (
      (Math.max(top.qualityScore, 1) - second.qualityScore) / Math.max(top.qualityScore, 1)
    ) < 0.05
    if (!manualReviewRequired) {
      top.isKeeper = true
      group.copies.slice(1).forEach((copy: any) => { copy.isDeleteTarget = true })
    }
    const totalSize = group.copies.reduce(
      (sum: number, copy: any) => sum + (copy.fileSize || 0),
      0,
    )
    groups.push({
      ...group,
      manualReviewRequired,
      potentialSavingsBytes: manualReviewRequired ? 0 : Math.max(0, totalSize - top.fileSize),
    })
  }
  groups.sort((left, right) => right.potentialSavingsBytes - left.potentialSavingsBytes)

  const unmatchedGroups = [...unmatched.values()]
    .filter((group) => group.copies.length >= 2)
    .map((group) => {
      group.copies.sort((left: any, right: any) => right.qualityScore - left.qualityScore)
      return {
        ...group,
        key: `unmatched|${group.key}`,
        manualReviewRequired: true,
        potentialSavingsBytes: 0,
      }
    })

  return {
    groups,
    unmatchedGroups,
    totalMoviesScanned,
    totalDistinctFiles: fileMap.size,
    totalDuplicateGroups: groups.length,
    totalUnmatchedGroups: unmatchedGroups.length,
    totalPotentialSavingsBytes: groups.reduce(
      (sum, group) => sum + group.potentialSavingsBytes,
      0,
    ),
  }
}
