# Arrival-day card transaction for the German Meldeschein (BMG § 29 (5) Nr. 1)

Researched: 2026-09-28. Scope: Germany only, the card path of the electronic Meldeschein.
Ticket: `.scratch/hotel-pms-v1/issues/25-arrival-day-card-transaction.md`.
Builds on `dach-compliance.md` § 1.5 (what § 29 (5) and the BeherbMeldV are) and `payments-provider-eu.md` (Stripe capabilities); neither is repeated here.

Statute text was pulled from gesetze-im-internet.de, the legislative reasoning from the Bundestag printed papers (dserver.bundestag.de), the XML schema from the Bundesanzeiger. German is quoted verbatim, followed by an English gloss. Points the sources do not settle are marked **UNSETTLED** (sources exist but conflict or stop short) or **UNVERIFIED** (no primary source found). Nothing here is legal advice; section 7 lists what a lawyer has to confirm.

## Verdict at a glance

| # | Question | Verdict | Confidence |
|---|---|---|---|
| 1 | Does a pre-authorisation (hold) with SCA count? | Probably yes. The statute asks for a "Zahlungsvorgang" that the guest "auslöst", not for a completed debit, and the official reasoning speaks of a "Zahlungs- oder Reservierungsvorgang". No official source says so in terms. | Medium. **UNSETTLED**, lawyer to confirm. |
| 2 | Does a zero-amount or minimal-amount verification count? | Zero-amount: probably no (no "Geldbetrag", so arguably no "Zahlungsvorgang"). Minimal amount: only if SCA demonstrably happened, which small amounts often skip through exemptions. Law is silent. | Low. **UNSETTLED**. |
| 3 | Does a payment made before arrival day count? | On the enacted wording, no: the confirmation happens "am Tag der Ankunft" by triggering the transaction. The government's reasoning and a 2020 BMI press release point the other way. | Medium for "no" as the safe rule. **UNSETTLED** because sources conflict. |
| 4 | Must the card belong to the registering guest? | The guest must personally trigger the transaction, and the stated purpose is to tie the token to "einer bestimmten Person". A third party's card defeats that purpose. Not spelled out in the statute. | Medium-high for "guest's own card". Company card in the guest's name: **UNSETTLED**. |
| 5 | What must be stored? | One string token plus the name of the hotel's payment service provider that generated it. Which Stripe identifier is "the token" is not defined anywhere official. | Storage duty certain; mapping **UNSETTLED**. |
| 6 | Where is the XSD, which version? | Bundesanzeiger, BAnz AT 10.07.2020 B1 (notice dated 17 June 2020). Unversioned. No later notice found. | High for location; "no later version" **UNVERIFIED**. |

---

## 0. The text and how it came to read that way

### 0.1 Text in force

BMG § 29 (5) Satz 1 [S1]:

> "Abweichend von Absatz 2 Satz 1 kann die Meldepflicht mit Zustimmung der beherbergten Person auch dadurch erfüllt werden, dass die in § 30 Absatz 2 genannten Daten elektronisch erhoben werden und die beherbergte Person deren Richtigkeit und Vollständigkeit am Tag der Ankunft bestätigt, indem die beherbergte Person
> 1. einen kartengebundenen Zahlungsvorgang mit einer starken Kundenauthentifizierung im Sinne des § 1 Absatz 24 des Zahlungsdiensteaufsichtsgesetzes auslöst, bei dem die zweckgebundene Zuordnungsnummer des eingesetzten Zahlungsmittels erhoben wird, [...]"

Gloss: with the guest's consent the duty can be met by collecting the § 30 (2) data electronically and having the guest confirm that they are correct and complete on the day of arrival, by the guest triggering a card-based payment transaction with strong customer authentication, in which the purpose-bound assignment number of the payment instrument used is collected.

BMG § 30 (2) Satz 5 [S2]:

> "Im Fall des § 29 Absatz 5 Nummer 1 ist die zweckgebundene Zuordnungsnummer des eingesetzten Zahlungsmittels zusammen mit den Daten nach Satz 1 zu speichern."

Gloss: in the card case, the purpose-bound assignment number of the payment instrument used must be stored together with the registration data.

ZAG § 1 (24) [S3]:

> "Starke Kundenauthentifizierung ist eine Authentifizierung, die so ausgestaltet ist, dass die Vertraulichkeit der Authentifizierungsdaten geschützt ist und die unter Heranziehung von mindestens zwei der folgenden, in dem Sinne voneinander unabhängigen Elementen geschieht, dass die Nichterfüllung eines Kriteriums die Zuverlässigkeit der anderen nicht in Frage stellt: 1. Kategorie Wissen, also etwas, das nur der Nutzer weiß, 2. Kategorie Besitz, also etwas, das nur der Nutzer besitzt oder 3. Kategorie Inhärenz, also etwas, das der Nutzer ist."

Gloss: SCA means authentication using at least two independent elements out of knowledge, possession and inherence.

### 0.2 Legislative history (this matters for points 1 and 3)

Three acts shaped § 29 (5) [S4]:

| In force | Act | What it did to § 29 (5) |
|---|---|---|
| 1 Jan 2020 | Drittes Bürokratieentlastungsgesetz (BEG III), Art. 1, G. v. 22.11.2019, BGBl. I S. 1746 | Inserted § 29 (5) with the three procedures, and § 30 (2) Satz 5 [S5] |
| 18 Mar 2021 | Gesetz zur Erprobung weiterer elektronischer Verfahren [...], G. v. 10.03.2021, BGBl. I S. 332 | Added Satz 2 (experimental clause) [S6] |
| 1 Jan 2025 | BEG IV, Art. 6, G. v. 23.10.2024, BGBl. 2024 I Nr. 323 | Removed the Personalausweis references, moved approval to the BSI, five-year term, added Satz 3 [S7] |

The card wording of Nr. 1 has not changed since 1 Jan 2020. The BEG IV reasoning on § 29 (5) deals only with the Personalausweis deletion and the experimental clause and says nothing about the card procedure [S8][S9].

**The government draft and the enacted text differ.** The government draft (BT-Drs. 19/13959, p. 9) read [S10]:

> "(5) Die zur Erfüllung der Meldepflicht gemäß § 30 Absatz 2 zu erhebenden Daten können auch ausschließlich elektronisch gespeichert werden, wenn durch die beherbergte Person zugleich ein kartengebundener Zahlungsvorgang mit einer starken Kundenauthentifizierung im Sinne des § 1 Absatz 24 des Zahlungsdiensteaufsichtsgesetzes ausgelöst wird. In diesem Fall wird die Unterschrift nach Absatz 2 Satz 1 mit Zustimmung der beherbergten Person ersetzt durch Speicherung der zweckgebundenen Zuordnungsnummer des eingesetzten Zahlungsmittels."

