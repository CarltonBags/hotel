# Accounting import formats in Austria and Switzerland, and card payout reports

Researched: 2026-09-29. Scope: what the v1 accounting export must carry to serve tax advisors and hotels in Austria and Switzerland; how the card provider's payout report is structured.
Ticket: `.scratch/hotel-pms-v1/issues/50-accounting-formats-research.md`.

Background not repeated here: `dach-compliance.md` section 6 (German advisor booking-batch format) and the draft decisions in `.scratch/hotel-pms-v1/issues/23-datev-export-mapping.md`.

Every claim cites its source. Points that could not be traced to a primary source are marked **UNVERIFIED**. Vendor documentation behind a login is marked as such.

Method: specifications were downloaded and read as text (RZL manual, Abacus interface references, bexio API reference, Stripe report schemas). Pages that could only be read through a summarising fetch are cited for general statements only; field names, paths and lengths in this document come from the text of the source itself unless marked secondary.

---

## 1. Austria

### 1.1 RZL (RZL Finanzbuchhaltung / EA-Rechnung)

Source: RZL's own interface manual "Handbuch Datenimport", Stand August 2026, 59 pages, published without login on rzlsoftware.at [A1]. The manual carries a copyright notice restricting reproduction; the summary below is for internal design use.

**Ways in** [A1, p. 4–5]:
1. RZL's own data interface (the format below).
2. A user-defined list form ("Listenformen"), not available for bookings or journal lines.
3. **The German advisor format**: RZL states it is a registered interface partner and imports bookings in the "DATEV-CSV Format ab Version 1.4 – gültig seit Mai 2011 mit den Ergänzungen von Oktober 2015". It adds: "Die Unterstützung zusätzlicher (neuerer) Erweiterungen des DATEV-Schnittstellen-Entwicklungs-Leitfadens kann nicht garantiert werden." The older SELF format is deprecated.
4. RZL-built converters for specific third-party programs.

**File format** [A1, p. 8–9]: text file, "ANSI-Format Codepage 1252 (Windows)" is the default (a user-chosen ASCII code page is possible); variable-length fields separated by semicolon; each line ends CR/LF; no separator after the last field; the semicolon must not occur inside text; an empty field may stand for 0. File name is free. The FIBU Next import dialog has an option "Importdatei enthält Spaltenüberschriften" [A2]. Fixed-length records are no longer supported.

**Importable record types** [A1, p. 8]: Buchungen, Salden, Personenkonten, Offene Posten, Journalzeilen (plus cost accounting, account master data and others listed on p. 4).

**Booking record ("Euro-Version"), 41 fields** [A1, p. 11–12]:

| Nr | Field | Length | Mandatory | Content |
|---|---|---|---|---|
| 1 | Kontonummer | 9 n | yes | 1–999999999 |
| 2 | Gegenkonto | 9 n | no | 0 allowed for split and collective bookings |
| 3 | OP-Nummer | 16 n | yes when open items are managed | numeric only; 0 = not tracked as open item |
| 4 | Beleg-Datum | 8 n | yes | TTMMJJJJ |
| 5 | Valuta-Datum | 8 n | no | TTMMJJJJ |
| 6 | Währung | 3 a | yes | ISO code of base currency |
| 7 | Sollbetrag | 13 n | no | decimal comma, minus sign directly before the amount |
| 8 | Habenbetrag | 13 n | no | as above |
| 9 | Steuerbetrag | 13 n | no | must be negative for credit notes and reversals |
| 10–12 | Fremdwährung, FW-Sollbetrag, FW-Habenbetrag | 3 a / 13 n | no | |
| 13 | Kostenstelle | 7 n | no | only on profit-and-loss accounts |
| 14 | Belegkreis | 3 a/n | no | e.g. AR, ER; agreed with the bookkeeper |
| 15 | Belegnummer | 15 a/n (text says max. 16) | no | alphanumeric |
| 16 | USt-Land | 2 n | yes | 1 = Austria |
| 17 | USt-Schlüssel | 2 n | partly | the rate: 10, 13, 20, 49 (4.9 %), 01 export, 02 intra-EU supply, 03 intra-EU service |
| 18 | USt-Code | 1 n | partly | 1 Vorsteuer, 2 MwSt., 3 Erwerbsteuer, 4 non-deductible, 5 reverse charge, 6 deviating input tax |
| 19 | USt-Sondercode | 2 n | no | e.g. 10/12 received deposit, 29 part invoice / deposit invoice, 13 exempt without input tax deduction |
| 20 | Buchungsart | 1 n | yes | 1 line with counter-booking, 2 line of a collective booking, 3 split line, 4 split collective, 5 collective, 6 collective for mandatory accounts |
| 21–23 | Abweichende Zahlungsfrist / Skontofrist / Skontoprozentsatz | | no | |
| 24, 25 | Buchungstext, Buchungstext 2. Zeile | 40 a/n each | no | |
| 26 | UID-Nummer | 14 a/n | partly | mandatory for intra-EU supplies and services |
| 27–29 | Dienstleistungsnummer, -land, -export | | no | |
| 30 | DMS-Schlüssel | 16 a/n | no | obsolete, replaced by field 41 |
| 31 | Kostenträger | 9 n | no | |
| 32 | Fremdbelegnummer | 19 a/n | no | |
| 33, 34 | Wert 1, Wert 2 | 17 n | no | free numeric values |
| 35 | Mahnsperre | 1 n | no | |
| 36 | Zahlungsreferenz | 35 a/n | no | |
| 37 | Belegpfad | 256 a/n | no | path of the document file |
| 38 | Reserviert | | no | empty |
| 39, 40 | OSS-Korrekturzeitraum, OSS-Korrekturart | | no | |
| 41 | DMS-GUID | 36 a/n | no | GUID of a document already in the RZL database |

