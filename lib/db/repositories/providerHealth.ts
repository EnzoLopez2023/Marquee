import type Database from 'better-sqlite3'

export class ProviderHealthRepository {
  constructor(private readonly db: Database.Database) {}

  async record(
    provider: string,
    status: 'ok' | 'error',
    startedAt: number,
    error?: unknown,
  ): Promise<void> {
    const observedAt = Date.now()
    const sanitizedError = error instanceof Error
      ? error.message.replace(/https?:\/\/\S+/g, '[upstream]').slice(0, 300)
      : null
    this.db.prepare(`
      INSERT INTO provider_health(provider, observed_at, status, latency_ms, sanitized_error)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(provider) DO UPDATE SET
        observed_at = excluded.observed_at,
        status = excluded.status,
        latency_ms = excluded.latency_ms,
        sanitized_error = excluded.sanitized_error
    `).run(provider, observedAt, status, observedAt - startedAt, sanitizedError)
  }

  async all() {
    return this.db.prepare('SELECT * FROM provider_health ORDER BY provider').all()
  }
}
