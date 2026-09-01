export const iconFiles = {
  master: 'marquee-icon-1024.png',
  appleTouch: 'apple-touch-icon.png',
  favicon: 'favicon.ico',
  pwa192: 'pwa-192x192.png',
  pwa512: 'pwa-512x512.png',
  maskable512: 'maskable-icon-512x512.png',
}

export const pwaIncludeAssets = [
  iconFiles.favicon,
  iconFiles.appleTouch,
]

export const manifestIcons = [
  { src: `/${iconFiles.pwa192}`, sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: `/${iconFiles.pwa512}`, sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: `/${iconFiles.maskable512}`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
]
