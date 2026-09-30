# Fiscal service provider selection (Germany KassenSichV, Austria RKSV, Switzerland)

Research date: 2026-09-28. Ticket: `.scratch/hotel-pms-v1/issues/30-fiscal-service-provider-selection.md`.
Scope: a multi-tenant web PMS (Next.js on Vercel EU, always-on worker container, Postgres) with no server or fiscal hardware at the hotel. Background not repeated here: `dach-compliance.md` section 4 and the decision in ticket 18 ("Cash handling and fiscal cash-register obligations").

Every claim cites a source in the "Sources" list. Claims that could not be confirmed from a primary source are marked **UNVERIFIED**. Where a fact argues against the decision already taken in ticket 18 it is marked **(contra ticket 18)**.

Access note: the German Finance Ministry sites (bundesfinanzministerium.de, ao.bundesfinanzministerium.de) sit behind a browser check and could not be read directly. The AEAO text was read from the NWB reproduction of the official text [G3]; the BMF letters from a summary page that links the originals [G5][G6]. Statutes (gesetze-im-internet.de), BSI, BZSt, RIS and the Austrian BMF decree were read from the official hosts.

## 1. Comparison of providers

| Criterion | fiskaly (SIGN DE, DSFINVK DE, SUBMIT DE, SIGN AT) | Deutsche Fiskal (Fiskal Cloud-TSE) | Swissbit Cloud-TSE 2 | efsta (EFR / Cloud EFR) | A-Trust (a.sign RK HSM) |
|---|---|---|---|---|---|
| **Germany: certified cloud security device** | Own device, BSI-K-TR-0717-2025, valid to 30.03.2033 [B2] | Own certificate BSI-K-TR-0525-2022 for a renamed D-TRUST product [B6] | Own device, BSI-K-TR-0612-2024, valid to 26.03.2030 [B4] | None of its own. Middleware that connects to devices of fiskaly, Swissbit, Deutsche Fiskal and hardware devices [E3] | None on the BSI list (30 entries checked) [B1] |
| **Austria: RKSV signing** | SIGN AT: signing, data collection log, counters, FinanzOnline reports [F11][F12] | No | No (product page names Germany only) [S1] | Yes, with smartcard or cloud HSM of A-Trust or PrimeSign [E5] | Yes, qualified trust service provider; online HSM products "exclusively for partners" [T1] |
| **Component on the customer side** | None. The certificate report places the whole device host at the provider (Google Cloud, Frankfurt) and the protection concept delegates nothing to taxpayer or software maker [B2][F2] | Yes. "lokale Client Komponente" run "in der operativen Umgebung des Steuerpflichtigen" on listed OS and Java combinations [B6][B5] | None described. Module, interface and storage run in one container on Google Cloud [B4]. Provider concepts are not public, **UNVERIFIED** | None with "Cloud EFR" (hosted by efsta) [E2]. Local and partner-hosted variants need an installed service [E1] | None for the HSM products ("ohne SmartCard") [T1] |
| **API model** | REST + JSON, OAuth-style token (24 h access, 48 h refresh), client-generated UUIDs, idempotent PUT [F10][F12] | Local Java connector on a port of the host [E3] | REST API [S1]; documentation behind login, **UNVERIFIED** | REST to the EFR; Cloud EFR with OAuth client credentials (access 1 h, refresh 7 days) [E2] | Developer manual only in the partner area [T1], **UNVERIFIED** |
| **Latency** | No published figure. Recommended client timeouts 3 to 5 s for transactions, 30 s for device creation [F5][F7]. "As a TSS can only process one request at a time" [F8] | Not published, **UNVERIFIED** | Not published, **UNVERIFIED** | Not published; failed signature retry up to 9000 ms configurable [E3] | Stated "Reaktionszeit" 150 ms (Basic), 100 ms (Advanced, Premium) [T1] |
| **Many taxpayers under one platform account** | Account → Group → managed organization ("Unit"); own API key per managed organization; all creatable by API [F10][F8][F11] | Portal per customer, **UNVERIFIED** | "Fully manageable via REST API", "zero-touch onboarding" [S1]; details **UNVERIFIED** | "Multi Company" mode: one EFR for many companies, identified by tax ID, location ID and till ID; one credential set covers all companies [E1][E2] | Per-taxpayer certificate; partner contract [T2] |
| **German cash data export (DSFinV-K)** | Separate product DSFINVK DE; the PMS sends cash point closings, fiskaly builds the export [F14][F15] | **UNVERIFIED** | Not offered as part of the device, **UNVERIFIED** | Yes, from its journal and archive [E3] | Not applicable |
| **German tax office notification** | SUBMIT DE sends to ELSTER with fiskaly's certificate; device and register data mirrored from SIGN DE [F16] | **UNVERIFIED** | **UNVERIFIED** | Produces the XML file; "must be processed manually by the taxable customer in MeinElster" [E6] | Not applicable |
| **Austrian data collection log and status receipts** | Log kept by fiskaly, export by API; start, monthly, yearly and closing receipts created automatically [F12][F13] | No | No | Log kept by EFR; status receipts generated automatically [E4] | Signing only; log and receipts are the register's job, **UNVERIFIED** |
| **Data retention by provider** | "held by fiskaly for a period of three (3) months"; longer storage is a separate product (SAFE) [F3][F4][F17] | **UNVERIFIED** | **UNVERIFIED** | Cloud archive, "10 years retention period" for device exports [E3] | Not applicable |
| **Public documentation** | Complete and open [F1] | Brand discontinued; site now serves fiskaly pages [F20] | Product page only; downloads need login [S1] | Open [E1] | Product page open, manuals gated [T1] |
| **Public price** | None found [section 7] | None | None; sold through partners [S1][S2] | None | HSM prices in partner area only [T1] |

Other devices on the BSI list that were not examined further: Diebold Nixdorf "DN TSE-Cloud" (BSI-K-TR-0826-2025) [B9] and the D-TRUST web service itself (BSI-K-TR-0524-2024) [B5]. fiskaltrust (middleware with public documentation) lists only installed operation for Germany and marks the Deutsche Fiskal and first-generation Swissbit cloud devices as needing environment protection on the customer's machine [X1][X2].

Ownership fact: fiskaly acquired DF Deutsche Fiskal GmbH from GK Software (announced for completion 31 March 2025) [F21]. The Deutsche Fiskal brand is being discontinued; the legal entity and existing contracts continue [F20]. "Deutsche Fiskal" is therefore not an independent alternative to fiskaly.

## 2. Certification status

Taken from the BSI list of certified technical security devices and the certificate reports, read 2026-09-28 [B1].

| Certificate | Product and version | Applicant | Issued | Valid until | Test basis |
|---|---|---|---|---|---|
| BSI-K-TR-0717-2025, extended by maintenance report MA-01 of 07.07.2026 | fiskaly sign Cloud-TSE 1.0.15-1.5.0; MA-01 adds 1.0.16-1.5.0 | fiskaly GmbH | 31.03.2025 | 30.03.2033 | TR-03153 v1.0.1 [B2] |
| BSI-K-TR-0522-2025 | fiskaly sign Cloud-TSE 1.0.12-1.4.1 | fiskaly GmbH | 13.01.2025 | 12.01.2033 | TR-03153 v1.0.1 [B3] |
| BSI-K-TR-0490-2021 | fiskaly sign Cloud-TSE 1.0.6-1.3.0 | fiskaly GmbH | 10.12.2021 | 09.12.2029 | TR-03153 v1.0.1 [B12] |
| BSI-K-TR-0403-2021 | fiskaly sign Cloud-TSE 1.2.0-1.0.5 | fiskaly GmbH | 28.05.2021 | 27.05.2029 | TR-03153 v1.0.1 [B12]. fiskaly: no active instance after 02.11.2025 [F1] |
| BSI-K-TR-0612-2024 | Swissbit Cloud TSE 2 | Swissbit AG | 27.03.2025 | 26.03.2030 | TR-03153-1 v1.1.1 [B4] |
| BSI-K-TR-0524-2024 (+ MA-01 to MA-03) | D-TRUST Web-Dienst für TSE 3.1 | D-TRUST GmbH | 26.02.2024 | 25.02.2032 | TR-03153 v1.0.1 [B5] |
| BSI-K-TR-0474-2021 | D-TRUST Web-Dienst für TSE 3.0 | D-TRUST GmbH | 10.12.2021 | 09.12.2029 | TR-03153 v1.0.1 [B8] |
| BSI-K-TR-0525-2022 | Fiskal Cloud-TSE 4.0 | DF Deutsche Fiskal GmbH | 16.05.2022 | BSI web page: 15.05.2029; report text: 09.12.2029 | TR-03153 v1.0.1 [B6] |
| BSI-K-TR-0526-2022 | DF Fiskal Cloud Manager 1.0 | DF Deutsche Fiskal GmbH | 16.05.2022 | 15.05.2029 | TR-03153 v1.0.1 [B7] |
| BSI-K-TR-0826-2025 | DN TSE-Cloud | Diebold Nixdorf Systems GmbH | 27.04.2026 | 26.03.2030 | TR-03153-1 v1.1.1 [B9] |

