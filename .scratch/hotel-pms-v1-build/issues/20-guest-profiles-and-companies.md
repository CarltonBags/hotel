# 20 — Guest profiles and Companies

**What to build:** Front Desk creates and edits tenant-wide Guest profiles (ADR 0004): names, date of birth, nationality, Country of Residence with postal code for Austrian and German residents, contact data, preferences, marketing consent with proof, identity document fields; stay history across all properties. Duplicate detection on email, phone and name plus date of birth at creation, with manual merge that keeps the most complete data. Companies with billing data, payment terms and default Routing Rules. Guest tab and Company tab open as record tabs in the shell; cross-property guest search.

**Blocked by:** 12 App shell with tabs, Main Menu, themes and languages

**Status:** done

- [x] Creating a guest with an email that exists shows the possible duplicate and offers to use it
- [x] Merging two profiles keeps both stay histories and logs the merge
- [x] A guest created at property A is found at property B of the same tenant
- [x] Revenue sees no contact details on a guest (permission matrix)

## Comments

**Done (2026-10-02).** Tenant migration 0007: `guests` (names, birth date, nationality, Country of Residence, postal code, address, email, phone with normalised copies, language, preferences, VIP, marketing consent with proof enforced by a check, identity document), `guest_changes` (history), `guest_merges` (ids and field names only), `companies` (billing data, payment terms, on account, default Routing Rules as categories, notes, active), `company_changes`, and `rate_plans.company_id` (a Rate Code may attach a Company, deferred from ticket 17). Domain: `mergeGuestData`, `normaliseEmail`/`normalisePhone`, `needsPostalCode`, `EMPTY_GUEST`, `ROUTING_CATEGORIES`, `canAtAnyProperty`; rights `view_guests`, `view_guest_contacts`, `edit_guests`, `merge_guests`, `view_companies`, `edit_companies`. Screens: Guests (tenant-wide search by name, email or phone; new guest with duplicate check offering the existing profile or "create anyway"), guest record tab (profile, stays placeholder, merge panel with possible duplicates and search, merges, change history), Companies list and record tab with history. Record pages register their own record tab in the shell (also after reload).

**Verified:** 171 tests green (domain 61, db 65, auth 17, staff 10, worker 14, events 4), typecheck, builds, tenant SQL lint. Browser walkthrough 11/11: create opens the profile and its record tab; same email offers the existing profile; create anyway; Berlin guest found from Zürich; merge leaves one profile and logs it; edit shows in history; Company with payment terms and routing as record tab; Revenue gets "not allowed" for guest search and profile links.

**Merge:** the profile the user is on is kept; its values win and gaps are filled from the other ("most complete" read as fill-gaps; to keep the other profile, merge from its page). Every row in the tenant schema pointing at the merged profile through a single-column foreign key moves to the kept one, so reservations (ticket 21) follow without extra code; multi-column references or unique conflicts stop the merge with a message instead of losing rows. Earlier merges of the absorbed profile move to the kept profile's log.

**Review fixes applied:** Revenue removed from guests and companies (matrix row "View and edit Guest profile" has no Revenue; acceptance "Revenue sees no contact details" holds because Revenue sees no profile at all — ticket 21 must redact guests inside reservations for Revenue); domain test guards that every role that views, edits or merges guests also sees contacts; history shown to every viewer; Company changes logged; rate-plan Company picker lists inactive Companies too, so saving no longer clears the link; guest save locks the row; ids from the browser checked; "0049…" phone searches match; shared constants moved to domain.

**Open points:**
- Company rights are an assumption (no matrix row): view PM, FD, AC; edit PM, FD, AC.
- Postal code for AT/DE residents is flagged, not required; statistics and check-in tickets enforce it.
- Erasure scope recorded on ticket 95 (history tables hold personal values).
- Stay history shows "No stays yet" until ticket 21.
