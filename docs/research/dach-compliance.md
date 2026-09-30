# DACH legal and fiscal requirements for a hotel PMS (v1)

> **Correction, 2026-09-28** (from `arrival-day-card-transaction.md`): inside the statutory XML, dates are `xsd:date` (`YYYY-MM-DD`); `JJJJMMTT` applies to the file name only. The address elements are `Land`, `PLZ`, `Ort`, `Ortsteil`, `Strasse`, `Hausnummer`, `AlternativeAdressangabe`, not the names listed in section 1.5 below. The schema is published as BAnz AT 10.07.2020 B1.

Researched: 2026-09-24. Scope: Germany first; Austria and Switzerland where they differ.
Ticket: `.scratch/hotel-pms-v1/issues/05-dach-compliance-research.md`.

Every claim below cites its source. Statute text was pulled from gesetze-im-internet.de, RIS/jusline (AT) and fedlex (CH) and quoted verbatim where the wording matters. Claims I could not trace to a primary source are marked **UNVERIFIED**.

---

## 1. Meldeschein (Germany: BMG §§ 29–30, BeherbMeldV)

### 1.1 Who must fill one in (since 1 Jan 2025: foreign guests only)

- BMG § 29 (2) S. 1: *"Beherbergte **ausländische** Personen haben am Tag der Ankunft einen besonderen Meldeschein **handschriftlich zu unterschreiben**, der die in § 30 Absatz 2 aufgeführten Daten enthält."* [S1]
- The word "ausländische" was inserted by the Viertes Bürokratieentlastungsgesetz (BEG IV), Art. 6 Nr. 1 a) aa), BGBl. 2024 I Nr. 323 of 29 Oct 2024; Art. 74 (6): *"die Artikel 6 und 7 treten am 1. Januar 2025 in Kraft."* [S9] Consequence: **German nationals no longer sign any BMG Meldeschein.** (Kurtaxe registration is a separate matter, see § 1.7 and § 3.)
- Exempt facilities (§ 29 (6)): educational homes, company/club homes, youth hostels, mountain huts, church institutions. [S1]
- Guests staying > 6 months fall under the ordinary residence registration (§ 29 (1)); guests without a domestic registered address must register with the Meldebehörde within two weeks once the stay exceeds three months. [S1]

### 1.2 Required fields (BMG § 30 (2), exhaustive list)

*"Die Meldescheine enthalten vorbehaltlich der Regelung in Absatz 3 **ausschließlich** folgende Daten:"* [S2]

1. Datum der Ankunft und der voraussichtlichen Abreise
2. Familiennamen
3. Vornamen
4. Geburtsdatum
5. Staatsangehörigkeiten
6. Anschrift
7. Zahl der ausländischen Mitreisenden und ihre Staatsangehörigkeit
8. Seriennummer des anerkannten und gültigen Passes oder Passersatzpapiers

Plus, in the § 29 (5) Nr. 1 card-payment procedure: *"ist die zweckgebundene Zuordnungsnummer des eingesetzten Zahlungsmittels zusammen mit den Daten nach Satz 1 zu speichern."* [S2]

"Ausschließlich" means the BMG form may not carry extra fields except those a Land adds for Kurtaxe (§ 30 (3): *"Durch Landesrecht kann bestimmt werden, dass für die Erhebung von Fremdenverkehrs- und Kurbeiträgen weitere Daten auf dem Meldeschein erhoben werden dürfen."*). [S2] Email, phone, marketing consent etc. must live elsewhere in the PMS record, not on the Meldeschein.

### 1.3 Who signs; spouse/children; groups

- The foreign guest signs, on the day of arrival (§ 29 (2) S. 1). [S1]
- *"Mitreisende ausländische Ehegatten, Lebenspartner und minderjährige Kinder sind auf dem Meldeschein nur der Zahl nach anzugeben."* (§ 29 (2) S. 2) — count only, no names. [S1]
- Tour groups > 10 persons: only the tour leader signs and gives the number and nationalities of the foreign co-travellers (§ 29 (2) S. 3). [S1]
- Everyone named on the form must show a valid passport or passport substitute (§ 29 (3)); the operator must compare the form against the ID and note discrepancies or a missing/invalid ID on the form (§ 30 (2) S. 2–4). [S1][S2]

### 1.4 Retention and deletion

- § 30 (4) S. 1: *"...die ausgefüllten Meldescheine vom Tag der Abreise der beherbergten Person an **ein Jahr aufzubewahren** und **innerhalb von drei Monaten** nach Ablauf der Aufbewahrungsfrist zu vernichten."* S. 2 applies the same periods to electronically collected § 29 (5) data. [S2]
- So: hard delete between day 365 and day 455 after departure. Authorities may demand inspection of hand-signed forms or machine-readable provision of electronic data (§ 30 (4) S. 3). [S2]
- Fines (§ 54 (2) Nr. 7–10, (3)): guest not signing, operator not keeping forms available, not retaining ≥ 1 year, not presenting on request — up to EUR 1,000 each. [S3]

### 1.5 Electronic completion and signature — what the law actually permits

**Verdict: a handwritten signature captured on an iPad/signature pad does NOT satisfy BMG § 29 (2), and it is not one of the § 29 (5) electronic procedures either.**

Legal basis:

