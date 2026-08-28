# Recovery

Recovery work is explicit and off the startup/request path.

```bash
npm run recovery -- backup /home/data/marquee.db /home/data/backups/marquee/<name>.db
npm run recovery -- verify /home/data/backups/marquee/<name>.db
npm run recovery -- restore /home/data/backups/marquee/<name>.db /tmp/marquee-restore.db
npm run recovery -- upload /home/data/backups/marquee/<name>.db
```

Backup and restore use `better-sqlite3`'s online backup API. Verification
records bytes, SHA-256, per-table counts, `quick_check`, `integrity_check`, and
`foreign_key_check`. Before those checks, verification requires
`application_id=marquee`, `schema_contract=marquee.sqlite.v2`, and the exact
ordered migration names/checksums. Startup and readiness also assert the exact
complete ordered migration identity with no extra rows and the normalized SQL
hashes for all required tables, indexes, and triggers.

Restore verifies into a private unique sibling staging directory, then
atomically renames the fully verified database over the destination. Startup
and restore share canonical physical/logical transition locks. Restore refuses
an active or stale lifetime owner, a live database lease, and any `-journal`,
`-wal`, or `-shm` beside either a logical symlink alias or its physical target.
Multiply linked destination inodes are rejected. The operator must fence/recover
those states first. Runtime/delete leases copied by an online backup are cleared
inside the staged database before final verification, allowing immediate
post-restore startup. Any pre-publish failure
leaves the existing destination and symlink target byte-for-byte intact and
removes only Marquee's owned staging directory.

The upload command uses managed identity and Marquee-owned private Blob storage,
downloads the object to a disposable read-back file, and verifies identical
bytes and SHA-256 before reporting success.

Production uses one process, one worker, one App Service instance, and
`/home/data/marquee.db` with `journal_mode=DELETE`, `foreign_keys=ON`, and a
bounded busy timeout. WAL is prohibited on Azure Files/SMB.

A renewable singleton SQLite lease prevents a second process from serving the
same authority. Lease loss marks readiness unavailable, fences every non-health
request, aborts in-flight destructive Plex work, retains its group lock through
expiry, and triggers listener shutdown.
