# City tax rule configuration

Map: ../map.md
Type: grilling
Status: resolved
Blocked by: -

## Question

City Tax is a separate Charge per guest-night computed from a per-Property rule. Define the rule model: the rule types v1 supports (percentage of net room price with night cap, stepped per-person table on net price, flat per person-night), which price components form the base, exemptions (age, business travel, residents, disability) and the evidence stored per exemption, seasonal validity, how rule changes take effect for existing reservations, whether the tax is subject to VAT per municipality, and the filing report per period. Check the model against Berlin, Hamburg, München, Wien and one Kurtaxe municipality from the DACH research.

## Answer

Resolved 2026-09-28 by grilling.

**Rule model**
- A property has at most one **City Tax Rule** in force for a given night. A property without a rule charges no City Tax.
- Three rule types:
  1. **Percentage** of the base, with an optional cap on taxed consecutive nights.
  2. **Step table**: an amount per person-night chosen by the band the base falls into.
  3. **Flat** amount per person-night, variable by season and Age Band.
- A rule has versions. Each version carries "valid for nights from" and, optionally, "only for bookings made from", because some laws spare bookings made before a change.
- When a new version starts, invoiced nights are never touched; uninvoiced future nights are recalculated and staff are told which reservations changed.

**Base**: the room component of the Rate without VAT and without included breakfast or other included Services. The property may mark further Services as part of the base (extra bed, final cleaning). A Price Override changes the base; a complimentary night has base zero.

**Rates exclude City Tax.** The tax is computed per guest-night and added on top. The booking engine shows the total including it.

**Pass-on, per property**, default "charged on top":
- Charged on top: a City Tax Charge per guest-night, shown on the invoice.
- Absorbed: the guest sees no tax line; the tax is still computed per night for filing.

**Channels** (raised by the owner: some channels already collect the tax in their price, others do not)
- Whether a channel booking's price contains City Tax is read from the booking's own tax data. Where the channel sends none, the property's default per channel applies. Staff can correct it on the reservation.
- If the booked price contains the tax, the total is **split backwards**: the tax contained in it is computed by the property's rule and posted as City Tax Charge, the room receives the remainder, and the guest pays exactly what the channel showed.
- If it does not, the tax is added on top and collected at the hotel.
- For OTA collect bookings the City Tax Charge is settled by the Tender "OTA collect" together with the room. The hotel still files and remits it.

**Exemptions**: the property enables reasons from a fixed list and sets the evidence rule for each (none, note, or document upload): age by Age Band, business travel, resident of the municipality, disability and accompanying person, long stay beyond N nights (applied automatically), student or trainee in the city, other with free text. Front Desk sets the exemption per guest on the reservation. The booking engine and channels always assume the guest is taxable; the hotel corrects at check-in.

**VAT on the tax**: each rule names the Tax Code of its City Tax Charge. Which code is right depends on the kind of levy and is one of the points in "Tax advisor confirmation of fiscal and voucher rules".

**Rounding**: per Charge, to the cent. Reports sum the Charges.

**Filing report**: per rule and period (monthly, quarterly or yearly), as PDF and CSV: nights and persons taxed, base, tax, exempt nights by reason with evidence, tax collected through OTAs, corrections of earlier periods, and optionally the guest list with length of stay where the law requires keeping it. Kept per rule, default 4 years after the end of the year. No electronic submission to the city in v1.

**Presets**: Berlin, Hamburg and Wien are shipped from the research, labelled "verify with your municipality". A property copies a preset and adjusts it. We maintain presets when laws change and notify the properties using them.

**Checked against the research**
| Place | Fits rule type | Notes |
|---|---|---|
| Berlin | Percentage, cap 21 nights | Base excludes breakfast, includes ancillary accommodation charges: covered by the base setting. Booking-date cut-off needed for the 2024 change: covered. |
| Hamburg | Step table | Hotel is the debtor and may absorb: covered by pass-on. No exemptions. Guest list kept 4 years: covered. Whether the band applies to the price per room or per person is not settled in the research. |
| Wien | Percentage | Staged rates 2026 and 2027: covered by versions. Exemptions for students and stays over 3 months: covered. |
| Spa or resort town | Flat | Season and age variation: covered. Extra registration-form fields some states allow are not modelled here. |
| München | No rule | The research contains nothing on München. UNVERIFIED whether a levy exists there; a property simply configures none. |

**Configured by**: Property Manager. Accounting sees the filing report.