Gloss: the draft tied electronic storage to a card transaction triggered "at the same time" ("zugleich") and contained no "on the day of arrival" for the card route. In the draft, "am Tag der Ankunft" appeared only in the separate eID paragraph (draft Abs. 6).

The Wirtschaftsausschuss replaced this with the wording now in force, which puts "am Tag der Ankunft" in front of all three procedures (BT-Drs. 19/14421 (neu), synopsis p. 7-8) [S11]. Its entire explanation is (p. 30) [S11]:

> "Gegenüber dem Regierungsentwurf erfolgt lediglich eine sprachliche Anpassung des Artikels. Die Änderung beruht auf einer Anregung des Bundesministeriums für Justiz und Verbraucherschutz im Rahmen der Rechtsförmlichkeitsprüfung."

Gloss: compared with the government draft there is merely a linguistic adjustment, suggested by the Justice Ministry during the drafting-quality review.

Consequence: the only substantive official reasoning is the one written for the draft wording (next quote), while the enacted wording is stricter on timing. The committee said it changed nothing of substance. That is the root of the disagreement in point 3.

The government's reasoning on the card route (BT-Drs. 19/13959, p. 29) [S10], quoted in full because points 1, 3, 4 and 5 all turn on it:

> "Mit der Neuregelung in Absatz 5 wird künftig weitgehend auf papiergebundene Meldescheine verzichtet und eine ausschließlich elektronische Speicherung der gemäß § 30 Absatz 2 Satz 1 zu erhebenden Daten zugelassen, wenn die Speicherung mit einem elektronischen kartengebundenen Zahlungs- oder Reservierungsvorgang der beherbergten Person unter Anwendung einer starken Kundenauthentifizierung im Sinne des § 1 Absatz 24 des Zahlungsdiensteaufsichtsgesetz (ZAG) verknüpft wird. Die starke Kundenauthentifizierung erfordert mindestens zwei, voneinander unabhängige Elemente der Kategorien Wissen (z. B. die PIN), Besitz (z. B. die Debit- oder Kreditkarte) und Inhärenz, also ein ständiges Merkmal des Kunden (z. B. der Fingerabdruck). Die handschriftliche Unterschrift auf dem papiergebundenen Meldeschein wird in diesem Fall ersetzt durch die Speicherung einer zweckgebundenen Zuordnungsnummer für wiederkehrende Zahlungen (sog. Token). Dieser Token wird im Zuge der Abwicklung zwischen Hotel und kartenausgebender Stelle oder bei jedem Einsatz einer Zahlungskarte generiert und ermöglicht, die Zahlung einem bestimmten Karteninhaberkonto und damit einer bestimmten Person zuzuordnen. Dies ermöglicht einen Verzicht auf eine eigenhändige Unterschrift des Meldescheines als eindeutiges Identifizierungsmerkmal. In diesen Fällen bedarf es künftig keines papiergebundenen Hotelmeldescheins mehr. Erfolgt zu einem späteren Zeitpunkt der Beherbergung ein Wechsel zu einem anderen Zahlungsmittel mit starker Kundenauthentifizierung (etwa bei der endgültigen Bezahlung der Hotelrechnung), ist die ursprünglich (etwa im Zusammenhang mit der Reservierung) erzeugte Zuordnungsnummer durch die zum späteren Zeitpunkt erzeugte Nummer zu ersetzen. Erfolgt zu einem späteren Zeitpunkt der Beherbergung ein Wechsel zu einem Zahlungsmittel ohne starke Kundenauthentifizierung, ist ein papiergebundener Hotelmeldeschein handschriftlich zu unterschreiben."

Gloss: electronic-only storage is allowed when storage is linked to an electronic card-based payment *or reservation* transaction of the guest under SCA. The signature is replaced by storing a purpose-bound assignment number for recurring payments (a "token"). The token is generated in processing between hotel and card issuer, or on each use of a payment card, and allows the payment to be attributed to a particular cardholder account and thereby to a particular person; this is what allows the signature to be dropped as the unique identifying feature. If the guest later switches to another payment instrument with SCA (for example when finally paying the bill), the number originally generated (for example in connection with the reservation) is to be replaced by the later one. If the guest later switches to a payment instrument without SCA, a paper form must be signed by hand.

---

## 1. Does a card pre-authorisation (hold) with SCA count, or only a captured payment?

**Verdict: probably counts. UNSETTLED, because no statute, regulation or ministry publication says so expressly.**

What the primary sources say:

1. The statute requires that the guest "einen kartengebundenen Zahlungsvorgang [...] auslöst" (triggers a card-based payment transaction) [S1]. It does not say "Zahlung", "Belastung" or "bezahlt". Nothing in § 29, § 30 or the BeherbMeldV requires that money is finally debited or captured [S1][S2][S12].
2. The official reasoning names a "kartengebundenen Zahlungs- oder Reservierungsvorgang" (card-based payment or reservation transaction) as sufficient [S10]. "Reservierungsvorgang" is not defined. It can mean the card-guaranteed room booking or the reservation of funds on the card; on either reading the legislator did not have only completed debits in mind.
3. German payment law treats the blocking of funds as part of a card-based payment transaction. BGB § 675t (4) [S13]:
   > "Unbeschadet sonstiger gesetzlicher oder vertraglicher Rechte ist der Zahlungsdienstleister des Zahlers im Fall eines kartengebundenen Zahlungsvorgangs berechtigt, einen verfügbaren Geldbetrag auf dem Zahlungskonto des Zahlers zu sperren, wenn 1. der Zahlungsvorgang vom oder über den Zahlungsempfänger ausgelöst worden ist und 2. der Zahler auch der genauen Höhe des zu sperrenden Geldbetrags zugestimmt hat."

   Gloss: in a card-based payment transaction the payer's bank may block an amount when the transaction was initiated by or through the payee and the payer consented to the exact amount blocked.