- § 29 (2) demands a *handschriftlich* signature on a *Meldeschein* (paper). [S1]
- § 29 (5) S. 1 is the only statutory substitute: with the guest's consent, data are collected electronically and the guest confirms correctness on the day of arrival by **one of three** means:
  1. *"einen kartengebundenen Zahlungsvorgang mit einer starken Kundenauthentifizierung im Sinne des § 1 Absatz 24 des Zahlungsdiensteaufsichtsgesetzes auslöst, bei dem die zweckgebundene Zuordnungsnummer des eingesetzten Zahlungsmittels erhoben wird,"*
  2. *"den elektronischen Identitätsnachweis nach § 12 des eID-Karte-Gesetzes oder nach § 78 Absatz 5 des Aufenthaltsgesetzes erbringt oder"*
  3. *"ihre eID-Karte nach § 13 des eID-Karte-Gesetzes oder ihren Aufenthaltstitel nach § 78 Absatz 5 des Aufenthaltsgesetzes zum Vor-Ort-Auslesen verwendet."* [S1]
  (References to the German Personalausweis were deleted by BEG IV because Germans are no longer covered. [S9])
- § 29 (5) S. 2–3: an operator **or a provider of electronic registration procedures** may apply to the **BSI** for approval of a different procedure for up to five years, provided data are collected electronically with consent, the guest confirms correctness "in geeigneter Weise" on arrival day, and *"ein vergleichbares Sicherheitsniveau zu den in Satz 1 Nummer 1 bis 3 genannten Verfahren besteht."* [S1] This is the only route by which a signature-on-tablet product could become lawful, and only after BSI approval.
- Administrative position: the DTV FAQ (Stand 23.04.2021), Q7, reports the Bundesinnenministerium's statement of May 2019: *"eine einfache elektronische Unterschrift, z.B. auf einem Touchpad o.ä. genügt nicht den Formerfordernissen eines elektronischen Meldescheins."* and *"Von dem bundesgesetzlichen Erfordernis der handschriftlichen Unterschrift kann aus Sicht des Bundesinnenministeriums in einem Bundesland nicht abgewichen werden."* Mecklenburg-Vorpommern's earlier tolerance is expressly described as no legitimation. [S4] (The BMI letter itself was not located online — the BMI position is **UNVERIFIED at primary level**, but the statutory wording "handschriftlich" plus the closed list in § 29 (5) is unambiguous on its own.)
- Guest choice: the guest cannot be forced into the electronic procedure; if they decline, the paper form with handwritten signature must be offered (§ 29 (5) "mit Zustimmung"; DTV Q8/Q9). If the guest refuses even that, only the guest is fined; the operator has discharged its duty by keeping forms available (§ 30 (1), § 54 (2) Nr. 7). [S1][S3][S4]

**What the § 29 (5) electronic procedure requires of the software (BeherbMeldV):** [S5]

- One data record per foreign guest, stored completely on the day of arrival (§ 2 (1)).
- Format: XML, UTF-8, per an XSD the BMI publishes in the Bundesanzeiger (§ 2 (2)).
- File name `JJJJMMTT_BeherbMeldeschein_Zaehler.xml`, counter restarting at 1 each day; stored in year/month folders (§ 2 (3)–(4)).
- Field identifiers per Anlage: `DatumAnkunft`, `DatumAbreise`, `Familienname`, `Vornamen`, `Geburtsdatum`, `Staatsangehoerigkeiten`, `Anschrift` (structured: Staat, PLZ, Ort, Ortszusatz, Straße, Hausnummer, Ergänzung), `AnzahlAngehoerige`, `AnzahlMitreisende`, `StaatsangehoerigkeitMitreisende`, `SeriennummerPass`, `Zahlungszuordnungsnummer` (*"Token ... und ... Namen des Zahlungsdienstleisters ... der den Token generiert"*), `Beherbergungsstaette`. [S5]
- On request, records must be made available for inspection and copied to a data carrier (§ 3). [S5]
- GDPR Art. 24/25/32 technical-organisational measures are mandated by BMG § 30 (5) for electronic procedures. [S2]

**Practical implication for the "push Meldeschein to guest iPad" feature (Germany):**

| Guest | What the iPad flow may do | What still has to happen |
|---|---|---|
| German national | Nothing required by BMG since 1.1.2025. Any signature is purely contractual/Kurtaxe. | Kurtaxe registration if the municipal Satzung requires it (§ 3). |
| Foreign national, paper route | Guest may type name/address on the iPad to **pre-fill** the form. | Form must be **printed and signed by hand** on arrival day; paper kept 1 year (+ ≤ 3 months). A tablet signature image is legally void as a Meldeschein signature. |
| Foreign national, § 29 (5) Nr. 1 | Guest enters data on iPad, consents, then pays/authorises by card **with SCA** on a terminal/online flow; PMS stores the PSP token + PSP name in the BeherbMeldV XML. | No signature at all. SCA must actually occur (chip+PIN, 3-DS); a card-on-file charge without SCA does not qualify. |
| Foreign national, § 29 (5) Nr. 2/3 | eID / eAT online proof or on-site chip read. | Needs eID reader integration; realistic only for EU eID-card holders and German residence-permit holders. |
| Any, BSI pilot | Signature-on-tablet could be part of a BSI-approved procedure. | Requires an application and approval under § 29 (5) S. 2; not available at launch. |

### 1.6 Landesrecht

BeherbMeldV § 2 (6): *"Landesrechtliche Vorgaben zur Ausführung des Bundesmeldegesetzes bleiben unberührt."* [S5] The Länder's Ausführungsgesetze (e.g. BayAGBMG, SächsAGBMG cited by the DTV FAQ [S4]) name the competent authorities and may add Kurtaxe fields under § 30 (3). No Land may relax the federal signature rule (BMI position, [S4]).

### 1.7 Austria (Meldegesetz 1991 + MeldeV) — differences

