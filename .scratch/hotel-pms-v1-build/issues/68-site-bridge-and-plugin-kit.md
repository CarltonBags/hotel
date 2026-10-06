# 68 — Site Bridge and plugin kit

**What to build:** A small Windows program installed on the hotel's lock PC (ADR 0014) connects outbound only, is enrolled per property with a token, hosts Lock Plugins and the FIAS till plugin, receives versioned plugin updates from our side without reinstall, reports health shown in the staff app and alerting on loss; the go-live checklist gains its item. The plugin kit: a plugin template, a test harness against a simulated on-premises lock system, and a certification checklist, so a vendor is added without touching the product.

**Blocked by:** 67 Lock interface, key issue and revoke, first cloud plugin

**Status:** in review (PR stacked on ticket 67)

- [ ] Bridge installed on a Windows test machine behind NAT and reachable through the worker with no inbound port (outbound-only connection built and walked through on macOS; Windows installation and service still to do, see Open points)
- [x] Plugin update pushed and activated remotely
- [x] Simulated on-premises plugin passes the harness end to end (issue, revoke, read)
- [x] Health loss alerts the Property Manager within minutes

## Comments

**Built:** the Site Bridge program (`apps/bridge`, Node): configured with the service's address, its token and per-plugin settings that stay on the hotel's PC; it only calls out, with a held long poll that reports its version, plugins (capabilities, health) and the answers to the last commands and takes the next ones. Enrolled per property with a token shown once (Bridge row and token written together; revoked at once), shown with its state in Settings → Site Bridge. Plugin versions are published once on our side (CLI), pushed per Bridge, fetched, checked by SHA-256 and by name and version, kept and activated without a reinstall; the version last activated stays active across restarts (an older one sent back stays back). A lock system on the hotel's network is a lock-system choice: each plugin call becomes a command with an expiry (the Bridge drops a command that arrives after we stopped waiting), only the lock operations may be called, a Bridge not calling in fails at once instead of making the sync wait. A Bridge quiet for three minutes alerts the property's Property Managers once (worker, every minute), its return is announced; the go-live checklist gains "Site Bridge connected". Plugin kit (`packages/bridge-kit`): plugin module format, template plugin, simulated on-premises lock server, harness (issue, read, update, revoke, revoke by name, refusals) with a CLI, certification checklist (`docs/bridge/plugin-kit.md`); installation guide (`docs/bridge/install.md`).

**Verified:** domain (online and alert rules, go-live item); kit tests (template passes the harness end to end, a faulty plugin is caught; runtime: hash and name checks, downgrade kept across restart, operations allow-listed, expired commands dropped); db `site-bridge.test.ts` (token, check-in, plugin push and update, a key card through the Bridge on the simulated lock server, alert once and back); full db suite; walkthrough 10/10 with a real Bridge process calling the local worker (alert after 235 s).

**Review fixes:** see the commit "Ticket 68: review fixes and ticket record".

**Open points:**
- Windows: installation as a service and a test on a Windows machine behind NAT; a signed installer.
- Plugin code is checked by hash from our own server; signing plugin versions (so a compromised server cannot push code) is worth deciding before the first on-premises vendor.
- The FIAS till plugin and its relay come with ticket 66 (the go-live item will count till-only Bridges then).
