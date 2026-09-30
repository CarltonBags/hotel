# 11 — Legal Entities, Properties, users and roles

**What to build:** An Owner or Tenant Admin creates Legal Entities (invoice header data, VAT ID, bank details) and Properties (name, country, time zone, currency, Legal Entity), invites users by email, gives tenant roles (Owner, Tenant Admin) and property roles per property from the fixed set of ten. A Property Manager invites users and assigns roles at their own property only. Permissions are checked on the server for every action following the permission matrix; a user with several roles gets the sum. All times shown are property time.

**Blocked by:** 10 Monorepo, control schema, tenant schema and sign-in

**Status:** ready-for-agent

- [ ] Tenant Admin creates a Legal Entity and a Property and the Property belongs to exactly one Legal Entity (ADR 0002)
- [ ] A user invited with Front Desk at property A cannot open property B
- [ ] A Property Manager cannot assign tenant roles
- [ ] Permission checks are one shared function used by every server action, with tests per role
