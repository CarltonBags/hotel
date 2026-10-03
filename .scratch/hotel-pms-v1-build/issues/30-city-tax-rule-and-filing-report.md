# 30 — City Tax Rule and filing report

**What to build:** A Property Manager configures at most one City Tax Rule per property in force per night, of type percentage with night cap, step table, or flat by season and Age Band, with versions carrying "valid for nights from" and optional "only for bookings made from". Base is the room component without VAT and included Services, extendable by marked Services. Pass-on per property: charged on top as a City Tax Charge per guest-night or absorbed. Exemptions from the fixed list with evidence rule per reason, set per guest on the reservation; long stay applied automatically. A new version recalculates uninvoiced nights and lists changed reservations. Filing report per rule and period as PDF and CSV. Presets Berlin, Hamburg and Wien labelled "verify with your municipality". The Tax Code of the City Tax Charge is a setting on the rule (final presets after gate 3).

**Blocked by:** 26 Check-in with folio posting, Charges and Routing Rules

**Status:** in review (pull request on branch ticket-30-city-tax, stacked on ticket-29-receivables)

- [x] Berlin preset on a 25-night stay taxes 21 nights
- [x] Hamburg step table picks the band from the net room price
- [x] Absorbed mode shows no line on the invoice but the filing report carries the tax
- [x] Exemption with document evidence stores the upload and shows the reason on the report

## Comments

**Built (2026-10-03).**

**Rule** (Settings → City Tax; Property Manager):
- At most one rule per property: an empty rule or a copy of a preset, labelled "verify with your municipality".
  - Berlin: 7.5 %, first 21 nights.
  - Hamburg: the step table with +1.20 per further started €50, for bookings from 2025.
  - Wien: 3.2 %, then 5 % from 1 Jul 2026 and 8 % from 1 Jul 2027; students exempt, and stays beyond 90 nights.
- Versions carry "valid for nights from" and optionally "only for bookings made from". There are three kinds:
  - percentage of the base, with an optional night cap
  - step table per person-night, banded by the price per person or per room, with an optional "+ X per further started Y"
  - flat per person-night by season and age
- The rule names the Tax Code and revenue account of the City Tax Charge.
- Base = room part net of VAT, without included Services, plus the Services the property marks (extra bed, final cleaning).
- Exemption reasons come from the fixed list, each with its evidence rule (none, note, document). Age (under N) and long stay (after N nights) apply automatically.

**Pass-on** per property: charged on top (a City Tax Charge per night, quantity = taxable persons when it divides evenly) or absorbed (no line, still filed). It is fixed for a stay at check-in, so a later change applies to later check-ins.

**Posting and recalculation.**
- The City Tax is a stay component posted at check-in on the routing category City Tax, and kept in step by the stay sync.
- Every night of a stay in house is recorded with base, persons, taxable persons, exempt persons by reason and tax, whether charged, absorbed or waived by a hand void.
- A rule change (version, Tax Code, base, reasons) recalculates the uninvoiced nights from today of every stay in house and lists the changed reservations with before and after. A stay that cannot be recalculated is skipped and listed, and never blocks the rule.
- Invoiced nights keep their amounts, and nights already slept get no City Tax afterwards.

**Exemptions** are set per person on the reservation and in the Today workspace (Guest tab) by Front Desk and Property Manager. The evidence document is PDF, JPEG or PNG, up to 5 MB. It is stored in the database until tenant file storage (ticket 36) and served only to the front office and report readers of the property.

**Filing report** (Reports → City Tax report; Property Manager, Accounting), per period with month, quarter, last quarter and year shortcuts. It is available as a page, PDF and CSV (formula-safe) and shows:
- room and person-nights, taxed person-nights, base, tax charged and absorbed
- exempt person-nights by reason
- exemptions with their evidence and the nights they exempted
- the guest list with length of stay

**Verified:**
- 327 tests green, plus typecheck and the tenant SQL lint.
- Browser walkthrough 16/16:
  - Berlin preset; disability with document; upload and serving.
  - Check-in posts the tax for the one taxable guest.
  - Absorbed stay: no line, still recorded; it stays absorbed after switching back.
  - Report page, PDF, CSV summing to the record.
  - New version recalculates and lists stays.

**Review fixes applied:**
- No City Tax posted for nights already slept.
- Invoiced nights refuse a shortening as before and keep their amounts on repricing.
- A Tax Code change reposts uninvoiced City Tax Charges.
- Quantity × price always equals the amount.
- Recalculation per stay in a savepoint, never confirming a shortening.
- CSV exemptions matched per reservation, `\r` quoted.
- The report lists exemptions only for nights they exempted.
- A hand-voided City Tax is filed as absorbed.
- Hamburg's booking cut-off.
- German term Beherbergungsabgabe.

**Open points:**
- Channel prices containing the tax (split backwards) and tax collected through OTAs come with ticket 38.
- Corrections of earlier periods: nights already slept are never rewritten, so filed periods stay as filed. A dedicated correction list waits for a real case.
- Age exemption and flat amounts use age limits, not Age Band records: a property's Age Bands are re-created on every save, so a reference to one would not last.
- Recalculation and the changed list cover stays in house. Confirmed future stays are computed at check-in (ADR 0009).
- Berlin's cap counts the nights of one reservation, not consecutive reservations in the same establishment.
- Hamburg band per person or per room: per person in the preset, unsettled in the research.
- The Tax Code of the City Tax Charge needs confirming at gate 03. The 0 % code maps to EN16931 category Z on invoices; category O ("not subject to VAT") would forbid other categories on the same invoice.
- The server action body limit is 6 MB for all actions (evidence upload).
- Report retention (4 years) comes with ticket 95.

