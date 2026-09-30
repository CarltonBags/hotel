# Switzerland registration flow

Map: ../map.md
Type: grilling
Status: resolved
Blocked by: 48

## Question

With the research in hand, decide the Switzerland mode of guest registration: who registers, fields, confirmation (signature or none), cantonal configuration per property, transmission, retention, and how the tablet, portal and self check-in flows branch for Swiss properties.

From the research: printed form with handwritten signature is the only certainly compliant path today; the card-payment substitute used in Germany must not be offered in Switzerland; one canton forbids photographing the identity document; family and group rules and transmission duties differ per canton, so they are per-canton settings; interface specifications of three cantonal systems are not public and must be requested.

## Answer

Resolved 2026-09-30 by grilling, within "Switzerland guest registration rules".

**Canton Profile per property**: sets who is registered (foreign guests only, or all guests), fields beyond the federal minimum, one form per adult, couple or family, retention period, whether a copy of the identity document may be kept (Tessin forbids it), whether a signature is required and in which form, and the transmission duty. Presets for Zürich, Bern, Graubünden, Wallis, Luzern, Genf, Tessin and Basel-Stadt, labelled "verify with your canton". Other cantons start from the federal minimum: surname, first name, date of birth, place of birth, nationality, accompanying spouse and minor children, arrival and departure, document type and number, establishment.

**Signature**: a switch in the Canton Profile. Default in v1 is the printed form with handwritten signature, the only certainly compliant path today: the tablet collects and prefills, the form is printed and signed at the desk. When a canton or the federal amendment allows it, the switch moves to "signature on tablet" or "no signature, with ID Check". The German card-payment path is never offered for Swiss properties.

**Flows**: the Meldeschein tablet flow, the Guest Portal's Pre-check-in and Self Check-in branch on the Canton Profile. Self Check-in cannot complete registration while the profile demands a handwritten signature; it hands over to reception, as for the German paper path.

**Transmission**
- Tessin: export file in its published format for upload.
- Zürich, Genf, Basel-Stadt: staff enter or upload by hand in the cantonal system until its interface specification is obtained; ticketed as "Cantonal registration interface specifications".
- Bern, Graubünden, Luzern, Wallis: records kept and printable on request.

**Other data**: date of birth and Country of Residence for every guest, since Swiss tourist taxes and guest cards depend on them.
