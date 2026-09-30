---
status: accepted
---

# Guest profiles are tenant-wide, not per property

A Guest profile belongs to the tenant and is visible at every property of that tenant, with duplicate detection on creation and manual merge. We chose this over per-property profiles so chains see stay history across hotels and can prefill registration; the cost is that GDPR deletion and consent must be handled at tenant level, which the folio and compliance tickets take into account.
