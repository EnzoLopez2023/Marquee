import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { iconFiles } from './icon-config.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC_DIR = path.join(ROOT, 'public')
const MASTER_PATH = path.join(PUBLIC_DIR, iconFiles.master)
const MASTER_SHA256 = '552a6bc58780ef9e597642445c40faccfbbff356729e30cfdfc34de7bad0cd54'
const MASTER_SIZE = 1024
const MASKABLE_SIZE = 512
const MASKABLE_SAFE_ZONE_RADIUS = MASKABLE_SIZE * 0.4
const MASKABLE_ARTWORK_SIZE = 408
// The approved master is hash-locked, so its measured reel-and-tail radius is immutable.
const MASKABLE_ARTWORK_MAX_RADIUS = 500
const MASKABLE_OFFSET = (MASKABLE_SIZE - MASKABLE_ARTWORK_SIZE) / 2
const MASKABLE_FEATHER = 48
const PNG_OPTIONS = {
  compressionLevel: 9,
  adaptiveFiltering: false,
  palette: false,
  force: true,
}

const requestedFlags = process.argv.slice(2)
const unknownFlags = requestedFlags.filter((flag) => flag !== '--check')
if (unknownFlags.length > 0) {
  throw new Error(`Unknown option${unknownFlags.length === 1 ? '' : 's'}: ${unknownFlags.join(', ')}`)
}
const checkOnly = requestedFlags.includes('--check')

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

async function resizePng(master, size) {
  return sharp(master, { failOn: 'error' })
    .resize(size, size, {
      fit: 'fill',
      kernel: sharp.kernel.lanczos3,
    })
    .removeAlpha()
    .png(PNG_OPTIONS)
    .toBuffer()
}

function createFeatherMask(size, feather) {
  const alpha = Buffer.alloc(size * size)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const edgeDistance = Math.min(x, y, size - 1 - x, size - 1 - y)
      alpha[y * size + x] = Math.round(255 * Math.min(1, edgeDistance / feather))
    }
  }
  return alpha
}

function interpolateColor(stops, position) {
  const upperIndex = stops.findIndex(([offset]) => offset >= position)
  if (upperIndex <= 0) {
    return stops[0][1]
  }
  const [lowerOffset, lowerColor] = stops[upperIndex - 1]
  const [upperOffset, upperColor] = stops[upperIndex]
  const progress = (position - lowerOffset) / (upperOffset - lowerOffset)
  return lowerColor.map((channel, index) => (
    Math.round(channel + (upperColor[index] - channel) * progress)
  ))
}

function createMaskableBackground() {
  const background = Buffer.alloc(MASKABLE_SIZE * MASKABLE_SIZE * 3)
  const stops = [
    [0, [80, 84, 92]],
    [0.58, [61, 66, 73]],
    [1, [27, 35, 41]],
  ]
  const centerX = MASKABLE_SIZE * 0.48
  const centerY = MASKABLE_SIZE * 0.45
  const radius = MASKABLE_SIZE * 0.72

  for (let y = 0; y < MASKABLE_SIZE; y += 1) {
    for (let x = 0; x < MASKABLE_SIZE; x += 1) {
      const distance = Math.hypot(x - centerX, y - centerY) / radius
      const color = interpolateColor(stops, Math.min(1, distance))
      const offset = (y * MASKABLE_SIZE + x) * 3
      background[offset] = color[0]
      background[offset + 1] = color[1]
      background[offset + 2] = color[2]
    }
  }
  return background
}

async function createMaskablePng(master) {
  const { data: artwork, info } = await sharp(master, { failOn: 'error' })
    .resize(MASKABLE_ARTWORK_SIZE, MASKABLE_ARTWORK_SIZE, {
      fit: 'fill',
      kernel: sharp.kernel.lanczos3,
    })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  assert(info.channels === 3, 'Maskable artwork resize must be RGB')

  const mask = createFeatherMask(MASKABLE_ARTWORK_SIZE, MASKABLE_FEATHER)
  const output = createMaskableBackground()
  for (let y = 0; y < MASKABLE_ARTWORK_SIZE; y += 1) {
    for (let x = 0; x < MASKABLE_ARTWORK_SIZE; x += 1) {
      const sourcePixel = y * MASKABLE_ARTWORK_SIZE + x
      const targetPixel = (y + MASKABLE_OFFSET) * MASKABLE_SIZE + x + MASKABLE_OFFSET
      const alpha = mask[sourcePixel]
      for (let channel = 0; channel < 3; channel += 1) {
        const source = artwork[sourcePixel * 3 + channel]
        const targetOffset = targetPixel * 3 + channel
        const target = output[targetOffset]
        output[targetOffset] = Math.round((source * alpha + target * (255 - alpha)) / 255)
      }
    }
  }

  return sharp(output, {
    raw: {
      width: MASKABLE_SIZE,
      height: MASKABLE_SIZE,
      channels: 3,
    },
  })
    .png(PNG_OPTIONS)
    .toBuffer()
}

function createIco(frames) {
  const directorySize = 6 + frames.length * 16
  const header = Buffer.alloc(directorySize)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(frames.length, 4)

  let imageOffset = directorySize
  frames.forEach(({ size, bytes }, index) => {
    const entryOffset = 6 + index * 16
    header.writeUInt8(size, entryOffset)
    header.writeUInt8(size, entryOffset + 1)
    header.writeUInt8(0, entryOffset + 2)
    header.writeUInt8(0, entryOffset + 3)
    header.writeUInt16LE(1, entryOffset + 4)
    header.writeUInt16LE(32, entryOffset + 6)
    header.writeUInt32LE(bytes.length, entryOffset + 8)
    header.writeUInt32LE(imageOffset, entryOffset + 12)
    imageOffset += bytes.length
  })

  return Buffer.concat([header, ...frames.map(({ bytes }) => bytes)])
}

