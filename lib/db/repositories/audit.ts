import type Database from 'better-sqlite3'
import type { Identity } from './identities.js'

export interface AuditEvent {
  category: 'auth' | 'navigation' | 'change' | 'contract' | 'telemetry'
  action: string
  view?: string | null
  method?: string | null
  path?: string | null
  status?: number | null
  detail?: string | null
}

export class AuditRepository {
  constructor(private readonly db: Database.Database) {}

  async append(event: AuditEvent, identity: Identity | null, ip: string | null): Promise<void> {
    this.appendAuthoritativeInTransaction(event, identity, ip)
  }

  appendAuthoritativeInTransaction(
    event: AuditEvent,
    identity: Identity | null,
    ip: string | null,
  ): void {
    this.insert(event, identity, ip, true, 'server')
  }

  async appendClientTelemetry(
    kind: 'navigation' | 'ui_interaction' | 'client_error',
    view: string | null,
    detail: string | null,
    identity: Identity,
    ip: string | null,
  ): Promise<void> {
    const action = {
      navigation: 'Client navigation',
      ui_interaction: 'Client interaction',
      client_error: 'Client error',
    }[kind]
    this.insert({
      category: 'telemetry',
      action,
      view,
      detail,
    }, identity, ip, false, 'client')
  }

  private insert(
    event: AuditEvent,
    identity: Identity | null,
    ip: string | null,
    authoritative: boolean,
    source: 'server' | 'client',
  ): void {
    const now = Date.now()
    this.db.prepare(`
      INSERT INTO app_audit_log(
        ts, received_at, tenant_id, user_oid, user_email_snapshot, user_name_snapshot,
        verified, authoritative, source, category, action, view, method, path,
        status, detail, ip
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      now,
      now,
      identity?.tenantId ?? null,
      identity?.oid ?? null,
      identity?.email ?? null,
      identity?.name ?? null,
      identity ? 1 : 0,
      authoritative ? 1 : 0,
      source,
      event.category,
      event.action.slice(0, 200),
      event.view ?? null,
      event.method ?? null,
      event.path?.slice(0, 300) ?? null,
      event.status ?? null,
      event.detail?.slice(0, 500) ?? null,
      ip,
    )
  }

  async list(limit: number) {
    return this.db.prepare(`
      SELECT * FROM app_audit_log ORDER BY ts DESC, id DESC LIMIT ?
    `).all(Math.min(Math.max(limit, 1), 1_000))
  }
}
