const RESOLUTION_TIER: Record<string, number> = { '4k': 4, '1080': 3, '720': 2, '480': 1, sd: 1 }
const CODEC_BONUS: Record<string, number> = { hevc: 500, h265: 500, h264: 200, mpeg4: 100 }

export function scoreCopy(media: any) {
  const reasons: string[] = []
  let score = 0
  const resolution = String(media?.videoResolution || '').toLowerCase()
  const tier = RESOLUTION_TIER[resolution] ?? 0
  if (tier) {
    score += tier * 10_000
    reasons.push(`Resolution ${media.videoResolution} (+${tier * 10_000})`)
  }
  const bitrate = Number(media?.bitrate) || 0
  if (bitrate) {
    score += bitrate
    reasons.push(`Bitrate ${bitrate} kbps (+${bitrate})`)
  }
  const codec = String(media?.videoCodec || '').toLowerCase()
  const codecBonus = CODEC_BONUS[codec] || 0
  if (codecBonus) {
    score += codecBonus
    reasons.push(`Video codec ${media.videoCodec} (+${codecBonus})`)
  }
  const channels = Number(media?.audioChannels) || 0
  if (channels) {
    score += channels * 50
    reasons.push(`Audio ${channels}ch (+${channels * 50})`)
  }
  const streams = media?.Part?.[0]?.Stream || []
  const hdr = streams.some((stream: any) => (
    stream.DOVIPresent
    || /hdr|dolby vision/i.test(
      stream.colorTrc || stream.colorPrimaries || stream.displayTitle || '',
    )
  ))
  if (hdr) {
    score += 2_000
    reasons.push('HDR / Dolby Vision (+2000)')
  }
  return { score, reasons }
}