Facts that qualify the headline validity dates:

- **fiskaly.** The 2033 date depends on another certificate. The report states that the device's validity "ist abhängig von der Gültigkeit der mitgeltenden Zertifizierungen" and names the public key infrastructure certificate BSI-K-TR-0635-2024 (Sub-CA services of DARZ GmbH), "gültig bis 24. Mai 2027" [B2]. The two security module parts hold separate Common Criteria certificates: BSI-DSZ-CC-1130-V4-2025 (module application 1.0.15), issued 31.03.2025, valid until 30.03.2033 [B10], and BSI-DSZ-CC-1153-V5-2025 (crypto service provider 1.5.0), issued 03.07.2025, valid until 02.07.2030 [B11]. The result of the conformity test is "Pass (mit Auflagen)" [B2].
- **fiskaly** is certified against the older guideline version 1.0.1, Swissbit Cloud TSE 2 and DN TSE-Cloud against TR-03153-1 version 1.1.1 [B2][B4][B9]. Swissbit advertises being "first solution on the market certified according to the latest BSI TR-03153-1, version 1.1.1" [S1]. Whether the older basis has any practical consequence for taxpayers before 2033 is **UNVERIFIED**.
- **Swissbit Cloud TSE 2.** Validity to 26.03.2030 holds "unter der Voraussetzung" that the co-valid certificates stay valid: infrastructure certificate BSI-K-TR-0662-2024 (valid to 04.12.2027), module application BSI-DSZ-CC-1239-2024 (valid to 28.11.2032), crypto service provider BSI-DSZ-CC-1238-2025 (valid to 26.03.2030) [B4].
- **Deutsche Fiskal.** The product is "das unter der Zertifizierungs-ID BSI-K-TR-0474-2021 zertifizierte Produkt ... in unveränderter Form"; its certificate is bound to the D-TRUST certificate and lapses with it [B6].
- **D-TRUST 3.1.** The 2024 report names an infrastructure certificate valid only to 02.04.2026 [B5]. Whether the later maintenance reports replaced it was not checked, **UNVERIFIED**.
- **KassenSichV § 11 (3)** (new in 2026): certification procedures under the older protection profiles applied for before 27 February 2026 may continue until 26 February 2027 [G2]. Later re-certifications fall under the European scheme named in § 11 (1). Effect on providers' renewal plans is **UNVERIFIED**.
- **A-Trust** holds no German certificate [B1]. A third-party note says its German cloud device was "in certification ... Currently paused by a-trust" (dated 06.08.2021) [X1].
- **Austria** has no product certification comparable to the BSI list. RKSV requires the signature or seal creation unit to be bought from a qualified trust service provider established in the EU/EEA or Switzerland (§ 15 (1)) and the registration check looks the provider up in the public trust list (§ 16 (2)) [A1]. Which trust service provider stands behind fiskaly SIGN AT is not stated in its public documentation, **UNVERIFIED**.

## 3. Operating-environment conditions on the customer side

A cloud security device is split into a signing core in the provider's data centre and a module application that records transactions. The certificates differ on where the module application must run. This is the deciding technical point for a PMS with no hardware at the hotel.

**fiskaly sign Cloud-TSE (BSI-K-TR-0717-2025)**

- Module application, interface and storage form the "TSE-Host", which "wird in einer Google Cloud Plattform Instanz betrieben"; the listed host requirements are Google Compute Engine region Frankfurt, Ubuntu 22.04 LTS, signed container images only, firewall limited to SSH and HTTPS, TLS 1.2 and 1.3 only [B2].
- Condition 1 of the certificate: operation is permitted and covered only in the environments named in chapters 7.1.1 to 7.1.7; "Für einen Betrieb unter anderen Systemvoraussetzungen besitzt das Zertifikat ... keine Gültigkeit". Condition 2: the administration tool manual must be followed [B2]. Both bind fiskaly as operator.
- The recording system (the PMS) "ist nicht Teil des Prüfgegenstands". It "darf nur an exakt ein SMAERS angebunden sein". "Es können bis zu 200 elektronische ERS auf eine TSE zugreifen", told apart by a client ID [B2].
- The protection concept says of the taxpayer and of the software maker: "This document does not delegate requirements of the CTSS protection to the Tax Payer" and "... to the ERS Manufacturer" [F2].
- The same concept requires: the administrator of the module "shall be different from and independent of the Taxpayer"; the cloud provider "shall be different from and independent of the Tax Payer"; "The ERS must not be executed on the SMAERS Host"; "The process data provided by the ERS interacting with SMAERS shall remain unaltered"; access control must ensure "that taxpayers are only allowed to access SMAERS that are associated with them" [F2].
- What remains for the PMS vendor and hotel under the service description: an internet connection; an integration in which "outages of the fiskaly SIGN DE service do not block the recording system"; credentials "kept confidential and issued only to authorised persons" [F3].

Result: nothing has to be installed at the hotel or inside the PMS infrastructure.

**D-TRUST web service and Deutsche Fiskal Fiskal Cloud-TSE**

- The device "besteht aus einer lokalen Client Komponente, die die SMAERS Anwendung ... implementiert und einer Server Komponente". "Der TSS Client Desktop ist eine Softwarebibliothek, die in der operativen Umgebung des Steuerpflichtigen betrieben wird" [B6][B5].
- Certified operation of the client part is allowed only on the tested combinations of operating system, Java runtime and minimum hardware, and the provider's guideline "Leitlinie zum Schutz von SMAERS durch die Umgebung" and integration requirements must be followed [B5][B6].
- In practice the connector is installed next to the register software (default `localhost:20001`), "requires a lot of RAM", and "needs continuous connectivity" to `fiskal.cloud` on port 443 [E3]. A third-party matrix lists environment protection as "required" and one registered client per unit [X1].
- Whether running this connector in the PMS vendor's worker container would satisfy "operative Umgebung des Steuerpflichtigen" is **UNVERIFIED**. The separate certificate for "DF Fiskal Cloud Manager" [B7] was not examined.

**Swissbit Cloud TSE 2**

- "Einbindungsschnittstelle, Speichermedium und SMAERS befinden sich auf demselben Host-System in einem Docker-Container"; host requirements name Google Cloud and Ubuntu 24.04 [B4].
- Conforming operation requires compliance with Swissbit's guidance documents and four concepts (provisioning, secure platform, update, configuration) [B4]. These are not published, so any duties passed to the software maker or taxpayer are **UNVERIFIED**.

**Rule that applies whichever provider is used**

- "Ein elektronisches Aufzeichnungssystem oder eine Gruppe elektronischer Aufzeichnungssysteme muss bei störungsfreier Verwendung genau einer TSE zugeordnet sein" (AEAO zu § 146a Nr. 1.6) [G3].
- Storage of the device data in a cloud is allowed: the storage medium can be "mit einer Cloud-Speicherung erfüllt werden. § 146 Abs. 2a und 2b AO bleibt unberührt" (Nr. 1.12.2.7) [G3].

## 4. Germany

### 4.1 Which transactions fall under the security device

