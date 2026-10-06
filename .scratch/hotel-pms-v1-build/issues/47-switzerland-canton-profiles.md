# 47 — Switzerland Canton Profiles and Tessin export

**What to build:** A Swiss property chooses a Canton Profile: who is registered, fields beyond the federal minimum, form per adult, couple or family, retention, whether an identity document copy may be kept (Tessin forbids), signature requirement and form, transmission duty; presets for Zürich, Bern, Graubünden, Wallis, Luzern, Genf, Tessin and Basel-Stadt labelled "verify with your canton". Default: printed form with handwritten signature; a switch allows tablet signature or none with ID Check when permitted. The German card path is never offered. Tessin: export file in its published format; Zürich, Genf and Basel-Stadt: records printable for manual entry until ticket 48; other cantons: records kept and printable. Date of birth and Country of Residence captured for every guest.

**Blocked by:** 45 Meldeschein registration on the tablet

**Status:** in review (PR stacked on ticket 44)

- [x] Tessin profile refuses a document image upload
- [x] Tessin export validates against the XSD
- [x] Zürich profile registers all guests; Bern registers foreign guests only
- [x] Self Check-in and Portal hand over to reception while a handwritten signature is required

## Comments

**Built**
- **Canton Profile per Swiss property** (Settings → Canton Profile, Property Manager):
  - who is registered (foreign guests or all);
  - fields beyond the federal minimum (address, gender, car);
  - one form per adult, couple or family;
  - retention (years, or Geneva's "until the end of the following January");
  - whether an identity document copy may be kept;
  - confirmation: printed form signed by hand by default, tablet signature, or none with ID Check where the canton confirmed it (never in Graubünden);
  - transmission (Tessin export, entry by hand in the cantonal system, kept and printable);
  - Tessin's establishment id.
- **Presets** for Zürich, Bern, Graubünden, Wallis, Luzern, Genf, Tessin and Basel-Stadt, labelled "verify with your canton". Where no retention period was found (ZH, VS, BS, other), five years is shown as an assumption. Each registration keeps the profile it started with.
- **Registration in Switzerland:**
  - the tablet asks place of birth and document type (and the car where the profile asks it);
  - every guest needs a date of birth and Country of Residence (companions too; completion is refused until they are there);
  - signed on paper at the desk, on the tablet, or by the ID Check alone, as the profile says;
  - the form prints with the canton, place of birth and document type.
  - The German card path is never offered.
- **Tessin:** no document pictures (refused before storing; pictures already stored go when the profile forbids copies). Export of completed forms by arrival day in Tessin's published formats:
  - the CSV for all;
  - one XML per form (the schema takes one registration a file), validated against the cantonal XSD kept in `docs/formats/`;
  - a record the schema cannot take (no date of birth, unknown country, postcode not in digits) is named instead of made up.
- **Zürich, Genf, Basel-Stadt and the others:** records kept and printable for entry by hand (ticket 48 brings the interfaces).
- **Hand-over:** the Guest Portal tells the guest the form is signed at reception while a handwritten signature is required. Self Check-in (ticket 49) is to use the same rule (noted there).

**Verified**
- All packages typecheck and pass:
  - domain: presets and grouping, Tessin per adult, ID Check rule, retention, document copy, hand-over, Tessin XML and CSV with escaping, formula guard and problems;
  - db `canton.test.ts`: no registration before a profile; Zürich all and Graubünden foreign only; Swiss date of birth and residence; Tessin portal refusal and hand-over; a Tessin tablet registration signed on paper, exported, the XML validated with `xmllint` against the cantonal XSD;
  - German and Austrian registration tests unchanged.
- Walkthrough 11/11 (a dev property switched to Switzerland for the run):
  - Tessin preset; no document copy; profile saved;
  - portal hand-over and no picture upload;
  - an Italian guest's form on the tablet with place of birth, document type and car;
  - signed on paper, ID Check, completed;
  - the CSV and the XML validated against the XSD.

**Review fixes**
- **Bern:** registers all guests. The ticket's line "Bern registers foreign guests only" contradicts the research, which resolved for Bern's statute (GGG Art. 24). The test now checks Graubünden for foreign-only.
- **Grouping:** the presets now follow the rules read: spouse and minor children on the guest's form ("couple"), Tessin a notification per adult. Before, adult children and spouses were counted on the head's form and left out of the Tessin export.
- **No made-up data in the XML:** no "0" postcode, "XXX" country or empty date; such records are named.
- **ID Check instead of a signature:** only where the canton confirmed it, never in Graubünden.
- **Every guest's date of birth and residence:** enforced at completion.
- **Germany unchanged:** the German form's heading is restored. Malformed tablet input gives the guest a field to fix, not an error. The export route checks its days and is open to the desk too.
- **Smaller:** a blank Tessin id no longer breaks the settings page; the Tessin id survives a preset change; the portal uses the validated profile once; the CSV guards against formulas; references are the form's id; age and "registered" rules live in the domain; shared constants; a typed error for missing Swiss details.

**Open points**
- **Bern:** the ticket line and the research disagree; the preset follows the research. Confirm with the canton on the first Bern customer.
- **ID Check confirmation:** recorded as a tick by the property, not checked against any canton list.
- **German properties:** the portal now also tells German guests the form is signed at reception (the same rule).
- **Tessin's portal:** the XML is checked against the schema as published; the portal's own checks (dates since 2000, the per-row result page) show only on upload.
