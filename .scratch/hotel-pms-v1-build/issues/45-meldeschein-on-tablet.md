# 45 — Meldeschein registration on the tablet

**What to build:** On a reservation, Front Desk opens guest registration: per guest the system shows whether they need their own form, are counted on a family form, or need nothing, from the property's country (Germany: foreign nationals only, spouse, partner and minors by count and nationality; Austria: all guests, minors on a parent's form) and the guest's data. The desk picks an enrolled tablet Device and sends the registration; one send queues every guest needing a form, the tablet runs them in turn; a tablet serves one reservation at a time and the desk can take it back. Tablet steps per guest: welcome with language choice, details (editable personal fields, arrival and departure read-only, statutory fields only), companions, review, completion; the desk sees progress live. Completion: Austria signs on the tablet; Germany prints the completed form for a handwritten signature (the card path comes in ticket 46). The desk records the ID Check; registration completes only with both. Stored: structured record, how it was confirmed, ID Check result, rendered PDF; automatic deletion Germany between day 365 and 455 after departure, Austria after 7 years. Guest edits write back to the profile logged as tablet edits.

**Blocked by:** 14 Devices and PIN Sign-in, 26 Check-in with folio posting, Charges and Routing Rules

**Status:** in review (PR stacked on ticket 86)

- [x] Matches docs/design/meldeschein flow for the tablet
- [x] A German national at a German property needs no form; a foreign family gets one form with counts
- [x] Austrian tablet signature image stored with the record and rendered on the PDF
- [x] Deletion job removes a German record on day 400 and keeps an Austrian one

## Comments

**Built**
- Who needs what, per guest, by the property's country:
  - Germany: foreign nationals only. The spouse, partner and minor children of the family's head are counted on the head's form, by number and nationality, whatever their own nationality.
  - Austria: every guest; minors are listed on a parent's form.
  - Other countries are refused (Switzerland comes with its Canton Profiles, ticket 47).
- Desk, on the reservation page:
  - Open the registration; add fellow guests.
  - Send to an enrolled guest tablet: everyone needing a form in turn, or one guest alone. One reservation per tablet. Take back at any time.
  - Live progress: the step, and the entered data as the guest types.
  - ID Check: passport compared, or a note why not ("no valid ID shown").
  - Germany: print the form, then "signed on paper".
  - Complete: the form is rendered under the lock, as confirmed, and kept.
- Guest tablet (`/tablet`, a guest Device; the device page sends guest devices there):
  - Idle: "come to reception".
  - Steps per guest: welcome with language; details with statutory fields only, gender included, arrival and departure read-only; companions (names not asked in Germany); review with Back.
  - Austria: signature with the confirmation line. Germany: told the form is printed at reception.
  - The tablet sees only the statutory fields of the person whose turn it is, and the role, name and nationality of those counted on their form.
- Guest edits go back to the profile in the same transaction, logged as `tablet:<device name>`.
- Records are deleted daily by the worker: Germany from day 365 after departure, Austria after 7 years.

**Verified**
- Domain tests: needs by country, family head, a German spouse of a foreign head, the minor at arrival, deletion days, completion rule.
- DB tests: German no-form and family counts; Austrian tablet run with one reservation per tablet, refusal of others, write-back as tablet edits, signature check, take-back, completion with the signature image on the stored PDF, no change after completion; German paper order; deletion on day 400 (DE goes, AT stays).
- Invoices test: PDF with the signature image.
- All packages typecheck and pass; tenant SQL check clean.
- Walkthrough (8/8), desk and tablet side by side: idle tablet; German national no form; foreign family one form with counts; step live; entered data live before submitting; profile write-back as tablet edits; German print, paper and ID Check to completion with the PDF; Austrian signature drawn on the stored PDF.

**Review fixes**
- The tablet endpoint returned other guests' full records and the desk's ID Check note; it now returns statutory fields only.
- The tablet POST is now:
  - size-capped, with the signature checked as PNG and capped;
  - typed and validated, with real dates only and a cap on companions;
  - answering with field names, never database messages.
- Steps lock the registration: double taps and take-back races leave nothing half done.
- Profile write-back happens in the same transaction.
- The PDF route authorises before reading anything of the person.
- Completed records refuse further ID Check or confirmation changes.
- A re-send resets the old queue; the device-busy race answers "busy".
- Counted persons are listed only on the head's form.

**Open points**
- Arrival-day card path (Germany): ticket 46.
- The German print is started by the desk ("Print form"); there is no automatic print to a desk printer.
- `device_id` on a registration has no foreign key to the control schema's devices: a revoked tablet keeps its registration until the desk takes it back.
- Deleting a reservation would cascade its registration before the retention period ends. Reservations are not deleted in the product today.
- Gender is captured for Austria's form; Germany's statutory minimum does not need it, but it is offered.