**Rules that shape the export** [A1, p. 10, 20]:
- Totals must balance: sum of gross = sum of net + sum of tax.
- "Die Sammelbuchungen auf den Debitoren- und Kreditoren-Sammelkonten sowie die Sammel-buchungen auf dem Vorsteuer-, und Mehrwertsteuer-Sammelkonto werden vom Programm durchgeführt und dürfen nicht in der Importdatei enthalten sein." The export therefore carries no VAT account lines; tax travels as an amount plus key on the revenue line.
- An outgoing invoice with one revenue account is two lines: the customer account with the gross amount, and the revenue account with net amount and tax amount. Sample from the manual: `20100;4120;100;15012025;;EUR;12000,00;0,00;0,00;;0,00;0,00;0;AR;100; 1;20;2;0;1;...` and `4120;20100;100;15012025;;EUR;0,00;10000,00;2000,00;;0,00;0,00;0;AR;100; 1;20;2;0;1;...`.
- An invoice with several revenue accounts or tax rates uses a split or collective booking (Buchungsart 2–5).
- A credit note swaps the sides and carries a negative tax amount.
- Received deposits have their own special codes (10, 12) and samples (example 13 in the manual: bank 2800 against customer 20000 with USt-Schlüssel 20, USt-Code 2, Sondercode 12).
- If an account does not exist the import stops until it is created by hand; new debtor accounts can instead be supplied in a Personenkonten file that is read during the booking import. A trial run ("Probelauf") is offered.
- RZL warns that a file can be imported twice by mistake; it offers "Buchungsdatei nach Übernahme löschen" as the guard. There is no batch identifier in the record.

**Tax codes**: rate-based keys, not account-based. Rates listed for Austria: 10 %, 13 %, 20 %, and "49 / 4,9% / Ermäßigter Steuersatz auf ausgewählte Grundnahrungsmittel", which the August 2026 edition names as its reason for re-issue ("Neuer Steuersatz 4,9%") [A1, p. 2, 14]. Whether the 4.9 % rate touches any hotel service (it is described as covering selected basic foodstuffs) is **UNVERIFIED** and belongs to the tax advisor ticket.

**Debtor master record, 19 fields** (up to 26 in FIBU Next) [A1, p. 35–37]: Kontonummer (9 n, mandatory), Kontenart (mandatory; 5 = Debitor I), Fremdwährung, UID-Nummer (14), Anrede, Name (40, mandatory), Straße (40), Ort (25, without postcode), Mahnsperre, three Mahnfristen, Land (postal country letter, "A" for Austria), PLZ (10), Zusatztext (40), Kundennummer (20), Mahnschema, deviating payment term flag and days. Longer texts are cut to the field length. Re-importing an existing account overwrites its master data.

**Chart of accounts**: the manual assumes the Austrian standard chart: "Wird in der Buchhaltung der ÖKR-Kontenplan verwendet, so sind die Sachkonten 4-stellig und die Personenkonten 5-stellig oder 6-stellig". Debtor ranges in that scheme: Debitor I 20000–29999 or 200000–299999; Kreditor I 30000–39999 or 300000–399999 [A1, p. 12, 36].

**Document linking** [A1, p. 19]: field 37 "Belegpfad" takes the path of a .jpg, .pdf or .png. A file in the same folder as the import file needs only its name; a file in a subfolder is given relative to the import file. It requires the licensed module "Belegverarbeitung"; without the licence the booking imports and the path is ignored. Belegpfad, DMS-Schlüssel and DMS-GUID are mutually exclusive.

**Delivery**: a file chosen in the import dialog of the advisor's or the company's RZL installation [A2]. No public upload interface for third-party software was found in RZL's public documentation; **UNVERIFIED** whether RZL's client portal accepts booking files from third-party software.

### 1.2 BMD (BMD NTCS)

**Official specification: not publicly retrievable.** BMD's own site describes the import only through its training catalogue: the seminar "FIBU Standardschnittstellen" covers "unterschiedlichen Dateiformaten (Excel, CSV, TXT, ...)", "Import und Export von Kontenstammdaten", "Import von Salden", "Import vieler verschiedener Buchungsdateien (ER, AR, KA, Lohn, u.v.m.)", "Importmöglichkeiten in der Vorerfassung" and "Import von Buchungen mit Dokumenten" [A3]. The field-level manual ("Schnittstellenhandbuch") is handed out by BMD to customers and partners; no public copy was found on bmd.com in two searches. Everything below on field names comes from third-party integrators that write BMD import files, and is therefore **secondary** and must be confirmed with a pilot advisor's BMD installation.

**File format (secondary)**: semicolon-separated CSV with variable record structure; the booking file has a header row with standard column names, and BMD assigns columns by those names ("da die FIBU aufgrund der Spaltenüberschriften die korrekte Zuordnung selbst ermittelt"). The person-account file has no standard headers; columns are assigned in BMD by a mapping file or by field selection [A4, p. 4, 7]. Encoding, decimal and date format: **UNVERIFIED** (not stated in any source retrieved).

