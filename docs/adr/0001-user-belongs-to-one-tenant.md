---
status: accepted
---

# A user belongs to exactly one tenant

Staff logins are scoped to a single tenant (hotel company); the same person working for two hotel companies has two accounts, and there is no cross-tenant membership or tenant switcher. We chose this over a global-user-with-memberships model because it keeps tenant isolation trivial to enforce at the data layer (every user row carries one tenant_id) and matches how nearly all target customers operate. Consultants and franchise operators who need several tenants are accepted as a known gap; revisiting this later means adding a membership layer, not changing the isolation model.

## Amendment 2026-10-01: email unique platform-wide, sign-in by Username

An email address identifies one user across the whole platform (a person working for two hotel companies uses two addresses). For daily sign-in staff enter a Username and password at their tenant's address, not the email; the Username is unique within the tenant and set by whoever invites the user. The email is used for invitations and notices. Chosen by the owner because front desk staff sign in several times a day and should not type an email address, and because the authentication library looks users up by email globally.
