# Approved legacy import

Import never accepts an arbitrary source database or self-declared evidence.
Every run requires `marquee.legacy-source-approval.v1`.

The f0 rehearsal is repository-pinned:

```bash
npm run import:legacy -- \
  --source /immutable/hearth.sqlite3 \
  --target /tmp/marquee.db \
  --manifest config/rehearsal-source-manifest.json

npm run reconcile -- \
  --source /immutable/hearth.sqlite3 \
  --target /tmp/marquee.db \
  --manifest config/rehearsal-source-manifest.json
```

After Sonarr is quiesced and the final backup changes, the operator creates a
new manifest with exact source baseline, DB bytes/SHA-256/schema object count,
owned table counts/Hearth canonical hashes, product hash, and all transform
counts/hashes. Its canonical `{contract,status,evidence}` payload must be signed
with an approved Ed25519 key:

```bash
npm run import:legacy -- \
  --source /immutable/final-hearth.sqlite3 \
  --target /tmp/marquee.db \
  --manifest /approved/final-source.json \
  --approval-key /approved/operator-ed25519-public.pem
```

The private key never enters Marquee. Import verifies source evidence before
the first target write and verifies every transformed target dataset before
reporting success. Reconciliation independently repeats those comparisons.

Production must configure a valid `ADMIN_OID`, or explicitly configure
`MARQUEE_BOOTSTRAP_ADMIN_OID`. A final import may also use
`--bootstrap-admin-oid`; that OID must match an imported legacy identity and
must be reflected in the signed transform evidence.
