# Switzerland guest registration rules

Map: ../map.md
Type: research
Status: resolved
Blocked by: -

## Question

What must a Swiss hotel record about its guests, and how? Report from primary sources: the federal rule (foreign nationals ordinance) and the cantonal rules for the largest tourism cantons (Zürich, Bern, Graubünden, Wallis, Luzern, Genf, Tessin, Basel-Stadt): who is registered, which fields, whether a signature is required and in what form, electronic transmission to the police (systems and formats), retention, and the state of the amendment in consultation until 27 November 2026. Include the Swiss tourist tax and guest card practice where it touches registration. Conclude with requirements for a Switzerland mode.

## Answer

Resolved 2026-09-29. Findings: [switzerland-registration.md](../../../docs/research/switzerland-registration.md).

- The rule set is cantonal, not national. Federal law (AIG Art. 16, VZAE Art. 18) covers foreign guests only: form per identity document, ID presented, guest signs, groups by a list signed by the tour leader. Federal mandatory fields: surname, first name, date of birth, place of birth, nationality, accompanying spouse and minor children, arrival and departure dates, document type and number, establishment name.
- Swiss guests are also registered in Zürich, Bern, Luzern, Wallis, Genf, Tessin and Basel-Stadt; Graubünden registers foreign guests only.
- Signature: required today for foreign guests everywhere (federal) and by Graubünden's own ordinance; no cantonal statute read prescribes its form. Whether a tablet signature suffices is decided nowhere (UNVERIFIED); printed form with handwritten signature is the only certainly compliant path. Build the signature as a per-canton switch.
- Amendment: preliminary draft only, consultation until 27 Nov 2026, no entry-into-force date. As drafted, an electronic form needs no signature if the host checks the data against the presented document (our ID Check); paper forms stay signed. EasyGov channel planned for 2028, voluntary, no format published.
- Transmission: Tessin electronic within 24 hours (published XML/XSD, CSV, XLSX upload); Genf daily arrival files; Basel-Stadt daily entry in eLM; Zürich electronic via HOKO. Bern, Graubünden, Luzern, Wallis: keep and produce on request. Interface specifications for HOKO, eLM and CheckIn are not public and must be requested.
- Retention (provider side): Bern at least 5 years, Luzern 5 years, Graubünden 1 year, Genf current year until end of the following January, Tessin 5 years for group lists and parental authorisations; Zürich, Basel-Stadt, Wallis not found.
- Tessin forbids photocopying the identity document; record type and number only.
- Tourist taxes are per person per night with per-place age bands and residence exemptions, so date of birth and residence are needed for every guest; Basel-Stadt couples tax and BaselCard to the same data entry.
- The German card-payment path has no basis in Swiss law and must not be offered.
