# 94 — High availability: standby switch-over, two-zone worker, zero-downtime deploys

**What to build:** Following gate 1's verdict: the database runs with a standby in a second EU data centre with automatic switch-over; the worker runs in two instances in two zones with the queue tolerating one loss; application deploys and migrations (expand and contract) apply without downtime; a switch-over and a deploy under load cause no failed staff actions beyond a retried request; availability is measured and published on the status page.

**Blocked by:** 93 Support access, status page and help centre, 01 Gate: Neon load test at 300 tenants and standby switch-over

**Status:** ready-for-agent

- [ ] Forced database switch-over during a load test: no data loss, recovery inside the promise
- [ ] Killing one worker instance: jobs, SSE and webhooks continue
- [ ] Deploy during load: zero failed requests in the test client
- [ ] Runbook written for switch-over and rollback