4. The SCA rules expressly cover that case. Delegated Regulation (EU) 2018/389 Art. 5 (3) (a) [S14]:
   > "Bei einem kartengebundenen Zahlungsvorgang, für den der Zahler nach Artikel 75 Absatz 1 der oben genannten Richtlinie seine Zustimmung zu der genauen Höhe des zu blockierenden Geldbetrags erteilt hat, gilt der Authentifizierungscode speziell für den Betrag, für dessen Blockierung der Zahler seine Zustimmung erteilt hat und dem er beim Auslösen des Zahlungsvorgangs zugestimmt hat."

   Gloss: where the payer consented to the exact amount to be blocked, the authentication code is specific to that blocked amount. So a hold is a recognised form of SCA-authenticated card transaction.
5. The BMI press release of 17 June 2020 on the BeherbMeldV [S15]:
   > "Auf die Abwicklung der Anmeldung in Papierform kann nun verzichtet werden, wenn eine Übernachtung kartengebunden elektronisch bezahlt oder reserviert wird."

   Gloss: paper can be dropped when a stay is paid for *or reserved* electronically by card.

What speaks against, or is missing:

- BGB § 675f (4) defines "Zahlungsvorgang" as "jede Bereitstellung, Übermittlung oder Abhebung eines Geldbetrags" (any provision, transfer or withdrawal of an amount of money) [S16]. A hold that is released without any capture never moves money. Whether such a hold alone is a completed "Zahlungsvorgang", or only the first step of one, is a payment-law question no source consulted answers for the BMG context.
- The DTV FAQ (secondary, Stand 23.04.2021) describes the card variant throughout in terms of the guest paying the "Reisepreis" on arrival day and does not mention holds either way [S17].
- The IHA FAQ (secondary, Stand 25.11.2024) describes "die Reservierung einer Gebühr auf der Kreditkarte mit einer Starken Kundenauthentifizierung" as a valid first SCA transaction, but in the context of securing payment from German guests, not as Meldeschein evidence [S18].

Practical reading for the product: a hold taken with SCA on arrival day that is later captured in whole or part (the normal hotel case) is the strongest form of the pre-auth variant, because a payment transaction is then completed on the same authorisation. A hold that is released with nothing captured is the weak form.

---

## 2. Does a zero-amount or minimal-amount card verification count?

**Verdict: law is silent. UNSETTLED. Zero-amount should be treated as not qualifying; minimal amounts qualify only if SCA actually took place.**

Zero amount:

- The statute requires a "Zahlungsvorgang" [S1]; BGB § 675f (4) ties that term to "eines Geldbetrags" [S16]. A zero-amount card verification provides, transfers or withdraws no amount. On the wording it is doubtful that it is a payment transaction at all.
- ZAG § 55 (1) distinguishes the two situations [S19]:
  > "Der Zahlungsdienstleister ist verpflichtet, eine starke Kundenauthentifizierung zu verlangen, wenn der Zahler 1. online auf sein Zahlungskonto zugreift; 2. einen elektronischen Zahlungsvorgang auslöst; 3. über einen Fernzugang eine Handlung vornimmt, die das Risiko eines Betrugs im Zahlungsverkehr oder anderen Missbrauchs beinhaltet."

  Gloss: SCA is required when the payer (2) triggers an electronic payment transaction or (3) performs a remote action carrying fraud risk. Saving a card with authentication but without a charge falls more naturally under Nr. 3 than Nr. 2. BMG § 29 (5) Nr. 1 refers to a payment transaction, which corresponds to Nr. 2.
- In Stripe terms a zero-amount verification is a SetupIntent. Stripe describes it as: "Sie ähnelt einer Zahlung, es wird aber keine Abbuchung erstellt." (it resembles a payment, but no charge is created) [S20]. A PaymentIntent cannot be zero: the minimum charge amount in EUR is 0,50 EUR [S21].
- For card-present SetupIntents on Stripe Terminal, the documentation describes collecting the card and the cardholder's consent but does not state that a PIN or any SCA is performed [S22]. **UNVERIFIED** whether any SCA occurs in that flow.
- No official source (statute, reasoning, BeherbMeldV, BMI, BSI) and neither association FAQ addresses zero-amount verification [S1][S10][S12][S15][S17][S18].

Minimal amount (for example a 1 EUR hold):

- Formally a payment transaction with an amount, so the objection above does not apply.
- The risk is that no SCA happens. Small transactions are the main field of SCA exemptions. Delegated Regulation (EU) 2018/389 Art. 11 (contactless at point of sale) [S14]:
  > "Zahlungsdienstleister dürfen [...] bei Auslösen eines kontaktlosen elektronischen Zahlungsvorgangs durch den Zahler davon absehen, eine starke Kundenauthentifizierung zu verlangen, wenn dabei die folgenden Bedingungen erfüllt sind: a) Der Einzelbetrag des kontaktlosen elektronischen Zahlungsvorgangs geht nicht über 50 EUR hinaus, und b) die früheren kontaktlosen elektronischen Zahlungsvorgänge [...] gehen seit der letzten Durchführung einer starken Kundenauthentifizierung zusammengenommen nicht über 150 EUR hinaus, oder c) die Anzahl der aufeinanderfolgenden kontaktlosen elektronischen Zahlungsvorgänge [...] geht seit der letzten Durchführung einer starken Kundenauthentifizierung nicht über fünf hinaus."

  and Art. 16 (remote low-value payments): exemption up to 30 EUR per transaction, 100 EUR cumulative or five transactions [S14]. Gloss: contactless payments up to 50 EUR and remote payments up to 30 EUR may lawfully run without SCA.
- The statute requires a transaction "mit einer starken Kundenauthentifizierung" [S1]. A transaction that was exempted from SCA is not one. The reasoning confirms the consequence: a payment instrument "ohne starke Kundenauthentifizierung" leads back to the paper form [S10].
- Whether a token transaction made solely to authenticate, with no connection to the price of the stay, satisfies the provision is not addressed by any official source. **UNSETTLED.** A vendor claim surfaced in search results that the card "wird nicht belastet" and serves only authentication; the vendor page returned HTTP 404 and the claim is not relied on. **UNVERIFIED.**

---

## 3. Does a payment made before the arrival day count?

**Verdict: on the enacted wording, no. The transaction has to be triggered on the day of arrival. Sources conflict, so this is UNSETTLED, and the safe rule is to require the transaction on arrival day.**

For "must be on arrival day":

