# 85 — Official tourism statistics report

**What to build:** Per property and calendar month the system produces the official tourism statistics in the country's variant: arrivals and overnight stays per person by Country of Residence (Austria split by federal state and German region), capacity figures (bed places, extra beds, rooms, opening days) from the dated room and bed history and the property's opening calendar, in the row order and codes of the official form; exclusion flag with reason per guest; statistical identity and deadline per property with a reminder; frozen on submission; export as spreadsheet and PDF. No direct transmission.

**Blocked by:** 32 Night Audit and Business Date

**Status:** in review (pull request on branch ticket-85-tourism-statistics, stacked on ticket-50-cash-desk)

- [x] German form for a demo month matches a hand count of persons by country
- [x] Austrian variant splits Germany by region
- [x] Frozen report cannot change; a correction creates a new version
- [x] Reminder appears on the deadline day

## Comments

**Built (2026-10-04).** Following "Tourism statistics reporting duties" and `docs/research/tourism-statistics.md`.

**Report** (Reports → Tourism statistics, Property Manager): one per property and calendar month, in the country's variant.
- **Germany** (form HOT, to the state statistical office): persons by country of residence (not nationality) in the row order of section F, other countries grouped by continent as on the form, "Ohne Angabe" last. Bed places on the last opening day (04); guest rooms on 31 July in the July report (05); room days offered and occupied (02, 03) from 25 rooms; closed periods listed (08/09).
- **Austria** (form F-B1/2, to the municipality): Austria by federal state and Germany by region from the postal code, then the form's origins with its groups (übrige GUS, restliches Südosteuropa, Südostasien, Arab countries in Asia, …).
- **Switzerland** (HESTA): each country by ISO code, opening days, occupied rooms, takings per person and night.

**Counting:**
- Persons, from stays checked in or out: arrivals in the month, and nights in the month, e.g. 3 persons from 25 July to 6 August give July 3 arrivals and 21 nights, August 0 and 15.
- Day use is not counted.
- Opening days are the days not in a Closed Period (new glossary term).
- Capacity comes from the dated bed history: a room counts from its first history entry.
- Room days offered exclude Out of Order nights and rooms of stays left out; the beds of guests left out are left out too.
- Occupied room nights count each room once a night.

**Data to complete:** stays whose guest has no country of residence (counted as "not stated") or, in Austria, no postal code are listed with links. A stay can be left out with a reason, by the Front Desk or the Property Manager; who and when are kept.

**Submission:**
- "Submit and freeze", once the month has ended, keeps the figures as submitted. The database refuses any change.
- A later submission is a correction with the next version. The page shows the rows that changed since the last version.
- Statistical identity and deadline day (default the 5th of the following month) per property.

**Reminder:** a banner from the deadline day until the month is submitted. It looks back up to six months, from the first stay on, so a missed month is not forgotten.

**Export:** PDF and spreadsheet (CSV, UTF-8 with BOM, formulas neutralised), now or for each version. No direct transmission.

**Verified:**
- 373 tests green (domain 162, db 191, invoices 8, staff 12), plus typecheck and the tenant SQL lint.
- Database tests cover all four acceptance criteria: a demo month against a hand count, Austria's split, frozen versions, and the reminder on the deadline day, including a missed earlier month.
- Browser walkthrough: totals match a hand count from the database (20 arrivals, 40 nights in October); spreadsheet in form order; PDF; submitted version listed and reminder gone; frozen; a correction becomes version 2. The reminder on the deadline day passed in the first run.

**Review fixes applied:**
- Only finished months are submitted.
- Day use is not counted.
- Rooms count from their history; Out of Order and excluded rooms leave room days offered; excluded beds leave bed places.
- Distinct occupied room nights.
- July-only guest rooms and form codes on the German report; closed periods printed.
- The reminder looks back several months, with one query for the banner.
- Formula-safe CSV shared with the City Tax report.
- Postal fixes (Braunau, Aschaffenburg).
- Changes since the last version shown.
- "Closed Period" instead of "closure".
- Exclusions record who and when; validation added.

**Open points:**
- **Country row codes:** the official codes for the rows (Germany 13–99, Austria's two-digit codes) could not be verified by the research. The rows are in form order without codes; read them from the forms (or the .CORE delivery agreement) and add them.
- **Companions:** all persons of a stay count under the primary guest's country of residence. Companions with their own residence need the per-person registration (Meldeschein, ticket 45).
- **Exclusion level:** exclusion is per stay, not per person.
- **Austria's yearly sheet:** F-B3 (capacity at 31 May) is not produced.
- **Swiss takings:** the definition is unverified (all room Charges, gross, per person-night).
- **Staff rooms:** there is no concept of rooms used by staff, so none are left out.
- **Postal regions:** they follow the leading digits. Border areas (Neu-Ulm and Lindau to Baden-Württemberg; parts of 36/37/38xxx; Schwechat to Wien) may land in the neighbouring region.
- **Germany's 25-room threshold:** uses the current room count, not the last July's.
- **Deleted rooms:** they leave past months' capacity.

