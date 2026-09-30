# 11 — Legal Entities, Properties, users and roles

**What to build:** An Owner or Tenant Admin creates Legal Entities (invoice header data, VAT ID, bank details) and Properties (name, country, time zone, currency, Legal Entity), invites users by email, gives tenant roles (Owner, Tenant Admin) and property roles per property from the fixed set of ten. A Property Manager invites users and assigns roles at their own property only. Permissions are checked on the server for every action following the permission matrix; a user with several roles gets the sum. All times shown are property time.

**Blocked by:** 10 Monorepo, control schema, tenant schema and sign-in

**Status:** done

- [x] Tenant Admin creates a Legal Entity and a Property and the Property belongs to exactly one Legal Entity (ADR 0002)
- [x] A user invited with Front Desk at property A cannot open property B
- [x] A Property Manager cannot assign tenant roles
- [x] Permission checks are one shared function used by every server action, with tests per role

## Comments

2026-09-30: built and reviewed. Acceptance met: 53 automated tests (domain matrix per role, tenant setup, roles, invitations), typecheck, builds, and an 18-step browser walkthrough (Owner creates Legal Entity and two Properties; invites Front Desk at Berlin; invitee accepts one-time link and sees only Berlin; Legal Entities page shows "Not allowed"; Owner promotes her to Property Manager at Hamburg; as PM she sees only Hamburg to assign, no tenant role field, and a forged tenantRole field is refused server-side).

Review findings fixed before commit: re-inviting a pending user could let a Property Manager take over a user of another property (now re-invite only rotates the link and requires managing every role the person holds); updateRoles went around authorize(); arbitrary property ids were accepted; cross-tenant email existence leaked; invitation accepted before the tenant check; role updates not transactional; last Owner could demote themselves; raw database errors reached the browser; invitation link built from request headers.

Left for later tickets, on purpose:
- Housekeeping Supervisor creating Housekeeper users: ticket 14 (PIN Sign-in), with the users-without-email rule.
- Invitation email delivery: ticket 39. Until then the inviter copies the link shown after inviting.
- Property-scoped pages (`requireAllowed("view_property", id)`) start with the property switcher in ticket 12.
- Email uniqueness stays platform-wide (see ticket 10 comments); decision still open with the owner.
- Defaults chosen here: invitations valid 7 days; reserved country and currency lists in packages/domain (EU + CH + LI); Europe time zones offered first.