- **All guests, including Austrians**, must register: MeldeG § 5 (1): *"Wer als Gast in einem Beherbergungsbetrieb Unterkunft nimmt, hat sich unverzüglich, jedenfalls aber innerhalb von 24 Stunden nach dem Eintreffen im Beherbergungsbetrieb anzumelden."* [S6]
- Fields (§ 5 (1) S. 2): Vor- und Familiennamen, Geburtsdatum, Geschlecht, Staatsangehörigkeit, Herkunftsland, Adresse samt PLZ; for foreign guests additionally Art, Nummer, Ausstellungsdatum, ausstellende Behörde des Reisedokuments. Registration is complete only when *"der Meldepflichtige die Richtigkeit der Daten mit seiner Unterschrift bestätigt hat."* Departure must be recorded. [S6]
- Family: one member registers and names co-travellers (name + DOB). Groups ≥ 8: leader signs a list; valid only if the group stays ≤ 2 weeks together (§ 5 (3)). Stays > 2 months trigger ordinary registration (§ 5 (2)). [S6]
- Gästeverzeichnis (§ 10): must contain § 5 data plus arrival/departure; **retained 7 years** from entry; authorities may inspect at any time; electronic systems must provide printouts or remote transmission on demand. [S7]
- **Electronic signature is expressly allowed.** MeldeV § 19 (2): data enter the electronic Gästeverzeichnis by *"1. elektronisches Festhalten des Schriftbildes ... einschließlich der geleisteten Unterschrift (elektronische Einbringung durch Scannen) oder 2. elektronisches Erfassen der Meldedaten und Übernahme der **elektronisch erfassten Unterschrift** oder 3. elektronische Einbringung mit qualifizierter elektronischer Signatur."* [S8] → A guest signing on an iPad is lawful in Austria (Nr. 2).
- Entries must match Anlage A content and carry *"eine laufende, nicht veränderbare Nummerierung"* (§ 19 (3)); state-of-the-art access protection; automated data stored 7 years then deleted (§ 19 (4)). [S8]
- No card-payment/eID substitute exists in Austria; the signature is the confirmation.

### 1.8 Switzerland — differences

- Federal law covers **foreign guests only**: AIG Art. 16: *"Wer Ausländerinnen oder Ausländer gewerbsmässig beherbergt, muss sie der zuständigen kantonalen Behörde melden."* [S10] VZAE Art. 18 (1): *"...einen Meldeschein gemäss den Angaben im Ausweispapier auszufüllen und diesen von der beherbergten Person unterschreiben zu lassen. ... Der Meldeschein ist der zuständigen kantonalen Behörde zu übermitteln."* Groups: list signed by the tour leader (Art. 18 (2)). [S11] (Stand 1 Jan 2025.)
- Cantons set the procedure and may go further. Zürich's Polizeigesetz § 21 (4) requires a Gästekontrolle and Meldescheine for **all** guests (City of Zürich page; electronic submission via Kantonspolizei). [S12]
- Signature form: the federal text says "unterschreiben"; whether a tablet signature counts is a cantonal-practice question — **UNVERIFIED**. The Bundesrat opened a consultation on 26 Aug 2026 (until 27 Nov 2026) to amend the VZAE so that *"die Beherbergenden die Meldung den Behörden auch elektronisch und ohne Unterschrift des Gastes übermitteln können"*, on the EasyGov platform. [S13] Until adopted, plan for a signature.
- No federal retention period for the Meldeschein was found — cantonal; **UNVERIFIED**.

---

## 2. Tourist taxes

### 2.1 Germany: two different instruments

