# 68 — Site Bridge and plugin kit

**What to build:** A small Windows program installed on the hotel's lock PC (ADR 0014) connects outbound only, is enrolled per property with a token, hosts Lock Plugins and the FIAS till plugin, receives versioned plugin updates from our side without reinstall, reports health shown in the staff app and alerting on loss; the go-live checklist gains its item. The plugin kit: a plugin template, a test harness against a simulated on-premises lock system, and a certification checklist, so a vendor is added without touching the product.

**Blocked by:** 67 Lock interface, key issue and revoke, first cloud plugin

**Status:** ready-for-agent

- [ ] Bridge installed on a Windows test machine behind NAT and reachable through the worker with no inbound port
- [ ] Plugin update pushed and activated remotely
- [ ] Simulated on-premises plugin passes the harness end to end (issue, revoke, read)
- [ ] Health loss alerts the Property Manager within minutes