- The enacted text makes the card transaction the *means* of a confirmation that takes place "am Tag der Ankunft": the guest "deren Richtigkeit und Vollständigkeit am Tag der Ankunft bestätigt, indem die beherbergte Person 1. einen kartengebundenen Zahlungsvorgang [...] auslöst" [S1]. A transaction triggered weeks earlier is not a confirmation given on arrival day.
- The committee deliberately moved "am Tag der Ankunft" in front of all three procedures; in the government draft the card route had no such timing element [S10][S11].
- BeherbMeldV § 2 (1) requires the data record to be stored "vollständig am Tag der Ankunft" (completely on the day of arrival), and the record includes the token [S12].
- The reasoning for the 2021 experimental clause explains why confirmation at the property matters (BT-Drs. 19/26176, p. 6) [S23]:
  > "Nummer 2 regelt, dass die zu beherbergende Person die Richtigkeit der Daten in der Beherbergungsstätte bestätigt, beispielsweise durch eine Authentisierung im Verfahren. Der Nachweis der Identität bei der Bestätigung der Daten ist notwendig, um sicherzustellen, dass auch die Person nachweislich dort beherbergt wird, welche die Buchung vorgenommen und sich innerhalb dieses Verfahrens elektronisch identifiziert hat."

  Gloss: proof of identity at confirmation is necessary to ensure that the person who booked and identified themselves is demonstrably the person accommodated there. This concerns Satz 2 Nr. 2, which uses the same "am Tag der Ankunft" phrase as Satz 1.
- DTV FAQ (secondary), Q6: the card variant is unsuitable "Generell bei Zahlungen, die bereits im Voraus geleistet wurden" (generally for payments already made in advance); Q12: "ist die Anknüpfung an eine Zahlung im Vorfeld ebenso wenig möglich" (linking to a payment made beforehand is likewise not possible) [S17].

For "an earlier transaction can count":

- The government reasoning expressly contemplates a token "ursprünglich (etwa im Zusammenhang mit der Reservierung) erzeugte Zuordnungsnummer" (originally generated, for example in connection with the reservation), to be replaced only if the guest later switches cards [S10]. That presupposes that a reservation-time token can be the stored token.
- The committee called its rewording "lediglich eine sprachliche Anpassung" (merely linguistic) [S11], which suggests no change of substance was intended.
- The BMI press release of 17 June 2020 says paper can be dropped when a stay is "kartengebunden elektronisch bezahlt oder reserviert" [S15].

Assessment: the wording of a statute is the outer limit of its interpretation, and the wording ties the confirming act to arrival day. The reasoning was written for a different wording. A booking-engine payment with 3-D Secure made before arrival day should therefore not be treated as satisfying § 29 (5) Nr. 1. Whether a regulator or court would accept it on the strength of the reasoning is open.

Not addressed by any source:

- What "Tag der Ankunft" means for arrivals after midnight, or for guests who pay online on arrival day before physically reaching the property. **UNVERIFIED.** The statute says day, not moment, and does not require the transaction to take place at the reception desk [S1].
- Whether a merchant-initiated charge on arrival day against a card authenticated at booking counts. It should not: no SCA occurs on that charge and the guest does not trigger it. This follows from the wording ("auslöst", "mit einer starken Kundenauthentifizierung") [S1], not from an express statement.

---

## 4. Must the card belong to the registering guest? What if a company or another person pays?

**Verdict: the registering guest must personally trigger the SCA transaction, and the card should be one on which the guest is the cardholder. If someone else pays, the card path is not available and the paper form applies. The statute does not say "own card" in terms; the conclusion rests on wording plus stated purpose.**

- Wording: "indem die beherbergte Person [...] auslöst" [S1]. The accommodated person is the one who triggers the transaction.
- Purpose, from the reasoning: the token "ermöglicht, die Zahlung einem bestimmten Karteninhaberkonto und damit einer bestimmten Person zuzuordnen. Dies ermöglicht einen Verzicht auf eine eigenhändige Unterschrift des Meldescheines als eindeutiges Identifizierungsmerkmal." [S10] Gloss: the token lets the payment be attributed to a cardholder account and thereby to a particular person, which is what replaces the signature as the unique identifier. If the cardholder is someone other than the guest, the token identifies the wrong person.
- DTV FAQ (secondary), Q6, lists as unsuitable for the card variant [S17]:
  > "Reisen, die von Dritten und nicht von der tatsächlich beherbergten Person bezahlt werden – da in diesem Fall der Gast am Tag der Ankunft keinen kartengebundenen Zahlungsvorgang tätigt"

  > "Kostenübernahmeerklärungen durch Unternehmen, Reiseveranstalter etc., da der Gast hier selbst am Tag der Ankunft keinen kartengebundenen Zahlungsvorgang nutzt."

  > "Gruppenreisen unter zehn Personen, bei denen nicht jeder Reisender vor Ort den Reisepreis mittels kartengebundenem Zahlungsvorgang bezahlt"

  Gloss: trips paid by third parties, cost-coverage by companies or tour operators, and small groups where not every traveller pays by card on site are all outside the card variant.
- One record per person: BeherbMeldV § 2 (1) requires "zu jeder beherbergten ausländischen Person nach § 29 Absatz 2 des Bundesmeldegesetzes einen Datensatz" [S12]. Accompanying foreign spouses, partners and minor children are only counted (§ 29 (2) Satz 2) and need no transaction of their own [S1]. Every other foreign guest who must be named needs their own record and therefore their own confirming act. Two unrelated foreign guests sharing a room cannot both be covered by one guest's card transaction.
- Guest may decline: the card path requires "Zustimmung der beherbergten Person" [S1], and the operator must keep paper forms available regardless (§ 30 (1) Satz 1) [S2].

Open points:

- **Company card issued in the guest's name** (the guest is the cardholder and performs the PIN or 3-D Secure step; the employer settles the bill). Wording and purpose are both met, since the token leads to the guest as cardholder. No source addresses it. **UNSETTLED**, lawyer to confirm.
- **How the PMS can know whose card it is.** No source imposes a name-matching duty on the operator. Technically the cardholder name is often unavailable: Stripe notes that on card-present payments "Cardholder name is typically not available on swipe or contactless payments" [S24]. The operator's statutory duty to compare the registration data with the passport remains in the electronic procedure (§ 30 (2) Satz 2-4) [S2].
- **Virtual cards from OTAs** are keyed, card-not-present and SCA-exempt (see `payments-provider-eu.md`). They involve neither the guest nor SCA and can never satisfy Nr. 1.

---

## 5. What must be stored, and how do Stripe objects map onto it?

### 5.1 What the law requires

