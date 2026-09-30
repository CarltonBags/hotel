# 17 — Rate Plans, policies, Supplements and Restrictions

**What to build:** Revenue creates a Rate Plan spanning one or more room types (ADR 0012) as a Base Rate Plan or a one-level Derived Rate Plan (amount or percentage off a base, with per-restriction inheritance) whose daily values are always stored; Supplements for single occupancy, extra adult and child per Age Band; Meal Plan; included Services with fixed component prices per person-night; reusable Payment Policies and Cancellation Policies; date-change flag and early-departure fee; public or hidden behind a Rate Code that may attach a Company; sold on channels or not; texts per language. Restrictions per plan, room type and date: stop sell, closed to arrival, closed to departure, minimum stay on arrival, minimum stay through, maximum stay. Shortcuts close a room type or the property. Price Floor per room type. Limits enforced: 20 room types and 200 projected rate plans per property.

**Blocked by:** 15 Room Types, Rooms, Room Features, Sections and Age Bands, 16 Service catalogue and Tax Codes

**Status:** ready-for-agent

- [ ] Changing a base price rewrites the stored prices of its derived plan and logs the change
- [ ] A derived plan cannot be the parent of another
- [ ] Per-occupancy prices computed from Supplements match a hand calculation for 1, 2, 3 adults and one child
- [ ] Closing the property writes stop sell into every plan for the chosen dates
