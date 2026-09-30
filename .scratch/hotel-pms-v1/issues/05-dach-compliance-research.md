# DACH legal and fiscal requirements

Map: ../map.md
Type: research
Status: resolved
Blocked by: -

## Question

What legal requirements must the v1 spec satisfy for German (and, where different, Austrian and Swiss) hotels? Cover: Meldeschein under Bundesmeldegesetz sections 29-30 (required fields, who signs, retention period, whether an electronic signature on a tablet is legally sufficient and under which conditions), tourist and city taxes (Kurtaxe, Bettensteuer), invoice content requirements under UStG section 14 and GoBD immutability of invoices, whether KassenSichV/TSE applies to hotel front-desk cash payments, GDPR retention for guest data, and accounting export conventions (DATEV). Cite primary legal sources.

## Answer

Full findings with verbatim statute quotes and sources: [docs/research/dach-compliance.md](../../../docs/research/dach-compliance.md).

- **E-signature verdict (DE): a signature drawn on the guest iPad is NOT a valid Meldeschein signature.** BMG § 29 (2) requires a *handschriftlich* signed form, and § 29 (5) allows only three substitutes: SCA card payment with token capture, eID/eAT online proof, or on-site eID chip read (or a BSI-approved pilot procedure). The BMI (May 2019, per DTV FAQ) explicitly rejected touchpad signatures. v1 must either print the iPad-prefilled form for a handwritten signature, or implement the § 29 (5) Nr. 1 card-SCA flow and write BeherbMeldV XML (`JJJJMMTT_BeherbMeldeschein_Zaehler.xml`, 13 defined fields).
- Since 1 Jan 2025 (BEG IV) **only foreign nationals** need a German Meldeschein; fields are the closed BMG § 30 (2) list; spouse/partner/minor children by count only; retain 1 year after departure, delete within 3 more months.
- **Austria differs:** all guests register within 24 h; an electronically captured signature on a tablet IS valid (MeldeV § 19 (2) Nr. 2); 7-year retention; immutable sequential numbering. **Switzerland:** foreign guests (all guests in e.g. Zürich), signature currently required; VZAE amendment to drop it is in consultation until 27 Nov 2026.
- Tourist taxes are per-property config, not a formula: percentage-of-net-room-price with night caps (Berlin 7.5 %, 21 nights; Vienna 5 % from 1.7.2026), stepped per-person tables (Hamburg), flat Kurtaxe per KAG Satzung with hotel as collector/joint debtor.
- Invoices: UStG § 14 (4) ten items, unique sequential number; Kleinbetrag ≤ €250 (AT €400); VAT room 7 %, food 7 % from 2026, drinks 19 %; retention 8 years (UStG § 14b/AO § 147 since 2025); GoBD: no editing of issued invoices, Storno referencing original, historised master data, Verfahrensdokumentation; E-Rechnung for B2B mandatory 2027/2028.
- KassenSichV/TSE applies to the PMS **as soon as it can record cash or vouchers** (AEAO § 146a Nr. 1.2, BMF FAQ on Hotelsoftware); card/transfer-only desk needs no TSE. Austria's RKSV covers card payments too.
- GDPR: Meldeschein 12–15 months, invoices 8 years (name/address must survive erasure requests), AT Gästeverzeichnis 7 years, Hamburg tax records 4 years; everything else purpose-bound.
- DATEV: EXTF Buchungsstapel CSV (category 21), semicolon, decimal comma, TTMM Belegdatum, S/H flag, Belegfeld 1 = invoice number, Festschreibung on close; official field lengths UNVERIFIED (spec is login-gated).