**Kurtaxe / Kurbeitrag (Gebühr/Beitrag under the Länder's Kommunalabgabengesetze)** — levied by recognised Kur-/Erholungsorte via municipal Satzung. Example Bayern KAG Art. 7: liable are persons staying in the recognised area for Kur-/Erholungszwecke without main residence there; the Satzung may exempt for important reasons; hosts *"können ... verpflichtet werden ... diese Personen der Gemeinde zu melden, ferner den Beitrag einzuziehen und an die Gemeinde abzuführen"*, may be required to transmit data electronically, and are jointly and severally liable. [S14] Amount is a per-person-per-night fixed sum set in each Satzung (varies by season, age, disability etc.) — **product must treat it as a configurable per-municipality table, not a formula.** BMG § 30 (3) lets Länder add Kurtaxe fields to the Meldeschein. [S2]

**Übernachtungsteuer / Bettensteuer / City Tax (örtliche Aufwandsteuer, Art. 105 (2a) GG)** — BVerfG, 22 March 2022, 1 BvR 2868/15 et al.: constitutional; described as *"einen niedrigen Prozentsatz des Preises einer ... Übernachtung (Nettoentgelt)"*; the *Beherbergungsbetrieb* is *Steuerschuldner* and remits. [S15]

Concrete examples (each city has its own law; treat as configuration):

| City | Rate / basis | Business travel | Filing | Source |
|---|---|---|---|---|
| Berlin | 7.5 % of *Nettoentgelt* for the overnight stay, excluding VAT, the tax itself, and separately charged non-accommodation services (breakfast, minibar, parking, telecoms); ancillary accommodation charges (cleaning, linen, extra bed) are included. Only the first 21 consecutive nights in the same establishment are taxed (§ 1 (3) ÜnStG). | Taxable since 1 Apr 2024 (contracts fixed before that date grandfathered). | Quarterly, electronic, by the 10th day after quarter end (from 2026). | [S16][S17] |
| Hamburg | Fixed step table per person-night on net price: ≤ €10 → 0; ≤ 25 → 0.60; ≤ 50 → 1.20; ≤ 100 → 2.40; ≤ 150 → 3.60; ≤ 200 → 4.80; +1.20 per further started €50 (bookings from 1 Jan 2025). Hotel is Steuerschuldner; may but need not pass on. No exemptions (minors included); records of names and length of stay kept **4 years** from end of the year; separate invoice line not required. | Taxable since 1 Jan 2023. | Quarterly (annual if < €1,000). | [S18] |

### 2.2 Austria (Ortstaxe / Nächtigungsabgabe — Landesrecht)

Vienna (WTFG): all paying guests owe Ortstaxe (§ 11); base = accommodation price **excluding VAT and breakfast "im ortsüblichen Ausmaß"** (§ 12); rate 3.2 % until 30 Jun 2026, **5 % from 1 Jul 2026**, 8 % from 1 Jul 2027 (§ 14, as consolidated on jusline; the staging was reported by WKO/ÖHV). Exempt: minors at school/vocational training in Vienna, students at Viennese universities, stays > 3 consecutive months. Operators must register each property electronically with the Magistrat within two weeks (§ 15 (1)). [S19][S20][S21][S22] Other Länder use per-person-per-night amounts set by Landesgesetz/Gemeinde — **UNVERIFIED specifics; configure per property.**

### 2.3 Switzerland

Kurtaxe/Beherbergungsabgabe is cantonal/communal; amounts are per person-night and vary by Gemeinde. Zürich's "City Tax" (CHF 3.50/person-night) is reported as a voluntary industry levy, not a statute — **UNVERIFIED**. [S23] Treat as a per-property configurable line.

---

## 3. Invoice requirements

### 3.1 Germany — UStG § 14 (4) mandatory contents (verbatim list) [S24]

1. full name and address of supplier **and** recipient;
2. supplier's Steuernummer or USt-IdNr.;
3. issue date;
4. *"eine fortlaufende Nummer mit einer oder mehreren Zahlenreihen, die zur Identifizierung der Rechnung vom Rechnungsaussteller einmalig vergeben wird (Rechnungsnummer)"*;
5. quantity and type of goods / scope and type of service;
6. date of supply (or date of payment received if it differs from the invoice date);
7. consideration broken down by tax rate and exemption, plus any agreed reduction;
8. tax rate and tax amount, or reference to the exemption;
9. reference to the recipient's retention duty in § 14b (1) S. 5 cases;
10. the word "Gutschrift" for self-billing.

Advance payments and final invoices: § 14 (5) — a final invoice must deduct pre-paid partial amounts and their tax if invoices were issued for them. [S24]

**Kleinbetragsrechnung (UStDV § 33):** total ≤ **EUR 250** → only supplier name/address, issue date, quantity/type, and gross amount with tax rate (or exemption note). May always be issued as a "sonstige Rechnung" (i.e. no e-invoice format needed). [S25]

**Rates relevant to hotels (UStG § 12 (2)):** Nr. 11 — 7 % for short-term letting of rooms; *"Satz 1 gilt nicht für Leistungen, die nicht unmittelbar der Vermietung dienen, auch wenn diese Leistungen mit dem Entgelt für die Vermietung abgegolten sind"* (Aufteilungsgebot: package prices must be split). Nr. 15 — 7 % for *"Restaurant- und Verpflegungsdienstleistungen, mit Ausnahme der Abgabe von Getränken"* (Steueränderungsgesetz 2025, Bundesrat 19 Dec 2025, effective 1 Jan 2026, permanent). So from 2026: room 7 %, food incl. breakfast 7 %, drinks 19 %, other services (parking, spa, telecoms) 19 %. [S26][S27]

**E-Rechnung:** § 14 (1) defines an *elektronische Rechnung* as one *"in einem strukturierten elektronischen Format ausgestellt, übermittelt und empfangen wird"* (EN 16931 / XRechnung / ZUGFeRD). Transitional § 27 (38): for domestic B2B supplies, paper or non-structured formats remain allowed for supplies executed until 31 Dec 2026; until 31 Dec 2027 if the issuer's prior-year turnover ≤ EUR 800,000; from 2028 structured e-invoices are mandatory B2B. [S24][S28] B2C (private guests) is unaffected. **The PMS must be able to emit XRechnung/ZUGFeRD for corporate accounts by 2027/2028** and must be able to receive them from 1 Jan 2025 (receiving duty stated in BMF letter of 15 Oct 2024 — **UNVERIFIED**, not fetched).

**Retention:** UStG § 14b (1): *"...acht Jahre aufzubewahren"* (copies of issued invoices and all received invoices); AO § 147 (3): 8 years for Buchungsbelege, 10 years for books/records/inventories/annual accounts, 6 years for other documents. Both reduced from 10 to 8 by BEG IV effective 1 Jan 2025 for invoices whose period had not yet expired on 31 Dec 2024 (UStG § 27 (40)). [S29][S30][S9][S28]

### 3.2 GoBD immutability and numbering (BMF 28 Nov 2019, as amended 11 Mar 2024 and 14 Jul 2025) [S31][S32]

- AO § 146 (4): *"Eine Buchung oder eine Aufzeichnung darf nicht in einer Weise verändert werden, dass der ursprüngliche Inhalt nicht mehr feststellbar ist."* [S33] GoBD Rz. 58 repeats this; Rz. 59: changes and deletions of electronic bookings *"müssen daher so protokolliert werden"*; explicitly applies "sinngemäß" to retained electronic documents such as invoices; Example 4 (Rz. 59) requires **historised master data** so an old invoice can be re-rendered with the customer name and tax rate valid at the time. [S31]
- Rz. 48: cash receipts and payments recorded **daily** (§ 146 (1) S. 2 AO). [S31]
- Rz. 64: *"Korrektur- bzw. Stornobuchungen müssen auf die ursprüngliche Buchung rückbeziehbar sein."* → no editing of issued invoices; only credit notes/Storno referencing the original. [S31]
- Rz. 68–69: Belegsicherung by *"laufende Nummerierung"*; for electronic invoices *"kann die laufende Nummerierung automatisch vergeben werden (z. B. durch eine eindeutige Belegnummer)"*. Combined with UStG § 14 (4) Nr. 4: invoice numbers unique and sequential (gaps must be explainable; several number ranges allowed). [S31][S24]
- Rz. 151–153: a **Verfahrensdokumentation** per DV system describing content, structure, flow and results, understandable to an expert third party within reasonable time. [S31]

### 3.3 Austria and Switzerland (brief)

- AT UStG 1994 § 11 (1) Z 3: same core content (name/address of both parties, quantity/type, date, consideration and rate, tax amount, issue date, *fortlaufende Nummer*, UID). Kleinbetragsrechnung threshold **EUR 400** (§ 11 (6)). Accommodation rate **10 %** (§ 10 (2) Z 3 lit. c: *"die Beherbergung in eingerichteten Wohn- und Schlafräumen und die regelmäßig damit verbundenen Nebenleistungen"*), standard 20 %. Records/receipts kept 7 years (BAO § 132a). [S34][S35][S36]
- CH: MWSTG Art. 25 — standard 8.1 %, reduced 2.6 %, **Sondersatz Beherbergung 3.8 %** (incl. breakfast) since 1 Jan 2024. [S37] Invoice content per MWSTG Art. 26 — **UNVERIFIED** (not fetched). QR-bill for payment slips — **UNVERIFIED**.

---

## 4. Does KassenSichV / TSE apply to hotel front-desk cash handling?

**Yes, as soon as the PMS can record a cash (or cash-equivalent) payment.**

- AO § 146a (1): anyone who records business transactions with an *elektronisches Aufzeichnungssystem* must use one that records each transaction individually, completely, correctly, timely and orderly, protected by a *zertifizierte technische Sicherheitseinrichtung* (security module, storage medium, uniform digital interface). [S38]
- KassenSichV § 1 (1): covers *"elektronische oder computergestützte Kassensysteme oder Registrierkassen"* (incl. app-based); excludes ticket machines, ATMs, vending machines, EC terminals, and *"elektronische Buchhaltungsprogramme"* (accounting software without cash function). [S39]
- AEAO zu § 146a Nr. 1.2 (BMF 30 Jun 2023): *"Kassenfunktion haben elektronische Aufzeichnungssysteme dann, wenn diese der Erfassung und Abwicklung von zumindest teilweise baren Zahlungsvorgängen dienen können. Dies gilt auch für vergleichbare elektronische, vor Ort genutzte Zahlungsformen ... sowie an Geldes statt vor Ort angenommener Gutscheine, Guthabenkarten, Bons und dergleichen. Eine Aufbewahrungsmöglichkeit des verwalteten Bargeldbestandes (z. B. Kassenlade) ist nicht erforderlich."* [S40]
- BMF FAQ, "Sind Barverkaufsfunktionen beispielsweise in einer Warenwirtschafts- oder Hotelsoftware per TSE zu schützen?": *"Sobald die Systeme in der Lage sind, bare Zahlungsvorgänge zu erfassen und abzuwickeln, fällt der entsprechende Teil der Software ... unter die Anforderungen des § 146a AO"*; capability, not actual use, is decisive; conversely *"Wenn das System keine baren Zahlungsvorgänge vor Ort ermöglicht, muss das System nicht über eine TSE verfügen."* [S41]
- Therefore the v1 design choice is binary: (a) **card/transfer-only PMS with no cash and no voucher redemption at the desk → no TSE**, or (b) any cash/voucher acceptance → the PMS is a Kassensystem and needs: a BSI-certified TSE (cloud TSE acceptable — **UNVERIFIED** as to specific certification), Belegausgabepflicht (§ 146a (2); electronic receipts permitted, "technologieneutral" [S41]), receipt content per KassenSichV § 6 (incl. TSE serial number, transaction counter, signature counter, Prüfwert, human-readable or QR) [S39], **DSFinV-K** export per § 4 KassenSichV (current version 2.4, Jan 2024; 2.3 still accepted) [S42], and **registration of the system with the tax office** via ELSTER under § 146a (4) within one month of acquisition/decommissioning (regime live since 1 Jan 2025; legacy systems were due by 31 Jul 2025) [S38][S43].
- Austria: BAO § 131b Registrierkassenpflicht when annual turnover > EUR 15,000 **and** cash turnover > EUR 7,500; "Bar" includes debit/credit cards and vouchers; each receipt signed via Sicherheitseinrichtung (RKSV). BAO § 132a: receipt for every cash payment, with sequential number. [S44][S36] → In Austria even a card-only front desk is a Registrierkasse.
- Switzerland: no fiscalisation regime found — **UNVERIFIED**.

---

## 5. GDPR retention for guest data

Principles: Art. 5 (1) (c) data minimisation and (e) storage limitation; lawful bases Art. 6 (1) (b) contract and (c) legal obligation; Art. 17 (1) erasure when no longer necessary, but Art. 17 (3) (b) excepts processing *"zur Erfüllung einer rechtlichen Verpflichtung"*; Art. 30 record of processing. [S45] Applied to a PMS, the statutory clocks are:

| Data class | Period | Legal basis |
|---|---|---|
| BMG Meldeschein (DE, foreign guests) / BeherbMeldV XML | 1 year after departure, destroy within the following 3 months | BMG § 30 (4) [S2] |
| Gästeverzeichnis (AT, all guests) | 7 years, then delete | MeldeG § 10 (2), MeldeV § 19 (4) [S7][S8] |
| Invoices (issued and received) and Buchungsbelege | 8 years from end of the calendar year | UStG § 14b (1), AO § 147 (3) [S29][S30] |
| Books, journals, annual accounts | 10 years | AO § 147 (3) [S30] |
| Übernachtungsteuer records (Hamburg: names + length of stay + business-purpose proof) | 4 years from end of year | HH Merkblatt Nr. 16 [S18] |
| Kurtaxe records | per Satzung — **UNVERIFIED** | KAG + Satzung |
| Everything else (reservation profile, preferences, marketing) | only as long as the purpose lasts; needs consent or legitimate interest; erase on request | GDPR Art. 5 (1) (e), 6, 17 [S45] |

Design consequence: the guest profile must support **partial erasure / anonymisation** that keeps the invoice (name + address are mandatory invoice content under § 14 (4) Nr. 1 and cannot be pseudonymised for 8 years) while purging Meldeschein data at 12–15 months and non-essential profile data on request. Card data: PCI DSS (contractual, not statutory) — store tokens only (this also feeds BMG § 29 (5) Nr. 1).

---

## 6. DATEV export conventions

- Target format: **DATEV-Format "Buchungsstapel" (EXTF, Datenkategorie 21)**, CSV, one file per period (typically month); official spec on developer.datev.de (login required; not retrievable here). [S46]
- From a published sample export [S47]: line 1 header `"EXTF";700;21;"Buchungsstapel";13;<timestamp>;;"<Herkunft>";"<Benutzer>";;<Beraternummer>;<Mandantennummer>;<WJ-Beginn JJJJMMTT>;<Sachkontenlänge>;<Datum von JJJJMMTT>;<Datum bis>;"<Bezeichnung>";;1;;0;"EUR";...`; line 2 column names; data columns start `Umsatz (ohne Soll/Haben-Kz);Soll/Haben-Kennzeichen;WKZ Umsatz;Kurs;Basisumsatz;WKZ Basisumsatz;Konto;Gegenkonto (ohne BU-Schlüssel);BU-Schlüssel;Belegdatum;Belegfeld 1;Belegfeld 2;Skonto;Buchungstext;...` with `Festschreibung` further right. Sample row: `24,95;"H";;;;;1200;4940;"8";2102;;;;"Fachbuch ...";` → amount with **decimal comma**, S/H flag, semicolon separator, Belegdatum **TTMM** without year (year comes from the header period). [S47]
- Field lengths commonly cited (Belegfeld 1 ≤ 36 chars = invoice number; Buchungstext ≤ 60; Konto/Gegenkonto numeric up to 9 digits; ANSI/Windows-1252 encoding) — **UNVERIFIED** against the official spec; validate with the tax advisor's DATEV import before release.
- Conventions the export must honour: one booking line per tax rate per invoice (room 7 %, food 7 %, drinks 19 %, Übernachtungsteuer/Kurtaxe as pass-through or separate revenue account per advisor), revenue accounts per SKR03/SKR04 chart chosen by the client's advisor (configurable mapping, not hard-coded), BU-Schlüssel or Automatikkonten for VAT, Belegfeld 1 = invoice number (links to GoBD Belegnummer), Festschreibung flag = 1 once the period is closed (GoBD immutability). SKR account numbers themselves — **UNVERIFIED** here; take from the client's advisor.

---

## Requirements the v1 spec must satisfy

1. **Nationality gate:** at check-in, determine each guest's nationality; German nationals get no BMG Meldeschein (BEG IV, 1.1.2025). Foreign nationals do. [S1][S9]
2. **Meldeschein content = exactly BMG § 30 (2) fields** (+ Land Kurtaxe fields where configured); no other fields on the form. Spouse/partner/minor children as a count only; groups > 10 via tour leader. [S1][S2]
3. **iPad flow, Germany:** the guest-facing iPad may collect data and a signature, but the signature image is **not** a valid Meldeschein signature. v1 must either (a) print the pre-filled form for a **handwritten** signature, or (b) implement BMG § 29 (5) Nr. 1: consent + SCA card transaction on arrival day + store PSP token and PSP name + write the BeherbMeldV XML. Do not ship a tablet-signature-only Meldeschein for foreign guests in Germany. [S1][S4][S5]
4. **BeherbMeldV output:** XML per BMI XSD, UTF-8, filename `JJJJMMTT_BeherbMeldeschein_Zaehler.xml`, year/month folder layout, all 13 identifiers, exportable to a data carrier on demand. [S5]
5. **Meldeschein retention job:** keep 1 year after departure, hard-delete within the following 3 months; log the deletion; authorities can request inspection/machine-readable copy in that window. [S2]
6. **ID verification step:** operator compares form to passport, records discrepancies or "no valid ID". [S2]
7. **Austria mode:** Meldeschein for **all** guests within 24 h; AT field set (incl. Geschlecht, Herkunftsland, travel-document data for foreigners); **electronic signature on iPad is valid** (MeldeV § 19 (2) Nr. 2); immutable sequential numbering; 7-year retention then deletion; printout/remote export for authorities. [S6][S7][S8]
8. **Switzerland mode:** Meldeschein for foreign guests (all guests where the canton says so, e.g. ZH); signature required until the VZAE amendment is adopted; cantonal transmission channel configurable. [S10][S11][S12][S13]
9. **Tourist-tax engine:** per-property configurable rules covering (a) percentage of net room price excluding VAT/breakfast/other services with night caps (Berlin 7.5 %, 21 nights; Vienna 5 % from 1.7.2026), (b) stepped per-person-night tables on net price (Hamburg), (c) flat per-person-night Kurtaxe with age/season exemptions (KAG Satzungen); business-travel exemption flags where a city still has one; per-guest exemption reasons; quarterly Steueranmeldung reports; record of guest names and nights retained ≥ 4 years. [S14]–[S22]
10. **Invoice content:** all UStG § 14 (4) items; unique sequential invoice numbers (gap-free per number range); Kleinbetragsrechnung layout for ≤ EUR 250 (AT: ≤ EUR 400); VAT split room 7 % / food 7 % / drinks 19 % / other 19 % (AT 10 %/20 %; CH 3.8 %/8.1 %); deposit/final-invoice netting per § 14 (5). [S24][S25][S26][S34][S37]
11. **GoBD:** issued invoices immutable; corrections only via Storno/credit note referencing the original; audit log of all changes; historised master data (customer name, tax rates) so any invoice re-renders identically; daily cash closing; Verfahrensdokumentation delivered with the product. [S31][S33]
12. **Retention:** invoices and booking vouchers 8 years (AO/UStG), books 10 years; guest-profile erasure must preserve invoice-mandatory fields for 8 years while purging everything else. [S29][S30][S45]
13. **E-Rechnung:** XRechnung/ZUGFeRD output for corporate (B2B) invoices by 1 Jan 2027 (all issuers by 2028); ability to ingest structured e-invoices from suppliers. [S24][S28]
14. **Cash decision:** either declare v1 card/transfer-only (no cash, no voucher redemption at desk → no TSE) or integrate a BSI-certified TSE, DSFinV-K export, § 6 KassenSichV receipt fields, electronic receipt delivery, and ELSTER § 146a (4) registration data. In Austria, RKSV (signed receipts) applies to card payments too, so the AT variant cannot avoid fiscalisation. [S38]–[S44]
15. **DATEV Buchungsstapel export:** EXTF header, semicolon CSV, decimal comma, TTMM Belegdatum, S/H flag, per-tax-rate lines, configurable account mapping, Belegfeld 1 = invoice number, Festschreibung on period close; verify against the official spec with a pilot client's advisor. [S46][S47]
16. **Card data:** tokens only (PCI); the SCA token is also the BMG § 29 (5) Nr. 1 evidence. [S1][S5]

---

## Sources

Primary (statutes, regulations, official guidance):

- [S1] BMG § 29 — https://www.gesetze-im-internet.de/bmg/__29.html
- [S2] BMG § 30 — https://www.gesetze-im-internet.de/bmg/__30.html
- [S3] BMG § 54 (Bußgeld) — https://www.gesetze-im-internet.de/bmg/__54.html
- [S4] Deutscher Tourismusverband, "FAQ: Elektronischer Meldeschein – Möglichkeiten und Hindernisse", Stand 23.04.2021 (reports BMI statement of May 2019; industry body, not the ministry itself) — https://www.deutschertourismusverband.de/fileadmin/user_upload/Themen/Politik/FAQ_Elektronischer_Meldeschein.pdf
- [S5] BeherbMeldV §§ 1–4 and Anlage — https://www.gesetze-im-internet.de/beherbmeldv/ (§ 2: https://www.gesetze-im-internet.de/beherbmeldv/__2.html ; Anlage: https://www.gesetze-im-internet.de/beherbmeldv/anlage.html)
- [S6] AT Meldegesetz 1991 § 5 — https://www.jusline.at/gesetz/meldeg/paragraf/5 (RIS consolidated: https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10005799)
- [S7] AT Meldegesetz 1991 § 10 — https://www.jusline.at/gesetz/meldeg/paragraf/10
- [S8] AT Meldegesetz-Durchführungsverordnung § 19 — https://www.jusline.at/gesetz/meldev/paragraf/19
- [S9] BGBl. 2024 I Nr. 323 (Viertes Bürokratieentlastungsgesetz), Art. 3 (AO), Art. 5 (UStG), Art. 6 (BMG), Art. 74 (Inkrafttreten) — https://www.recht.bund.de/bgbl/1/2024/323/regelungstext.pdf
- [S10] CH AIG Art. 16 (SR 142.20, Stand 1.1.2025) — https://www.fedlex.admin.ch/eli/cc/2007/758/de (PDF: https://www.fedlex.admin.ch/filestore/fedlex.data.admin.ch/eli/cc/2007/758/20250101/de/pdf-a/fedlex-data-admin-ch-eli-cc-2007-758-20250101-de-pdf-a.pdf)
- [S11] CH VZAE Art. 18 (SR 142.201, Stand 1.1.2025) — https://www.fedlex.admin.ch/eli/cc/2007/759/de (PDF: https://www.fedlex.admin.ch/filestore/fedlex.data.admin.ch/eli/cc/2007/759/20250101/de/pdf-a/fedlex-data-admin-ch-eli-cc-2007-759-20250101-de-pdf-a.pdf)
- [S12] Stadt Zürich, "Für Beherbergende" (PolG ZH § 21 Abs. 4) — https://www.stadt-zuerich.ch/de/stadtleben/veranstaltungen-und-bewilligungen/gastgewerbe/fuer-beherbergende.html
- [S13] Bundesrat press release, 26 Aug 2026, "Bund will Meldewesen in der Beherbergung digitalisieren" — https://www.admin.ch/de/newnsb/STwblroLhJ4-
- [S14] Bayerisches KAG Art. 7 (Kurbeitrag) — https://www.gesetze-bayern.de/Content/Document/BayKAG-7
- [S15] BVerfG press release 40/2022 on 1 BvR 2868/15 et al. (22 Mar 2022) — https://www.bundesverfassungsgericht.de/SharedDocs/Pressemitteilungen/DE/2022/bvg22-040.html ; decision: https://www.bundesverfassungsgericht.de/SharedDocs/Entscheidungen/DE/2022/03/rs20220322_1bvr286815.html
- [S16] Berlin Übernachtungsteuer, service portal (7.5 %, quarterly, electronic) — https://service.berlin.de/dienstleistung/326105/
- [S17] Senatsverwaltung für Finanzen Berlin FAQ "Übernachtungssteuer für Geschäftsreisende ab April 2024", Stand 02.07.2024 (hosted by DEHOGA Berlin) — https://dehoga-berlin.de/wp-content/uploads/2024/11/City-Tax-FAQs-ab-April-2024_Stand-081024.pdf
- [S18] Freie und Hansestadt Hamburg, Finanzbehörde, "Merkblatt Kultur- und Tourismustaxe", Stand Juli 2025 — https://www.hamburg.de/resource/blob/207446/c1d8916ebdf1fdd33e6f781cdf75a3c7/ktt-merkblatt-data.pdf
- [S19] Wiener Tourismusförderungsgesetz § 11 — https://www.jusline.at/gesetz/wtfg/paragraf/11
- [S20] WTFG § 12 — https://www.jusline.at/gesetz/wtfg/paragraf/12
- [S21] WTFG § 14 — https://www.jusline.at/gesetz/wtfg/paragraf/14 ; § 15 — https://www.jusline.at/gesetz/wtfg/paragraf/15
- [S22] WKO Wien, "Aktuelle Wiener Ortstaxe" (secondary, for the 3.2 % → 5 % → 8 % staging) — https://www.wko.at/wien/tourismus-freizeitwirtschaft/hotellerie/aktuelle-ortstaxe-wien
- [S23] htr.ch report on Zürich City Tax CHF 3.50 (secondary) — https://www.htr.ch/story/people-events/zuercher-hotellerie-praesidentenwechsel-und-citytax-erhoehung-37310
- [S24] UStG § 14 — https://www.gesetze-im-internet.de/ustg_1980/__14.html
- [S25] UStDV § 33 — https://www.gesetze-im-internet.de/ustdv_1980/__33.html
- [S26] UStG § 12 — https://www.gesetze-im-internet.de/ustg_1980/__12.html
- [S27] Bundesregierung, "Entlastungen für Pendler und Gastronomie" (Steueränderungsgesetz 2025, Bundesrat 19 Dec 2025) — https://www.bundesregierung.de/breg-de/aktuelles/steueraenderungsgesetz-bundesrat-2383684
- [S28] UStG § 27 (38), (40) — https://www.gesetze-im-internet.de/ustg_1980/__27.html
- [S29] UStG § 14b — https://www.gesetze-im-internet.de/ustg_1980/__14b.html
- [S30] AO § 147 — https://www.gesetze-im-internet.de/ao_1977/__147.html
- [S31] BMF, GoBD, 28 Nov 2019 (Rz. 48, 58–60, 61–71, 151–153) — https://www.datev.de/content/dam/markenassets/themen-und-produktgruppen/zielgruppen/zielgruppenuebergreifend/gobd/bmf_gobd_neufassung_2019.pdf (BMF original URL currently blocked by bot protection)
- [S32] BMF, GoBD amendments 11 Mar 2024 and 14 Jul 2025 — https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Weitere_Steuerthemen/Abgabenordnung/AO-Anwendungserlass/2024-03-11-aenderung-gobd.pdf ; https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Weitere_Steuerthemen/Abgabenordnung/2025-07-14-GoBD-2-aenderung.pdf
- [S33] AO § 146 — https://www.gesetze-im-internet.de/ao_1977/__146.html
- [S34] AT UStG 1994 § 11 — https://www.jusline.at/gesetz/ustg/paragraf/11
- [S35] AT UStG 1994 § 10 — https://www.jusline.at/gesetz/ustg/paragraf/10
- [S36] AT BAO § 132a — https://www.jusline.at/gesetz/bao/paragraf/132a
- [S37] ESTV, MWST-Steuersätze — https://www.estv.admin.ch/estv/de/home/mehrwertsteuer/mwst-steuersaetze.html
- [S38] AO § 146a — https://www.gesetze-im-internet.de/ao_1977/__146a.html
- [S39] KassenSichV — https://www.gesetze-im-internet.de/kassensichv/BJNR351500017.html
- [S40] BMF, AEAO zu § 146 und § 146a, 30 Jun 2023 (Nr. 1.2 Kassenfunktion) — https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Weitere_Steuerthemen/Abgabenordnung/AO-Anwendungserlass/2023-06-30-AEAO-Par-146-AO.pdf
- [S41] BMF FAQ "Das Kassengesetz für mehr Steuergerechtigkeit" (Hotelsoftware question) — https://www.bundesfinanzministerium.de/Content/DE/FAQ/FAQ-steuergerechtigkeit-belegpflicht.html
- [S42] BZSt, DSFinV-K — https://www.bzst.de/DE/Unternehmen/Aussenpruefungen/DigitaleSchnittstelleFinV/digitaleschnittstellefinv_node.html
- [S43] BMF letter 28 Jun 2024, Mitteilungsverpflichtung § 146a (4) AO (BMF page bot-blocked; text as reproduced by HWK Dresden) — https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Weitere_Steuerthemen/Abgabenordnung/2024-06-28-mitteilungsverpflichtung-nach-AO.pdf ; https://www.hwk-dresden.de/recht/rechtsberatung/steuerrecht/detail/kassenfuehrung-mitteilungsverpflichtung-nach-146a-absatz-4-abgabenordnung-ao.html
- [S44] AT BAO § 131b — https://www.jusline.at/gesetz/bao/paragraf/131b
- [S45] GDPR (DE text) Art. 5, 6, 17, 30 — https://eur-lex.europa.eu/legal-content/DE/TXT/HTML/?uri=CELEX:32016R0679
- [S46] DATEV Developer Portal, DATEV-Format Buchungsstapel (login-gated) — https://developer.datev.de/de/file-format/details/datev-format/format-description/booking-batch
- [S47] Sample EXTF_Buchungsstapel.csv (community sample, structure only) — https://github.com/ledermann/datev/blob/master/examples/EXTF_Buchungsstapel.csv

Not reachable during this research (retry later): BMI XSD announcement https://www.bmi.bund.de/SharedDocs/kurzmeldungen/DE/2020/07/schema-beherbmeldv.html ; HotellerieSuisse Meldeschein page ; BWO "Pflicht zur Meldung von ausländischen Gästen" ; KAG BW § 43.