**Booking columns (secondary, from a Business Central connector's documentation)** [A5][A6]:

| Column | Content |
|---|---|
| Satzart | 0 = Fibu-Buchung; 4 = Mehrfachausgleich (payments clearing several invoices) |
| Konto | debtor, creditor or ledger account |
| GKonto | counter-account (revenue or expense account; bank or cash for payments) |
| Belegnr | document number |
| BuchDatum, BelegDatum | posting date, document date |
| BuchSymbol | booking symbol, e.g. AR, ER, EG, BK (bank), KA (cash) |
| BuchCode | 1 = debit booking, 2 = credit booking; the sign of the amount then distinguishes invoice from credit note |
| Steuercode | BMD tax code from the NTCS table |
| Prozent | tax rate |
| Betrag | gross when the leading account is a person account, net when it is a ledger account |
| Steuer | tax amount |
| FWBetrag, Währung | foreign currency amount and code |
| Text | booking text |
| KOST | cost centre |
| Extbelegnr | external document number |
| Nettodatum, Skontodatum, Skontopz, Skonto | payment terms |
| ts-ablauftyp, ts-ablaufnr, ts-ablaufart, ts-versteuerungsart | part-invoice chain: type (1 = part or deposit invoice, 2 = final invoice), chain number, and taxation type (0 = on invoice, 1 = on payment) |
| ausz-Belegnr, ausz-betrag, ausz-skonto | the invoice a payment settles, with amount and discount |
| Dokument | document file |

A second integrator documents the same shape for outgoing invoices: split bookings led by the person account; Satzart fixed 0; Buchungscode 1; tax amount multiplied by −1; booking symbol AR, or AZ for a deposit invoice, GU for a credit note, ST for a cancellation invoice; for credit notes and cancellations all amounts are multiplied by −1 [A4, p. 8]. Account numbers longer than 10 digits are rejected by that exporter [A4, p. 7].

**Tax codes (secondary)**: BMD uses numbered tax codes combined with the rate in a separate column. One integrator's mapping lists: 1 = Umsatzsteuer, 2 = Vorsteuer, 5 = export supplies, 7 = intra-EU supply, 8/9 = intra-EU acquisition, 18/19 = reverse charge inbound, 20 = export-related services, 34 = import VAT, 77A = reverse charge outbound [A7]. A hotel's domestic revenue at 10 %, 13 % or 20 % would therefore be Steuercode 1 with Prozent 10, 13 or 20; this reading is **UNVERIFIED** against BMD's own code table.

**Debtor master data (secondary)**: Konto, Nachname, Vorname, Zusatzname, Matchcode, Strasse, Postleitzahl, Land, Ohne Steuer, Telefonnummer, Faxnummer, E-Mail, Homepage, UID-Nummer, Währung, bank details, IBAN, Swift/Bic, Zahlungsziel, Skonto fields [A4, p. 5].

**Document linking (secondary)**: one document per booking through the Dokument column. One exporter copies the file into a "Dokumente" folder beside the export file, names it after the invoice number, and writes a configurable path so that "die Pfadstruktur bei einem externen Steuerberater" can be reproduced; relative paths are allowed [A4, p. 11]. Another delivers a ZIP holding the CSV and a "receipts" folder with the PDFs, linked by file name [A8].

**Delivery (secondary)**: the hotel sends the file (or ZIP) to the advisor, who imports it in NTCS under FIBU → Buchen → "Import Buchungen", or into "Vorerfassung Buchungen", which needs an extra BMD module; accounts must already exist in the chart [A8][A9].

**German advisor format into BMD**: one invoicing vendor reports that BMD can read it only with import models that are a separately licensed BMD extra; the page could not be retrieved (HTTP 403), so this is **UNVERIFIED** [A10].

### 1.3 The German advisor format in Austria

- The vendor of the German advisor format sells an Austrian standard chart, **SKR 07**, described as "DATEV-Kontenrahmen in Anlehnung an den österreichischen Einheitskontenrahmen", current edition "Stand Juli 2026", with ten account classes 0–9 and accounts with standard labelling and functions [A11]. It also publishes a tax key table for SKR 07 and a document on Austrian account functions and VAT keys [A12][A13]. Both help documents are rendered by script and returned an empty page in two retrieval attempts; **the Austrian tax key numbers are UNVERIFIED**.
- Consequence for the draft in ticket 23: the two shipped German templates (SKR03, SKR04) do not fit an Austrian advisor who works in this product; that advisor would use SKR 07 with its own tax keys. The file structure (header, columns) is the same booking batch; the account numbers and tax keys differ.
- RZL reads the booking batch CSV at the level of interface version 1.4 (May 2011) plus the October 2015 additions and does not guarantee newer extensions [A1, p. 4–5]. An export aimed at RZL through this path should therefore use only the long-established columns.
- BMD reading the booking batch: **UNVERIFIED** (see 1.2).

### 1.4 Charts of accounts in common use in Austria

- **Österreichischer Einheitskontenrahmen (EKR / ÖKR)**: ten classes 0–9. RZL's manual treats it as the default, with 4-digit ledger accounts and 5- or 6-digit person accounts, debtors in 20000–29999 or 200000–299999 [A1, p. 12, 36]. An Austrian tax advisory firm summarises the classes as: 0 fixed assets, 1 inventories, 2 other current assets ("Forderungen, Bank, Kassa"), 3 liabilities and provisions, 4 operating income ("Umsatzerlöse"), 5 materials and purchased services, 6 personnel, 7 depreciation and other operating expenses, 8 financial items and income taxes, 9 opening, closing and capital accounts [A14] (secondary).
- The manual's own samples use revenue accounts 4100 (10 %) and 4120 (20 %), bank 2800, debtors 20100 and 200001 [A1, p. 20–22]. These are sample numbers, not a recommendation.
- **SKR 07** for advisors on the German product [A11].
- A hotel-specific Austrian chart: none found in a primary source. **UNVERIFIED** whether Austrian hotel advisors use an industry chart on top of the EKR. Account numbers must come from the client's advisor, as in Germany.

### 1.5 Austria: what differs from the German export

1. Tax is expressed as **rate plus code** (RZL: USt-Schlüssel 10/13/20 with USt-Code 2; BMD: Prozent with Steuercode) and the **tax amount is carried on the line**. The German batch carries a tax key or relies on automatic accounts and carries no tax amount. The export therefore needs net, tax and gross per line, not only gross.
2. Both Austrian products want the **debtor line and the revenue lines of one invoice tied together** as a split booking (RZL Buchungsart; BMD split with leading person account).
3. Deposit invoices and received deposits have **their own markers** (RZL Sondercode 10/12/29; BMD booking symbol AZ and the part-invoice chain columns).
4. Credit notes and cancellations need an explicit **document type** (RZL Belegkreis; BMD BuchSymbol GU/ST) and negative tax.
5. RZL's open-item number is **numeric only**, 16 digits. An invoice number with letters or separators cannot be used there; a numeric form of the invoice number is needed.
6. Text fields are shorter than in the German batch: RZL booking text 2 × 40, debtor name 40, city 25.
7. Document files travel **beside the booking file** in a folder, referenced by relative path or file name.

---

## 2. Switzerland

Swiss accounting is served by "Treuhänder" (fiduciaries). No single exchange format plays the role the German advisor format plays in Germany; each product has its own interface.

### 2.1 Abacus

Source: Abacus publishes its interface documentation openly on downloads.abacus.ch. The booking interface guide is classed "C1 / Öffentlich" [C1]; the field references are generated per interface version [C2][C3].

**Format**: XML, UTF-8, in an `AbaConnectContainer` envelope: `TaskCount`, `Task`, `Parameter` (`Application` FIBU, `Id` "XML Buchungen", `MapId` AbaDefault, `Version` 2020.00, optional `Mandant`), then `Transaction` with one `Entry mode='SAVE'` per booking [C1, p. 4–5][C2]. An older "ASCII Buchungen" interface (version 2012.00) also exists [C4].

**Booking structure** [C1, p. 5, 9][C2]: each `Entry` has one `CollectiveInformation` (the first account; for a collective booking the account that carries the total) and one or more `SingleInformation` (the counter-accounts). `SingleCount` in the collective part states how many single parts follow. An invoice with several revenue accounts and tax rates is therefore one Entry: debtor or clearing account with the gross total, then one SingleInformation per revenue account and tax code.

**Main fields** [C2]:

| Element | Type / length | Mandatory | Note |
|---|---|---|---|
| EntryLevel, EntryType, Type | Text 1 / 1 / 8 | yes | |
| DebitCredit | Text 1 | yes | |
| Client, Division | Number 6 / 8 | yes | client and business division |
| KeyCurrency | Text 3 | yes | base currency |
| EntryDate, ValueDate | Date | yes / no | |
| AmountData (Currency, Amount), KeyAmount | Number 13 | yes | |
| Account | Number 11 | yes | |
| TaxAccount | Number 11 | no | |
| BookingLevel1–3 | Number 11 | no | cost centre, cost unit, project |
| Text1, Text2 | Text 80 | yes / no | |
| DocumentNumber | **Text 10** | no | |
| TaxData: TaxIncluded, TaxType, UseCode, AmountData, KeyAmount, TaxRate, TaxCoefficient, Country (Text 2), TaxCode (**Text 3**), FlatRate | | yes inside TaxData | |
| NoteData.Text | Text 2000 | no | |
| ExternalData (ID Number 12, Designation Text 40) | | no | |
| EntryKey | GUID 36 | no | |
| SubLedgerObject.AccountReceivableOrPayableData (DocumentNumber, CustomerNumber, ItemNumber) | Number 12 / 12 / 6 | no | |

**Tax** [C1, p. 6–7]: bookings are validated for VAT on import and incorrect ones are refused, unless the import option "MWST berechnen" is on, in which case Abacus computes tax from its own master data; "Abacus empfiehlt beim Import die Einstellung „MWST-berechnen“ zu verwenden." With that option off, TaxIncluded, Amount and TaxCode must be supplied. The tax code is the client's own code (3 characters) from the Abacus master data; the examples in the guide use the codes of the sample client. There is no fixed national code list in the interface.

**Debtor sub-ledger** [C3]: a separate interface "DEBI – Belege" (version 2021.00). Document: DocumentCode (Text 4, mandatory), CustomerNumber (Number 11, mandatory), Number (Number 10, mandatory), Reference and UniqueReference (Text 60), AccountReceivableDate (mandatory), Currency, Amount, PaymentReferenceLine (Text 35), CollectiveAccount, optional one-off address (AddressData with Name 100, Street 50, HouseNumber 9, ZIP 15, City 50, Country 4). Line items: Number, Amount, CreditAccount (mandatory), TaxCode (Text 3), TaxIncluded, TaxAmount, Text 80, cost centres. A separate "DEBI – Zahlungen" interface carries payments [C5].

**Document linking**: neither the FIBU booking interface nor the DEBI document interface defines a field for an attached file; a search of both field references for document, PDF, dossier or attachment elements found none [C2][C3]. Attaching originals through another Abacus interface is **UNVERIFIED**.

**Delivery** [C1, p. 12][C2]: file import in Abacus program 5534 (mapping in program 625), or the command line tools `abaconnectimportconsole.exe` / `abaconnectexportconsole.exe`, which "muss direkt auf dem Abacus Server ausgeführt werden". A web-service mapping (AbaDefaultWS) is published for the same interface [C6]. In practice the file goes to the fiduciary or the hotel's Abacus administrator.

**Constraints that matter**: document number 10 characters in the ledger interface and numeric (10 digits) in the debtor interface; customer number numeric; tax code 3 characters.

### 2.2 Bexio

Source: bexio's public API reference [C7]. bexio is a cloud product; the documented way in for third-party software is the API, not a file.

- **Authentication**: bearer token (OAuth 2.0 / OpenID Connect) [C7].
- **Bookings**: `POST /3.0/accounting/manual_entries` on `https://api.bexio.com`. Body: `type` (`manual_single_entry`, `manual_compound_entry`, `manual_group_entry`), `date`, `reference_nr` (≤ 80 characters), `entries[]`. Entry fields shown in the reference: `debit_account_id`, `credit_account_id`, `tax_id`, `tax_account_id`, `description`, `amount`, `currency_id`, `currency_factor`. A compound entry distributes one total over several accounts; a group entry holds several one-line bookings under one reference number [C7].
- **Accounts and tax codes are internal ids**, read per company from `GET /2.0/accounts` and `GET /3.0/taxes` (filters `scope`, `date`, `types` = `sales_tax` | `pre_tax`). A tax object has `id`, `uuid`, `name`, `code` (sample "UN77"), `digit` (the VAT form digit, sample "302"), `type`, `account_id`, `value`, `start_year`, `end_year`, `is_active` [C7]. The export must therefore map its own tax codes and accounts to each company's ids at connection time.
- **Document linking**: `POST /3.0/accounting/manual_entries/{manual_entry_id}/entries/{entry_id}/files`, multipart upload, "only for entry types manual_single_entry and manual_group_entry"; "Max. file size is 12MB and supported file formats are PNG, JPG, JPEG, GIF, DOC, DOCX, XLS, XLSX, PPT, PPTX, PDF." A second endpoint attaches files to the manual entry as a whole [C7].
- **Debtors**: contacts (`/2.0/contact`) and invoices (`/2.0/kb_invoice`) exist as API resources [C7]. Posting the hotel's invoices as bexio invoices would duplicate invoice numbering; booking them as manual entries avoids that.
- **Locks**: a manual entry carries `is_locked` and `locked_info` (sample value "closed_business_year") [C7].
- **File import of bookings**: a native CSV import of manual bookings in bexio is **UNVERIFIED**; bexio's idea portal lists it as a request, but the page could not be retrieved. Third-party importers exist in bexio's marketplace [C8].

### 2.3 Banana

Source: Banana's own documentation [C9][C10][C11].

- **Format**: text file with column headers. "Fields and column names must be separated by the tab character"; first line holds the column names, which are case-sensitive English names (NameXml); "Character encoding should preferably be UTF-8"; dates `yyyy-mm-dd`; decimal point; no thousands separator; one record per line [C10].
- **Double-entry columns**: `Date`, `Description`, `AccountDebit`, `AccountCredit`, `Amount`, `VatCode`, `AmountCurrency` (multi-currency); recommended: `DateDocument`, `DocInvoice` (invoice number), `DocOriginal`, `DocLink` (path to the scanned document, PDF or JPG), `DateExpiration`, `ExternalReference` ("information that helps identify each transaction as unique") [C11].
- **Invoice with several lines**: first row with `AccountDebit` = customer, no credit account, total amount, no VAT code; following rows with `AccountCredit` = revenue account, the line amount and its `VatCode` [C11].
- **Tax codes**: named codes from the file's VAT table. Banana's template for Swiss hotels and restaurants uses V81 (8.1 %), V26 (2.6 %), V38 (3.8 %) for sales [C12].
- **Delivery**: file, imported under Actions → Import to Accounting → Transactions [C9].
- **German advisor format**: Banana offers an import/export extension for it, filed under its Germany documentation and requiring the Plus plan [C13]. It is not a Swiss exchange format.

### 2.4 Sage (Sage 50 Switzerland, now Infoniqa ONE 50)

- The Swiss Sage 50 line is documented today in the Infoniqa help centre under the name Infoniqa ONE 50 [C14]. The help article on the import dialog returned HTTP 403 in two attempts. From the search index of that article: bookings are imported through "Extras / Buchungen importieren...", the file must be CSV, with a header line of field names followed by one line per record, fields separated by semicolon or tab, and the header decides which fields are imported [C14]. **The field names and tax code handling are UNVERIFIED.**
- Sage's own fiduciary exchange ("Treuhand-Datenaustausch") moves data between two Sage 50 installations and is of no use to third-party software: "Es werden nur FIBU-Buchungen ausgetauscht! ... Offene Posten und Personenkonten von Nebenbüchern werden nicht ausgetauscht." [C15]
- Document linking and delivery other than file: **UNVERIFIED**.

### 2.5 Charts of accounts in common use in Switzerland

- **Schweizer Kontenrahmen KMU** (publisher veb.ch): the general chart; a school version is hosted on the federal SME portal [C16]. The document could not be retrieved (HTTP 502, then a non-PDF response); account numbers from it are **UNVERIFIED** here.
- **Schweizer Kontenrahmen für die Hotellerie und Gastronomie**: industry chart, joint work of GastroSuisse, HotellerieSuisse and the Schweizerische Gesellschaft für Hotelkredit (SGH). The trade journal of HotellerieSuisse reported on 28 July 2025 that the chart was fundamentally revised (previous edition 2014), that SGH took over responsibility, that "Wo sinnvoll, orientierte man sich an den KMU-Kontenrahmen sowie an USALI", that the aim was a final version by the end of 2025, "digital, kostenlos und zweisprachig", and that it "hat keinen gesetzlichen Charakter"; the fiduciary keeps a free choice [C17] (secondary; the final edition itself was not retrieved, **UNVERIFIED** whether it has been published).
- Banana ships a template that "entspricht dem Schweizer Kontenrahmen für die Hotellerie und Gastronomie", with 4-digit accounts, for example 1000 Kasse, 1020 Banken aktiv, 1100 Forderungen aus Lieferungen und Leistungen, 2200 Geschuldete MWST (Umsatzsteuer), 3400 Beherbergung Ertrag Sammelkonto, 3405 Kurtaxen Ertrag [C12]. Which edition of the industry chart the template follows is not stated.
- bexio's API examples use accounts 1020 and 3200–3202, consistent with the KMU numbering [C7].

### 2.6 Switzerland: what differs from the German export

1. There is **no tax key standard**. Every product uses the client's own tax codes (Abacus 3-character code, bexio tax id, Banana named code). The export needs a per-company mapping from its Tax Codes to the target's codes.
2. **Currency is CHF**, and a hotel near the border may invoice in EUR. Abacus and Banana carry base-currency and document-currency amounts side by side; bexio carries `currency_id` and `currency_factor`. The export must carry both amounts and the rate.
3. Abacus and Banana want the invoice as **one grouped booking** (total on the debtor side, one line per revenue account and tax code).
4. Number formats differ from the German batch: decimal point, ISO dates, UTF-8.
5. Document number fields are **short** (Abacus 10).
6. For bexio the delivery is an **API connection per company**, with OAuth consent by the hotel, not a file handed to an advisor.

---

## 3. Card provider payout reports (Stripe)

Source: Stripe's own documentation [P1]–[P4]. Background on the provider choice and the platform model (direct charges on connected accounts) is in `payments-provider-eu.md`.

### 3.1 Structure

- **Payout reconciliation report**: matches each payout received in the bank account with the batch of payments and other transactions it settles. It is available only with **automatic payouts** (or to a platform whose connected accounts have automatic payouts). With manual payouts Stripe cannot tell which transactions a payout contains, and the account holder must reconcile alone; Stripe points such users to the balance report instead [P1][P2].
- **Sections**: balance summary; payout reconciliation (transactions of each payout grouped by reporting category); failed payouts; ending balance reconciliation (transactions not yet paid out at the end date) [P1].
- **Downloads**: summary or itemized, CSV for all accounts; itemized CSV can include custom metadata "um Stripe-Transaktionen mit Datensätzen in Ihrem Buchhaltungssystem abzugleichen" [P1].
- **Report types in the reporting interface**: `payout_reconciliation.itemized.7` and `payout_reconciliation.summary.2` (parameters `interval_start`, `interval_end`), `payout_reconciliation.by_id.itemized.4` and `payout_reconciliation.by_id.summary.1` (parameter `payout`), `ending_balance_reconciliation.itemized.4`, `failed_payouts.itemized.2`, `balance.summary.2`. Optional run parameters include `timezone`, `currency`, `reporting_category`, `decimal_separator` and `columns` [P1][P3].
- **Grouping date**: a payout is grouped by its expected arrival date, not the date the bank books it. Report data is processed on its own schedule, so a payout can arrive before its reconciliation data is ready; Stripe emits events twice a day when data for 00:00 and 12:00 UTC becomes available [P1].

**Itemized columns (default columns marked \*)** [P1]:

| Column | Meaning |
|---|---|
| automatic_payout_id \* | payout the line belongs to |
| automatic_payout_effective_at \* | expected arrival date; also when the funds leave the Stripe balance |
| balance_transaction_id \* | unique id of the balance transaction |
| created \*, available_on \* | creation time; date the net funds become available |
| currency \* | currency of gross, fee, net |
| gross \*, fee \*, net \* | amounts in major units |
| reporting_category \* | charge, refund, fee, dispute, payout and so on |
| description \* | free text of the balance transaction |
| charge_id, payment_intent_id, source_id | the Stripe objects behind the line |
| payment_metadata[key], refund_metadata[key], transfer_metadata[key] | metadata set by the integrating software; one column per requested key |
| customer_facing_amount, customer_facing_currency | amount as seen by the payer when charged in another currency |
| payment_method_type, card_brand, card_country, card_funding | |
| connected_account_id, connected_account_name, connected_account_direct_charge_id | platform activity |
| payout_reference_token, payout_statement_descriptor, trace_id | what appears on the bank statement |
| fee_net_of_withheld_tax, withheld_tax | tax contained in the fee column |
| dispute_reason, invoice_id, invoice_number (Stripe's own invoicing only) | |

The summary report has: reporting_category, currency, count, gross, fee, net [P1].

**Reporting categories** [P4]: card and other payments are both `charge`; refunds `refund`; `stripe_fee` balance transactions appear as `fee`; platform fees as `platform_earning`; payout failures and cancellations as `payout_reversal`. One category matters for hotels: when a payment is authorised and then captured for less, two balance transactions appear, one for the full authorised amount and one reversing the uncaptured part, the second with category `partial_capture_reversal`.

**Same data through the API** [P2][P5]: `GET /v1/balance_transactions?payout=po_xxx`, optionally with `expand[]=data.source`. The payout id comes from the event `payout.reconciliation_completed` or from listing payouts. A balance transaction has `amount` (gross, smallest currency unit), `fee`, `fee_details[]`, `net` (= amount − fee), `currency`, `exchange_rate`, `available_on`, `reporting_category`, `source`, `type`.

### 3.2 What booking payouts and fees would require

The draft in ticket 23 books card payments to a card-provider clearing account and does not book payouts or fees. To book them later, the following would be needed:

1. **A reference on every card payment**: store the provider's payment id (`payment_intent_id`, `charge_id`) on each Payment and Refund, and set metadata on the payment at the provider (invoice or folio number, Legal Entity) so that the itemized report carries the hotel's own references [P1].
2. **Automatic payouts** on every hotel's provider account; with manual payouts no payout-to-transaction assignment exists [P1][P2].
3. **Per payout, three kinds of booking lines**: bank account (debit) with the payout amount; fee expense account (debit) with the sum of `fee`; card clearing account (credit) with the sum of `gross` of charges less refunds and disputes. The payout id or the payout reference token goes into the document field so that the advisor can match the bank statement line [P1].
4. **New account mappings**: fee expense, dispute losses, and the bank account the payouts land in.
5. **Tax treatment of fees**: the report exposes `withheld_tax` and `fee_net_of_withheld_tax` [P1]. How fees of a provider established in another country are to be declared by an Austrian or Swiss hotel is **UNVERIFIED** and belongs to the tax advisor.
6. **Period cut-off**: charges and their payout fall on different dates and often in different export periods; the clearing account carries the difference. The ending balance reconciliation section lists what is not yet paid out at a period end [P1].
7. **Pre-authorisation captures**: the pair of balance transactions for a partial capture must be netted, or the clearing account will not match the Payment recorded at checkout [P4].
8. **Currency**: report amounts are in major units, API amounts in the smallest unit; a payout in a currency other than the charge currency carries an exchange rate [P1][P5].
9. **Platform access**: the platform can run the report for a hotel's connected account with the report types `connected_account_payout_reconciliation.itemized.4` (parameters `interval_start`, `interval_end`, optional `connected_account`) and `connected_account_payout_reconciliation.by_id.itemized.4` (parameters `connected_account`, `payout`) [P6]. The events announcing new report data are not sent to Connect webhook endpoints [P7].

Until then, the draft's "payout report as a separate download" is served by the itemized payout reconciliation CSV per payout, with the metadata columns switched on.

---

## 4. Recommendation for v1

Market shares of the accounting products were not found in any primary source; statements such as "BMD and RZL dominate Austria" are **UNVERIFIED**. The recommendation rests on what is documented and what each format costs to serve.

**Build one internal export model, then writers per format.** Every format examined is a different serialisation of the same facts: a document with a debtor side and one line per revenue account and tax rate. The differences are in grouping, tax expression, number formats and field lengths.

| Priority | Format | Reason |
|---|---|---|
| v1 | German advisor booking batch, with a country profile | Already decided in ticket 23. With an Austrian profile (advisor's chart or SKR 07, Austrian tax keys) it serves Austrian advisors on the German product, and RZL reads it at interface level 1.4 (2011/2015) [A1][A11]. Tax keys for Austria must come from the advisor. |
| v1 | Documented neutral CSV, extended | Already decided in ticket 23. Extend it with the fields in section 5 so that it is a complete carrier for Austria and Switzerland. It is the fallback for every product without a native writer. |
| v1 if an Austrian hotel is in the pilot | RZL native | Public, current, complete specification (August 2026), including deposits and document paths [A1]. Lowest risk of all native formats. |
| v1 if an Austrian hotel is in the pilot | BMD NTCS CSV | Widely written by third-party software, but the official specification is not public; build it against a pilot advisor's installation and BMD's interface manual [A3]–[A8]. |
| v1 if a Swiss hotel is in the pilot | Abacus XML (FIBU "XML Buchungen") | Public specification, versioned, validated on import [C1][C2]. |
| Later | bexio | Needs an API integration with consent and id mapping per company, not a file [C7]. |
| Later | Banana | Simple tab-separated text [C10][C11]; low effort, but no evidence found on its use by hotels of the target size. |
| Later | Sage 50 / Infoniqa ONE 50 | Field specification not retrievable [C14]. |
| Not in v1 | Booking card payouts and fees | As in the draft; offer the provider's itemized payout report as a download. |

If neither an Austrian nor a Swiss hotel is in the pilot, v1 ships the first two rows only, and the internal model is built to the list in section 5 so that the native writers can be added without changing it.

---

## 5. What the accounting export must carry

1. **Document grouping**: every booking line belongs to a document (Invoice, Deposit Invoice, Cancellation Invoice, payment, cash desk entry), and the lines of one document can be emitted either as separate two-sided lines or as one grouped booking with a leading account and a count of sub-lines.
2. **Document type** per document: invoice, deposit invoice, final invoice netting a deposit, credit note or cancellation, payment, refund; with a configurable symbol per target (RZL Belegkreis, BMD BuchSymbol, Abacus DocumentCode).
3. **Three amounts per revenue line**: net, tax, gross, each signed, plus the side (debit or credit). Totals per document must balance to the cent: gross = net + tax.
4. **Tax as four separate facts**: rate in percent, direction (output or input tax), the target's tax code, and the country in which the turnover is taxable. The mapping from the PMS Tax Code to the target's code is a table per Legal Entity and per target format.
5. **No separate tax account lines** where the target books tax itself (RZL, BMD, Abacus with tax calculation on); a separate tax account where the target needs it.
6. **Account, counter-account and debtor account** as numbers up to 9 digits for Austria and 11 for Abacus; for bexio the company's internal ids. Account length per Legal Entity is configurable (4-digit ledger and 5- or 6-digit person accounts in the Austrian standard chart).
7. **Chart of accounts templates per country**: the Austrian standard chart and SKR 07 for Austria; the Swiss KMU chart and the Swiss hotel and gastronomy chart for Switzerland; all labelled as needing the advisor's confirmation, as in ticket 23.
8. **Two dates per line**: document date and posting or value date, with writers for TTMMJJJJ, TTMM, ISO and XML date forms.
9. **Document number in two forms**: the full invoice number, and a numeric form of at most 10 digits for targets that accept only numbers or short fields (RZL open-item number 16 digits numeric; Abacus document number 10). The rule that derives the numeric form must be stable and collision-free per Legal Entity.
10. **External reference**: a unique, stable id per booking line or document, so that a target can detect a second import (Banana ExternalReference, Abacus EntryKey or ExternalData, bexio reference_nr).
11. **Booking text in two lines** with per-target truncation (40 + 40 for RZL, 80 + 80 for Abacus, 60 in the German batch), never containing the field separator.
12. **Currency facts**: base currency of the Legal Entity (EUR or CHF), document currency, amount in both, and the exchange rate.
13. **Deposit chain**: the link between a Deposit Invoice, the payment received for it, and the final invoice that nets it, plus whether tax falls due on invoice or on payment.
14. **Payment settlement reference**: for each payment, the invoice number or numbers it settles and the amount per invoice.
15. **Debtor master data** as its own export: account number, name (split to 40 or 50 characters), street, house number, postcode, city, country in both ISO and postal-letter form, VAT identification number, customer number, payment term, language.
16. **Cost centre** as an optional field per line (department such as lodging or restaurant), since every target has one.
17. **Document files**: one file per document, named after the document number, placed in a folder beside the booking file, referenced by relative path; for API targets uploaded per booking line (bexio: 12 MB limit, PDF and image types).
18. **Encoding and number format per writer**: Windows-1252 with decimal comma and semicolon for RZL and the German batch; UTF-8 with decimal point for Abacus XML and Banana.
19. **Export run identity**: run number, Legal Entity, period, created-at, and a record of which documents went into which run, so a file can be re-issued unchanged and a document is never exported twice (RZL warns that a file can be imported twice).
20. **Pre-flight check**: the export refuses to run when a used Service, Tax Code, Tender or debtor has no account or no target tax code, as in ticket 23; in addition it reports values that will be truncated or that cannot be expressed in the chosen format.
21. **City Tax lines** with their own account and their own tax code (not taxable or pass-through), since Austrian local tax and Swiss Kurtaxe are booked apart from lodging revenue (the Swiss hotel template has a separate account for it).
22. **Provider references on card payments**: payment id and payout id where known, carried in the neutral CSV, so that payouts and fees can be booked later without changing the model.

---

## Sources

Austria:

- [A1] RZL Software GmbH, "Handbuch Datenimport" (RZL FIBU/EA Import-Schnittstelle), Stand August 2026, 59 pages — https://rzlsoftware.at/fileadmin/user_upload/PDF_Schnittstelle/RZL_FIBU_Import_Schnittstelle.pdf
- [A2] RZL Online Hilfe, FIBU Next, Datenimport / RZL Format / Buchungen — https://hilfe.rzlsoftware.at/FIBUNext/Datenimport/RZL%20Format/Buchungen/
- [A3] BMD, seminar description "WebAkademie: FIBU Standardschnittstellen" — https://www.bmd.com/at/akademie/akademieshop/seminar/d/webakademie-fibu-standardschnittstellen-11389
- [A4] EDV Hausleitner GmbH, "BMD NTCS Schnittstelle FIBU04", Version 1.0-2, 14.05.2020 (third-party exporter; secondary) — https://www.edv-hausleitner.at/fileadmin/FIBU04_BMD_NTCS_Schnittstelle_1.0-2_14.05.2020_Dokumentation.pdf
- [A5] COSMO CONSULT, BMD NTCS Interface for Business Central, "Export Einkaufsbelege" (third-party; secondary) — https://docs.cosmoconsult.com/de-de/business-central/bmd-ntcs-interface/3_Features/Export_Import_Documents/PurchaseDocuments.html
- [A6] COSMO CONSULT, same product, "Export Zahlungen" (third-party; secondary) — https://docs.cosmoconsult.com/de-de/business-central/bmd-ntcs-interface/3_Features/Export_Import_Documents/ExportPayments.html
- [A7] domonda Academy, "Steuerkürzel domonda / Steuercodes BMD" (third-party; secondary) — https://academy.domonda.com/academy/steuerkurzel-domonda-steuercodes-bmd
- [A8] Pleo Help Centre, "CSV Export für BMD NTCS" (third-party; secondary) — https://pleohelp.freshdesk.com/de/support/solutions/articles/103000361366-csv-export-f%C3%BCr-bmd-ntcs
- [A9] domonda Academy, "BMD Datenimport - Step by Step" (third-party; secondary) — https://academy.domonda.com/academy/bmd-datenimport
- [A10] easybill, "Export für BMD" (HTTP 403, not retrieved; content known from search index only) — https://support.easybill.de/hc/de/articles/360021632740-Export-f%C3%BCr-BMD
- [A11] DATEV, shop page "Kontenrahmen SKR 07 Österreich", Stand Juli 2026 — https://www.datev.de/web/de/datev-shop/material/kontenrahmen-skr-07-oesterreich/
- [A12] DATEV Hilfe-Center, document 1034178 "Österreich - Individuelle Kontenfunktionen, Umsatzsteuerschlüssel, ..." (script-rendered, body not retrieved) — https://help-center.apps.datev.de/documents/1034178
- [A13] DATEV Wissensplattform, document 0907044 "Steuerschlüssel-Tabelle 2022 - SKR07" (script-rendered, body not retrieved) — https://wissensplattform.apps.datev.de/help/document/0907044
- [A14] Bernhart Steuerberatung, "Kontenplan Österreich: EKR, Kontenklassen und Praxis" (secondary) — https://bernhart-stb.at/news/allgemeines/kontenplan-oesterreich-kontenklassen/

Switzerland:

- [C1] Abacus Research AG, "XML-AbaConnect, Fibu Buchungsschnittstelle (Version 2020)", V1.0, 02.07.2020, class C1 / Öffentlich — https://downloads.abacus.ch/fileadmin/ablage/abaconnect/htmlfiles/fibu/Buchungsschnittstellendokumentation.pdf
- [C2] Abacus, AbaConnect documentation, "Schnittstelle: FIBU - XML Buchungen Version 2020.00" — https://downloads.abacus.ch/fileadmin/ablage/abaconnect/htmlfiles/fibu/FIBU__XML%20Buchungen_2020.00_AbaDefault_DE.html
- [C3] Abacus, AbaConnect documentation, "Schnittstelle: DEBI - Belege Version 2021.00" — https://downloads.abacus.ch/fileadmin/ablage/abaconnect/htmlfiles/debi/DEBI__Belege_2021.00_AbaDefault_DE.html
- [C4] Abacus, "Schnittstelle: FIBU - ASCII Buchungen Version 2012.00" (listed, not read) — https://downloads.abacus.ch/fileadmin/ablage/abaconnect/htmlfiles/fibu/FIBU__ASCII%20Buchungen_2012.00_AbaDefault_DE.html
- [C5] Abacus, "DEBI - Zahlungen Version 2023.00" (listed, not read) — https://downloads.abacus.ch/fileadmin/ablage/abaconnect/htmlfiles/debi/DEBI__Zahlungen_2023.00_AbaDefault_DE.html
- [C6] Abacus, "FIBU - XML Buchungen Version 2015.00", web-service mapping AbaDefaultWS (listed, not read) — https://downloads.abacus.ch/fileadmin/ablage/abaconnect/htmlfiles/fibu/FIBU__XML%20Buchungen_2015.00_AbaDefaultWS_DE.html
- [C7] bexio API reference (sections Manual Entries, Taxes, Accounts, Contacts, Invoices) — https://docs.bexio.com/
- [C8] bexio Marketplace, importly.ch (third-party importer) — https://marketplace.bexio.com/de-CH/apps/126085/apprombroch
- [C9] Banana, "Import to accounting" — https://www.banana.ch/doc/en/node/3328
- [C10] Banana, "Import 'Text file with columns header'" — https://www.banana.ch/doc/en/node/9966
- [C11] Banana, "Double-entry transactions" (import columns) — https://www.banana.ch/doc/en/node/9947
- [C12] Banana, template "Banana Buchhaltung: für Schweizer Hotellerie und Gastronomie" — https://www.banana.ch/apps/de/node/9056
- [C13] Banana, "DATEV Import/Export" — https://www.banana.ch/de/node/10916
- [C14] Infoniqa Hilfe-Center, "Der Dialog Buchungen importieren" (HTTP 403, not retrieved; content known from search index only) — https://onlinehelp.infoniqa.com/hc/de-ch/articles/8838187625490-Der-Dialog-Buchungen-importieren
- [C15] Sage Schweiz AG, "Sage Treuhand-Datenaustausch, oneSage Version 2.4.2", 15.05.2013 (copy hosted by a third party) — https://cdn.kibe.ch/public/downloads/Treuhand-Datenaustausch_50_50_V2.4.pdf
- [C16] KMU-Portal (SECO), "Schweizer Kontenrahmen KMU: Offizielle Schulversion" by veb.ch (not retrieved) — https://www.kmu.admin.ch/dam/kmu/de/dokumente/savoir-pratique/Finances/240812%20Schulkontenrahmen%20VEB%20-%20DE.pdf.download.pdf/240812%20Schulkontenrahmen%20VEB%20-%20DE.pdf
- [C17] htr hotelrevue, "Verschlankter Kontenrahmen als neuer Branchenstandard", 28.07.2025 (trade press; secondary) — https://www.htr.ch/story/hotellerie/verschlankter-kontenrahmen-als-neuer-branchenstandard-43268

Card provider:

- [P1] Stripe, "Payout reconciliation report" (sections, downloads, column schemas) — https://docs.stripe.com/reports/payout-reconciliation
- [P2] Stripe, "Payout reconciliation" (API guide) — https://docs.stripe.com/payouts/reconciliation
- [P3] Stripe, "Payout reconciliation report types" (report type ids and run parameters) — https://docs.stripe.com/reports/report-types/payout-reconciliation
- [P4] Stripe, "Reporting categories" — https://docs.stripe.com/reports/reporting-categories
- [P5] Stripe API reference, "The Balance Transaction object" — https://docs.stripe.com/api/balance_transactions/object
- [P6] Stripe, "Connect report types" — https://docs.stripe.com/reports/report-types/connect
- [P7] Stripe, "Reporting API" — https://docs.stripe.com/reports/api
