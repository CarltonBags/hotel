# 30 — City Tax Rule and filing report

**What to build:** A Property Manager configures at most one City Tax Rule per property in force per night, of type percentage with night cap, step table, or flat by season and Age Band, with versions carrying "valid for nights from" and optional "only for bookings made from". Base is the room component without VAT and included Services, extendable by marked Services. Pass-on per property: charged on top as a City Tax Charge per guest-night or absorbed. Exemptions from the fixed list with evidence rule per reason, set per guest on the reservation; long stay applied automatically. A new version recalculates uninvoiced nights and lists changed reservations. Filing report per rule and period as PDF and CSV. Presets Berlin, Hamburg and Wien labelled "verify with your municipality". The Tax Code of the City Tax Charge is a setting on the rule (final presets after gate 3).

**Blocked by:** 26 Check-in with folio posting, Charges and Routing Rules

**Status:** ready-for-agent

- [ ] Berlin preset on a 25-night stay taxes 21 nights
- [ ] Hamburg step table picks the band from the net room price
- [ ] Absorbed mode shows no line on the invoice but the filing report carries the tax
- [ ] Exemption with document evidence stores the upload and shows the reason on the report