- The duty attaches to the system, not to the tender. "Grundsätzlich ist jedes eingesetzte elektronische Aufzeichnungssystem ... sowie die damit zu führenden digitalen Aufzeichnungen durch eine TSE zu schützen" (AEAO Nr. 1.6) [G3]. A system has cash function when it "der Erfassung und Abwicklung von zumindest teilweise baren Zahlungsvorgängen dienen" can, including vouchers accepted on site (Nr. 1.2) [G3].
- Every completed process that must lead to a receipt is secured as type "Kassenbeleg" with gross turnover per tax rate and "Zahlbetrag je Zahlart" (Nr. 2.2.3.6.1) [G3]. The secured data therefore carry all tenders of the process, cash and non-cash.
- **(contra ticket 18)** Ticket 18 says that in Germany "cash and voucher transactions are signed". The sources do not limit signing to cash and voucher tenders. Once the desk module is a cash register system, every process it records that ends in a receipt is to be secured, whatever the tender. Whether card payments taken at the desk can be routed through a part of the PMS that is outside the cash register system is a question for the tax advisor and is **UNVERIFIED**.
- Business events named as examples for such systems: "Eingangs-/Ausgangs-Umsatz, nachträgliche Stornierung eines Umsatzes, Unternehmer-Trinkgeld, Gutschein (Ausgabe, Einlösung), Privatentnahme, Privateinlage, Wechselgeld-Einlage, Lohnzahlung aus der Kasse, Geldtransit" (Nr. 1.10.2) [G3].
- Other processes that must also be secured include "Trainingsbuchungen, Stornierung eines zuvor erfassten Vorgangs, Belegabbrüche, erstellte Angebote, nicht abgeschlossene Geschäftsvorfälle (z. B. Bestellungen)" (Nr. 1.11.1) [G3]. Long-running orders are secured as type "Bestellung" with quantity, item text and unit price (Nr. 2.2.3.6.2) [G3]. Whether charges posted to a hotel folio count as such orders is **UNVERIFIED** and belongs on the tax advisor's list.
- Timing: the transaction must be started "unmittelbar mit Beginn eines aufzuzeichnenden Vorgangs"; an update is due at most 45 seconds after a change of the process data; for type "Kassenbeleg" these 45-second updates fall away; the transaction must be finished before the receipt is issued or the register is closed (Nr. 2.2.2, 2.2.3.3, 2.2.3.6.1) [G3].

### 4.2 Mandatory receipt contents

KassenSichV § 6 sentence 1, as in force after the amendment of 14 January 2026 [G2]. A receipt must contain at least:

1. full name and full address of the supplier;
2. date of issue, time of the start and time of the end of the process;
3. quantity and kind of goods, or extent and kind of service;
4. transaction number;
5. consideration and tax amount in one sum, the tax rate, or a note of tax exemption;
6. serial number of the recording system and serial number of the security device;
7. check value (signature) of the end of the process and the running signature counter.

The AEAO adds "Betrag je Zahlungsart" to this list (Nr. 2.4.4) [G3].

Form of the data: readable without a machine, **or** readable from a QR code, **or** contained in the structured part of an electronic invoice (§ 6 sentence 2) [G2]. If the QR code of DSFinV-K annex I is used, the requirements "gelten ... als erfüllt" (Nr. 2.4.4) [G3]. Values must be printed in the format returned by the device; "Nachträgliches Runden, Abschneiden oder Verändern dieser Daten ist unzulässig" [G3]. fiskaly returns the finished QR code content in the field `qr_code_data` [F9].

Delivery:

- The receipt is issued "in unmittelbarem zeitlichem Zusammenhang" with the transaction (AO § 146a (2)) [G1], on paper "oder mit Zustimmung des Belegempfängers elektronisch in einem standardisierten Datenformat" (§ 6 sentence 5) [G2].
- Consent needs no form and can be implied. The electronic receipt counts as provided when the customer is given the possibility to take it. It must be created in every case (Nr. 2.5.3) [G3].
- Showing the receipt on the hotel's own screen alone "reicht nicht aus" (Nr. 2.5.4). Permitted channels: a QR code on a display, download link, NFC, e-mail, customer account; formats such as JPG, PNG or PDF that open with free standard software (Nr. 2.5.6) [G3].
- A receipt is required only for events with a third party; withdrawals and deposits by the owner are exempt (Nr. 2.5.5) [G3].
- Invoice rules of UStG § 14 remain untouched; where no invoice is required a receipt under § 6 is still required (Nr. 2.4.3) [G3].

### 4.3 Export format and version

- The uniform digital interface consists of the integration interface, the export interface of the device (TAR archives with log messages and certificates) and DSFinV-K (AEAO Nr. 1.12.2.10, 1.13) [G3][G4].
- Current version: DSFinV-K 2.4, "Stand: Januar 2024". Version 2.3 applies to records from 1 July 2022. Version 2.4 contains only editorial changes; "eine Anwendung der DSFinV-K in der Version 2.3 [ist] ausreichend" [G4].
- If only part of a complex software falls under DSFinV-K, the duty to hand over other data of the system "bleibt ... unberührt" (Nr. 2.3) [G3].
- Device data may be moved to an archive system if that system can later export them in the prescribed TAR form; all log messages of all steps must be archived to keep the chain; condensing records is not allowed during the retention period (Nr. 1.15) [G3], KassenSichV § 3 (3), (4) [G2].
- fiskaly: the PMS submits a "cash point closing" per register "at least once a day"; unsigned transactions must be included with `security.error_message` in place of the device transaction id; exports come as TAR or ZIP with CSV files [F15][F5].

### 4.4 Notification to the tax office (AO § 146a (4))

Data to report [G1], detailed in AEAO Nr. 1.16 [G3]:

| Item | Detail |
|---|---|
| Taxpayer name | |
| Tax number | Steuernummer as ordering criterion; the business identification number once introduced |
| Kind of security device | "setzt sich aus der Zertifizierungs-ID sowie der Seriennummer der TSE zusammen"; format `BSI-K-TR-nnnn-yyyy` or `BSI-K-TR-nnnn-yyyy-MA-ZZ` |
| Kind of recording system | chosen from a list in the reporting procedure |
| Number of recording systems | per place of business |
| Serial number of each recording system | assigned by the maker of the system; must identify each unit uniquely |
| Date of acquisition | for rented or lent systems the start of the lease or provision |
| Date of decommissioning | includes loss or destruction |

Procedure:

- Deadline: "innerhalb eines Monats nach Anschaffung oder Außerbetriebnahme" [G1].
- Channel: only electronically through "Mein ELSTER" or the ERiC interface (Nr. 1.16.1) [G3]. The procedure has been available since 1 January 2025; systems acquired before 1 July 2025 had to be reported by 31 July 2025 [G5].
- One notification per place of business. Every notification must list **all** recording systems of that place of business, including unchanged ones (Nr. 1.16.1.4, 1.16.2.4) [G3].
- A wrong notification must be corrected without delay (Nr. 1.16.3) [G3].
- Only the system with cash function is reported, not connected input devices without cash function (Nr. 2.6) [G3].
- fiskaly SUBMIT DE transmits with fiskaly's own ELSTER certificate. Before each transmission the vendor "must download the preview PDF, present it to the END CUSTOMER, and obtain confirmation of correctness and consent". The service does not detect on its own that a new notification is due [F16].

### 4.5 Outage rules

Source: AEAO zu § 146a Nr. 1.14 and 2.7 [G3]. The statute and the regulation contain no outage rule [G1][G2].

| Question | Rule |
|---|---|
| May work continue? | Yes. "Soweit der Ausfall lediglich die TSE betrifft, wird es nicht beanstandet, wenn das elektronische Aufzeichnungssystem bis zur Beseitigung des Ausfallgrundes weiterhin genutzt wird" (1.14.3) |
| What must the receipt show? | The outage "muss ... auf einem eventuellen Beleg ersichtlich sein. Dies kann durch die fehlende Transaktionsnummer oder durch eine sonstige eindeutige Kennzeichnung erfolgen" (1.14.2). Date and time then come from the recording system (1.14.3) |
| Does the receipt duty continue? | Yes. It lapses only "bei einem vollumfänglichen Ausfall des Aufzeichnungssystems oder bei Ausfall der Druck- oder Übertragungseinheit" (2.7) |
| What must be documented? | "Ausfallzeiten und -grund einer TSE sind zu dokumentieren"; this may be automated by the recording system (1.14.1) |
| Duty to repair | The cause must be removed "unverzüglich" (1.14.4) |
| Must the tax office be told? | No notification duty for an outage is contained in the AEAO or the statute. The notification of § 146a (4) concerns acquisition and decommissioning [G1][G3] |
| Signing afterwards | fiskaly: "Subsequent signing of a transaction is not permitted" [F6]. No official source for this sentence was found, **UNVERIFIED** |

