import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { normalizeMarqueeUrl } from '../../scripts/sonarr-agent/sonarr-agent.mjs'

describe('Sonarr installer secret handling', () => {
  it('checks a secured candidate before atomically promoting it without a secret backup', () => {
    const script = readFileSync('scripts/sonarr-agent/install-task.ps1', 'utf8')
    expect(script).not.toContain('Copy-Item $configPath')
    expect(script).not.toContain('$configPath.bak')
    const secureCreate = script.indexOf('[System.IO.FileStream]::new')
    const candidateCheck = script.indexOf('& $node $script --check --config $tempConfigPath')
    const atomicMove = script.indexOf('Move-Item $tempConfigPath $configPath -Force')
    expect(secureCreate).toBeGreaterThan(0)
    expect(candidateCheck).toBeGreaterThan(secureCreate)
    expect(candidateCheck).toBeLessThan(atomicMove)
    expect(atomicMove).toBeGreaterThan(secureCreate)
    expect(script).toContain('$acl.SetAccessRuleProtection($true, $false)')
    expect(script).toContain('The active config was not changed')
  })

  it('ignores every config backup or temporary filename variant', () => {
    const ignore = readFileSync('.gitignore', 'utf8')
    expect(ignore).toContain('scripts/sonarr-agent/sonarr-agent.config.json*')
  })

  it('accepts HTTPS and canonical loopback HTTP only, without credentials', () => {
    expect(normalizeMarqueeUrl('https://marquee.example.test/')).toBe('https://marquee.example.test')
    expect(normalizeMarqueeUrl('http://localhost:3000')).toBe('http://localhost:3000')
    expect(normalizeMarqueeUrl('http://127.12.34.56')).toBe('http://127.12.34.56')
    expect(normalizeMarqueeUrl('http://[::1]:3000')).toBe('http://[::1]:3000')
    for (const url of [
      'http://marquee.example.test',
      'http://localhost.evil.test',
      'http://127.0.0.1.nip.io',
      'http://127.1',
      'http://user:password@localhost',
      'https://user:password@marquee.example.test',
    ]) {
      expect(() => normalizeMarqueeUrl(url)).toThrow()
    }
  })

  it('validates marqueeUrl before writing the token-bearing config', () => {
    const script = readFileSync('scripts/sonarr-agent/install-task.ps1', 'utf8')
    const validation = script.indexOf("Normalize-MarqueeUrl ([string] $config['marqueeUrl'])")
    expect(validation).toBeGreaterThan(0)
    expect(validation).toBeLessThan(script.indexOf('[System.IO.FileStream]::new'))
  })
})
