# Sonarr agent cutover

Do not execute this runbook without explicit production approval.

1. Deploy Marquee and validate authenticated `/api/sonarr/agent-check`.
2. Stop the `HearthSonarrAgent` collector process/task first and verify it is
   no longer running. Disabling its scheduled-task trigger alone is not
   sufficient: a persistent process can continue collecting and refilling.
3. If it must run to drain, invoke `node sonarr-agent.mjs --drain-only` and
   prove it performs no Sonarr collection and creates no new delivery/log
   entries.
4. Drain the Hearth Sonarr queue to the legacy authority. Resolve every dead
   letter with an explicit replay or reviewed disposition, then prove the
   pending queue is empty.
5. Stop the `HearthSonarrAgent` process/task again, if drain-only was used,
   and verify no legacy Sonarr writer remains before continuing.
6. Only after quiescence, capture and verify the final immutable Hearth backup.
7. Run the final import and zero-difference reconciliation from that backup.
8. Install `MarqueeSonarrAgent` with `MARQUEE_URL`, the new ingest token, and a
   fresh queue. Keep the Sonarr API key only in the ACL-restricted local config.
9. Verify the first delivery, duplicate replay, snapshot, summary, trends,
   freshness, and Marquee-owned agent logs.
10. Record the first Marquee write. Recovery is forward-only from that point.
11. Retain the Hearth backup and old authority read-only through the approved
   soak; retire the old task only after approval.

The agent preserves durable append-before-send delivery, bounded queue/dead
letter, snapshot coalescing, log batching, retry classification, and delivery
receipts. During transition it accepts legacy configuration and emits both
Marquee and Hearth delivery-id headers.

The installer creates the token-bearing configuration with its
Administrators/SYSTEM ACL already attached and then atomically replaces the
active file. It never writes a secret-bearing `.bak`; every config filename
variant is ignored by Git.

The installer and agent require HTTPS for `MARQUEE_URL`; plaintext HTTP is
accepted only for normalized `localhost`, `127.0.0.0/8`, or `[::1]` loopback
development targets. `--drain-only` performs no Sonarr collection or log
enqueue and exits nonzero if the durable queue cannot make progress to empty.