- BMG § 30 (2) Satz 5: "die zweckgebundene Zuordnungsnummer des eingesetzten Zahlungsmittels" stored together with the registration data [S2]. Gloss: the assignment number *of the payment instrument used*.
- BeherbMeldV Anlage, Nr. 12 `Zahlungszuordnungsnummer` [S12]:
  > "bestehend aus der zweckgebunden Zuordnungsnummer des elektronischen Zahlungsvorganges (Token) und aus dem Namen des Zahlungsdienstleisters der Beherbergungsstätte, der den Token generiert"

  Gloss: consisting of the purpose-bound assignment number *of the electronic payment transaction* (token) and the name of the accommodation's payment service provider that generates the token.
- XSD (BAnz AT 10.07.2020 B1) [S25]: element `Zahlungszuordnungsnummer` (optional, `minOccurs="0"`), containing two mandatory `xsd:string` children:
  - `Zahlungstoken`: "Dieses Feld enthält die zweckgebundene Zuordnungsnummer des eingesetzten Zahlungsmittels, die im Rahmen eines kartengebundenen Zahlungsvorgangs erhoben wird."
  - `NameZahlungsdienstleister`: "Dieses Feld enthält den Namen des Zahlungsdienstleisters, der den Zahlungstoken generiert."
- Reasoning: the token is "eine[r] zweckgebundenen Zuordnungsnummer für wiederkehrende Zahlungen (sog. Token)", generated "im Zuge der Abwicklung zwischen Hotel und kartenausgebender Stelle oder bei jedem Einsatz einer Zahlungskarte" [S10].
- Replacement rule from the reasoning: if the guest later pays with a different SCA card, the stored number is replaced by the later one; if the guest switches to an instrument without SCA, a paper form must be signed [S10]. This appears only in the reasoning, not in the statute or the BeherbMeldV. **UNSETTLED** whether it binds, and it sits uneasily with the arrival-day wording.
- Retention: same as the form, one year from departure, deletion within the following three months (§ 30 (4) Satz 2) [S2].

What is certain: exactly one string and one provider name; the provider is the *hotel's* PSP, not the card issuer or the card scheme; the card number itself is not what is stored.

What is not defined anywhere: whether "the token" identifies the instrument (statute, XSD) or the transaction (Anlage), and its format. The three texts use both descriptions. **UNSETTLED.**

### 5.2 Mapping to Stripe

