# 17 — Rate Plans, policies, Supplements and Restrictions

**What to build:** Revenue creates a Rate Plan spanning one or more room types (ADR 0012) as a Base Rate Plan or a one-level Derived Rate Plan (amount or percentage off a base, with per-restriction inheritance) whose daily values are always stored; Supplements for single occupancy, extra adult and child per Age Band; Meal Plan; included Services with fixed component prices per person-night; reusable Payment Policies and Cancellation Policies; date-change flag and early-departure fee; public or hidden behind a Rate Code that may attach a Company; sold on channels or not; texts per language. Restrictions per plan, room type and date: stop sell, closed to arrival, closed to departure, minimum stay on arrival, minimum stay through, maximum stay. Shortcuts close a room type or the property. Price Floor per room type. Limits enforced: 20 room types and 200 projected rate plans per property.

**Blocked by:** 15 Room Types, Rooms, Room Features, Sections and Age Bands, 16 Service catalogue and Tax Codes

**Status:** done

- [x] Changing a base price rewrites the stored prices of its derived plan and logs the change
- [x] A derived plan cannot be the parent of another
- [x] Per-occupancy prices computed from Supplements match a hand calculation for 1, 2, 3 adults and one child
- [x] Closing the property writes stop sell into every plan for the chosen dates

## Comments

**Done (2026-10-01).** Tenant migration 0005: Payment and Cancellation Policies per property, Rate Plans spanning room types (base or one-level derived by amount or percent, per-restriction inheritance, base occupancy, Meal Plan, policies, date-change flag, early-departure fee, public or Rate Code, sold on channels, texts per language), Supplements (single, extra adult, child per Age Band), included Services with fixed component prices, Rates and Restrictions per plan, room type and date, `rate_changes` log grouped by change id, Price Floor on room types. Domain `rates.ts`: `derivedPrice`, `occupancyPrice`/`occupancyPrices`, `effectiveRestriction`, `checkPlanLimits`; shared `roundMoney`. Permission `manage_rates` (Property Manager, Revenue). Screen `/settings/rate-plans` with tabs Rate Plans, Policies, Price Floors, Close-out and a projected-plans counter.

**Verified:** 144 tests green (domain 48, db 51 against Postgres, auth 17, staff 10, worker 14, events 4), typecheck, builds, tenant SQL lint. Acceptance criteria: base price change rewrites derived prices and logs both (db test, incl. derivation change); derived never a parent on create and update (db test, plus UI disables "derived" without another base); Supplements hand calculation 1/2/3 adults and one child = 100/120/155/135 (domain test); close property writes stop sell into every plan (db test and browser). Browser walkthrough 11/11: policies, BAR, NR at -10 %, refused second-level derivation, close-out 4 cells, Price Floor 79.

**Review fixes applied:** base occupancy may not exceed a spanned room type's max adults; a derived plan spans only its base's room types, and a base dropping a room type narrows its derived plans; prices and restrictions removed by dropping a room type or turning a base plan derived are logged with old values; rate and restriction writes and close-outs take the property lock that plan edits take, and close-out runs in one transaction; blank translations dropped on create; every constraint named in the migration and mirrored in the Drizzle schema; shared form helpers in `lib/form.ts`; unknown derivation kind refused.

**Open points:**
- Queueing changes for the channel manager (ADR 0012) is the channel sync ticket's outbox; `rate_changes` is its source until then.
- Writes to an inherited restriction field on a derived plan are stored but have no effect while inherited; the grid (ticket 18) must show that.
- Rate Code attaching a Company waits for ticket 20 (Companies).
- Price Floor enforcement belongs to Price Override (reservation tickets); ticket 18 marks below-floor cells.
- Fee kind "none" added for cancellation, no-show and early departure so a plan can carry no fee; the decision record lists only first night, percent and full stay.