function verifyMaskableGeometry() {
  assert(Number.isInteger(MASKABLE_OFFSET), 'Maskable artwork must be centered on whole pixels')
  const renderedRadius = MASKABLE_ARTWORK_MAX_RADIUS * MASKABLE_ARTWORK_SIZE / MASTER_SIZE
  assert(
    renderedRadius <= MASKABLE_SAFE_ZONE_RADIUS,
    `Maskable artwork radius ${renderedRadius.toFixed(2)}px exceeds the ${MASKABLE_SAFE_ZONE_RADIUS.toFixed(2)}px safe zone`,
  )
}

async function verifyPng(name, bytes, size) {
  const metadata = await sharp(bytes, { failOn: 'error' }).metadata()
  assert(metadata.format === 'png', `${name} must be a PNG`)
  assert(metadata.width === size && metadata.height === size, `${name} must be ${size}x${size}`)
  assert(metadata.hasAlpha === false, `${name} must be opaque`)
}

function verifyIco(bytes, expectedSizes) {
  assert(bytes.readUInt16LE(0) === 0, `${iconFiles.favicon} has an invalid reserved field`)
  assert(bytes.readUInt16LE(2) === 1, `${iconFiles.favicon} is not an icon`)
  assert(bytes.readUInt16LE(4) === expectedSizes.length, `${iconFiles.favicon} must contain ${expectedSizes.length} frames`)
  expectedSizes.forEach((size, index) => {
    const entryOffset = 6 + index * 16
    assert(bytes.readUInt8(entryOffset) === size, `${iconFiles.favicon} frame ${index + 1} must be ${size}px wide`)
    assert(bytes.readUInt8(entryOffset + 1) === size, `${iconFiles.favicon} frame ${index + 1} must be ${size}px high`)
    assert(bytes.readUInt16LE(entryOffset + 6) === 32, `${iconFiles.favicon} frame ${index + 1} must be 32-bit`)
  })
}

async function buildArtifacts(master) {
  const faviconSizes = [16, 32, 48]
  const faviconFrames = await Promise.all(faviconSizes.map(async (size) => ({
    size,
    bytes: await resizePng(master, size),
  })))

  return new Map([
    [iconFiles.appleTouch, await resizePng(master, 180)],
    [iconFiles.favicon, createIco(faviconFrames)],
    [iconFiles.pwa192, await resizePng(master, 192)],
    [iconFiles.pwa512, await resizePng(master, 512)],
    [iconFiles.maskable512, await createMaskablePng(master)],
  ])
}

async function verifyReferences() {
  const [viteConfig, indexHtml, packageJson] = await Promise.all([
    readFile(path.join(ROOT, 'vite.config.ts'), 'utf8'),
    readFile(path.join(ROOT, 'index.html'), 'utf8'),
    readFile(path.join(ROOT, 'package.json'), 'utf8').then(JSON.parse),
  ])

  assert(
    viteConfig.includes("import { manifestIcons, pwaIncludeAssets } from './scripts/icon-config.mjs'"),
    'vite.config.ts must import the shared icon manifest',
  )
  assert(viteConfig.includes('includeAssets: pwaIncludeAssets'), 'VitePWA must include the shared HTML icon assets')
  assert(viteConfig.includes('icons: manifestIcons'), 'VitePWA must use the shared icon manifest')
  assert(
    indexHtml.includes(`href="/${iconFiles.favicon}"`) &&
      indexHtml.includes(`href="/${iconFiles.appleTouch}"`),
    'index.html must reference the generated favicon and Apple touch icon',
  )
  assert(packageJson.scripts?.['icons:generate'] === 'node scripts/generate-icons.mjs', 'package.json must expose icons:generate')
  assert(packageJson.scripts?.['icons:check'] === 'node scripts/generate-icons.mjs --check', 'package.json must expose icons:check')
  assert(packageJson.scripts?.prebuild === 'npm run icons:check', 'package build must be gated by icons:check')
}

async function main() {
  const master = await readFile(MASTER_PATH)
  assert(sha256(master) === MASTER_SHA256, `${iconFiles.master} does not match the approved SHA-256`)
  await verifyPng(iconFiles.master, master, MASTER_SIZE)
  verifyMaskableGeometry()

  const artifacts = await buildArtifacts(master)
  if (!checkOnly) {
    await Promise.all([...artifacts].map(([name, bytes]) => writeFile(path.join(PUBLIC_DIR, name), bytes)))
  }

  for (const [name, expectedBytes] of artifacts) {
    const actualBytes = await readFile(path.join(PUBLIC_DIR, name))
    assert(
      actualBytes.equals(expectedBytes),
      `${name} has drifted (expected ${sha256(expectedBytes)}, received ${sha256(actualBytes)})`,
    )
  }

  await Promise.all([
    verifyPng(iconFiles.appleTouch, artifacts.get(iconFiles.appleTouch), 180),
    verifyPng(iconFiles.pwa192, artifacts.get(iconFiles.pwa192), 192),
    verifyPng(iconFiles.pwa512, artifacts.get(iconFiles.pwa512), 512),
    verifyPng(iconFiles.maskable512, artifacts.get(iconFiles.maskable512), 512),
  ])
  verifyIco(artifacts.get(iconFiles.favicon), [16, 32, 48])
  await verifyReferences()

  const verb = checkOnly ? 'verified' : 'generated'
  console.log(`Icon system ${verb}: ${artifacts.size} derivatives match the approved master.`)
}

await main()
