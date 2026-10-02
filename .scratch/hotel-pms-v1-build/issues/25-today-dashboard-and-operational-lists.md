# 25 — Today dashboard, operational lists and cross-property search

**What to build:** Front Desk opens the Today dashboard (arrivals, departures, in-house, occupancy, flagged overbookings) and the lists from the Main Menu: arrivals, departures, in-house, house list, breakfast list, each sortable and printable. Users with access to several properties get a consolidated today dashboard per property and a cross-property reservation and guest search from the navbar.

**Blocked by:** 22 Edit, move and cancel reservations with audit log and forced overbooking

**Status:** done

- [x] Lists reflect a new reservation without reload (live updates)
- [x] Breakfast list counts persons per Meal Plan
- [x] Cross-property search finds a guest at another property and opens it there

## Comments

**Done (2026-10-02).** Today shows one card per property (the selected one, or every property with "All properties"): arrivals, departures, in-house, Occupancy tonight and overbooked reservations. Lists in the Main Menu (right `view_operational_lists`: Property Manager, Front Desk): Arrivals, Departures (room of the last night), In house (Checked-in), House list (everyone sleeping in the house that night, by room), Breakfast list (persons per Meal Plan for the morning of the date); each sortable by column, movable by day and printable without the shell. Navbar search finds functions, reservations by confirmation number or guest name at every property the user may see reservations at, and Guest profiles; a reservation at another property switches the navbar to it and opens it. Live updates: every reservation write announces `data.reservations` for its property (events `publishDataChange`, no personal data); the shell turns these into a browser event and `LiveRefresh` re-renders lists, Today and the Calendar without a toast.

**Verified:** 213 tests green (domain 87, db 90, auth 17, events 5, staff 10, worker 14), typecheck, tenant SQL lint. Browser walkthrough 7/7: an Arrivals list updates from a booking made in a second tab; sorting both ways; breakfast counts per Meal Plan; print hides the shell; Today figures; search from Zürich opens the Berlin reservation there.

**Review fixes applied:** breakfast list counts only checked-in guests for today and past mornings (a forecast of Confirmed stays for mornings ahead), so a stay that never arrived is not counted; Today's counts and the lists share their rules; stale search results cleared while a new query runs; search returns fields, formatted in the browser; live-update kinds shared from the domain package; shared calendar-date check; German "Zimmerkategorie".

**Open points:**
- In house stays empty until check-in (ticket 26); the Breakfast list for today counts only checked-in guests for the same reason.
- Lists and Today use the property's own date until Night Audit provides the Business Date (TODOs in code).
- Occupancy counts all rooms until Out of Order exists (TODO in code).
- Live updates are announced by the staff app; writes from the worker (channel manager) must announce too when they arrive.
- Every user of the tenant receives the data-change hint (property id only).
