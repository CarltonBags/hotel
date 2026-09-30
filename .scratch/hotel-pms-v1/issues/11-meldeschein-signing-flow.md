# Meldeschein tablet signing flow

Map: ../map.md
Type: prototype
Status: resolved
Blocked by: 05

## Question

The DACH research (see "DACH legal and fiscal requirements") found that in Germany a signature drawn on a tablet is NOT a valid Meldeschein signature (BMG §29(2) requires a handwritten signature; §29(5) allows only card-SCA with token capture, eID/eAT, or on-site eID read), that since 1 January 2025 German nationals need no Meldeschein at all, and that Austria expressly accepts an electronically captured signature. Prototype the guest-facing tablet flow under those rules: staff triggers from the reservation; tablet shows the form prefilled for each foreign guest with editable name and address fields; the completion step branches per property jurisdiction: Austria signs on the tablet; Germany either prints the completed form for a handwritten signature or, if the guest pays by card with SCA, uses the §29(5) Nr. 1 card flow and skips the signature. Answer: pairing model between desk and tablet, what the guest may edit, storage and retention of the completed form, per-guest handling in multi-guest reservations, and whether the German card-SCA path is in v1 or print-only ships first.

## Answer

Resolved 2026-09-28 by prototype; verdict given by the product owner after walking the three paths in the browser.

**Flow**
1. Front desk opens the reservation's guest registration. The system shows, per guest, whether they need their own form, are only counted on a family form, or need nothing, from the property's jurisdiction and the guest's nationality and relation.
2. Desk picks an enrolled Device and sends the registration to it. **One send queues every guest who needs their own form**; the tablet runs guest 1, then asks to pass the tablet to guest 2. Sending a single guest stays possible. A tablet serves one reservation at a time; desk can take it back at any moment.
3. Tablet steps per guest: welcome (language choice), details, companions, review, completion. Desk sees progress and the entered data live.
4. Desk performs the **ID Check**: confirms the details were compared with the passport, optionally noting a discrepancy or that no valid ID was shown.
5. Registration completes only when the guest's part is done **and** the ID Check is recorded.

**Completion per jurisdiction**
- **Austria**: guest signs on the tablet. All guests register; minors are listed on a parent's form (prototype assumption, verify in build).
- **Germany**: only foreign nationals. Spouse, partner and minor children are recorded by number and nationality only. **Both paths ship in v1 and the guest chooses**: (a) consent plus a card payment with strong customer authentication on the arrival day, which replaces the signature, stores the payment token and provider name, and writes the statutory XML record; (b) printed form with handwritten signature at the desk. Path (b) is always offered and is the fallback when the guest declines or does not pay by card.
- **Switzerland**: not prototyped; rules are changing (consultation until 27 Nov 2026). Kept in fog.

**Editing**: on the tablet the guest may edit all personal fields (names, date of birth, nationality, address, passport number). Arrival and departure are read-only. Guest edits are written back to the Guest profile and logged as changed by the guest on the tablet. The form carries only the statutory fields; email, phone and marketing consent never appear on it.

**Storage**: a structured record, how it was confirmed (tablet signature image, card token, or "signed on paper" with staff name and time), the ID Check result, and a rendered PDF. Hand-signed paper stays a physical document filed by the hotel and is not scanned. Deletion is automatic per jurisdiction: Germany between day 365 and day 455 after departure, Austria after 7 years.

**Pairing**: as decided in "Tech stack detail and tenancy strategy": tablets are enrolled Devices of one property and show only what the desk pushes.

Open point, ticketed as "Arrival-day card transaction for registration": which card transactions satisfy the German card path when the stay is prepaid or paid by a company.

Assets:
- Screenshots: `docs/design/meldeschein/`.
- Prototype: `apps/staff-shell-prototype`, route `/prototype/meldeschein?variant=A|B|C` (`&demo=<step>` jumps the tablet to a step). Code in `components/prototype/meldeschein/`. Uncommitted, same as the shell prototype.
