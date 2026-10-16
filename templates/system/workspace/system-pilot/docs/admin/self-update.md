# Updates and Managed Production Maintenance

Reviewed against Community 0.84.13. Updating software can interrupt running work. Confirm the installation's approved procedure and scope before invoking an updater or restarting services.

## Source-checkout updater

The CLI/dashboard SelfUpdater fetches Git refs, checks out the requested safe ref (default main), installs pinned dependencies and builds. It can restart running instance runtimes and then the dashboard automatically; it is not merely git pull followed by an optional manual restart. Verify the returned status and current services rather than assuming no interruption.

The updater repository/channel may be configured for a downstream edition. Do not point an Enterprise installation at the Community release repository or use a pre-release channel inadvertently. Inspect the actual installation/version and approved target.

## Managed signed-package installations

An administrator-managed production server may instead require a signed release package, backup, qualified migration, activity checks, maintenance notice and explicit activation. The source-checkout updater is not a substitute for that procedure. Do not run it from a pilot conversation to bypass a maintenance gate.

Use the deployment owner's current runbook out of band; it may not be part of the installed agent workspace. Never invent target-specific service names, privileged restart commands, rollback guarantees or a reusable historical activity exception.

## Verification

Report code version, database migration, service health, UI/login and business/provider acceptance as separate evidence. A code downgrade does not reverse a schema migration. A backup created before activation does not authorize restoring over later writes.

The reference build runtime is Node.js 22.23.3 with pnpm 10.33.0; declared Node compatibility is >=22.12.0. The compatibility minimum is not the version used for release qualification. Preserve user files and resolve managed-document collisions before synchronization.
