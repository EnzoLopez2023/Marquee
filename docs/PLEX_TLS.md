# Plex TLS policy

Marquee verifies Plex TLS certificates by default. `PLEX_BASE_URL` must use
HTTPS unless insecure compatibility is explicitly enabled.

For a private or self-signed Plex certificate, mount the issuing CA certificate
inside the app and set:

```text
PLEX_TLS_CA_FILE=/run/secrets/plex-ca.pem
```

An optional normalized SHA-256 DER certificate fingerprint provides
supplemental pinning after normal hostname/chain verification:

```text
PLEX_TLS_CERT_SHA256=<64 lowercase or colon-delimited hex characters>
```

`PLEX_TLS_INSECURE=true` is a compatibility-only escape hatch and cannot be
combined with a CA file or pin. It is never the default. Marquee records an
authoritative audit event, marks Plex provider health degraded, and exposes the
degraded transport mode in admin and Watchtower health responses whenever it
is enabled.

No Azure resource is provisioned by this contract. Deployment must provide the
environment values and mount the private CA through the app's secret delivery
mechanism.
