# Permission matrix for fixed roles

Map: ../map.md
Type: grilling
Status: resolved
Blocked by: 02 10 13 15

## Question

Given the fixed roles from "Tenancy, property and role model" (Property Manager, Front Desk, Housekeeper, Housekeeping Supervisor, Maintenance, Accounting, Revenue, plus Owner/Tenant Admin implying Property Manager), write the exact permission matrix: for each domain object (reservation, guest, folio, invoice, payment, cleanliness, room block, housekeeping task, maintenance issue, lost and found item, rate plan, restriction, availability, property settings, users) which role may view, create, edit, void/cancel. Decide the handful of sensitive actions that need Property Manager override (refunds, invoice cancellation, rate overrides below floor, deleting guest data) and whether an override is a separate approval or a role check.

## Answer

Resolved 2026-09-28 by grilling. Cells marked (owner) were decided by the product owner against or beyond the agent's recommendation.

**Principles**
- Permissions are fixed per role; no custom roles in v1.
- A user may hold several property roles at one property; permissions add up. If the roles use different layouts (phone-first or shell), the user picks at login.
- Owner and Tenant Admin act as Property Manager at every property.
- Every record shows its change history to anyone who may view the record.
- **Approval**: when an action exceeds a role's limit, the system asks for approval. The Property Manager approves by entering their own credentials on the same screen, or remotely from a notification. The action is recorded under the requesting user with "approved by". Requests expire after 24 hours.

Legend: ● allowed · ◐ allowed with limits stated · ▲ allowed only with approval · blank not allowed.
Columns: PM Property Manager · FD Front Desk · HS Housekeeping Supervisor · HK Housekeeper · MT Maintenance · AC Accounting · RV Revenue.

| Action | PM | FD | HS | HK | MT | AC | RV |
|---|---|---|---|---|---|---|---|
| **Reservations and guests** | | | | | | | |
| View reservation | ● | ● | ◐ floor view | ◐ floor view | ◐ floor view | ● | ◐ no contact details, no folio |
| Create, edit, cancel reservation | ● | ● | | | | | |
| Room Assignment | ● | ● | | | | | |
| Check-in, check-out | ● | ● | | | | | |
| Check-in into a room that is not ready (reason) | ● | ● | | | | | |
| Sell past availability (confirmation) | ● | ● | | | | | |
| View and edit Guest profile | ● | ● | | | | ◐ view | |
| Merge Guest profiles | ● | ● | | | | | |
| Registration and ID Check | ● | ● | | | | | |
| Guest Inbox | ● | ● | | | | | |
| Request erasure of guest data | ● | | | | | | |
| **Money** | | | | | | | |
| View folio | ● | ● | | | | ● | |
| Post Charge from Service catalogue | ● | ● | ◐ minibar | ◐ minibar | | ● | |
| Post free-text Charge | ● | | | | | | |
| Void uninvoiced Charge (reason) | ● | ● | | | | ● | |
| Move Charge between folios | ● | ● | | | | ● | |
| Price Override at or above Price Floor | ● | ● | | | | | |
| Price Override below floor, complimentary | ● | ▲ | | | | | |
| Take Payment | ● | ● | | | | ● | |
| Refund | ● | ◐ up to property limit, ▲ above | | | | ● | |
| Issue Invoice, Deposit Invoice | ● | ● | | | | ● | |
| Cancellation Invoice (reason) | ● | ● (owner: no time limit) | | | | ● | |
| Receivables: match payments, reminders | ● | | | | | ● | |
| Accounting export | ● | | | | | ● | |
| Run Night Audit | ● | ● | | | | ◐ view result | |
| **Rates** | | | | | | | |
| View Rates and Restrictions | ● | ● | | | | ● | ● |
| Edit Rates and Restrictions, close room type or property | ● | | | | | | ● |
| Rate Plans, policies, Rate Codes, Price Floor | ● | | | | | | ● |
| Service catalogue: prices | ● | | | | | | ● |
| Service catalogue: Tax Codes, revenue accounts | ● | | | | | ● | |
| **Housekeeping and maintenance** | | | | | | | |
| View Cleanliness and Room Blocks | ● | ● | ● | ◐ own rooms | ● | | |
| Set Dirty | ● | ● | ● | ◐ own rooms | | | |
| Set Clean | ● | ● (owner) | ● | ◐ own tasks | | | |
| Set Inspected | ● | ● (owner) | ● | | | | |
| Generate, assign, publish Housekeeping Tasks; Sections | ● | | ● | | | | |
| Work Housekeeping Task, record declined cleaning | ● | | ● | ◐ own tasks | | | |
| Room Block: Out of Service | ● | ● | ● | | ● | | |
| Room Block: Out of Order | ● | | ● | | ● | | |
| Report Maintenance Issue | ● | ● | ● | ● | ● | ● | ● |
| Work and close Maintenance Issue | ● | | | | ● | | |
| Lost and found: record item | ● | ● | ● | ● | | | |
| Lost and found: return or dispose | ● | ● | ● | | | | |
| **Lists and reports** | | | | | | | |
| Operational lists (house, arrivals, departures, breakfast) | ● | ● | ◐ housekeeping lists | | | | |
| Financial reports, City Tax report | ● | | | | | ● | |
| Revenue and occupancy reports | ● | | | | | ● | ● |
| **Administration** | | | | | | | |
| Property settings, Check-in Conditions, key handover | ● | | | | | | |
| Users and roles at the property | ● | | | | | | |
| Enrol Devices | ● | | | | | | |
| Property-wide audit log | ● | | | | | ◐ money entries | |
| Own Quick Access and Pinned Tabs | ● | ● | ● | ● | ● | ● | ● |

**Floor view** (Housekeeping Supervisor, Housekeeper, Maintenance): room, guest surname, stay dates, number of guests, housekeeping notes. No contact details, address, identity document data, prices or folio. The supervisor also sees arrival time and VIP flag.

**Tenant level** (not property roles): Tenant Admin and Owner manage tenant settings, Legal Entities, properties, tenant roles, accent colour, and execute erasure of guest data. Only the Owner manages the subscription and can delete the tenant.

**Erasure of guest data**: requested by a Property Manager, executed by Tenant Admin or Owner because Guest profiles are tenant-wide. The system keeps what the law requires (invoice fields for 8 years, registration records until their deletion date) and removes the rest; the log entry carries no erased data.

**Night Audit**: a closed Business Date cannot be reopened; corrections are made in the current date.

Risk noted with the owner's choices: Front Desk may set Inspected, so the inspection step is a convention rather than a control whenever Front Desk uses that right; Front Desk may cancel invoices without time limit, so Accounting should review the Cancellation Invoice list in the money audit log.

> Update 2026-09-29 from "Shared-device login for floor staff": the Housekeeping Supervisor may create Housekeeper users, reset their PIN and unlock them. All other user management stays with the Property Manager. PIN Sign-in exists for Housekeeper, Housekeeping Supervisor and Maintenance only.

> Update 2026-09-30 from "Own point of sale for bar, restaurant and spa": three new property roles, Service, Spa Staff and Outlet Manager; the role set is now ten. Their rows in the matrix follow the point-of-sale ticket.

> Note 2026-09-30: rows for cash, vouchers and the three outlet roles are decided in "Permissions for cash, vouchers and outlet roles".