| Stripe object | What it is (Stripe's own description) | Fit |
|---|---|---|
| PaymentMethod `pm_...` | "PaymentMethods represent your customer's payment instruments" [S26]. For Terminal, the `card_present` PaymentMethod "die Tokenisierung der physisch vorhandenen Karte darstellt" (represents the tokenisation of the physically present card) [S22]. | Closest match to "Zuordnungsnummer des eingesetzten Zahlungsmittels": a PSP-generated token for the instrument. |
| PaymentIntent `pi_...` and its `latest_charge` `ch_...` | `latest_charge`: "ID of the latest Charge object created by this PaymentIntent"; `payment_method`: "ID of the payment method used in this PaymentIntent." [S27] | Matches the Anlage's "Zuordnungsnummer des elektronischen Zahlungsvorganges". Identifies the specific arrival-day transaction and leads to the PaymentMethod and the authentication result. |
| `fingerprint` | "Uniquely identifies this particular card number." For wallets "the tokenized number might be provided instead of the underlying card number." [S24] | Identifies the card across transactions within the Stripe account; not a transaction reference. |
| `generated_card` | "ID of a card PaymentMethod generated from the card_present PaymentMethod that may be attached to a Customer for future transactions." [S24] | Matches the reasoning's "Zuordnungsnummer für wiederkehrende Zahlungen" for Terminal payments. "Only present if it was possible to generate a card PaymentMethod." |
| `network_transaction_id` | "This is used by the financial networks to identify a transaction." [S24] | Generated by the card network, not by the hotel's PSP, so it does not meet "der den Token generiert". |

Recommendation (an engineering choice, not a legal finding): write the PaymentMethod ID of the arrival-day transaction into `Zahlungstoken`, and keep the PaymentIntent ID, charge ID and the SCA evidence below in the PMS record linked to the Meldeschein for the same retention period. Both the statute and the XSD describe the token as belonging to the payment instrument, and they rank above the Anlage's explanatory column. A lawyer should confirm, since the Anlage wording points to the transaction.

With Stripe Connect direct charges the objects live on the hotel's connected account (see `payments-provider-eu.md`); an ID is only resolvable together with the connected account ID, which the PMS must retain.

### 5.3 Provider name

- Stripe's contracting entity for Germany and all EEA countries is "Stripe Payments Europe, Limited", with "Stripe Technology Europe, Limited" as an additional party where Financial Services Terms say so (Stripe Services Agreement, last modified 18 Nov 2025, section 12) [S28].
- The regulated entity is Stripe Technology Europe, Limited: "STEL is authorised as an electronic money institution by the Central Bank of Ireland (reference number: C187865) to issue electronic money, execute payment transactions, make money remittances, issue payment instruments and acquire payment transactions [...]" [S29].
- Which of the two is "der Zahlungsdienstleister der Beherbergungsstätte, der den Token generiert" is not something Stripe or the BMI states. **UNSETTLED.** The field is a free string, so the value must be a per-provider configuration, not hard-coded.

### 5.4 Evidence that SCA actually took place

The statute requires SCA on the transaction itself. The PMS has to read this from the charge, not assume it.

Online (card, 3-D Secure), fields under `payment_method_details.card.three_d_secure` [S24]:

- `result`: `authenticated` = "3D Secure authentication succeeded." `exempted` = "A 3D Secure exemption has been applied to this transaction. Exemption may be requested for a number of reasons including merchant initiation, low value, or low risk." `attempt_acknowledged` = "No authentication was performed, but the card network has provided proof of the attempt."
- `authentication_flow`: `challenge` = "The issuing bank authenticated the customer by presenting a traditional challenge window." `frictionless` = "The issuing bank authenticated the customer via the 3DS2 frictionless flow."
- `three_d_secure` is null when 3-D Secure was not used ("Populated if this transaction used 3D Secure authentication.").
- The integration can ask for a challenge with `request_three_d_secure=challenge`, but "Stripe kann Ihre Präferenz nicht garantieren, da der Aussteller den endgültigen Authentifizierungsablauf bestimmt" (Stripe cannot guarantee the preference; the issuer decides) [S30].

Only `result=authenticated` with `authentication_flow=challenge` shows that the guest actively used two factors. Whether a frictionless authentication is SCA within ZAG § 1 (24) is not stated by Stripe or by any source consulted; in a frictionless flow the customer does nothing. **UNSETTLED**; treat frictionless as not qualifying.

In person (Stripe Terminal, `card_present`):

- Stripe, regional guidance for Germany [S31]:
  > "In DE erfüllen alle Transaktionen, die mit einer PIN authentifiziert werden, die SCA-Anforderungen. Die Karte stellt das erste Authentifizierungselement der Transaktion (Besitznachweis), und die PIN das zweite (Wissensnachweis) dar."

  Gloss: in Germany every transaction authenticated with a PIN meets the SCA requirements; card is possession, PIN is knowledge.
- Same page: "Transaktionen unter 50 Euro [...] gelten als *von geringem Wert* und können von der starken Kundenauthentifizierung ausgenommen werden." [S31] Gloss: contactless taps under 50 EUR may run without SCA.
- Field `payment_method_details.card_present.receipt.cardholder_verification_method`: "One of the following: `approval`, `failure`, `none`, `offline_pin`, `offline_pin_and_signature`, `online_pin`, or `signature`." [S24]
- Field `read_method`: `contact_emv`, `contactless_emv`, `contactless_magstripe_mode`, `magnetic_stripe_fallback`, `magnetic_stripe_track2` [S24].

Qualifying: cardholder verification method `offline_pin`, `online_pin` or `offline_pin_and_signature`. Not qualifying: `none`, `signature`, `approval`, `failure`, any magnetic-stripe read, any MOTO or keyed entry.

Mobile wallets at the terminal (Apple Pay, Google Pay): the device's own biometric or passcode check is commonly treated as SCA, but the Stripe pages consulted do not say which verification-method value such a payment reports. **UNVERIFIED**; do not count wallet taps until confirmed with Stripe.

---

## 6. Where is the official XML schema published, and what is its current version?

- Legal basis: BeherbMeldV § 2 (2) Satz 3: "Das Bundesministerium des Innern und für Heimat gibt die Struktur des XML-Dokumentes als XML-Schema-Definition (XSD) im Bundesanzeiger bekannt." [S12]
- Official publication: **Bundesanzeiger, BAnz AT 10.07.2020 B1**, "Bekanntmachung nach § 2 Absatz 2 der Beherbergungsmeldedatenverordnung", Vom 17. Juni 2020, Bundesministerium des Innern, für Bau und Heimat, file reference V II 2 - 20104/131#3. The schema is printed in full as the Anlage [S25].
- BMI confirmation (news item of 10.07.2020): "Die XML-Schema-Definition wurde am 10.07.2020 im Bundesanzeiger veröffentlicht. Die XML-Schema-Definition kann hier als XSD-Datei heruntergeladen werden. Ergänzend dazu steht eine Beispiel-XML zur Verfügung." [S32]
- Download: BMI file `BeherbMeldV_Schema.xsd`, page dated 30.06.2020, "xml, 5KB" [S33]. The live BMI site answered HTTP 400 to automated requests on 2026-09-28; the archived copy of the file (Wayback snapshot of 29 Apr 2024) was compared with the Bundesanzeiger text and is identical apart from one typesetting soft hyphen in the Bundesanzeiger rendering.
- **Version: the schema carries no version number, no `targetNamespace` and no version attribute.** The only identifier is its publication reference. The spec should cite it as "XSD per BAnz AT 10.07.2020 B1".
- Later changes: BEG IV Art. 7 amended the BeherbMeldV with effect from 1 Jan 2025 but only inserted "ausländischen" in § 1 and § 2 (1), updated the ministry's name in § 2 (2), and reworded the explanations of Anlage Nr. 8, 9 and 10. No identifier changed [S7]. No later Bundesanzeiger notice under § 2 (2) was found by web search. **UNVERIFIED** that none exists; the Bundesanzeiger's own search could not be queried exhaustively. A search index lists the BMI file under revision parameter `v=4`, while the archived copy is `v=3`; the `v=4` file could not be retrieved, so whether its content differs is **UNVERIFIED**. Re-download from the BMI and diff before implementation.

Schema facts the implementation must respect, all from [S25]:

- Root element `Meldeschein`; children in fixed order (`xsd:sequence`): `DatumAnkunft`, `DatumAbreise`, `Familienname`, `Vornamen`, `Geburtsdatum`, `Staatsangehoerigkeiten`, `Anschrift`, `AnzahlAngehoerige`, `AnzahlMitreisende`, `StaatsangehoerigkeitMitreisende` (optional), `SeriennummerPass` (optional), `Zahlungszuordnungsnummer` (optional), `Beherbergungsstaette`.
- `DatumAnkunft` and `DatumAbreise` are `xsd:date`, that is `YYYY-MM-DD`. The Anlage of the regulation describes them as "(JJJJMMTT)" [S12]. The two official texts differ; a file has to validate against the XSD, so the XSD format governs the XML content. The `JJJJMMTT` pattern still applies to the file name (§ 2 (3)) [S12].
- `Geburtsdatum` pattern `([12]\d{3})(-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01]))?`: full date or year only.
- `AnzahlAngehoerige` and `AnzahlMitreisende` are mandatory `xsd:nonNegativeInteger`; write 0 when there are none.
- Address type `Adresse`: `Land` (required), `PLZ`, `Ort` (required), `Ortsteil`, `Strasse` (required), `Hausnummer`, `AlternativeAdressangabe`. These element names differ from the descriptive labels in the Anlage and from the field list in `dach-compliance.md` § 1.5.
- `Beherbergungsstaette`: `BeherbergungsstaetteName` and `BeherbergungsstaetteAnschrift` (type `Adresse`), both required.
- `Zahlungszuordnungsnummer` is optional in the schema because the same record format serves the eID routes; for the card route it is mandatory by statute (§ 30 (2) Satz 5) [S2].

---

## 7. Rules the spec must state

### Certain (directly from statute, regulation or the published schema)

1. The card path is offered only to foreign guests who must be named on a Meldeschein, and only with the guest's consent; the consent is recorded. Paper forms remain available at every property at all times. [S1][S2]
2. The confirming card transaction must carry strong customer authentication on that very transaction. The PMS reads the authentication outcome from the payment provider and never assumes it. [S1][S3]
3. These never qualify: merchant-initiated or off-session charges, MOTO and keyed entry, OTA virtual cards, magnetic-stripe reads, contactless taps without PIN, any transaction on which an SCA exemption was applied, SEPA direct debit, cash, bank transfer, invoice. [S1][S14][S24][S31]
4. One XML record per named foreign guest, stored completely on the day of arrival, UTF-8, validating against the XSD of BAnz AT 10.07.2020 B1, file name `JJJJMMTT_BeherbMeldeschein_Zaehler.xml` with a daily counter from 1, in year and month folders. [S12][S25]
5. In the card case the record contains `Zahlungszuordnungsnummer` with both `Zahlungstoken` and `NameZahlungsdienstleister`; the provider named is the hotel's payment service provider. [S2][S12][S25]
6. Dates inside the XML use `xsd:date` (`YYYY-MM-DD`); the counts of accompanying family members and group members are always written, 0 if none. [S25]
7. Accompanying foreign spouse, partner and minor children are counted on the guest's record and need no card transaction. Every other named foreign guest needs their own record and their own confirming act or a paper form. [S1][S12]
8. The operator still compares the data with the passport and records discrepancies or a missing or invalid document; the record has a place for that (`SeriennummerPass`: "oder Angaben zu Abweichungen oder Nichtvorlage"). [S2][S12]
9. Token and record are kept one year from departure and deleted within the following three months; on request they are provided to the authorities in machine-readable form. [S2]
10. Fallback to the printed form with handwritten signature happens whenever: the guest declines; no card is presented; the transaction fails or is declined; SCA evidence is absent; someone other than the guest pays; the stay is paid by invoice, cash or voucher; the property's terminal or provider is unavailable. [S1][S2][S10][S17]

### Adopted as the safe rule, pending a lawyer's confirmation

11. **Timing.** The qualifying transaction must be triggered on the calendar day of arrival, in the property's local time. A prepaid rate or booking-engine payment with 3-D Secure before that day does not satisfy the card path on its own; the guest is asked for a fresh SCA transaction on arrival day or signs paper. *To confirm:* whether the reasoning's reservation-time token can be relied on; how arrival after midnight is treated. [S1][S10][S11][S17]
12. **Pre-authorisation.** A hold taken on arrival day with SCA is accepted as the confirming transaction. *To confirm:* that a hold suffices as "Zahlungsvorgang", and whether a hold later released with nothing captured still counts. Until confirmed, the spec should prefer flows where at least part of the hold is captured. [S1][S10][S13][S14]
13. **Zero-amount verification** (SetupIntent, card check without amount) is not accepted as the confirming transaction. *To confirm:* whether it could be. [S1][S16][S19][S20]
14. **Minimal amounts** are not used as a device to obtain a token. If the real arrival-day transaction happens to be small, it counts only when SCA evidence is present. *To confirm:* whether a transaction unrelated to the price of the stay is acceptable at all. [S1][S14]
15. **Whose card.** The guest must be the cardholder and personally perform the PIN or 3-D Secure step. The check-in flow asks the guest or the receptionist to affirm this, and offers paper when a company, travel agent, host or companion pays. *To confirm:* company cards issued in the guest's own name; whether the operator has any duty to verify the cardholder name. [S1][S10][S17]
16. **3-D Secure frictionless** results are treated as no SCA for this purpose; only `authenticated` with a `challenge` flow qualifies online. *To confirm:* with Stripe and counsel. [S24][S30]
17. **Mobile wallets at the terminal** are treated as not qualifying until Stripe confirms how their cardholder verification is reported. [S24][S31]
18. **Token mapping.** `Zahlungstoken` holds the Stripe PaymentMethod ID of the arrival-day transaction; the PaymentIntent ID, charge ID, connected account ID and the SCA evidence fields are kept in the PMS alongside the record for the same retention period. `NameZahlungsdienstleister` is a per-provider configuration value. *To confirm:* instrument token versus transaction reference, and which Stripe entity name to write. [S2][S12][S25][S28][S29]
19. **Change of card during the stay.** If the guest later pays with a different SCA card, the reasoning says the stored number is replaced; if the guest switches to an instrument without SCA, a paper form is signed. The spec should not rewrite a stored record automatically until counsel confirms whether this passage of the reasoning is to be followed, given that the record must be complete on arrival day. [S10][S12]
20. **Schema currency.** Before implementation, download the XSD from the BMI again and diff it against BAnz AT 10.07.2020 B1; check the Bundesanzeiger for any later notice under BeherbMeldV § 2 (2). [S25][S33]

---

## Sources

Primary (statutes, regulations, parliamentary papers, official notices):

- [S1] BMG § 29 (version in force since 1 Jan 2025) — https://www.gesetze-im-internet.de/bmg/__29.html
- [S2] BMG § 30 — https://www.gesetze-im-internet.de/bmg/__30.html
- [S3] ZAG § 1 (definitions, Abs. 24) — https://www.gesetze-im-internet.de/zag_2018/__1.html
- [S4] Version history of BMG § 29 (consolidated by buzer.de; used for the amendment chain only) — https://www.buzer.de/29_BMG.htm
- [S5] Drittes Bürokratieentlastungsgesetz, Art. 1, G. v. 22.11.2019, BGBl. I S. 1746 (text as consolidated) — https://www.buzer.de/gesetz/13626/a229649.htm
- [S6] Gesetz zur Erprobung weiterer elektronischer Verfahren zur Erfüllung der besonderen Meldepflicht in Beherbergungsstätten, Art. 1, G. v. 10.03.2021, BGBl. I S. 332 — https://www.buzer.de/gesetz/14511/a268337.htm
- [S7] Viertes Bürokratieentlastungsgesetz, Art. 6 and Art. 7, BGBl. 2024 I Nr. 323 — https://www.recht.bund.de/bgbl/1/2024/323/regelungstext.pdf
- [S8] BT-Drs. 20/11306 (government draft BEG IV), reasoning on Art. 6 and Art. 7, p. 89-90 — https://dserver.bundestag.de/btd/20/113/2011306.pdf
- [S9] BT-Drs. 20/13015 (committee report BEG IV), reasoning on Art. 6 Nr. 1 c), p. 103 — https://dserver.bundestag.de/btd/20/130/2013015.pdf
- [S10] BT-Drs. 19/13959 (government draft BEG III, 14.10.2019): draft Art. 1 on p. 9; reasoning "Zu Artikel 1" on p. 29-30 — https://dserver.bundestag.de/btd/19/139/1913959.pdf
- [S11] BT-Drs. 19/14421 (neu) (Beschlussempfehlung und Bericht, Ausschuss für Wirtschaft und Energie, 23.10.2019): synopsis p. 7-8; reasoning p. 30 — https://dserver.bundestag.de/btd/19/144/1914421.pdf
- [S12] BeherbMeldV §§ 1-4 and Anlage (as amended by Art. 7 G. v. 23.10.2024) — https://www.gesetze-im-internet.de/beherbmeldv/BJNR121800020.html
- [S13] BGB § 675t — https://www.gesetze-im-internet.de/bgb/__675t.html
- [S14] Delegierte Verordnung (EU) 2018/389 (RTS on SCA), Art. 5, 11, 16 — https://eur-lex.europa.eu/legal-content/DE/TXT/HTML/?uri=CELEX:32018R0389 (text retrieved via https://publications.europa.eu/resource/celex/32018R0389 because EUR-Lex returned an empty response to automated requests)
- [S15] BMI press release, 17.06.2020, "Kontaktloser Check-in in Hotels kann starten" (archived copy; live BMI site blocks automated requests) — http://web.archive.org/web/20200920174625/https://www.bmi.bund.de/SharedDocs/pressemitteilungen/DE/2020/06/kontaktloser-check-in-in-hotels-kann-starten.html
- [S16] BGB § 675f — https://www.gesetze-im-internet.de/bgb/__675f.html
- [S19] ZAG § 55 — https://www.gesetze-im-internet.de/zag_2018/__55.html
- [S23] BT-Drs. 19/26176 (draft of the 2021 act, CDU/CSU and SPD, 26.01.2021), reasoning p. 5-6 — https://dserver.bundestag.de/btd/19/261/1926176.pdf
- [S25] Bundesanzeiger, BAnz AT 10.07.2020 B1, "Bekanntmachung nach § 2 Absatz 2 der Beherbergungsmeldedatenverordnung" vom 17. Juni 2020 — edition listing: https://www.bundesanzeiger.de/pub/de/amtlicher-teil?0=&edition=BAnz+AT+10.07.2020 ; PDF: https://www.bundesanzeiger.de/pub/publication/MRVLC7YOnHbscbAfq14/content/MRVLC7YOnHbscbAfq14/BAnz%20AT%2010.07.2020%20B1.pdf
- [S32] BMI news item, 10.07.2020, "XML Schema für den digitalen Hotelmeldeschein veröffentlicht" (archived) — http://web.archive.org/web/20240626154338/https://www.bmi.bund.de/SharedDocs/kurzmeldungen/DE/2020/07/schema-beherbmeldv.html ; same text in the BMI Meldewesen FAQ (archived 12.08.2025) — http://web.archive.org/web/20250812082230/https://www.bmi.bund.de/SharedDocs/faqs/DE/themen/moderne-verwaltung/meldewesen/meldewesen.html
- [S33] BMI download page `BeherbMeldV_Schema.xsd` — https://www.bmi.bund.de/SharedDocs/downloads/DE/veroeffentlichungen/2020/beherbmeldv_schema.html (archived page: http://web.archive.org/web/20240430213555/https://www.bmi.bund.de/SharedDocs/downloads/DE/veroeffentlichungen/2020/beherbmeldv_schema.html ; archived file: http://web.archive.org/web/20240429183139/https://www.bmi.bund.de/SharedDocs/downloads/DE/veroeffentlichungen/2020/beherbmeldv_schema.null?__blob=publicationFile&v=3)

