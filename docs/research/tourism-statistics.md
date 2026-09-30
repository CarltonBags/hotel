# Official tourism statistics: reporting duties for hotels in Germany, Austria and Switzerland

Researched: 2026-09-29. Ticket: `.scratch/hotel-pms-v1/issues/53-tourism-statistics-research.md`.

Every claim cites its source. Statute text is quoted in its original language with an English gloss. Claims that could not be traced to a primary source are marked **UNVERIFIED**. Guest registers (Meldeschein, Gästeverzeichnis) are covered in `dach-compliance.md` sections 1.7 and 1.8 and are not repeated here.

---

## 1. Germany

### 1.1 Legal basis and who must report

- The survey is a federal statistic ordered by the **Beherbergungsstatistikgesetz (BeherbStatG)** of 22 May 2002, last amended by Art. 7 of the Act of 22 Dec 2025 (BGBl. 2025 I Nr. 354). § 1: *"Über die Beherbergung im Reiseverkehr (vorübergehende Beherbergung) werden statistische Erhebungen bei Beherbergungsbetrieben als Bundesstatistik durchgeführt."* (Statistical surveys on temporary accommodation are carried out at accommodation establishments as a federal statistic.) [D1]
- **Threshold**, § 3 (1): *"Beherbergungsbetriebe im Sinne des § 1 sind Betriebe und Betriebsteile, die nach Einrichtung und Zweckbestimmung dazu dienen, mindestens zehn Gäste gleichzeitig vorübergehend zu beherbergen. Bei Campingplätzen müssen mindestens zehn Stellplätze vorhanden sein."* (Establishments and parts of establishments equipped and intended to accommodate at least ten guests at the same time; campsites need at least ten pitches.) [D1] Destatis applies this as "mindestens zehn Schlafgelegenheiten" (at least ten bed places); a double bed counts as two. [D3, ch. 1.1 and 2.1.3]
- **Branches covered**, § 3 (2): 55.1 Hotels, Gasthöfe und Pensionen; 55.2 Ferienunterkünfte und ähnliche Beherbergungsstätten; 55.3 Campingplätze; 55.4 Vermittlungstätigkeiten für Beherbergungsdienstleistungen (not yet listed in the 2024 quality report [D3], so a recent addition); Schulungsheime; Vorsorge- und Rehabilitationskliniken. [D1]
- **Duty to answer**, § 6 (1): *"Für die Erhebungen besteht Auskunftspflicht. Auskunftspflichtig ist der Inhaber, die Inhaberin, der Leiter oder die Leiterin des Beherbergungsbetriebs."* (Answering is mandatory; the owner or manager of the establishment is liable.) On first inclusion the duty also covers the elapsed months of the calendar year (§ 6 (2)). [D1]
- **Exemption for founders**, § 6 (3): no duty in the calendar year of opening; none in the two following years if turnover of the last closed business year was below EUR 800,000. [D1]
- **Unit**: the local establishment (*"örtliche Einheiten, die durch die Sitzadresse des Betriebes ... definiert werden"*), so a group reports per property, not per company. [D3, ch. 1.2]
- **It is a full census above the threshold, not a sample.** [D3, ch. 3.1]
- **Sanction**: late, wrong, incomplete or missing answers, and not using the electronic procedure, are administrative offences with a fine of up to EUR 5,000 (BStatG § 23 (1), (2), (3)). [D2]
- EU frame: Regulation (EU) No 692/2011 on European statistics on tourism, with Implementing Regulation (EU) No 1051/2011. [D3, ch. 1.6] (Cited as named in the Destatis quality report; the regulation text itself was not re-read for this ticket.)

### 1.2 Figures to report

BeherbStatG § 4, verbatim [D1]:

> Erhebungsmerkmale sind:
> 1. Zahl der Ankünfte und Übernachtungen von Gästen; bei Gästen, deren Wohnsitz oder gewöhnlicher Aufenthalt außerhalb Deutschlands liegt, werden diese Angaben auch in der Unterteilung nach Herkunftsländern erfasst,
> 2. Zahl der angebotenen Gästebetten oder bei Campingplätzen der Stellplätze,
> 3. Datum der vorübergehenden Schließung und Wiedereröffnung sowie der gewerberechtlichen Abmeldung,
> 4. bei Hotels, Gasthöfen, Pensionen und Hotels garnis zusätzlich Zahl der Gästezimmer,
> 5. bei den in Nummer 4 genannten Beherbergungsbetrieben mit 25 und mehr Gästezimmern darüber hinaus die Zahl der belegten und angebotenen Zimmertage; für Letztere hilfsweise die Auslastung als Prozentangabe.

Gloss: (1) number of arrivals and overnight stays; for guests whose residence or habitual abode is outside Germany, also broken down by country of origin; (2) number of guest beds offered (pitches for campsites); (3) dates of temporary closure, reopening and deregistration of the business; (4) for hotels, inns, guesthouses and hotels garnis also the number of guest rooms; (5) for those with 25 or more guest rooms also the number of occupied and offered room days, or alternatively occupancy as a percentage.

Auxiliary data (§ 5): name and address of the establishment; name, phone and e-mail of a contact person (the latter voluntary, § 6 (1) sentence 3). [D1]

Definitions used by the statistical offices [D3, ch. 2.1.3]:

| Figure | Definition (original) | Consequence for the system |
|---|---|---|
| Ankünfte | *"Zahl der Anmeldungen von Gästen in einem Beherbergungsbetrieb innerhalb des Berichtszeitraums, die zum vorübergehenden Aufenthalt eine Schlafgelegenheit belegten."* | Count persons, not reservations or rooms, by arrival date within the month. |
| Übernachtungen | *"Zahl der Übernachtungen von Gästen, die im Berichtszeitraum in einem Beherbergungsbetrieb ankamen oder aus dem vorherigen Berichtszeitraum noch anwesend waren."* | Count person-nights falling in the month, including guests who arrived in an earlier month. A stay across a month boundary yields one arrival (in the arrival month) and nights in both months. |
| Herkunftsländer | *"Maßgebend ist grundsätzlich der ständige Wohnsitz oder der gewöhnliche Aufenthaltsort eines Gastes, nicht dagegen dessen Staatsangehörigkeit bzw. Nationalität."* | **Country of residence, not nationality.** |
| Angebotene Schlafgelegenheiten | *"Anzahl der Schlafgelegenheiten, die am letzten Öffnungstag eines Beherbergungsbetriebes im Berichtsmonat tatsächlich angeboten wurden."* Double beds count as two; regularly offered sofa beds count; *"Behelfsmäßige Schlafgelegenheiten (z. B. Zustellbetten, Kinderbetten) werden nicht berücksichtigt."* | A bed-place count per room excluding extra beds and cots, evaluated on the last open day of the month. |
| Angebotene Gästezimmer | *"Zahl der Gästezimmer, die vom jeweiligen Beherbergungsbetrieb am 31. Juli tatsächlich angeboten wurden."* Rooms used by staff do not count. | Annual figure, reference day 31 July (§ 2 (1), (2) BeherbStatG [D1]). |
| Angebotene Gästezimmertage | *"Anzahl der Tage im Berichtsmonat, an denen die Gästezimmer tatsächlich zur Verfügung standen."* | Room days offered; only for hotels with 25 or more rooms. |
| Belegte Gästezimmertage | *"Anzahl der Tage im Berichtsmonat, an denen die Gästezimmer tatsächlich belegt waren."* | Room nights occupied. |
| Auslastung der Gästezimmer | *"Belegte Gästezimmertage/angebotene Gästezimmertage x 100."* | Computed by the office; the alternative percentage is a fallback. |