- **(contra ticket 18)** Ticket 18 expects that "long outages are listed for the notification duty". For Germany no such duty was found. It exists in Austria (section 5.6).
- A replacement device has a new serial number. Since the serial number of the device is part of the reported data (Nr. 1.16.2.2) [G3], a replacement changes reportable data. That this triggers a new notification within one month is an inference, **UNVERIFIED**.

### 4.6 Pending change in the law

A ministry draft of 7 August 2026 ("Gesetz zur Einführung einer Kassenpflicht ...") provides for a cash register duty above 100,000 euro, for abolition of the paper receipt duty on 1 January 2028 and for a duty to make receipts available instead [G6]. Not yet law. Read from a summary page, original not reachable.

## 5. Austria

### 5.1 Which payments fall under the duty

- Duty to use a register: from annual turnover of 15,000 euro per business if cash turnover exceeds 7,500 euro (BAO § 131b (1) Z 2) [A2].
- "Als Barzahlung gilt auch die Zahlung mit Bankomat- oder Kreditkarte oder durch andere vergleichbare elektronische Zahlungsformen, die Hingabe von Barschecks, sowie vom Unternehmer ausgegebener und von ihm an Geldes statt angenommener Gutscheine, Bons, Geschenkmünzen und dergleichen" (§ 131b (1) Z 3) [A2].
- The decree narrows card payments to those made on site: cash payment includes card payment "vor Ort/an der Kasse". "Nicht als Barzahlung gelten beispielsweise die Zahlung mit Zahlungsanweisung, die Online-Banking-Überweisung, Paypal und Einziehungsaufträge, Daueraufträge oder Zahlungen über das Internet mittels Bankomat- oder Kreditkarte, die nicht vor Ort ... beim bzw. im Beisein des leistenden Unternehmers erfolgen" (section 2.4.14) [A4].
- Card reservation with later charge: if the amount charged later is not identical to the reserved amount and the charge happens "ohne neuerliche Mitwirkung des Kunden", the process "kann ... wie ein Einziehungsauftrag gewertet werden, sodass keine Registrierkassen- und Belegerteilungspflicht ... besteht" (section 2.4.11, example 4, written for car rental) [A4]. Transfer of this example to hotel pre-authorisations is plausible but **UNVERIFIED**.
- **(contra ticket 18)** Ticket 18 says that in Austria "every receipt is signed, including card payments". The decree limits this to payments made on site in the presence of the business. Payments in the hosted booking page and charges to a stored card without the guest present are not cash turnover under the decree.
- Deposits, part payments and final payments made in cash or by card on site are cash turnover (section 2.4.11) [A4].
- Paying an already issued invoice at the desk: the business issues "keine 'Rechnung' im Sinn des UStG 1994, sondern einen Beleg über die empfangene Barzahlung". The receipt may refer to the invoice number only and need not split by tax rate "wenn die Rechnung zur Abfuhr der Steuerschuld schon im (elektronischen) Aufzeichnungssystem erfasst wurde". It is advised to mark the register receipt as a duplicate of the invoice to avoid a second tax liability (section 2.4.11) [A4].
- Preparing the hotel invoice the evening before departure is allowed; a receipt before payment is normally not foreseen (section 4.4) [A4].
- Pass-through items (the decree's term "durchlaufende Posten") are not cash turnover; if recorded in the register they are marked as not relevant for VAT (section 2.4.2.1) [A4]. Whether a local guest tax qualifies is **UNVERIFIED**.

### 5.2 Vouchers

- Sale of a value voucher is "noch kein steuerbarer Vorgang" and "noch nicht um einen registrierkassen- und belegerteilungspflichtigen Barumsatz". Recording it in the register is called "zweckmäßig"; it is then booked for example as "Bonverkauf" at zero percent or as not cash turnover (section 2.4.10.1) [A4].
- "Der Wertgutschein ist als Barumsatz im Zeitpunkt der Einlösung zu erfassen". "Es ist immer der Nominalwert des eingelösten Wertgutscheins als Barumsatz anzusetzen" (section 2.4.10.1) [A4].
- If the sale is recorded in the register and a receipt issued, the receipt must meet BAO § 132a (section 4.5.2) [A4].

### 5.3 Contents of the signed receipt

Minimum contents, BAO § 132a (3) [A3]:

1. clear designation of the supplier;
2. consecutive number, assigned once, from one or more number series;
3. day of issue;
4. quantity and customary name of goods, or kind and extent of service;
5. amount of the cash payment.

Additional contents for registers, RKSV § 11 (1) [A1]:

1. register identification number;
2. date and time of issue;
3. amount of the cash payment split by tax rates;
4. content of the machine-readable code.

Machine-readable code, RKSV § 10 (2) [A1]: register identification number, consecutive number, date and time, amounts by tax rate, turnover counter encrypted with AES-256, serial number of the certificate, signature value of the previous receipt, signature value of this receipt.

Further rules:

- If a QR code cannot be printed, a link as barcode or OCR text, or the coded text form, is allowed (§ 11 (2)) [A1].
- Receipts for training and cancellation bookings "sind ausdrücklich als solche zu bezeichnen" (§ 11 (3)) and are signed and logged like cash turnover (§ 7 (2), § 9 (1)) [A1].
- Receipt numbers must be unique per register identification number and AES key (decree section 4.6) [A4].
- The annex to RKSV was amended with effect from 1 July 2026 (BGBl. II Nr. 134/2026): the fifth amount field now reads "Betrag-Satz-Besonders (19 %, 4,9 %)" [A1]. Relevance for hotel services is **UNVERIFIED**.
- fiskaly returns `qr_code_data`, `receipt_number`, `time_signature` and `cash_register_serial_number` [F11][F13].

Delivery, change of law on **1 October 2026**:

- BAO § 132a (1) in the version of BGBl. I Nr. 97/2025 adds: "Als für den Zugriff verfügbar gilt ein elektronischer Beleg jedenfalls dann, wenn der Unternehmer dem die Barzahlung Leistenden die Möglichkeit einräumt diesen mit einem Endgerät im Zusammenhang mit dem Bezahlvorgang vor Ort auszulesen. Auf Verlangen des Leistungsempfängers oder der Organe der Abgabenbehörde hat der Unternehmer einen physischen Beleg ausgedruckt auszufolgen" [A3].
- Consequence: a printer, or a device that can print on demand, must be reachable at every Austrian cash desk. RKSV § 5 (1) already requires "einen Drucker ... oder eine Vorrichtung zur elektronischen Übermittlung von Zahlungsbelegen" [A1].
- A copy of each receipt is kept for seven years from the end of the calendar year; storage on data carriers counts (§ 132a (6)) [A3].

### 5.4 Start, monthly, yearly and closing receipts

| Receipt | Rule | Source |
|---|---|---|
| Start receipt | First cash turnover with amount zero; puts the register identification number into the log. Must be checked "unmittelbar nach der Registrierung"; decree: within one week after registration. Result logged and kept with the receipt | RKSV § 6 (1), (4) [A1]; decree 3.5.3.2 [A4] |
| Monthly receipt | At each month end the counter state is stored as signed zero receipt | RKSV § 8 (2) [A1] |
| Yearly receipt | The monthly receipt of December. "auszudrucken, zu prüfen und ... aufzubewahren". Check no later than 15 February of the following year | RKSV § 8 (3) [A1]; decree 4.5.7 [A4] |
| Closing receipt | On planned decommissioning, amount zero, printed and kept | RKSV § 17 (8) [A1] |
| Collective receipt after outage | Signed zero receipt over all receipts issued during the outage | RKSV § 17 (4) [A1] |

Details:

- Start, yearly and closing receipts carry a "verpflichtende Ausdruck- und Aufbewahrungspflicht" (decree 4.5.7) [A4].
- Registers not used in a month need no monthly receipt for it. If a receipt is issued after a monthly or yearly receipt, a new one is needed. Seasonal businesses may create the yearly receipt at season end, at the latest before business starts in the new year (decree 4.5.7) [A4].
- With transmission by web service "Kein Belegcheck mittels BMF Belegcheck App notwendig"; registration, decommissioning, start receipt and yearly receipt are sent fully automatically by the register software (handbook, version 17 May 2019) [A5].
- fiskaly: "The receipt types MONTHLY_CLOSE and YEARLY_CLOSE are generated automatically" when the next receipt falls in a new month or year; validation of yearly receipts through FinanzOnline is done by the service [F13][F12]. A register with no receipt in January therefore gets its yearly receipt late. The PMS must trigger a zero receipt in time, an inference from the mechanism, **UNVERIFIED** as to fiskaly behaviour.
- The printing and keeping of start, yearly and closing receipts is not done by the provider. It stays with the hotel.

### 5.5 Registration with FinanzOnline

- The business or its authorised representative reports signature units and registers through FinanzOnline: serial number of the certificate, kind of unit, register identification numbers connected to it, and the freely chosen AES key (RKSV § 16 (1)) [A1].
- Registration at the latest one week after putting the security device into operation (§ 6 (3)) [A1].
- Each register needs an identification number unique within the business (§ 5 (4)). Use of one register by several businesses is allowed only if each uses its own certificate and the register keeps a separate log for each (§ 5 (6)) [A1].
- fiskaly: the taxpayer creates a "Cash Register Webservice User" in FinanzOnline and hands the credentials (participant id, user id, PIN) to the vendor; they are passed once per taxpayer through `authenticateFon` and stored by fiskaly. State changes of unit and register then register them automatically; initialising a register creates and validates the start receipt [F11][F12][F13].
- fiskaly limits: "It is not possible to create more than one SCU for the same organization"; registers per unit unlimited; "You should only create as many Cash Registers as there are in a given store" [F13][F12].

### 5.6 Data collection log

- Every register keeps a log in which each cash turnover is stored with at least the receipt data of BAO § 132a (3) and the content of the machine-readable code (RKSV § 7 (1), (4)) [A1].
- "Die Daten des Datenerfassungsprotokolls sind zumindest vierteljährlich auf einem elektronischen externen Medium unveränderbar zu sichern" and kept under BAO § 132 (§ 7 (3)) [A1].
- The log must be exportable at any time in the format of annex Z 3 (§ 7 (5)) [A1].
- fiskaly: exports are "not generated automatically. We recommend triggering the export at least once every 3 months" [F13]. Together with the three-month holding period [F4] this makes a scheduled export and own storage by the PMS necessary.

### 5.7 Outage rules

Sources: RKSV § 17 [A1]; decree section 3.6 [A4].

| Case | What may continue | What the receipt states | Afterwards |
|---|---|---|---|
| Signature unit fails | Record on another register with a working unit; if impossible continue on the same register | In place of the signature value the string "Sicherheitseinrichtung ausgefallen" in the code, and the same notice "gut sichtbar am Beleg" | Signed collective receipt with amount zero, stored in the log, showing start and end of the outage (§ 17 (4)) |
| Register fails | Record on other registers; if impossible record by hand and keep copies | Handwritten receipt | Enter each turnover afterwards from the copies; a daily collective entry is allowed (§ 17 (5), decree 3.6.1) |

Notification:

- "jeden nicht nur vorübergehenden Ausfall und jede Außerbetriebnahme" must be reported "ohne unnötigen Aufschub" through FinanzOnline, with affected component, reason and start (§ 17 (1), (2)) [A1].
- Temporary means "nicht länger als 48 Stunden". "Ohne unnötigen Aufschub erfordert im Allgemeinen eine Meldung längstens binnen einer Woche" (decree 3.6) [A4].
- The end of each reported outage must also be reported (§ 17 (6); decree 3.6) [A1][A4].
- Closing the register during holidays or seasonal closure is neither outage nor decommissioning (decree 3.6) [A4].

fiskaly behaviour:

- Trust service provider not reachable: receipts get a substitute signature and the notice; when it is reachable again "SIGN AT automatically creates a zero-valued receipt marking the end of the outage"; outages of the unit are reported to FinanzOnline by fiskaly [F13][F12].
- fiskaly itself not reachable: this "can be viewed as an outage of the cash register itself". The PMS stores the request with its receipt UUID, hands out a receipt without fiscal number that states "Sicherheitseinrichtung ausgefallen", keeps a copy, and replays the requests later with the same UUID [F13].
- Register outage must be set by the integrator: state `OUTAGE` "at most 48 hours after the defect was detected", back to `INITIALIZED` when usable [F12].

## 6. Switzerland

- No statute was found that requires a certified security device, signed receipts or registration of cash registers. This is the absence of a finding, not a positive official statement, **UNVERIFIED** in that sense.
- General bookkeeping rule: books and vouchers must be kept and stored "dass sie nicht geändert werden können, ohne dass sich dies feststellen lässt" (GeBüV Art. 3) [C1]. Procedures and infrastructure must be documented (Art. 4) [C1].
- Tax administration guidance: a cash book is "unabdingbar" for businesses with lively cash traffic, listing hospitality first. "Im Kassabuch sind die Einnahmen und Ausgaben fortlaufend, lückenlos und zeitnah aufzuzeichnen und durch Kassastürze regelmässig zu kontrollieren"; a restaurant enters the daily register total in the cash book [C2].
- Till receipts up to 400 francs including tax need no details of the recipient; the same holds for register coupons [C2].
- fiskaly offers no signing product for Switzerland; only its archive product lists Switzerland [F17][F10].

Result: Swiss properties run the cash desk (registers, shifts, cash book, counts) with the fiscal module switched off. The immutable cash book and audit log of the PMS cover the Swiss rule.

## 7. Pricing

No provider publishes a price per register or per transaction. All figures below are what could be found.

| Provider | Public information | Source |
|---|---|---|
| fiskaly | No price list. `fiskaly.com/pricing` returns "not found". Contract and pricing conditions are visible to customers in the HUB. In Austria "certificates created in the live environment are chargeable". Archive product: "Fixed monthly fee" (SAFE) or "Based on data volume" (SAFE flex). Test environment free and without contract | [F24][F13][F17][F20] |
| Swissbit Cloud-TSE 2 | "Cancelable on a monthly basis", "Flexible subscription model", "usage-based: no usage no cost - this may vary depending on the POS provider". Sold through partners | [S1][S2] |
| A-Trust | Online products in three sizes: 10,000 signatures per year, 30,000 per year, unlimited; term 5 years; "Kosten p.a.: Siehe Partner:innenbereich". Smartcard with certificate 36.50 euro without VAT (needs a card reader, not usable here) | [T1][T3] |
| efsta | Units are ordered in the efsta portal; Cloud EFR "only available on request". No price | [E2][E3] |
| Deutsche Fiskal | Brand discontinued | [F20] |

- One PMS vendor's help page is reported to charge 9 euro per month for its fiskaly-based integration. Seen in a search result only, not a fiskaly price, **UNVERIFIED**.
- Price per register, per device or per transaction for fiskaly: **UNVERIFIED**. A quotation is needed before the PMS price list is fixed. Points to ask: unit of billing in Germany (device, client or transaction), unit in Austria (unit, register, certificate), cost of DSFINVK DE and SUBMIT DE, cost of replaced devices after provider faults, minimum fee.

## 8. Recommendation

**Recommended: fiskaly**, with four products: SIGN DE (security device), DSFINVK DE (cash data export), SUBMIT DE (tax office notification) and SIGN AT (Austria). **Fallback: efsta Cloud EFR.**

Reasoning:

1. **Only fiskaly meets the architecture in both countries from one account.** Its German device runs entirely at the provider and its protection concept delegates no protective duty to taxpayer or software maker [B2][F2]. The same account, authentication scheme and organisation model serve Austria [F10][F11]. Deutsche Fiskal needs a client component in the taxpayer's environment [B6] and now belongs to fiskaly [F21]. Swissbit Cloud-TSE 2 covers Germany only [S1]. A-Trust covers Austria only and has no German certificate [B1][T1].
2. **Longest certificate validity among cloud devices**: 30.03.2033, against 26.03.2030 for Swissbit and DN and 2029 to 2032 for the D-TRUST family [B1]. The date is conditional, see section 2.
3. **Multi-tenant model fits.** One platform account, a managed organisation per taxpayer or property with its own API key, devices and registers created by API [F8][F10][F11]. Up to 200 recording systems per German device [B2].
4. **Complete public documentation**, including the outage procedures for both countries [F5][F6][F13]. Swissbit and A-Trust keep developer documentation behind a login [S1][T1].
5. **Austrian status receipts, log and FinanzOnline reports are handled by the service** [F12][F13]. With A-Trust alone the PMS would have to build log, counters, chaining, status receipts and the FinanzOnline web service itself.

Facts that speak against fiskaly, to be weighed by the owner:

1. **Incident of 24 to 27 May 2026.** After a maintenance update, signing was degraded for a subset of devices for about three days. "some TSS instances could not be recovered and had to be set to DEFECTIVE"; affected customers had to "create a new TSS and Client" [F18]. A defective device "must be replaced with a new one. Existing clients must be linked to the new TSS again, each with a new client_id" [F19].
2. **No public price** (section 7).
3. **Data are held for three months only** [F3][F4][F14]. Long-term storage is the PMS's task or a further paid product [F17]. The technical page says records "are stored for the duration of the legal retention period" [F1b]; this contradicts the service description. The service description is the contractual text and is taken as decisive; the contradiction should be put to fiskaly.
4. **One device handles one request at a time** [F8] (statement dated 2023). Busy properties may need more than one device; a recording system may be attached to exactly one [B2][G3].
5. **Provider concentration.** fiskaly now also owns Deutsche Fiskal [F21]. The realistic independent alternatives are Swissbit Cloud-TSE 2 for Germany and a trust service provider plus own RKSV logic, or efsta, for Austria.
6. **Certified against the older guideline version** (section 2).
7. **No warranty beyond the device**: fiskaly "does not warrant other requirements for the proper operation of a recording system (e.g., correct integration of DSFinV-K, GoBD, archiving)" and the hotel "is responsible for compliance with all statutory obligations" [F3].

Why efsta is the fallback and not the first choice: Cloud EFR offers one API for both countries, a ten-year archive and the notification file [E1][E2][E3][E6], and names PMS as a source system [E1]. But it is "only available on request", has no public price, produces the German notification only as a file the hotel uploads by hand [E6], and puts a second company between the PMS and the device, which for Germany is again fiskaly or Swissbit [E3].

Design consequence: keep the fiscal module behind an internal interface with the operations `provision`, `sign`, `close register`, `export`, `report outage`, so that the provider can be changed per country.

Confidence: **medium to high** for the choice of provider (certificates, architecture and Austrian law were read from primary sources). **Low** for cost. **Medium** for the German administrative guidance, read from a reproduction.

## 9. Constraints on the cash, receipt and voucher model

Organisation and registers

1. One fiscal organisation per taxpayer. Austria: one signature unit per Legal Entity, because several businesses on one register need separate certificates and logs [A1] and fiskaly allows one unit per organisation [F13]. Germany: fiskaly advises one managed organisation per location [F8]. The model needs the mapping Legal Entity → property → fiscal organisation → device or unit → register.
2. A Cash Register is a fiscal object with an immutable serial number assigned by the PMS vendor, unique across all customers (Germany, AEAO 1.16.2.5, 2.2.3.1) [G3], and an identification number unique within the business (Austria, RKSV § 5 (4)) [A1]. Renaming a register must not change these.
3. A German register is attached to exactly one device in normal operation [G3][B2]. At most 200 registers per device [B2].
4. Create only as many Austrian registers as exist in the property [F12]. Registers cannot be deleted, only decommissioned; decommissioning creates a closing receipt and a report [F13][A1].
5. Register life cycle states needed: created, registered, active, outage, decommissioned, defective [F12][F10]. Acquisition date and decommissioning date are stored per register for the German notification [G1].
6. Replacing a German device (provider fault or otherwise) creates a new device serial number and new client ids [F19]. The register keeps its own serial number; the history of devices per register is stored with dates.

Signing

7. Germany: every process of the cash desk module that ends in a receipt is signed, whatever the tender, until the tax advisor confirms a narrower scope (section 4.1).
8. Germany: the signing call carries receipt type, gross amount per tax rate and amount per tender [G3]. The folio payment must therefore know its tax split at the moment of payment. A payment against a folio with mixed tax rates needs a defined allocation rule.
9. Germany: the transaction is started when the payment process starts and finished before the receipt is issued [G3]. Cancelled payment dialogs are finished as aborted processes, not dropped [G3][F15].
10. Germany: owner-only events at the desk are signed too but need no receipt: paid-outs, bank deposits, change money, transfers between registers, tips paid out, count differences [G3]. They map to the export business cases `Auszahlung`, `Einzahlung`, `Geldtransit`, `TrinkgeldAN` or `TrinkgeldAG`, `Privatentnahme`, `Privateinlage`, `Lohnzahlung`, `Anfangsbestand`, `DifferenzSollIst` [F15].
11. Austria: a receipt is signed when a payment is received on site in cash, by card or by voucher [A2][A4]. Payments in the hosted booking page and charges to a stored card without the guest present are not signed (section 5.1).
12. Austria: each payment at the desk is a receipt of its own with amounts per tax rate. When an invoice already exists, the receipt may refer to the invoice number and should be marked as duplicate of the invoice [A4].
13. Corrections are never edits. Germany: a cancellation is a new signed process [G3]. Austria: a cancellation receipt with negative amounts, marked as cancellation [F13][A1].
14. Training mode, if offered, produces signed receipts marked as training that do not change the turnover counter [A1][G3].
15. Signing requests are idempotent by a UUID generated by the PMS and stored before the call [F10][F12]. The same UUID is used for a replay.
16. The desk never waits for the provider beyond a configurable timeout, 3 to 5 seconds recommended [F5][F7].

Vouchers

17. Sale and redemption are separate event types. Germany: export business cases `MehrzweckgutscheinKauf` and `MehrzweckgutscheinEinloesung` for value vouchers (the single-purpose pair exists as well) [F15]. Which pair applies is the tax advisor's question already ticketed.
18. Germany: issue and redemption of a voucher at the desk are both named as events of a cash register system [G3]; both are signed.
19. Austria: the sale at the desk is not cash turnover; if recorded it is booked at zero percent as voucher sale. The redemption is cash turnover at the nominal value redeemed and is signed [A4].
20. Vouchers sold online by card are outside the Austrian duty (section 5.1). For Germany the cash function is defined by payments and vouchers accepted on site (AEAO 1.2) [G3]; that online sales are therefore outside the signed scope is an inference, **UNVERIFIED**. The liability must still reach the same voucher ledger.
21. Partial redemption: the signed amount is the part redeemed; the remaining balance is not a payment.

Receipts

22. The Receipt stores, unchanged and in the returned format: Germany transaction number, start and end time, device serial number, register serial number, signature counter, signature value, QR code content [G2][G3][F9]; Austria register id, receipt number, signature time, amounts per tax rate, QR code content [A1][F11]. No rounding or reformatting.
23. The Receipt also carries supplier name and address, date, service description, amount, tax amount and rate, and amount per tender [G2][G3][A3].
24. The QR code is the standard form in both countries [G3][A1][F9].
25. Electronic delivery by QR code on a guest-facing display, link or e-mail is allowed in both countries; display on the staff screen alone is not enough in Germany [G3][A3]. Germany needs the guest's consent, which may be implied [G3].
26. Austria from 1 October 2026: a printed receipt on request of the guest or the tax officers [A3]. Every Austrian desk needs access to a printer. In Austria the printer is therefore not optional.
27. The Receipt is created in every case, also when the guest does not take it [G3].
28. Austrian start, yearly and closing receipts must be printed and kept by the hotel; the PMS offers them as printable documents and records that printing was done [A1][A4].
29. Receipt and Invoice stay separate documents (ticket 18). In Germany a receipt is needed even where no invoice is required [G3].

Closing, export and retention

30. Germany: a register closing per register at least once per day, sent as cash point closing, containing every transaction including unsigned ones with their error text [F15][F5]. Closing a Shift and the Night Audit are the natural triggers; a register with open transactions cannot be closed [G3].
31. Austria: a zero receipt is triggered by the PMS at the first business moment of each month and year for every active register, so that monthly and yearly receipts exist on time (section 5.4). Yearly receipt checked by 15 February [A4].
32. Scheduled exports, stored immutably by the PMS: German device archive (TAR) and DSFinV-K export, Austrian log export at least every quarter [A1][F13][G3]. Interval shorter than the provider's three-month holding period [F3][F4].
33. Retention of the exports: Austria seven years [A3]; Germany as in `dach-compliance.md`. No condensing of records [G2].
34. On demand export for an audit, by period and by register, in DSFinV-K 2.3 or 2.4 [G4] and in the Austrian log format [A1].

Outage

35. Outage is a state per register with start, end, reason and affected component, written automatically [G3][A1].
36. Germany: work continues; the receipt carries a clear mark such as "TSE ausgefallen" and no transaction number; date and time come from the PMS; nothing is signed afterwards; no report to the tax office [G3][F6].
37. Austria, provider reachable but trust service down: the provider returns the substitute signature; the receipt shows "Sicherheitseinrichtung ausgefallen" clearly [A1][F13].
38. Austria, provider not reachable: the PMS issues the receipt with "Sicherheitseinrichtung ausgefallen" and without fiscal number, keeps a copy, queues the request and replays it with the same UUID [F13]. The queue survives restarts.
39. Austria: an outage longer than 48 hours is reported through FinanzOnline within one week, and its end as well [A1][A4]. The PMS sets the register to outage at the provider no later than 48 hours after detection and alerts the Property Manager before that [F12].
40. The list of outages per register is part of the procedure documentation in both countries [G3][A4].

Onboarding data

41. Germany, per property: taxpayer name, tax number, place of business, per register kind of system, serial number, acquisition date; from the provider certificate id and device serial number [G1][G3]. The hotel confirms the preview before each transmission [F16].
42. Germany: every change (new register, removed register, replaced device) triggers a new notification for the whole place of business within one month [G1][G3]. The PMS detects this; the provider does not [F16].
43. Austria, per Legal Entity: VAT id or tax number, and the credentials of a FinanzOnline web service user created by the hotel [F11]. These are secrets of the hotel; they are passed to the provider and not kept in readable form by the PMS.
44. Switching the cash desk on in Germany or Austria is blocked until provisioning has succeeded; in Austria until the start receipt is validated [A1][F11].

Switzerland

45. No signing, no registration. Cash book with running balance, counts and immutable audit log are sufficient under the rules found [C1][C2].

## Open points for the tax advisor or the provider

1. Germany: may card payments at the desk stay outside the signed scope (section 4.1)?
2. Germany: are folio postings "orders" that must be secured (section 4.1)?
3. Germany: does a replaced device require a new notification (section 4.5)?
4. Austria: do hotel pre-authorisations with later capture fall under example 4 of the decree (section 5.1)? Is the local guest tax a pass-through item?
5. fiskaly: price units; holding period versus "legal retention period"; trust service provider behind SIGN AT; renewal of the infrastructure certificate due 24 May 2027; remedy and cost after provider-caused defective devices.

## Sources

Germany, law and administration

- [G1] AO § 146a — https://www.gesetze-im-internet.de/ao_1977/__146a.html
- [G2] KassenSichV, "zuletzt geändert durch Art. 3 V v. 14.1.2026 I Nr. 10" — https://www.gesetze-im-internet.de/kassensichv/BJNR351500017.html
- [G3] AEAO zu § 146a, consolidated text as reproduced by NWB Datenbank — https://datenbank.nwb.de/Dokument/500001_146a/ ; official location, not readable by this research: https://ao.bundesfinanzministerium.de/ao/2026/Abgabenordnung/Vierter-Teil/Zweiter-Abschnitt/Erster-Unterabschnitt/Paragraf-146a/ae-146a.html
- [G4] BZSt, Digitale Schnittstelle der Finanzverwaltung für Kassensysteme — https://www.bzst.de/DE/Unternehmen/Aussenpruefungen/DigitaleSchnittstelleFinV/digitaleschnittstellefinv_node.html
- [G5] BMF letter 28.06.2024, IV D 2 - S 0316-a/19/10011 :009, summary with links to the originals — https://elektronische-steuerpruefung.de/bmf/schreiben-beginn-der-mitteilungsverpflichtung-nach-146a-absatz-4-abgabenordnung-ao.htm
- [G6] Draft law on a cash register duty, 07.08.2026, summary with link to the ministry page — https://elektronische-steuerpruefung.de/bmf/gesetz-kassenpflicht-entwurf.htm

BSI

- [B1] List of certified technical security devices (three pages, 30 entries) — https://www.bsi.bund.de/DE/Themen/Unternehmen-und-Organisationen/Standards-und-Zertifizierung/Zertifizierung-und-Anerkennung/Listen/Zertifizierte-Produkte-nach-TR/Technische_Sicherheitseinrichtungen/TSE_node.html
- [B2] BSI-K-TR-0717-2025, page, conformity report and maintenance report MA-01 — https://www.bsi.bund.de/SharedDocs/Zertifikate_TR/Technische_Sicherheitseinrichtungen/BSI-K-TR-0717-2025.html ; https://www.bsi.bund.de/SharedDocs/Downloads/DE/BSI/Zertifizierung/Konformitaetsreporte/Technische_Sicherheitseinrichtungen/BSI-K-TR-0717-2025.pdf?__blob=publicationFile ; https://www.bsi.bund.de/SharedDocs/Downloads/DE/BSI/Zertifizierung/Konformitaetsreporte/Technische_Sicherheitseinrichtungen/BSI-K-TR-0717-2025-MA-01.pdf?__blob=publicationFile
- [B3] BSI-K-TR-0522-2025 — https://www.bsi.bund.de/SharedDocs/Zertifikate_TR/Technische_Sicherheitseinrichtungen/BSI-K-TR-0522-2025.html
- [B4] BSI-K-TR-0612-2024, page and conformity report — https://www.bsi.bund.de/SharedDocs/Zertifikate_TR/Technische_Sicherheitseinrichtungen/BSI-K-TR-0612-2024.html ; https://www.bsi.bund.de/SharedDocs/Downloads/DE/BSI/Zertifizierung/Konformitaetsreporte/Technische_Sicherheitseinrichtungen/BSI-K-TR-0612-2024.pdf?__blob=publicationFile
- [B5] BSI-K-TR-0524-2024, page and conformity report — https://www.bsi.bund.de/SharedDocs/Zertifikate_TR/Technische_Sicherheitseinrichtungen/BSI-K-TR-0524-2024.html
- [B6] BSI-K-TR-0525-2022, page and conformity report — https://www.bsi.bund.de/SharedDocs/Zertifikate_TR/Technische_Sicherheitseinrichtungen/BSI-K-TR-0525-2022.html
- [B7] BSI-K-TR-0526-2022 — https://www.bsi.bund.de/SharedDocs/Zertifikate_TR/Technische_Sicherheitseinrichtungen/BSI-K-TR-0526-2022.html
- [B8] BSI-K-TR-0474-2021 — https://www.bsi.bund.de/SharedDocs/Zertifikate_TR/Technische_Sicherheitseinrichtungen/BSI-K-TR-0474-2021.html
- [B9] BSI-K-TR-0826-2025 — https://www.bsi.bund.de/SharedDocs/Zertifikate_TR/Technische_Sicherheitseinrichtungen/BSI-K-TR-0826-2025.html
- [B10] BSI-DSZ-CC-1130-V4-2025 — https://www.bsi.bund.de/SharedDocs/Zertifikate_CC/CC/Fiskalisierung/1130.html
- [B11] BSI-DSZ-CC-1153-V5-2025 — https://www.bsi.bund.de/SharedDocs/Zertifikate_CC/CC/Serveranwendungen_Sonstiges/1153.html
- [B12] BSI-K-TR-0490-2021 and BSI-K-TR-0403-2021 — https://www.bsi.bund.de/SharedDocs/Zertifikate_TR/Technische_Sicherheitseinrichtungen/BSI-K-TR-0490-2021.html ; https://www.bsi.bund.de/SharedDocs/Zertifikate_TR/Technische_Sicherheitseinrichtungen/BSI-K-TR-0403-2021.html

Austria

- [A1] Registrierkassensicherheitsverordnung, consolidated version of 28.09.2026 — https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=Bundesnormen&Gesetzesnummer=20009390
- [A2] BAO § 131b — https://www.ris.bka.gv.at/NormDokument.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10003940&Paragraf=131b
- [A3] BAO § 132a, version in force until 30.09.2026 and version in force from 01.10.2026 (BGBl. I Nr. 97/2025) — https://www.ris.bka.gv.at/NormDokument.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10003940&Paragraf=132a ; https://www.ris.bka.gv.at/NormDokument.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10003940&Paragraf=132a&FassungVom=2026-10-01
- [A4] BMF, Erlass zur Einzelaufzeichnungs-, Registrierkassen- und Belegerteilungspflicht, 23.12.2019, BMF-010102/0007-I/8/2019 — https://findok.bmf.gv.at/findok/resources/pdf/a8ae01cd-b8d6-4e66-9954-f77ac33b8df2/77231.1.1.pdf . A later version may exist, not checked.
- [A5] BMF, Handbuch Registrierkassen in FinanzOnline, version 17.05.2019 — https://www.bmf.gv.at/dam/jcr:0af97a40-da60-4c81-8e1e-22c3ecca52a4/BMF_Handbuch_Registrierkassen.pdf

Switzerland

- [C1] Geschäftsbücherverordnung, SR 221.431, version of 01.01.2013 — https://fedlex.data.admin.ch/filestore/fedlex.data.admin.ch/eli/cc/2002/216/20130101/de/pdf-a/fedlex-data-admin-ch-eli-cc-2002-216-20130101-de-pdf-a-1.pdf
- [C2] ESTV, MWST-Info 16 Buchführung und Rechnungsstellung, print file of 27.05.2026 as hosted by swissvat.ch — https://www.swissvat.ch/fileadmin/user_upload/MI_16_27.05.2026.pdf ; official web publication: https://www.gate.estv.admin.ch/mwst-webpublikationen/public/pages/taxInfos/tableOfContent.xhtml

fiskaly

- [F1] Certification — https://workspace.fiskaly.com/countries/germany/certification/
- [F1b] Technical details of the device — https://workspace.fiskaly.com/countries/germany/technical-details/
- [F2] Operational Environment Protection Concept, version 2.0.6, 23.01.2025 — https://workspace.fiskaly.com/assets/SMAERS-v1.0.15_Umgebungsschutzkonzept-v2.0.6-2025-01-23.pdf
- [F3] Service description SIGN DE, 24.03.2026 — https://workspace.fiskaly.com/pm-hub/service-descriptions/sign-de/2026-03-24/
- [F4] Service description SIGN AT, 24.03.2026 — https://workspace.fiskaly.com/pm-hub/service-descriptions/sign-at/2026-03-24/
- [F5] Error handling guide — https://workspace.fiskaly.com/countries/germany/guides/error-handling/
- [F6] FAQ, no connection to fiskaly — https://workspace.fiskaly.com/countries/germany/faq/what-do-we-have-to-do-if-there-is-no-connection-from-the-cash-register-to-fiskal-5130610530962/
- [F7] FAQ, timeouts — https://workspace.fiskaly.com/countries/germany/faq/which-timeout-should-be-set-for-the-sign-de-api-requests-5256120094354/
- [F8] FAQ, number of managed organisations and devices — https://workspace.fiskaly.com/countries/germany/faq/how-many-managed-organizations-and-tsss-should-i-create-8106834808604/
- [F9] Receipt data Germany — https://workspace.fiskaly.com/countries/germany/compliance/receipt-data/
- [F10] Concepts and resource mapping — https://workspace.fiskaly.com/getting-started/concepts/ ; https://workspace.fiskaly.com/getting-started/resource-mapping/
- [F11] SIGN AT integration guide and receipt data — https://workspace.fiskaly.com/sign-at/integration-guide/ ; https://workspace.fiskaly.com/sign-at/receipt-data/
- [F12] SIGN AT API reference, version 1.2.6 — https://workspace.fiskaly.com/api/rksv/v1/
- [F13] SIGN AT FAQ collection (outage, substitute signature, log export, monthly and yearly receipts, cancellation, unit and register limits, test and live) — https://workspace.fiskaly.com/countries/austria/faq/
- [F14] Service description DSFinV-K, 24.03.2026 — https://workspace.fiskaly.com/pm-hub/service-descriptions/dsfinvk/2026-03-24/
- [F15] DSFINVK DE introduction, key characteristics, process and business case types, connection to SIGN DE — https://workspace.fiskaly.com/dsfinvk/introduction/ ; https://workspace.fiskaly.com/dsfinvk/key-characteristics/ ; https://workspace.fiskaly.com/dsfinvk/process-types-business-transaction-types/ ; https://workspace.fiskaly.com/dsfinvk/connecting-signde-dsfinvk/
- [F16] Service description SUBMIT DE, 24.03.2026 — https://workspace.fiskaly.com/pm-hub/service-descriptions/submit-de/2026-03-24/
- [F17] SAFE introduction — https://workspace.fiskaly.com/safe/introduction/
- [F18] Status page, incident "SIGN DE v2 - Degraded performance", 24 to 27 May 2026 — https://status.fiskaly.com/incidents/gq9s429pzydy
- [F19] FAQ, state DEFECTIVE — https://workspace.fiskaly.com/countries/germany/faq/what-does-the-state-defective-of-a-tss-mean-4961084686738/
- [F20] Page served at the former Deutsche Fiskal address (fiskaly SIGN DE page with notes for Deutsche Fiskal customers) — https://www.deutsche-fiskal.de/
- [F21] fiskaly on the acquisition of Deutsche Fiskal — https://www.fiskaly.com/blog/fiskaly-acquires-deutsche-fiskal ; https://workspace.fiskaly.com/blog/2026-strategy-update/
- [F24] HUB billing update, 03.06.2026 — https://workspace.fiskaly.com/blog/2026-hub-billing-upgrade/

Other providers

- [S1] Swissbit Cloud-TSE 2 product page — https://www.swissbit.com/en/products/point-of-sale/cloud-tse-2
- [S2] Swissbit blog, 03.11.2025 — https://www.swissbit.com/en/news/blog/swissbit-cloud-tse-2-the-saas-solution-for-secure-and-simple-fiscal-compliance
- [T1] A-Trust RKSV portfolio — https://www.a-trust.at/de/produkte/registrierkasse/rksv_portfolio/
- [T2] A-Trust information for partners — https://www.a-trust.at/de/produkte/registrierkasse/informationen_f%C3%BCr_partner/
- [T3] A-Trust web shop, register products — https://www.a-trust.at/webshop/?cat=3
- [E1] efsta EFR architecture — https://docs.efsta.net/efr/architecture
- [E2] efsta Cloud EFR — https://docs.efsta.net/efr/cloud
- [E3] efsta Germany, fiscal devices — https://docs.efsta.net/efr/DE/fiscal-devices/
- [E4] efsta Austria, fiscal requirements — https://docs.efsta.net/efr/AT/fiscal/
- [E5] efsta Austria, fiscal devices — https://docs.efsta.net/efr/AT/fiscal-devices/
- [E6] efsta Germany, mandatory reporting — https://docs.efsta.net/efr/DE/reporting
- [X1] fiskaltrust, Germany on-premise installation (device matrix) — https://docs.fiskaltrust.cloud/docs/poscreators/middleware-doc/germany/operation-modes/on-premise-installation
- [X2] fiskaltrust, Swissbit Cloud-TSE (first generation) — https://docs.fiskaltrust.cloud/docs/poscreators/middleware-doc/germany/scu/swissbit-cloud

Not reachable during this research: bundesfinanzministerium.de and ao.bundesfinanzministerium.de (browser check); Swissbit and A-Trust developer documentation (login); fiskaly price information (not published).
