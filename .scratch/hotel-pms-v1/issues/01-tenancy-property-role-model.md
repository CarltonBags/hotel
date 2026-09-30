# Tenancy, property and role model

Map: ../map.md
Type: grilling
Status: resolved
Blocked by: -

## Question

How do Tenant, Property, User and Role relate? A tenant (hotel company) owns 1..N properties; users may work at one or many properties with different roles per property. Decide: the role vocabulary for v1 (e.g. owner, property manager, front desk, housekeeping, accounting), whether roles are per property or per tenant, what a tenant-wide admin sees across properties, and what a cross-property view must show. Resolve the terms into CONTEXT.md.

## Answer

Resolved 2026-09-24 by grilling.

- **Tenant** owns 1..N **Legal Entities** and 1..N **Properties**. Each Property belongs to exactly one Legal Entity. Invoice header data, VAT ID, bank details and invoice numbering live on the Legal Entity.
- **User** belongs to exactly one Tenant (email unique per tenant). A person working for two hotel companies has two accounts. No cross-tenant membership in v1.
- **Tenant roles** (at most one per user): **Owner** and **Tenant Admin**. Both imply full Property Manager rights on every current and future property. Owner additionally manages the subscription and can delete the tenant.
- **Property roles**, assigned per (User, Property), fixed set, fixed permissions, no custom roles in v1: **Property Manager** (everything at the property, including inviting users and assigning property roles there), **Front Desk** (reservations, check-in/out, folio, Meldeschein), **Housekeeping** (room status and tasks only), **Accounting** (invoices, payments, reports; no reservation edits), **Revenue** (rates, restrictions, availability). A user may hold different property roles at different properties.
- **User administration**: Tenant Admin/Owner manage all users and tenant roles; a Property Manager invites users and assigns property roles at their own property only.
- **Cross-property surfaces in v1** for users with access to more than one property: consolidated today-dashboard (arrivals, departures, occupancy per property), cross-property reservation and guest search, consolidated reports with per-property breakdown. Every other screen is single-property behind a property switcher.
- **All staff, including housekeeping, have individual logins.** Shared-device PIN login is fog.
- Exact permission matrix per role is a follow-up ticket, blocked until the domain objects it references exist.
- ADR: `docs/adr/0001-user-belongs-to-one-tenant.md`.

> Update 2026-09-28: "Housekeeping model" changes the fixed property role set from five to seven: Property Manager, Front Desk, Housekeeper, Housekeeping Supervisor, Maintenance, Accounting, Revenue.
