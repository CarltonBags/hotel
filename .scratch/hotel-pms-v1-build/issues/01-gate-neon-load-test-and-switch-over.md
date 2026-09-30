# 01 — Gate: Neon load test at 300 tenants and standby switch-over

Source: wayfinder ticket [21-neon-load-test.md](../../hotel-pms-v1/issues/21-neon-load-test.md) (stays open there until this gate is done)

**What to build:** Owner task. Finish the schema-per-tenant load test that stopped at 97 tenants on a 512 MB plan: upgrade the Neon project to a plan with at least 2 GB storage, then an agent reruns stage 2 to 300 tenants (provisioning, roll-forward migration, pooled search-path isolation, backend memory) and, from the Neon console, measures standby switch-over time and confirms automatic switch-over in the EU region. Record the verdict: keep Neon, keep schema-per-tenant on another managed Postgres, or fall back to shared schema with row-level security. If the verdict changes the platform, amend ADR 0006 and ADR 0008 and revisit the data layer built in ticket 10. Until then the build proceeds on Neon behind one data layer so the provider stays swappable.

**Blocked by:** None — can start immediately

**Status:** ready-for-human

- [ ] Neon plan upgraded and stage 2 run to 300 tenants with the numbers recorded in the wayfinder ticket
- [ ] Standby switch-over tested from the console with its duration recorded against the 99.95 % promise
- [ ] Verdict written; ADR 0006 and 0008 amended if it changes them
- [ ] Neon database password reset after the test (it was pasted into a chat)