Payment provider documentation (first-party, Stripe):

- [S20] Setup Intents API — https://docs.stripe.com/payments/setup-intents
- [S21] Minimum charge amounts — https://docs.stripe.com/currencies
- [S22] Terminal, saving a card without charging — https://docs.stripe.com/terminal/features/saving-payment-details/save-directly
- [S24] Charge object, `payment_method_details` — https://docs.stripe.com/api/charges/object?query=payment_method_details
- [S26] PaymentMethod definition (glossary text on Stripe docs pages, e.g. in [S22]) — https://docs.stripe.com/api/payment_methods/object
- [S27] PaymentIntent object — https://docs.stripe.com/api/payment_intents/object
- [S28] Stripe Services Agreement, General Terms, section 12, last modified 18 Nov 2025 — https://stripe.com/de/legal/ssa
- [S29] Stripe Technology Europe, Limited, Authorised Payment Services — https://stripe.com/legal/stel
- [S30] 3-D Secure authentication flow, `request_three_d_secure` — https://docs.stripe.com/payments/3d-secure/authentication-flow
- [S31] Terminal regional considerations, Germany, "Starke Kundenauthentifizierung" — https://docs.stripe.com/terminal/payments/regional?integration-country=DE

Secondary (industry bodies; used for interpretation only, never as the sole basis of a rule marked certain):

