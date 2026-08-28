import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Sonarr cutover ordering', () => {
  it('quiesces and drains the legacy writer before the final backup/import', () => {
    const runbook = readFileSync('docs/SONARR_CUTOVER.md', 'utf8')
    const quiesce = runbook.indexOf('Stop the `HearthSonarrAgent` collector process/task first')
    const drain = runbook.indexOf('Drain the Hearth Sonarr queue')
    const stop = runbook.indexOf('Stop the `HearthSonarrAgent` process/task again')
    const backup = runbook.indexOf('capture and verify the final immutable Hearth backup')
    const importStep = runbook.indexOf('final import and zero-difference reconciliation')
    expect(quiesce).toBeGreaterThan(0)
    expect(drain).toBeGreaterThan(quiesce)
    expect(stop).toBeGreaterThan(drain)
    expect(backup).toBeGreaterThan(stop)
    expect(importStep).toBeGreaterThan(backup)
  })
})