### 1.3 Period and deadline

- Monthly; the reporting period is the preceding calendar month (§ 2 (1), (2) BeherbStatG). The number of guest rooms is collected only once a year, reference day 31 July. [D1]
- The statute sets no day of the month. BStatG § 15 (5): the answer must be given *"innerhalb der von den Erhebungsstellen gesetzten Fristen"* (within the deadlines set by the collecting offices), that is by each state statistical office. [D2]
- **Bavaria** prints on its form HOT: *"Rücksendung bitte bis zum 5. Tag nach Ablauf des Berichtsmonats"* (return by the 5th day after the end of the reporting month). [D9] (Sample form dated 2020 as published on the office's page today.)
- The federal sample form in the survey portal prints no day. [D8] The deadlines of the other fifteen state offices were not retrieved: **UNVERIFIED**. Treat the deadline as a per-property setting with a default of the 5th of the following month, the strictest value found.
- Timing pressure is real: the provisional federal result is published within 40 days after the end of the month, and missing reports are imputed and replaced when the report arrives late within the calendar year. [D3, ch. 3.3 and 5] Establishments may correct reported values by reporting again. [D10]

### 1.4 Submission channel and file formats

- Electronic submission is mandatory. BStatG § 11a (2): *"Werden Betrieben und Unternehmen für die Übermittlung der für eine Bundesstatistik zu erhebenden Daten elektronische Verfahren zur Verfügung gestellt, sind sie verpflichtet, diese Verfahren zu nutzen. Zur Vermeidung unbilliger Härten kann die zuständige Stelle auf Antrag eine Ausnahme zulassen."* (Where electronic procedures are provided, businesses must use them; hardship exemptions on application.) [D2]
- Destatis: *"Für diese Statistik besteht seit August 2014 eine Online-Meldepflicht. Als Erhebungsinstrumente werden Internet-Fragebögen (IDEV) und technische Schnittstellen zu Buchungssystemen der Beherbergungsbetriebe (eSTATISTIK.core) verwendet. In besonderen Härtefällen ist die Meldung per Papierfragebogen zulässig."* (Online reporting has been mandatory since August 2014, by web form IDEV or by the technical interface to booking systems eSTATISTIK.core.) [D3, ch. 3.2]
- **Two official channels** [D4][D5][D6]:
  1. **IDEV** (Internet Datenerhebung im Verbund): web form filled in by hand in the browser; per the portal it also offers plausibility checks and file upload. [D5] The upload format IDEV accepts for this survey was not retrieved: **UNVERIFIED**.
  2. **eSTATISTIK.core (.CORE)**: machine delivery from the hotel's own software. *"Das Statistikmodul steuert als Softwarekomponente die Gewinnung der statistischen Daten, erstellt das Datenpaket im statistikspezifischen XML-Format DatML/RAW und übernimmt dessen Übermittlung sowie das abschließende Abrufen von Prüfprotokollen."* (The statistics module extracts the data, builds the package in the XML format DatML/RAW, transmits it and fetches the check protocol.) [D6]
- **File format**: XML, document type **DatML/RAW**, part of the XÖV-certified message format **XStatistik**; the receipt comes back as **DatML/RES**. [D6][D7] CSV is accepted only through the .CORE web application, which converts it: *"Liegen Ihre Daten in einem CSV-Format vor, bietet Ihnen die CORE-Webanwendung die Möglichkeit, basierend auf dieser CSV-Datei das Lieferdatenformat DatML/RAW erzeugen und diese unmittelbar an die Statistik übermitteln zu lassen."* [D7]
- **Transport**: HTTPS (TLS) to the common data entry point `https://core.estatistik.de/`, port 443, path `/core/`; from there the delivery is routed to the competent state office. One registration and one account serve all states and all statistics. [D5][D6]
- **Vendor interface**: the offices provide the free library **CORE.connect** (Java, .NET, C/C++ via JNI) and, for Java, CORE.inspector. The content of a delivery for one statistic is fixed in its **Liefervereinbarung** (delivery agreement) and **Erhebungsbeschreibung**. Vendors register as software manufacturer in the portal, run a joint test with the offices, and are then listed as software provider. Deliveries flagged "Test" are discarded. [D6][D7]
- **Field names of the delivery agreement for this survey** (statistic ID 0037 in the portal), as named on the official survey page [D4]: `ArtBetrieb` (11 = Hotellerie, 13 = Sonstiges Beherbergungsgewerbe, 22 = Camping), `BettenStellplaetze`, `GaestezimmerJuli`, `AngebotenZimmertage`, `BelegteZimmertage`, `SchliessungTag`, `WiedereroeffnungDatum`, `AbmeldungTag`, `AnkuenfteGesamt`, `UebernachtungenGesamt`, `WohnsitzLand`, `AnkuenfteLand`, `UebernachtungenLand`. The delivery agreement document itself (XML structure, country code list, value ranges) is not linked on the public page and was not retrieved: **UNVERIFIED**; obtain it on vendor registration.
- **One delivery per property**: *"Falls Meldungen für mehrere Beherbergungsbetriebe übermittelt werden sollen, geben Sie bitte für jeden Betrieb eine separate .CORE-Meldung ab. Hierfür erhält jeder Betrieb eine eigene Berichtseinheit-ID."* (Each establishment gets its own reporting unit ID.) [D4]
- **Questionnaire structure** (form HOT, Hotellerie) [D8]: A reporting month and year; B beds offered on the last open day of the month (code 04); C guest rooms on 31 July, July report only (05); D room days offered (02), room days occupied (03), or alternatively occupancy in full percent (06), only with 25 or more rooms, the state of the last available July deciding; E temporary closure (08), reopening (09), deregistration (10); F arrivals and overnight stays per country of residence (codes 13 to 99). Separate forms exist for camping (CAM) and other accommodation (SOB). [D4]
- **Country list of form HOT, section F** [D8], headed *"Wohnsitz der Gäste (nicht Staatsangehörigkeit)"* (residence of the guests, not nationality): Deutschland; Europe: Belgien, Bulgarien, Dänemark, Estland, Finnland, Frankreich, Griechenland, Vereinigtes Königreich, Irland, Island, Italien, Kroatien, Lettland, Litauen, Luxemburg, Malta, Niederlande, Norwegen, Österreich, Polen, Portugal, Rumänien, Russische Föderation, Schweden, Schweiz (including Liechtenstein), Slowakei, Slowenien, Spanien, Tschechien, Türkei, Ukraine, Ungarn, Zypern, Sonstiges Europa; Africa: Südafrika, Sonstiges Afrika; America: Kanada, Vereinigte Staaten, Mittelamerika/Karibik, Brasilien, Sonstiges Südamerika, Sonstiges Nordamerika; Asia: Arabische Golfstaaten, China/Hongkong, Indien, Israel, Japan, Südkorea, Taiwan, Sonstiges Asien; Australien; Neuseeland/Ozeanien; Ohne Angabe; Insgesamt. The membership of every "other" group is listed on the form and the survey page. [D4][D8]
- **Rules for counting** [D4][D8]:
  - Arrivals: guests who arrived in the month; guests still present from the previous month are not arrivals. Day guests are not counted. *"Tagesgäste werden nicht erfasst."*
  - Overnight stays: all nights in the month, including those of guests who arrived earlier. Official example: three persons arriving 25 July and leaving 6 August give July 3 arrivals and 21 nights, August 0 arrivals and 15 nights.
  - Purpose of stay is irrelevant; business travellers and fitters count. *"Auch Monteure müssen gemeldet werden."*
  - Refugees are not overnight guests and are excluded, as are the rooms and beds they occupy. *"Geflüchtete sind dagegen keine Übernachtungsgäste."*
  - Stays longer than one year, and guests who have registered a residence at the property, are excluded together with their beds.
  - Beds of 1.40 m width or more count as two bed places.
  - A month without arrivals and nights still requires a nil report (*Fehlanzeige*), unless a temporary closure with reopening date has been notified.
  - "Ohne Angabe" (unknown) is to be used only in exceptional cases.
- **Source of the country of residence**, in the offices' own words: *"können Sie beispielsweise auf die bei der Buchung angegebene Wohnadresse oder auf den Meldeschein zurückgreifen, den Sie für ausländische Staatsangehörige aufgrund des Bundesmeldegesetzes (§§29, 30 BMG) erfassen."* (Use the home address given at booking, or the Meldeschein collected for foreign nationals.) [D4] Since 1 Jan 2025 German nationals no longer fill in a Meldeschein (see `dach-compliance.md` 1.1), so for them the booking address is the only source.

### 1.5 Differences between the federal states

- The law and the figures are federal and uniform; the survey is carried out by the state offices: *"Die Erhebung wird dezentral von den Statistischen Ämtern der Länder durchgeführt."* [D3, ch. 3.2] The recipient of the report is therefore the statistical office of the state in which the property lies.
- **Deadline differs by state**: set by each office under BStatG § 15 (5); Bavaria asks for the 5th day after month end. [D2][D9] Other states **UNVERIFIED**.
- **Channel is the same everywhere**: IDEV and eSTATISTIK.core through the common portal and the common .CORE entry point, which routes to the competent office. [D5][D6] Bavaria names exactly these two: *"Meldung: IDEV, eSTATISTIK.core"*. [D9] The portal page carries one state-specific note, a link to a separate service of the Statistisches Landesamt Rheinland-Pfalz for its respondents. [D4] What that service differs in was not established: **UNVERIFIED**.
- **Additional state surveys below the threshold**: states may survey smaller establishments under state law. Rheinland-Pfalz did so until 2020: *"Seit Januar 2021 werden keine Daten mehr in Betrieben mit weniger als zehn Betten erhoben (Privatquartiere und gewerbliche Kleinbetriebe). Diese wurden bis dahin in Gemeinden mit Fremdenverkehrsprädikat auf landesrechtlicher Grundlage zusätzlich zum bundesweit befragten Berichtskreis erhoben."* [D10] Whether any state still runs such a survey today was not established: **UNVERIFIED**. It would concern only properties under ten beds, which are outside the core market of this product.
- **Regional breakdowns** (Reisegebiete, Gemeindegruppen by spa or resort status) are national particularities applied by the offices from the property's address; the hotel reports nothing extra for them. [D3, ch. 2.1.3]
- **Not part of this statistic**: municipal Kurtaxe and Übernachtungsteuer filings (see `dach-compliance.md` section 2) are separate duties toward the municipality with their own forms.

## 2. Austria

### 2.1 Legal basis and who must report

- **Tourismus-Statistik-Verordnung 2002**, BGBl. II Nr. 498/2002, as amended by BGBl. II Nr. 564/2003, 502/2004 and 24/2012, issued under the Bundesstatistikgesetz 2000. Consolidated text as of 29 Sep 2026. [A1]
- **No bed threshold for the establishment.** The threshold sits at the municipality. § 2 (1) Z 7: *"Erhebungsgemeinde: Städte und Gemeinden mit mehr als 1 000 Gästenächtigungen im Kalenderjahr."* (Survey municipality: towns and municipalities with more than 1,000 guest nights per calendar year.) § 4 (1): *"In den Erhebungsgemeinden sind monatlich die Ankünfte, Übernachtungen und Herkunftsländer der Gäste zu erheben."* [A1] Every establishment in such a municipality reports, including private hosts with up to ten beds (§ 2 (1) Z 5). [A1]
- **Who is liable**, § 5: *"der Unterkunftsgeber oder sein Beauftragter"* (the accommodation provider or the person he appoints); for campsites the supervising person or the owner. [A1]
- **Guests**, § 2 (1) Z 1: *"Urlauber, Geschäftsreisende, Kurgäste und sonstige Personen, die in einem Beherbergungsbetrieb nicht länger als zwölf Monate nächtigen."* (Holidaymakers, business travellers, spa guests and others staying no longer than twelve months.) [A1]

### 2.2 Figures

- Monthly: arrivals, overnight stays and countries of origin of the guests (§ 4 (1)). [A1]
- **Country of origin is residence, not nationality.** § 2 (1) Z 2: *"Herkunftsland des Gastes: Land des Hauptwohnsitzes des Gastes; wenn dieses nicht bekannt ist, das Land seines gewöhnlichen Aufenthaltes."* (Country of the guest's main residence; if unknown, the country of habitual abode.) [A1] This is the same "Herkunftsland" field that the guest register already requires under MeldeG § 5 (1) next to "Staatsangehörigkeit" (see `dach-compliance.md` 1.7), so in Austria both values are captured on the Gästeblatt by law.
- Yearly, reference day 31 May (§ 4 (2)): type of establishment; number of guest beds, extra beds (*Zusatzbetten*) and mattress-dormitory places available in winter and summer season; the calendar months in which the establishment is fully or partly open; for hotels and similar establishments also the category (*Betriebsgruppe*) under the classification rules of the Fachverband Hotellerie of the Wirtschaftskammer and the number of rooms. [A1]
- Seasons: winter 1 November to 30 April, summer 1 May to 31 October (§ 2 (1) Z 8, 9). [A1]
- **No occupied-room figure.** The ordinance asks for no room nights and no room occupancy; occupancy is derived from nights and beds. [A1]

### 2.3 Period, deadline and recipient: the municipality, linked to the guest register

§ 6 (1), verbatim [A1]:

> Die Gemeinden gemäß § 2 Abs. 1 Z 7 haben die in § 4 Abs.1 angeführten Daten zu erheben. Zu diesem Zweck haben die Auskunftspflichtigen der Erhebungsgemeinde zu übermitteln:
> 1. unverzüglich, spätestens jedoch innerhalb von 48 Stunden nach der Ankunft und nach der Abreise des jeweiligen Gastes die Meldedaten (§ 10 Meldegesetz 1991) „Ankunft“ und „Abreise“ jeweils verknüpft mit „Herkunftsland“ oder
> 2. bis zum 5. eines jeden Kalendermonats den an Hand der in Z 1 angeführten Meldedaten "Ankunft", "Abreise" und "Herkunftsland" des jeweiligen Gastes vollständig ausgefüllten und unterfertigten Betriebsbogen gemäß Abs. 3 über das vorangegangene Kalendermonat.

Gloss: the hotel reports to its **municipality**, not to Statistik Austria, in one of two modes: (1) per guest, without delay and at the latest within 48 hours after arrival and after departure, the guest-register data "arrival" and "departure" each linked with "country of origin"; or (2) by the 5th of each month the completed and signed establishment sheet (*Betriebsbogen*) for the previous month.

- **The hotel does not choose the mode.** § 6 (2): Statistik Austria decides, after hearing the municipality and considering its technical conditions, which mode applies in that municipality. [A1]
- **Betriebsbogen fields** (§ 6 (3)): name and address of the establishment; month and year; type of establishment; number of arrivals and overnight stays by country of origin. [A1]
- The municipality checks completeness, compiles the *Gemeindebogen* and sends it to Statistik Austria by the 15th of the following month (§ 6 (5) Z 3). It keeps the guest sheets and establishment sheets until 31 October of the following year (§ 6 (5) Z 4). [A1]
- **Yearly capacity sheet** (*Bestandsbogen*): reference day 31 May, signed, to the municipality by 5 June (§ 7 (4)). [A1]

### 2.4 Submission channel and format

- § 8 (1): *"Wenn bei der Erhebungsgemeinde die technischen Voraussetzungen gegeben sind, können die Auskunftspflichtigen die Daten gemäß § 6 Abs. 1 und 3 sowie § 7 Abs. 2 auf elektronischem Weg der Erhebungsgemeinde übermitteln."* (Where the municipality has the technical means, the data may be sent to it electronically.) [A1]
- The ordinance names **no file format and no federal interface** for the hotel. The channel is whatever the municipality operates.
- Statistik Austria confirms recipient and deadlines: *"Ankünfte und Nächtigungen: monatlich, bis spätestens 5. des dem Berichtsmonat folgenden Monats an das Gemeindeamt bzw. Magistrat. Betriebe und Betten: jährlich, bis spätestens 5. Juni des Berichtsjahres an das Gemeindeamt bzw. Magistrat."* and *"Die Meldung erfolgt an die Berichtsgemeinde mittels Fragebogen."* [A2]
- **Official forms for the hotel**: `F-B1/2` (monthly arrivals and overnight stays) and `F-B3` (yearly capacity), published as OpenDocument spreadsheets (.ods) to be saved locally, filled in and sent to the municipality. [A2][A4]
- **Two equal-ranking inputs**: the guest register sheets (*Gästeverzeichnisblätter*), which *"können an die Gemeinde auch elektronisch übermittelt werden"*, or the Betriebsbogen F-B1/2. The hotel may keep its guest register electronically. [A3, ch. 2.1 and 5.1]
- **Interface for PMS vendors**: none is defined federally. The web questionnaire (E-Quest in the Statistik Austria portal, with TXT import in a predefined record layout) is the channel of the **municipality** toward Statistik Austria, in use since reporting month November 2020, not of the hotel. [A3, ch. 2.1 and 5.1.4] Which electronic guest-registration systems the individual municipalities and tourism associations run, and their interfaces, were not researched from primary sources: **UNVERIFIED**; this is a per-municipality integration.
- **Country codes are fixed**: *"Dies bedeutet, dass Betriebe bzw. Softwarefirmen, die die Nächtigungsstatistik erstellen, die vorgegebenen Ländercodes der Statistik Austria verwenden müssen."* (Establishments and software firms must use the country codes given by Statistik Austria.) [A3, ch. 4.5]
- **Origin list of form F-B1/2** [A4]. It is finer than a country list for the two main markets:
  - Austria by federal state: Burgenland, Kärnten, Niederösterreich, Oberösterreich, Salzburg, Steiermark, Tirol, Vorarlberg, Wien.
  - Germany by region: Bayern; Baden-Württemberg; Nordrhein-Westfalen; Mitteldeutschland (Hessen, Rheinland-Pfalz, Saarland); Norddeutschland (Niedersachsen, Hamburg, Bremen, Schleswig-Holstein); Ostdeutschland (Sachsen, Sachsen-Anhalt, Thüringen, Brandenburg, Mecklenburg-Vorpommern); Berlin.
  - Other origins: Arabische Länder in Asien, Australien, Belgien, Brasilien, Bulgarien, China (incl. Hong Kong, Macao), Dänemark, Estland, Finnland, Frankreich (incl. Monaco), Griechenland, übrige GUS, Indien, Irland, Island, Israel, Italien, Japan, restliches Südosteuropa, Kanada, Kroatien, Lettland, Litauen, Luxemburg, Malta, Neuseeland, Niederlande, Norwegen, Polen, Portugal, Rumänien, Russland, Saudi-Arabien, Schweden, Schweiz und Liechtenstein, Slowakei, Slowenien, Spanien, Südafrika, Südkorea, Südostasien, Taiwan, Tschechische Republik, Türkei, Ukraine, Ungarn, USA, Vereinigte Arabische Emirate, Vereinigtes Königreich, Zypern, Übriges Afrika, Übriges Asien, Zentral- und Südamerika, Übriges Ausland, Insgesamt.
  - The form prints a two-digit code next to each origin. The codes were read from the spreadsheet but the pairing of code to origin was not checked cell by cell: take the codes from the form itself [A4], not from this note.
- **Type of establishment on form F-B1/2** [A4]: 5-Stern/5-Stern Superior; 4-Stern Superior; 4-Stern; 3-Stern/3-Stern Superior; 2-/1-Stern; Gewerbliche Ferienwohnung; Privatquartier (on or not on a farm); Campingplatz; Kurheim; Kinder- und Jugenderholungsheim; Jugendherberge; Schutzhütte; private Ferienwohnung; Sonstige Unterkunft. Unclassified hotels assign themselves to the comparable star category.
- **Rules for counting** [A3][A4]:
  - Arrivals are newly arrived guests only; nights are counted for all guests. *"Jeder Gast wird daher so oft gezählt als er im Monat Nächtigungen aufweist."* [A4]
  - A night from the last day of a month to the first of the next belongs to the month of the evening: *"so gilt diese Übernachtung noch für jenen Monat, in dem er angekommen ist."* [A3, ch. 5.1.5]
  - Children count: *"Ja, auch Kinder sind zu erfassen!"*, even where state law exempts them from Ortstaxe. [A3, ch. 0]
  - Paying or not is irrelevant (*"entgeltlich oder unentgeltlich"*). [A3, ch. 0]
  - Refugees are excluded. Patients of hospitals and rehabilitation institutions are excluded. Owners of second homes are excluded. Stays beyond twelve months are excluded. [A3, ch. 0 and 5.1.5]
  - **Workers**: *"Personen, die zur Ausübung einer Tätigkeit im Ort nächtigen (z.B. Montage- oder Saisonarbeiter), sind nicht Gegenstand der Beherbergungsstatistik."* but *"Sind Nächtigungsgemeinde und Firmensitz unterschiedlich, so sind diese Personen als Gäste im Sinne der Beherbergungsstatistik zu erfassen."* [A3, ch. 0] Statistik Austria itself notes in a footnote that the delimitation is unsettled. This differs from Germany, where fitters are always counted. [D4]
  - For group travel, the tour leader's country of origin must never be applied to all members. For business travel, the company seat is never the country of origin. [A3, ch. 0 and 4.5]
  - A nil report (*Leermeldung*) is expected. [A3, ch. 5.1.5]
- **Country of origin in the words of the guideline**: *"Als Herkunftsland gilt das Land des Hauptwohnsitzes, welches nicht mit der Nationalität laut Reisedokument übereinstimmen muss. ... So ist beispielsweise eine Russin, die in Deutschland ihren ordentlichen Wohnsitz hat, als Deutsche und nicht als Russin zu zählen."* (The country of main residence, which need not match the nationality in the travel document; a Russian woman resident in Germany counts as German.) [A3, ch. 4.5]
- **Link to local tax**: municipalities compute the local levy per establishment from the same night counts [A3, ch. 4.4.3], so the monthly statistics sheet and the Ortstaxe declaration usually travel together. The rules for the levy are state law (see `dach-compliance.md` 2.2).

- **Yearly form F-B3** [A5]: per month of the tourism year (November to October) the number of days open (a dash for a full month, blank for a closed month); for hotels and similar establishments rooms, beds and extra beds (*Zusatzbetten*, including mattress dormitories) under the star category; due 5 June at the municipality, dated and signed.

## 3. Switzerland

### 3.1 Legal basis and who must report

- **Bundesstatistikgesetz (BStatG, SR 431.01)**, Art. 6 Abs. 4: *"Wenn es die Vollständigkeit, Repräsentativität, Vergleichbarkeit oder Aktualität einer Statistik unbedingt erfordert, kann der Bundesrat ... bei der Anordnung einer Erhebung natürliche und juristische Personen des privaten und öffentlichen Rechts und deren Vertreter zur Auskunft verpflichten. Die verpflichteten Personen müssen die Auskünfte wahrheitsgetreu, fristgemäss, unentgeltlich und in der vorgeschriebenen Form erteilen."* (The Federal Council may make answering mandatory; those obliged must answer truthfully, in time, free of charge and in the prescribed form.) Version in force 1 Jan 2024. [C1]
- **Bundesstatistikverordnung (BStatV, SR 431.011) of 30 April 2025**, in force since 1 June 2025, Anhang 1, entry **09.27 "Befragung für die Beherbergungsstatistik"** [C2], verbatim:

> Zuständiges Organ: Bundesamt für Statistik
> Gegenstand: Ankünfte und Logiernächte der Gäste nach Herkunftsland, Beherbergungskapazität und durchschnittliche Einnahmen pro Nacht
> Art und Methode: Vollbefragung der Besitzerinnen und Besitzer sowie der Leiterinnen und Leiter von Hotels, Kurbetrieben, Zelt- und Wohnwagenplätzen
> Auskunftspflicht: Obligatorisch
> Periodizität und Zeitpunkt der Durchführung: Monatlich
> Mitwirkende bei der Durchführung: Kantone, touristische Verbände

  Gloss: subject is arrivals and overnight stays by country of origin, accommodation capacity and average takings per night; full survey of owners and managers of hotels, health establishments, tent and caravan sites; mandatory; monthly; cantons and tourism associations take part in carrying it out.
- This ordinance repealed the Statistikerhebungsverordnung of 30 June 1993 (SR 431.012.1), which older material still cites (Art. 47 Nr. 2). [C2] A consolidated version dated 15 Oct 2026 is already published in Fedlex; it was not compared with the version in force: **UNVERIFIED** whether entry 09.27 changes.
- **No size threshold** appears in the entry: every hotel, health establishment and campsite is covered. The survey is known as **HESTA** and reaches about 5,000 establishments according to the fact sheet (the web page says 6,000). [C3][C4] The unit is the local establishment (*Arbeitsstätte*). [C3]
- Holiday flats and collective accommodation fall under a separate survey, the Parahotelleriestatistik (entry 09.28), which is a sample survey on the demand side. [C2] Out of scope for a hotel system.

### 3.2 Figures

- From the ordinance: arrivals and overnight stays (*Logiernächte*) by country of origin; capacity; average takings per night. [C2]
- From the official instructions for the online form [C5]: number of **opening days** in the month; whether overnight stays occurred; **arrivals and overnight stays by country of residence**; **number of occupied rooms**; **average takings per person and night** (*"die Anzahl besetzte Zimmer und die durchschnittlichen Einnahmen pro Person und Nacht"*); and on the first page the establishment's standing data such as contact person and number of beds, to be corrected when changed. The fact sheet names rooms and beds as core variables. [C3]
- **Country of residence, not nationality**: *"erfassen Sie dort die Ankünfte und Logiernächte nach dem Wohnsitzland (nicht Nationalität) der Gäste."* [C5]
- **Country coding**: countries are picked by name or **ISO code**; the office publishes the list as "ISO-Ländercodes" with two-letter codes (CH, DE, FR, IT ...). [C5][C6] Unlike Germany and Austria there are no grouped "other" rows in the published list: each country is reported on its own.
- What "average takings per person and night" includes (breakfast, VAT, tourist tax) is not defined in the documents retrieved: **UNVERIFIED**.
- Whether Swiss residents are broken down by canton: not in the documents retrieved; the form asks for a country. [C5]

### 3.3 Period and deadline

- Monthly, reference period the calendar month. [C2][C3] *"Im Normalfall haben Sie immer den letzten Monat auszufüllen."* [C5]
- The day of the month by which the report is due was not found in any document retrieved: **UNVERIFIED**. The fact sheet states only *"Nach zehn Tagen wird eine schriftliche Mahnung versandt"* (a written reminder is sent after ten days), and that monthly figures are available 25 working days after the end of the month. [C3]
- A month with the establishment closed or with zero nights must still be reported (zero opening days, or "no" to overnight stays). [C5]

### 3.4 Submission channel and file formats

- Channels named by the office: *"Internet (http://www.esurvey.bfs.admin.ch/eHESTA), Hotelsoftwares (PMS), E-Mail oder Papierfragebogen."* [C3]
- **eHESTA** is the online form; login with a user number and a password that the system reissues every month by e-mail. [C5][C7]
- **Upload from hotel software**: the form has a button for it: *"Hier können Sie die Daten von Ihrer Hotelsoftware hochladen, sofern diese eine entsprechende Exportfunktion aufweist. Fragen Sie bei Ihrer Kontaktperson beim Softwarehersteller nach."* (Upload the data from your hotel software if it has a matching export function.) [C5] The **file format and its specification are not published** on the pages retrieved: **UNVERIFIED**. Request it from the office (hotelstatistik@bfs.admin.ch, Sektion Tourismus). [C3][C4]
- The report is sent to the federal office, not to the canton or municipality. Cantons and tourism associations are named as participants in carrying out the survey [C2]; whether some collect on the office's behalf was not established: **UNVERIFIED**.
- Separate from this: the cantonal guest registration and tourist tax returns (see `switzerland-registration.md`).

## 4. Report v1 must ship

This section is a conclusion drawn from sections 1 to 3, not a quotation of law.

### 4.1 Comparison

| | Germany | Austria | Switzerland |
|---|---|---|---|
| Legal basis | BeherbStatG, BStatG [D1][D2] | Tourismus-Statistik-Verordnung 2002 [A1] | BStatG Art. 6, BStatV Anhang 1 Nr. 09.27 [C1][C2] |
| Who | 10 or more bed places [D1] | every establishment in a municipality with more than 1,000 nights a year [A1] | every hotel, health establishment, campsite [C2] |
| Recipient | statistical office of the state, through one national entry point [D4][D6] | the municipality [A1][A2] | Federal Statistical Office [C3] |
| Period | month | month, or per guest within 48 hours [A1] | month |
| Deadline | set by state; Bavaria 5th day [D9] | 5th of following month [A1][A2] | UNVERIFIED |
| Arrivals and nights | by country of residence, fixed list with grouped rows [D8] | by residence: Austrian state, German region, country list [A4] | by country of residence, ISO code [C5][C6] |
| Capacity | beds monthly (last open day); rooms yearly at 31 July [D1][D8] | yearly at 31 May: rooms, beds, extra beds, open days per month [A1][A5] | beds and rooms as standing data; opening days monthly [C3][C5] |
| Room occupancy | room days offered and occupied, from 25 rooms [D1] | not asked [A1] | occupied rooms [C5] |
| Money | none | none | average takings per person and night [C2][C5] |
| Machine channel | eSTATISTIK.core, XML DatML/RAW [D6][D7] | none federal; municipal systems [A1][A3] | upload in eHESTA, format unpublished [C5] |

### 4.2 Definition

**Official tourism statistics** is one fixed report per property and calendar month, in the variant of the property's country. It counts persons, not rooms or reservations.

Common rules, identical in the three countries:

1. **Arrivals** = persons whose stay at the property began on a date within the month and who stayed at least one night. [D8][A4]
2. **Overnight stays** = person-nights whose evening falls within the month, including guests who arrived in an earlier month. The night from the last day of a month to the first of the next belongs to the earlier month. [D8][A3]
3. Both are grouped by **origin = country of residence of each person**, never nationality. [D3][A1][C5]
4. Not counted: day use without a night; no-shows and cancellations; persons flagged as excluded (item 5 in section 5). [D4][A3]
5. The report is produced per property, never consolidated across properties. [D4][A1]
6. A month without nights still yields a report (nil report). [D8][A3][C5]

Germany variant (layout of form HOT [D8]):
- Header: property's identification number at the statistical office, month and year.
- Beds offered on the last open day of the month.
- Guest rooms offered on 31 July, shown in the July report.
- For properties with 25 or more guest rooms: room days offered and room days occupied in the month.
- Dates of temporary closure, planned reopening, deregistration.
- One row per origin of the official list with its form code, columns arrivals and overnight stays, plus "Ohne Angabe" and the total.

Austria variant (layout of form F-B1/2 [A4] and, once a year, F-B3 [A5]):
- Header: property, municipality, month and year, type of establishment by star category.
- One row per origin of the official list, where residents of Austria are split by federal state and residents of Germany by region, columns arrivals and overnight stays, total.
- Yearly capacity sheet at 31 May: rooms, beds, extra beds, days open per month of the tourism year.
- Where the municipality requires per-guest reporting within 48 hours instead of the monthly sheet, the statistics data travel with the guest register entry (arrival, departure, country of origin) and no monthly sheet is due. [A1] That mode belongs to the guest register ticket; the report here still serves as the property's own control total.

Switzerland variant (content of the eHESTA form [C5]):
- Opening days in the month.
- One row per country of residence (ISO 3166-1 alpha-2), columns arrivals and overnight stays, total.
- Occupied rooms in the month.
- Average takings per person and night.
- Standing data: rooms, beds.

Figures that differ from the internal reports of "Reporting scope":
- Room days offered and occupied follow the statistical definitions, not the internal **Available Rooms** and **Occupancy (figure)**. Rooms used by staff are not guest rooms at all [D3], and rooms occupied by excluded persons are left out of both figures [D8]. The internal Occupancy counts house use as occupied. The report therefore states its own base. How Out of Order rooms enter "room days offered" is not spelled out by the offices beyond *"tatsächlich zur Verfügung standen"* (actually available) [D3]; excluding them is the reading taken here and should be confirmed with a state office: **UNVERIFIED**.

Delivery in v1:
- The report opens as a Workspace Tab, prints, and exports as spreadsheet file and PDF, with rows in the order and with the codes of the official form, so that staff can key or paste it into IDEV, send F-B1/2 to the municipality, or fill eHESTA.
- The report is frozen when the user marks it as submitted (who, when, figures). A later change of underlying data shows as a difference and leads to a corrected report, which the German offices accept within the calendar year. [D3][D10]
- A reminder on the property's deadline day (default the 5th of the following month).
- Direct machine delivery is **not** in the definition of v1, because none of the three specifications could be read: the German delivery agreement for .CORE is handed out on vendor registration [D6], Austria has no federal interface [A1], and the Swiss upload format is unpublished [C5]. Registering as software manufacturer with the German offices and requesting the Swiss format are the two follow-up actions; the data model in section 5 is sufficient for both.

## 5. Data the system must capture

Per guest and stay:

1. **Country of residence** of every person staying, as ISO 3166-1 alpha-2, stored as its own field next to nationality. Nationality stays what the Meldeschein needs; country of residence is what all three statistics need. [D3][D8][A1][C5] Default: the country of the guest's home address; the booker's or company's address must never be used as a fallback [A3, ch. 4.5]. "Unknown" is allowed but reported as "Ohne Angabe" and should be rare. [D8]
2. **Region of residence** for residents of Austria (federal state) and Germany (federal state), needed by properties in Austria [A4]. Derive it from the postal code of the home address; therefore the postal code is required whenever the country of residence is Austria or Germany and the property is in Austria.
3. **Every person, not only the Primary Guest**: companions and children each count as an arrival and produce nights. [A3, ch. 0][D8] The German Meldeschein records spouse and minor children only as a number (see `dach-compliance.md` 1.3), so the statistics cannot be read from it. Capture per reservation the persons with their country of residence; a companion inherits the Primary Guest's country of residence as an editable default. A tour leader's country must not be copied to the group. [A3, ch. 0]
4. **Actual first night and last night per person**, not only the reservation dates, so that early departures, extensions, and persons joining or leaving a room mid-stay produce correct person-nights.
5. **Exclusion from statistics** as a flag on the stay with a reason: refugee accommodation [D4][A3]; stay longer than twelve months or residence registered at the property [D4][A1]; second-home owner (Austria) [A3]; worker staying at the place of work under the Austrian rule [A3]; staff or house use (derived from the rule that rooms used by staff are not guest rooms [D3]). Rooms and beds occupied by excluded persons must be removable from the capacity figures. [D8]
6. **Day use** marked as such, so that it produces neither arrival nor night. [D8]

Already captured but needed from the source rather than this report: the home address at booking for German nationals, who no longer fill in a Meldeschein and for whom the booking address is the only source of residence. [D4] The Booking Engine, the Guest Portal pre-check-in and the front desk check-in must therefore ask for country of residence (or a full address) for all guests, not only for those who need a Meldeschein.

Per property:

7. **Statistical identity**: country variant; for Germany the state, the identification number (*Identnummer*, in .CORE *Berichtseinheit-ID*) issued per property, and the type of establishment (`ArtBetrieb` 11, 13 or 22) [D4]; for Austria the municipality, the reporting mode that municipality uses, and the type of establishment code of F-B1/2 [A1][A4]; for Switzerland the eHESTA user number [C5].
8. **Deadline day** per property, default the 5th of the following month. [D9][A1]
9. **Statistical bed places per Room**: regular beds, where a bed of 1.40 m width or more counts as two and a regularly offered sofa bed counts; extra beds and cots are not included [D4][D8]. For Austria additionally the number of **extra beds** per room [A5]. This is a new attribute: the rate system's Base Occupancy and maximum occupancy are not the same number.
10. **Rooms that are not guest rooms** (used by staff) flagged, so that they are outside every capacity figure. [D3]
11. **Dated history of rooms and beds**, so that the counts on a reference day (last open day of each month; 31 July; 31 May) can be reproduced later. [D1][A1]
12. **Opening calendar**: dates of temporary closure and reopening, days open per month, and final deregistration. [D1][D8][A5][C5]
13. **Occupied rooms per night** under the statistical definition (rooms occupied by counted guests). [D1][C5]
14. For Switzerland, **takings per person-night**, from the charges of counted stays; the revenue definition is open (section 3.2).

Per report:

15. **Submission record**: month, figures as submitted, user, time, channel, and any later corrected version.
16. **Mapping tables maintained by us, versioned by validity date**: ISO country to the German form rows and codes [D8], to the Austrian rows and codes including the regional split [A4], and the Swiss ISO list [C6]. The German survey page now classifies by WZ 2025 [D4] where the 2024 quality report still used WZ 2008 [D3], which shows that these lists move.

## Open points

| Point | Status |
|---|---|
| German delivery agreement for .CORE (XML structure, country codes, value ranges) | UNVERIFIED, obtainable on vendor registration [D6] |
| Deadlines of German state offices other than Bavaria | UNVERIFIED |
| Upload format IDEV accepts for this survey | UNVERIFIED |
| What the separate service of Rheinland-Pfalz differs in | UNVERIFIED |
| Whether any German state still surveys establishments under ten beds | UNVERIFIED |
| Treatment of Out of Order rooms in "room days offered" | UNVERIFIED, reading taken: excluded |
| Austrian municipal electronic systems and their interfaces | UNVERIFIED, not researched |
| Swiss deadline day | UNVERIFIED |
| Swiss upload file format from hotel software | UNVERIFIED, request from the office |
| Swiss definition of average takings per person and night | UNVERIFIED |
| Text of Regulation (EU) No 692/2011 | not re-read; cited as named by the national offices |

Method note: web search was not available for this ticket; all sources were reached by direct retrieval from the official sites on 2026-09-29. The German survey portal and the Swiss statistics site render their content by script, so their texts were read from the sites' own content interfaces, whose addresses are given below.

## Sources

Germany:

- [D1] Beherbergungsstatistikgesetz (BeherbStatG), Stand: zuletzt geändert durch Art. 7 G v. 22.12.2025 I Nr. 354 — https://www.gesetze-im-internet.de/beherbstatg_2003/BJNR164200002.html
- [D2] Bundesstatistikgesetz (BStatG) § 11a, § 15, § 23 — https://www.gesetze-im-internet.de/bstatg_1987/__11a.html ; https://www.gesetze-im-internet.de/bstatg_1987/__15.html ; https://www.gesetze-im-internet.de/bstatg_1987/__23.html
- [D3] Statistisches Bundesamt, Qualitätsbericht "Monatserhebung im Tourismus" 2024, published 25 Aug 2025 — https://www.destatis.de/DE/Methoden/Qualitaet/Qualitaetsberichte/Gastgewerbe-Tourismus/tourismus-monatserhebung.pdf?__blob=publicationFile&v=14 (Note: its chapter 1.6 still cites the act as amended in 2015; the act itself [D1] is newer.)
- [D4] Erhebungsportal der Statistischen Ämter des Bundes und der Länder, survey page "Monatserhebung im Tourismus nach dem Beherbergungsstatistikgesetz" (statistic ID 0037, page 411, modified 1 Jul 2026), including "Wichtige Hinweise zur Datenmeldung", "Erläuterungen zur Art des Beherbergungsbetriebes" and "Erläuterungen und Ausfüllhinweise für einzelne Erhebungsmerkmale" — page: https://erhebungsportal.estatistik.de/Erhebungsportal/ ; content read from https://erhebungsportal.estatistik.de/Erhebungsportal/api/content/content/411
- [D5] Erhebungsportal, ".CORE" information page (page 119) — https://erhebungsportal.estatistik.de/Erhebungsportal/api/content/content/119 ; IDEV information: https://erhebungsportal.estatistik.de/Erhebungsportal/informationen/informationen-zu-idev-118
- [D6] Erhebungsportal, "Informationen für Softwarehersteller" (page 14), including "Sicherheit der Daten" and ".CORE Datenformate" — https://erhebungsportal.estatistik.de/Erhebungsportal/api/content/content/14 ; data entry point https://core.estatistik.de/core/
- [D7] Erhebungsportal, "Daten übermitteln" (page 838) — https://erhebungsportal.estatistik.de/Erhebungsportal/api/content/content/838
- [D8] Questionnaire "Monatserhebung im Tourismus – Hotellerie (HOT)" with explanations and legal notice, federal sample form from the Erhebungsportal — https://erhebungsportal.estatistik.de/Erhebungsportal/api/assets/files?downloadId=d6e957e5b9f04ea9aaefbe4a584c2235
- [D9] Bayerisches Landesamt für Statistik, survey page Tourismus and sample form HOT — https://www.statistik.bayern.de/service/erhebungen/wirtschaft_handel/tourismus/index.html ; https://www.statistik.bayern.de/mam/service/erhebungen/handel_gastgewerbe/tourismus/hot_s1-8_2020_fiu.pdf
- [D10] Statistisches Landesamt Rheinland-Pfalz, Tourismus, Methoden — https://www.statistik.rlp.de/themen/tourismus/hintergrund/methoden

Austria:

- [A1] Tourismus-Statistik-Verordnung 2002, BGBl. II Nr. 498/2002 idF BGBl. II Nr. 24/2012, consolidated version of 29 Sep 2026 (RIS) — https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=Bundesnormen&Gesetzesnummer=20002382
- [A2] Statistik Austria, "Beherbergungsstatistik – Betriebe" (last updated 11 Feb 2026) — https://www.statistik.at/ueber-uns/erhebungen/unternehmen/beherbergungsstatistik-betriebe
- [A3] Statistik Austria, "Organisation und Ablauf der österreichischen Beherbergungsstatistik. Ein Leitfaden für Berichtsgemeinden", 7th edition, March 2024 — https://www.statistik.at/fileadmin/pages/1177/Leitfaden_Beherbergungsstatistik_Maerz_2024.pdf
- [A4] Statistik Austria, form F-B1/2 "Ankünfte und Übernachtungen im Monat" — https://www.statistik.at/fileadmin/pages/1177/FB1-2.ods
- [A5] Statistik Austria, form F-B3, Tourismusjahr 2025/26 — https://www.statistik.at/fileadmin/pages/1177/F-B3_Tourismusjahr_2026.ods

Switzerland:

- [C1] Bundesstatistikgesetz (BStatG, SR 431.01), Stand 1 Jan 2024, Art. 6 — https://www.fedlex.admin.ch/eli/cc/1993/2080_2080_2080/de ; text read from https://fedlex.data.admin.ch/filestore/fedlex.data.admin.ch/eli/cc/1993/2080_2080_2080/20240101/de/html/fedlex-data-admin-ch-eli-cc-1993-2080_2080_2080-20240101-de-html-4.html
- [C2] Bundesstatistikverordnung (BStatV, SR 431.011) of 30 April 2025, Stand 1 Jun 2025, Art. 49 and Anhang 1 Nr. 09.27 and 09.28 — https://www.fedlex.admin.ch/eli/cc/2025/318/de ; text read from https://fedlex.data.admin.ch/filestore/fedlex.data.admin.ch/eli/cc/2025/318/20250601/de/html/fedlex-data-admin-ch-eli-cc-2025-318-20250601-de-html-8.html
- [C3] Bundesamt für Statistik, Steckbrief "Beherbergungsstatistik HESTA" — https://www.bfs.admin.ch/bfs/de/home/statistiken/tourismus/erhebungen/hesta.assetdetail.35950521.html ; file https://dam-api.bfs.admin.ch/hub/api/dam/assets/35950521/master
- [C4] Bundesamt für Statistik, "Beherbergungsstatistik" (HESTA) survey page — https://www.bfs.admin.ch/bfs/de/home/statistiken/tourismus/erhebungen/hesta.html
- [C5] Bundesamt für Statistik, "Beherbergungsstatistik - eHesta: Detaillierte Gebrauchsanweisung" (E-Survey Anleitung), published 7 Jan 2020 — https://www.bfs.admin.ch/bfs/de/home/statistiken/tourismus/erhebungen/hesta.assetdetail.11547270.html ; file https://dam-api.bfs.admin.ch/hub/api/dam/assets/11547270/master
- [C6] Bundesamt für Statistik, "ISO Ländercodes", published 7 Nov 2019 — https://dam-api.bfs.admin.ch/hub/api/dam/assets/10687502/master
- [C7] eHESTA online form, login page, version 9.4 of 1 Sep 2025 — https://www.esurvey.bfs.admin.ch/eHESTA