- [S17] Deutscher Tourismusverband, "FAQ: Elektronischer Meldeschein – Möglichkeiten und Hindernisse", Stand 23.04.2021, Q3, Q4, Q6, Q9, Q12 — https://www.deutschertourismusverband.de/fileadmin/user_upload/Themen/Politik/FAQ_Elektronischer_Meldeschein.pdf (the same text is published by the law firm Spirit Legal: https://www.spiritlegal.com/de/aktuelles/details/faq-elektronischer-meldeschein-fuer-hotels-und-beherbungsstaetten.html)
- [S18] Hotelverband Deutschland (IHA), "Das neue Hotelmelderecht – FAQ", Stand 25.11.2024, Q4 and Q7, distributed by DEHOGA Bayern — https://www.dehoga-bayern.de/fileadmin/user_upload/Hotelverband_Deutschland_IHA_FAQ_Hotelmelderecht_ab_Januar_2025.pdf (announcement: https://www.dehoga-bayern.de/aktuelles/detailansicht/article/das-neue-hotelmelderecht/)

Looked for and not found:

- Any official reasoning (Begründung) for the BeherbMeldV itself. It was issued as a ministerial regulation without Bundesrat consent; no explanatory memorandum was located.
- Any BMI or BSI publication interpreting "kartengebundener Zahlungsvorgang" for pre-authorisations, zero-amount verifications or third-party cards. The BSI's role under § 29 (5) Satz 2 concerns approval of *other* procedures, not interpretation of Nr. 1.
- Any court decision or fine notice on § 29 (5) Nr. 1.
- Bundestag Wissenschaftliche Dienste, WD 3 - 3000 - 009/23 (14.04.2023) restates § 29 (5) without interpreting the card route — https://www.bundestag.de/resource/blob/949378/1e0985ee1e6b30e94e8cf9b6e7a894d6/WD-3-009-23-pdf-data.pdf
