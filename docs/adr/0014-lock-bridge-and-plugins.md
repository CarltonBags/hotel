---
status: accepted
---

# A small on-site Lock Bridge with vendor plugins reaches hotel lock systems

The product talks to every door lock system through one internal lock interface, with one plugin per vendor. Lock systems installed on the hotel's own network are reached through a small Windows program, the Lock Bridge, on the PC that already runs the lock software; it connects outbound only. We chose this over staying cloud-only because the owner requires the lock systems common in German hotels, most of which run on the hotel's network, and over buying a third-party connector because the owner wants to cover and add vendors ourselves.

## Consequences

- This is the one exception to "no local server at the hotel" (ADR 0007): the Bridge needs installation, updates and monitoring.
- Each vendor needs a partner agreement before its plugin can be built and certified.
- Plugins declare their capabilities; features differ per property depending on its lock system.

## Amendment 2026-09-30

The Bridge also carries a plugin for FIAS-based restaurant tills and is renamed Site Bridge. See "Restaurant and bar charges to the room".
