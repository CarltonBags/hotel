---
status: accepted
---

# A user belongs to exactly one tenant

Staff logins are scoped to a single tenant (hotel company); the same person working for two hotel companies has two accounts, and there is no cross-tenant membership or tenant switcher. We chose this over a global-user-with-memberships model because it keeps tenant isolation trivial to enforce at the data layer (every user row carries one tenant_id) and matches how nearly all target customers operate. Consultants and franchise operators who need several tenants are accepted as a known gap; revisiting this later means adding a membership layer, not changing the isolation model.
