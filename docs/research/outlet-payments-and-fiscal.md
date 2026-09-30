# Card acceptance on phones and fiscal duties of an outlet point of sale

Research date: 2026-09-30. Scope: own point of sale for bar, restaurant and spa in hotels in Germany, Austria and Switzerland; payments through Stripe (Connect direct charges, Terminal, see `payments-provider-eu.md`); fiscal signing through fiskaly (see `fiscal-service-provider-selection.md`). This file does not repeat what those two files and `point-of-sale-room-charges.md` already establish.

## 1. Tap to Pay on a staff phone (Stripe)

How the sources were read: all Stripe documentation in this file was fetched as raw Markdown (`docs.stripe.com/<page>.md`, English) and quoted from that text, except where marked "summary". Prices come from the raw HTML of stripe.com/de, /at and /ch pricing pages.

**Availability.** Tap to Pay on iPhone and Tap to Pay on Android are both generally available in AT, CH and DE (both lists also include most of western Europe; LI is public preview) [P1][P2]. The regional reader table lists "Tap to Pay on Android, Tap to Pay on iPhone" for DE and for the AT/CH group [P4].

**Supported phones.**
- iPhone: "Tap to Pay requires an iPhone XS or later running a one-year or later iOS version"; beta iOS releases do not work; PIN entry needs iOS 16.4 or later [P1]. The app needs Apple's entitlement `com.apple.developer.proximity-reader.payment.acceptance`, first a development entitlement and then a distribution entitlement, and the app is submitted to Apple for approval; Apple requires a "How to Tap" instruction screen before app review [P1].
- Android: any device that is not itself a PCI PTS payment device, has integrated NFC and an ARM processor, is not rooted with a locked bootloader, "Runs Android 13 or later", has a security update from the past 12 months, uses Google Mobile Services with the Play Store, has a hardware keystore (`FEATURE_HARDWARE_KEYSTORE` version 100 or later), "Has a stable connection to the internet", runs the unmodified manufacturer OS and has Developer options disabled [P2]. Named phones include current Google Pixel, Samsung Galaxy (A, S, Z, XCover), Motorola, OnePlus, Xiaomi and others; named handhelds include Sunmi L3/V3, Zebra TC53E/TC58E and Honeywell CT32/CT37 [P2]. SDK dependency `com.stripe:stripeterminal-taptopay` (version 5.8.1 in the page) [P2].

**Card schemes.** "Tap to Pay on iPhone includes support for Visa, Mastercard, American Express, and Discover contactless cards, NFC-based mobile wallets, and QR-based payment methods"; the same sentence appears for Android. Domestic schemes are named only for Australia (eftpos), Canada (Interac) and France (Cartes Bancaires) [P1][P2]. Maestro is listed for Tap to Pay on both platforms [P3].
- **girocard: no.** The payment method table lists girocard only for "WisePad 3, Stripe Reader S700, Stripe Reader S710" [P3]; the Germany section says "To accept girocard payments, you must use one of the following readers: BBPOS WisePad 3 ... Stripe Reader S700" and that WisePOS E does not support girocard [P4]. A co-badged girocard (girocard plus Visa or Mastercard) tapped on a phone can therefore only be charged over the international scheme; that such cards work on a phone is an inference from the co-badging text in [P4], **not stated for Tap to Pay**. A girocard-only card cannot be accepted on a phone.
- Discrepancy: [P3] lists S710 for girocard, [P4] names only WisePad 3 and S700, and the DE row of the reader table in [P4] lists smart readers "BBPOS WisePOS E, Stripe Reader S700" without S710. Treat S710 for girocard in Germany as **UNVERIFIED**.
- Austria and Switzerland: "Stripe supports Visa, Mastercard, American Express, and Discover payments" in each; AT in EUR, CH "Swiss franc (CHF)" only [P4]. No Swiss domestic debit scheme is named.

**Limits and PIN.**
- Contactless amounts above the cardholder verification limit require PIN. Stripe's support article gives 50 EUR for Germany and Austria and 80 CHF for Switzerland (**summary**: read through a summarising fetch, not raw text) [P6].
- PIN on the phone is supported (iPhone iOS 16.4+, Android SDK 4.3.0+) [P1][P2]. On Android the PIN is collected either because the amount is above the CVM limit (before `collectPaymentMethod` returns) or because the issuer requests SCA (during `confirmPaymentIntent`) [P2].
- Android PIN entry fails when Developer options are on, accessibility services run, screen recording is active, screen overlays exist, a screenshot is attempted, or there is no active internet connection; the error is `TAP_TO_PAY_INSECURE_ENVIRONMENT` [P2]. The PIN pad appears at a random position [P2].
- SCA in DE and AT: "Transactions below 50 euros ... are considered low value and might be exempted from SCA", with the 5-transaction / 150 EUR counters. With Tap to Pay, if the card supports contactless PIN "you see two charges": a soft decline `online_or_offline_pin_required` and then the authorised or declined charge; "If contactless PIN isn't supported, the payment will be hard-declined before the PIN screen appears" [P4]. Cards that need insertion cannot be completed on a phone; Stripe recommends a card reader or a Payment Link as fallback [P1][P2].
- Maximum amount per payment: not stated for Tap to Pay online payments, **UNVERIFIED**. The only stated ceiling is the offline maximum (section 5).

**Platform model (Connect direct charges).**
- Direct charges: "all API resources belong to the connected account"; the connected account bears Stripe fees, refunds and chargebacks; connection tokens are created with the `Stripe-Account` header of the hotel's account, optionally scoped to a `location`; client-side PaymentIntents are then created on that connected account [P7]. Connected accounts need the `card_payments` capability [P7].
- "Tap to Pay readers don't need to be registered in the Dashboard or API ahead of time"; the reader is bound to a `location` at connection time (`TapToPayConnectionConfiguration` with `locationId`). The location's `display_name` is shown on the tap screen [P8].
- Terminal payments require that "both the Stripe account receiving the funds and the location associated with the reader must be in the same country, accepting local currency only" [P4]. A Swiss hotel's phones therefore take CHF only.
- iPhone: "For platforms, use of Tap to Pay on iPhone is subject to the Apple Acceptance Platform User Terms and Conditions" [P1]. With direct charges "each connected account must individually accept" Apple's terms with an Apple ID of the business, either on first connection or beforehand through onboarding links; `isTapToPayAccountLinked` tells whether this is done [P8]. "Any iPhone can use up to 3 unique Stripe accounts across apps within a rolling 24-hour period"; a fourth raises `SCPErrorTapToPayReaderMerchantBlocked` [P8]. A phone shared across more than three hotels in a day stops working.
- The iPhone reader "disconnects when your application enters the background or when your iPhone loses connectivity" [P8].

**Tipping on the phone.** On-reader tipping lists only "Stripe Reader S700/S710, BBPOS WisePOS E, BBPOS WisePad 3" as readers [P9], and the offline feature table marks tipping "Unsupported" for Tap to Pay readers [P5]. On-receipt tipping (tip added at capture) is available only in the US [P10]. In DACH a tip taken on a phone must therefore be entered in the PMS app and included in the PaymentIntent `amount`, as Stripe prescribes for mandatory tips [P10]; that this is the only route for voluntary tips on a phone is an inference.

**Price (list).** Terminal card-present: 1.4 % + 0.10 EUR for EEA cards, 2.9 % + 0.10 EUR for non-EEA cards, "+ 0,10 € pro Autorisierung für Tap to Pay" (Germany and Austria); Switzerland identical in CHF (1.4 % + 0.10 CHF, + 0.10 CHF per Tap to Pay authorisation) [P11].

## 2. Mobile card readers for table service (Stripe)

| Reader | Type | DE | AT | CH | girocard | On-reader tip | Offline | Notes |
|---|---|---|---|---|---|---|---|---|
| BBPOS WisePad 3 | Mobile, Bluetooth LE to the staff phone or tablet (USB on Android) | yes | yes | yes | yes (DE) | yes, see note | yes | Works only paired with the PMS app on a phone; "Mobile readers force a reboot and disconnect from the POS app 24 hours after the last boot" [P12][P13][P4][P9] |
| Stripe Reader S700 | Android smart reader, countertop and handheld | yes | yes | yes | yes (DE) | yes | yes | Connects over internet or LAN; can run the PMS's own app on the device ("Apps on Devices"); battery "15 hours (active use)", 318 g [P14][P5][P4] |
| Stripe Reader S710 | S700 with cellular | not in DE row of [P4]; cellular listed for DE | yes, cellular yes | yes, **no cellular** | **UNVERIFIED** (see section 1) | yes | yes | Falls back Ethernet → WiFi → cellular; cellular billed monthly per enabled reader [P15][P16] |
| BBPOS WisePOS E | Android smart reader | yes | yes | yes | **no** | yes | yes | Only co-badged cards over Visa/Mastercard in DE [P4] |

- WisePad 3 software versions are pinned per country: DE `4.01.07.00_DE_v31_511001`, AT (EU_W1 group) `4.01.07.00_Prod_EU_W1_on_v28_510001`, CH `4.01.07.00_SZZZ_EU_CH_HU_LI_v4_511001` [P13]. The regional pages still name `..._Prod_EU_W1_on_v28_510001` as minimum for CH [P4].
- On-reader tipping availability conflicts: the reader page lists AT, CH, DE for all four readers [P9]; the tipping overview lists WisePad 3 only in "AU, CA, FR, DE, IE, NL, NZ, SG, GB" and the smart readers in AT, CH, DE [P10]. For AT and CH, WisePad 3 on-reader tipping is **UNVERIFIED**; smart readers are fine.
- On-reader tipping works with automatic and manual capture; the tip comes back in `amount_details` of the PaymentIntent; percentage tips are post-tax unless a tip-eligible amount is sent [P9][P10].
- Table service pattern supported by the documents: either (a) a phone running the PMS app plus a WisePad 3 in the pocket, which gives girocard and chip-and-PIN; or (b) an S700/S710 handheld running the PMS outlet app directly on the reader. Both keep readers on the hotel's connected account via `Stripe-Account` [P7]. Platform-owned smart readers that serve several connected accounts are private preview and server-driven only [P7].
- Language: DE requires service in German unless otherwise agreed; readers switch language in settings; custom reader screens and receipts must be translated by the integrator [P4].

## 3. Fiscal duties of a restaurant point of sale (Germany, Austria)

How the sources were read: AEAO zu § 146a as raw text of the NWB reproduction [G3]; DSFinV-K 2.4 as raw text of the official BZSt PDF [D1]; the Austrian decree as raw text of the BMF PDF [A4]. What `fiscal-service-provider-selection.md` already states (receipt contents under KassenSichV § 6 and RKSV § 11, device outage tables, closing and export) is not repeated.

### 3.1 Germany: when an order must be signed

- An order is an "other process" that must be secured: "Trainingsbuchungen, Stornierung eines zuvor erfassten Vorgangs, Belegabbrüche, erstellte Angebote, nicht abgeschlossene Geschäftsvorfälle (z. B. Bestellungen)" (AEAO Nr. 1.11.1) [G3].
- Restaurant orders have their own process type: "Langanhaltende Bestellvorgänge (z. B. in der Gastronomie) werden als eigenständige Vorgänge realisiert. Deshalb sind diese über die Art des Vorgangs „Bestellung" abzubilden", with quantity (`MENGE`), item text (`ARTIKELTEXT`) and unit price (`BRUTTO`). "Die Erstellung der Rechnung bzw. der Bezahlvorgang sind über die Art des Vorgangs „Kassenbeleg" abzusichern" (AEAO Nr. 2.2.3.6.2) [G3].
- Timing rule for every transaction: start "unmittelbar mit Beginn eines aufzuzeichnenden Vorgangs"; update "Spätestens 45 Sekunden nach einer Änderung der Daten des Vorgangs"; finish at the end of the process; "Vor einer Belegausgabe oder zum Zeitpunkt eines Kassenabschlusses ist der Vorgang zwingend zu beenden" (AEAO Nr. 2.2.2, 2.2.3.3) [G3]. For type "Kassenbeleg" the 45-second updates fall away (Nr. 2.2.3.6.1) [G3].
- **Simplification used by restaurant tills (DSFinV-K Tz. 2.7.2):** orders are secured as separate "Bestellung" transactions; the "Kassenbeleg" transaction is then started only when the bill is created ("erst bei Rechnungserstellung gestartet und auch gleich wieder beendet"), so no transaction stays open over the whole meal. Conditions: "Der Start-Zeitpunkt der ersten Transaktion „Bestellung" muss zusätzlich auf dem Beleg abgedruckt werden", and the orders and the bill must be linked through the field `ABRECHNUNGSKREIS` in `Bonkopf_AbrKreis` (for example the table number) [D1]. The AEAO repeats the printing condition (Nr. 2.2.3.6.2) [G3].
- Tz. 2.7.1: "Bestellungen auch auf mehrere Rechnungen verteilt sein" (split bills) as long as `ABRECHNUNGSKREIS` links them [D1].
- Tz. 2.7.3 (serving across several systems without order securing): the first preparatory step is secured as `SonstigerVorgang`, its time printed on the receipt, linked via `ABRECHNUNGSKREIS` [D1].
- Signed data format: `processType` `Bestellung-V1`, `processData` lines `<Menge>;"<Bezeichnung>";<Preis>` separated by U+000D, price as gross unit price with two decimals [D1 Annex I]. The bill is `Kassenbeleg-V1` with `<Vorgangstyp>^<Brutto-Steuerumsätze>^<Zahlungen>`, payments only as "Bar" or "Unbar" [D1 Annex I].
- `AVBestellung` in the export covers orders "die im Kassensystem direkt erfasst und als eigenständiger Vorgang behandelt werden"; "Im Falle einer Zahlung bzw. Anzahlung handelt es sich nicht um einen Vorgang vom Typ „AVBestellung"" [D1 Annex B]. fiskaly maps `AVBestellung` to receipt type `ORDER` in `transactions[].head[].type` [F15].
- Business case ID: when orders, bills and payments happen at different times, "ist die besondere Angabe einer Geschäftsvorfall-ID ... erforderlich"; across systems this is done via the table `Bon_Referenzen` [D1 Tz. 2].

### 3.2 Germany: cancellations, aborted receipts, training, tips

- Cancelling a whole order: "Im Falle einer Stornierung einer ganzen Bestellung darf das Feld P_STORNO nicht verwendet werden, sondern es muss für eine Stornierung ein neuer Datensatz mit umgekehrtem Vorzeichen erzeugt werden, der wiederum abgesichert werden muss" (Tz. 4.2.3) [D1]. Line cancellations before signing may use `P_STORNO = 1`; "Sobald die Transaktion in der TSE signiert ist, darf das Feld P_STORNO nicht mehr verwendet werden" [D1].
- Cancelling a paid bill: the original stays unchanged; a separate receipt with `BON_STORNO = 1`, type "Beleg", reversed signs, and a record in `Bon_Referenzen` to the original (Tz. 4.2.2). A cancelled invoice is an invoice correction under UStG § 14 (4) [D1]. `AVBelegstorno` "kann bei Systemen, die mit einer TSE abgesichert werden, nicht verwendet werden" [D1 Annex I].
- Aborted process: `AVBelegabbruch` for processes "die nach Transaktionsbeginn abgebrochen werden"; "Eine tatsächliche Bezahlung darf im Zusammenhang mit diesem Vorgangstyp nicht erfolgen" [D1 Annex B].
- Training mode: training bookings must be logged and secured "obwohl es sich nicht um Geschäftsvorfälle handelt", as `AVTraining`; "Trainingsumsätze lösen weder eine kassenwirksame noch eine umsatzsteuerbehaftete Verbuchung aus" (Tz. 4.2.6). The training mode must be switched "aktiv durch die Kasse"; "Eine tatsächliche Bezahlung an der Kasse darf im Zusammenhang mit diesem Vorgangstyp nicht erfolgen" [D1 Annex B]. fiskaly: `TRAINING` [F15].
- Tips: "Unternehmer-Trinkgeld" is a business event of the register (AEAO Nr. 1.10.2) [G3]. `TrinkgeldAG` records tips to the employer, taxed per VAT key; `TrinkgeldAN` records tips for employees, which have "weder lohnsteuerliche noch umsatzsteuerliche Konsequenzen" and is used only when the owner's assets are affected, "beispielweise ... wenn Trinkgeld gemeinsam mit dem Rechnungsbetrag unbar gezahlt wird"; both pay-in and pay-out to the employee can be shown [D1 Annex C]. **A card tip on the outlet bill is therefore a `TrinkgeldAN` line on the signed receipt, and the later cash pay-out to staff is a second `TrinkgeldAN` movement.**

### 3.3 Germany: receipts for hospitality

- Receipt contents and electronic delivery: see `fiscal-service-provider-selection.md` section 4.2; nothing restaurant-specific in KassenSichV § 6 [G2].
- Additional line required by the simplification: start time of the first order (section 3.1) [D1][G3].
- Exemption from the receipt duty only on application under AO § 148 for sales "an eine Vielzahl von nicht bekannten Personen"; "Die mit der Belegausgabepflicht entstehenden Kosten stellen für sich allein keine sachliche Härte ... dar"; the transaction must still be secured (AEAO Nr. 2.5.9 to 2.5.11) [G3].
- Business-meal receipts for income tax (Bewirtungsbeleg: machine-printed, registered, with TSE data; tip shown): the BMF letter of 30 June 2021 could not be fetched (two attempts: HTML browser check, then HTTP 404), **UNVERIFIED**. Treat as an open point for the receipt layout.

### 3.4 Austria: what is signed in the restaurant

- Signing attaches to cash turnover. "Als Barzahlung gilt auch die Zahlung mit Bankomat- oder Kreditkarte vor Ort oder durch andere vergleichbare elektronische Zahlungsformen" and vouchers accepted instead of money (decree 2.4.4) [A4]. Orders are not named as signed events; the decree only uses "Bestellungseingabe im Kassensystem" as the start of a business event (2.4.1) [A4]. **An order is not signed in Austria; the payment is** (inference from [A4] and RKSV § 9, which signs each cash receipt [A1]).
- Timing: DEP entry "hat zeitnah ohne signifikante Verzögerungen zu erfolgen (technische Verzögerungen wegen Pufferung oder Caching sind möglich)" and "muss vor der Erfassung eines weiteren Geschäftsvorfalles abgeschlossen sein" because receipts are chained (3.2.1.2) [A4].
- Receipt handover "vor dem Verlassen der Geschäftsräumlichkeiten bzw. in der vom Unternehmen genutzten Freifläche"; preparing a bill before payment is allowed (the decree names "Ausstellung einer Hotelrechnung am Vorabend der Abreise"), but issuing the receipt before payment is not the rule (4.4) [A4]. A restaurant terrace counts as part of the premises: "bei Ausschank im Gastgarten eines Restaurants" (6.7) [A4].
- Split table bill (Tischabrechnung): if the whole table is booked and "das Inkasso der Gesamtsumme zu Teilbeträgen bei mehreren Personen ... zeitnah erfolgt, muss nicht für jeden Kunden ein gesonderter Beleg ausgestellt werden"; the table (Verrechnungskreis) and the item shares "sollen ... ersichtlich oder ermittelbar sein"; one receipt to one guest suffices (4.5.3) [A4].
- Forbidden: "Stock- und Standverrechnung", i.e. giving a waiter goods and computing takings from the count at day end (4.5.4) [A4].
- Training: "Trainingsbuchungen sind ab der Inbetriebnahme der Registrierkasse in das Datenerfassungsprotokoll signiert aufzunehmen und als solche zu kennzeichnen" and must not be used to record turnover (3.1.2) [A4]. In the machine-readable code the turnover counter is replaced by `TRA` for training and `STO` for cancellation receipts [A4].
- Cancellations: stored in the signature journal like cash turnover (3.2.1.1) [A4]; see `fiscal-service-provider-selection.md` constraint 13.
- Tips: tips to the owner are cash receipts; employee tips recorded in the register are pass-through items (2.4.6) [A4].
- Card payments taken with a Stripe reader on the table are cash turnover in this sense, so the outlet signs them like cash (inference from 2.4.4 [A4]).

### 3.5 Internet outage at the outlet

- Germany, fiskaly cloud device unreachable: this is a device outage. Work continues, the receipt carries a mark such as missing transaction number, date and time come from the PMS, and nothing is signed afterwards (see `fiscal-service-provider-selection.md` section 4.5) [G3]. Orders taken during the outage cannot be secured within 45 seconds; they fall under the same outage documentation (inference).
- Austria, fiskaly unreachable: receipt with "Sicherheitseinrichtung ausgefallen", copy kept, request replayed with the same UUID; outage over 48 hours reported (fiscal research section 5.7) [A1][F13].
- **The outlet app must therefore keep taking orders and printing marked receipts without internet**, which requires a local order store on the device or a local server, and a printer reachable over the local network. Card payment during the outage is possible only with a Stripe reader in offline mode, not with a phone (section 5).

## 4. Spa treatments and product sales

**Germany (UStG, raw text of gesetze-im-internet.de) [U1][U2][U3]:**
- Standard rate 19 % (§ 12 (1)); reduced 7 % list in § 12 (2).
- Restaurant food: § 12 (2) Nr. 15 "die Restaurant- und Verpflegungsdienstleistungen, mit Ausnahme der Abgabe von Getränken" at 7 %, with no end date in the current text. Drinks in the restaurant and bar: 19 %.
- Swimming pool: § 12 (2) Nr. 9 "die unmittelbar mit dem Betrieb der Schwimmbäder verbundenen Umsätze sowie die Verabreichung von Heilbädern" at 7 %.
- Sauna, massage, cosmetic treatment: not named in § 12 (2), so 19 % by default (inference from the closed list; the administrative guidance UStAE 12.11 was not read, **UNVERIFIED** for sauna in a pool package).
- Medical treatments are VAT exempt only when performed in the exercise of a medical or similar healing profession (§ 4 Nr. 14 a: "Arzt, Zahnarzt, Heilpraktiker, Physiotherapeut, Hebamme oder einer ähnlichen heilberuflichen Tätigkeit") [U3]. A wellness massage is not such a treatment by default (inference).
- Retail products in the spa shop: 19 % unless listed in Anlage 2 (inference from § 12 (2) Nr. 1).
- Vouchers: a voucher is a single-purpose voucher when "der Ort der Lieferung oder der sonstigen Leistung ... und die für diese Umsätze geschuldete Steuer zum Zeitpunkt der Ausstellung des Gutscheins feststehen"; its issue is taxed as the supply itself. Any other voucher is multi-purpose and taxed only at redemption (§ 3 (13) to (15)) [U2]. **A hotel value voucher usable in restaurant (7 %), bar (19 %) and spa (7 % or 19 %) is multi-purpose**; a voucher for "one 60-minute massage" is single-purpose at 19 % (inference). Export business cases `EinzweckgutscheinKauf` / `-Einloesung` and `MehrzweckgutscheinKauf` / `-Einloesung` exist [D1][F15].

**Austria (UStG 1994 § 10, version in force from 1 July 2026, BGBl. I Nr. 37/2026) [U4]:**
- 20 % standard (§ 10 (1)); 4.9 % for goods in Anlage 3 (§ 10 (1a)); 10 % for food and drinks listed in Anlage 1, including "Restaurationsumsätze" (§ 10 (2) Z 1 lit. b); 13 % for "die unmittelbar mit dem Betrieb von Schwimmbädern verbundenen Umsätze und die Thermalbehandlung" (§ 10 (3) Z 5).
- Massage and cosmetic treatments are not listed, so 20 % (inference). Drinks served in the restaurant are 10 % only if listed in Anlage 1, otherwise 20 %; Anlage 1 was not read, **UNVERIFIED** per drink.
- The 4.9 % rate for Anlage 3 goods may affect a shop selling basic foods; Anlage 3 not read, **UNVERIFIED**.
- Vouchers (fiscal side): sale of a value voucher is not cash turnover; redemption is cash turnover at nominal value (fiscal research section 5.2) [A4]. The UStG 1994 voucher provisions were not located in §§ 1, 3, 4, 6, **UNVERIFIED**.
- Spa services are cash turnover like restaurant sales; the decree lists hairdresser examples of item descriptions such as "Friseurleistung", "Haarpflegeprodukt" (Anlage to the decree) [A4]. Treatments must carry a customary description on the receipt (BAO § 132a (3) Z 4, fiscal research section 5.3).

**Switzerland (ESTV rate page) [C3]:** standard 8.1 %, reduced 2.6 % for food under the food law and some goods, special rate 3.8 % for accommodation including breakfast. Restaurant service at the standard rate is common knowledge but was not stated on the page read, **UNVERIFIED**. No fiscal signing (fiscal research constraint 45).

**Consequence for the model:** one outlet sells items at several rates at once (food 7 % / 10 %, drinks 19 % / 20 % / 10 %, pool 7 % / 13 %, massage 19 % / 20 %). Every Service item carries its own Tax Code per country; there is no outlet-level default rate.

## 5. Offline card payments on Stripe Terminal

**Yes, store and forward exists**, with conditions.

- Mechanism: "Stripe Terminal allows you to store payments locally on your POS device or smart reader. When a network connection is restored, the SDK or smart reader automatically forwards any stored payments to Stripe." "Authorization is only attempted after connectivity is restored and the payment is forwarded" [P5][P17].
- Readers: mobile (WisePad 3 in DACH), smart (S700/S710, WisePOS E, Verifone V660p/UX700). "Tap to Pay on Android doesn't support offline mode." Tap to Pay on iPhone offline is "in private preview in the United States" only [P5]. **A phone alone cannot take payments offline in DACH.**
- Schemes offline: Visa, Mastercard, Amex, Discover, Maestro, UnionPay, JCB supported; **"girocard - Unsupported"**. "If you're collecting payments in the European Economic Area, customers are required to insert their card and enter a PIN"; "Tapping cards is also not supported in markets where Strong Customer Authentication ... is required"; swiping is not allowed [P5][P17]. Offline in DE/AT therefore means chip and PIN on an international scheme only. Switzerland is outside the EEA; whether tap is allowed offline there is **UNVERIFIED**.
- Countries: the offline pages carry no country list and no country exclusion for AT, CH or DE [P5][P17]; availability in DACH is inferred from the absence of a restriction and from general Terminal availability, **not stated**.
- Limits: "the Stripe-enforced offline maximum of 10,000 USD or equivalent in your operating currency" per transaction [P17]. No stored-sum or storage-time limit from Stripe is stated; the integrator sets its own via `offlineBehavior` (`REQUIRE_ONLINE`, `PREFER_ONLINE`, `FORCE_OFFLINE`) and the counters `offlinePaymentsCount` and `offlinePaymentAmountsByCurrency` [P17].
- Liability: "You, as the user, assume all decline and tamper-related risks associated with an offline transaction. If your tampered reader can't forward payments to Stripe, or the issuer declines the transaction, there's no way to recover the funds" [P17]. Under direct charges the "user" is the hotel's connected account [P7].
- Preconditions: offline mode enabled on a Terminal `Configuration` (`offline[enabled]=true`) assigned to the `Location`; Android SDK 3.2.0 or later. Smart reader: the POS must have connected to the same reader "within the last 24 hours, on the same local network", so a working LAN is still needed. Mobile reader: connected online to a reader of the same type at the same Location "within the last 30 days" and software updated within that time [P17].
- Reconciliation: offline PaymentIntents "have a null `id`"; Stripe recommends a custom identifier in `metadata` and a webhook to map it to the PaymentIntent ID after forwarding. With automatic capture they are captured after forwarding; with manual capture they need capture once `requires_capture`. "You can't cancel or refund a PaymentIntent that was created and confirmed offline until it's forwarded." `account_type` and `authorization_response_code` are missing from offline receipts; `paymentIntent.offlineDetails.offlineCardPresentDetails.receiptDetails` gives receipt data [P17]. Offline status of a charge is visible in `payment_method_details.card_present.offline` [P17].
- How the money reaches the hotel: forwarded payments are ordinary PaymentIntents on the connected account created from the connection token of that account [P7][P17]; payouts then follow the direct-charge flow of `payments-provider-eu.md`. Forwarding needs a fresh connection token from the PMS backend [P5].
- Cellular fallback reduces the need: S710 switches to cellular when Ethernet and WiFi fail and keeps processing online; cellular is available in AT and DE, not CH [P15][P16].
- Features offline: on-reader tipping supported on smart readers, unsupported on mobile readers; incremental authorisation unsupported; extended authorisation supported [P5].

## Constraints on the point of sale model

Payments
1. **Two card acceptance modes per outlet**: Tap to Pay on a staff phone and a Stripe reader. Tap to Pay alone is not enough in Germany, because girocard is not supported on phones [P3][P4], cards that require insertion fail [P1][P2][P4], and phones cannot take payments offline [P5]. Each German outlet needs at least one WisePad 3 or S700.
2. A card payment belongs to the hotel's connected account: connection tokens, locations and PaymentIntents are created with `Stripe-Account`; one Stripe Terminal `Location` per outlet (its `display_name` is shown on the phone's tap screen) [P7][P8].
3. Country lock: reader location, connected account and currency must be in the same country; a Swiss outlet takes CHF only [P4].
4. iPhones: each hotel's account must accept Apple's Tap to Pay terms once (`isTapToPayAccountLinked`, onboarding link); a phone serves at most 3 Stripe accounts per rolling 24 hours [P8]. Android phones must meet the device list (Android 13+, patch within 12 months, GMS, no developer options) [P2]. The PMS app must be distributed with Apple's Tap to Pay entitlement [P1].
5. For German girocard, create PaymentIntents with `payment_method_options.card_present.routing.requested_priority` set to `domestic` or `international`; girocard refunds go out by SEPA transfer and can fail, so the refund state must allow "failed" [P4].
6. Tips on phones are entered in the PMS app and included in the PaymentIntent `amount`; on readers, on-reader tipping returns the tip in `amount_details`. The folio and receipt store the tip separately from revenue in both cases [P9][P10].
7. Offline card payments are a per-outlet setting (`offline[enabled]` on a Terminal `Configuration`) with a PMS-side ceiling per payment and per stored total, enforced through `offlineBehavior = REQUIRE_ONLINE` above the ceiling [P17]. Stripe's own ceiling is 10,000 USD equivalent per payment [P17].
8. An offline card payment is a payment with state "stored, not authorised": null PaymentIntent id, a PMS-generated id in `metadata`, matched by webhook after forwarding; it cannot be refunded or cancelled until forwarded; it can later be declined, and the loss is the hotel's [P17]. The outlet bill must support "declined after the fact", which reopens the amount as an open claim (inference).
9. Offline in the EEA means chip and PIN on international schemes only; girocard and tap are refused offline [P5][P17].
10. Readers must be connected online regularly: smart readers within the last 24 hours on the same LAN, mobile readers within 30 days [P17]; mobile readers reboot every 24 hours [P12]. The outlet app shows a warning when a reader is close to these limits (inference).

Fiscal, Germany
11. An outlet order is a fiscal object of its own: each order round is secured as `Bestellung-V1` with quantity, item text and gross unit price, within 45 seconds of each change [G3][D1].
12. The bill and the payment are secured as `Kassenbeleg-V1` when the bill is created, not when the table is opened (DSFinV-K Tz. 2.7.2). The receipt then prints the start time of the first order, and orders and bill share an `ABRECHNUNGSKREIS` (table or check id) [D1][G3].
13. Every order, bill and payment carries a business case id that links them, also across split bills and across systems (`Bon_Referenzen`) [D1].
14. A cancelled order line after signing is a new signed line with negative quantity; `P_STORNO` only before signing. A cancelled whole order is a new signed negative order. A cancelled paid bill is a new receipt with `BON_STORNO = 1`, reversed signs and a reference to the original [D1].
15. An abandoned payment dialog is secured as `AVBelegabbruch`, never dropped [D1].
16. Training mode is an explicit state of the outlet app; everything done in it is signed as `AVTraining`, never touches turnover, and no real payment may be taken in it. The Stripe connection must therefore be switched to test mode or blocked while training (inference from [D1]).
17. Tips paid by card with the bill are `TrinkgeldAN` (employee) or `TrinkgeldAG` (employer) lines on the signed receipt; the cash pay-out to staff is a second signed movement [D1].
18. How an own-outlet order that is charged to the room is secured (open `Bestellung` closed at folio payment, or `AVTransfer` as between separate systems) is not settled by the sources, **pending tax advisor**. `point-of-sale-room-charges.md` covers only external tills.

Fiscal, Austria
19. Orders are not signed; each payment at the table (cash, card, voucher) is a signed receipt with amounts per tax rate [A4][A1].
20. A table bill paid in parts by several guests may be one receipt if paid promptly; table and item shares must be derivable [A4].
21. Training and cancellation receipts are signed, marked `TRA` / `STO`, and do not change the turnover counter [A4].
22. The receipt is handed over on the premises, terrace included; a printer must be reachable from every outlet from 1 October 2026 (fiscal research constraint 26) [A4].

Both countries
23. The outlet must keep working without internet: local order storage, local receipt printing with the outage mark, queue of signing requests replayed with the same UUID (Austria), documented outage periods (Germany) [G3][A1][F13].
24. Every sellable item carries a Tax Code per country; restaurant food, drinks, pool, sauna, massage and retail items differ (DE 7/19 %, AT 10/13/20 %, CH 2.6/8.1 %) [U1][U4][C3].
25. Vouchers valid across outlets are multi-purpose in Germany (taxed at redemption); single-service vouchers are single-purpose (taxed at sale). The voucher record carries its type from issue [U2].
26. Spa treatments are sold through the same signed outlet flow as restaurant items; a treatment booked in advance and paid at checkout follows the folio rules of `point-of-sale-room-charges.md` (inference).

## Open points

1. Germany: own outlet order charged to the room within the same PMS: secure as open `Bestellung` until folio payment, or as `AVTransfer`? (constraint 18)
2. Germany: after an offline card payment is declined days later, how is the already signed `Kassenbeleg` with "Unbar" corrected (new receipt with changed tender, or `Forderungsentstehung`)?
3. Germany: exact layout for business-meal receipts (BMF letter 30 June 2021) not read.
4. Stripe: girocard on S710 in Germany (documents disagree); on-reader tipping on WisePad 3 in AT and CH (documents disagree); offline tap in Switzerland.
5. Stripe: whether a maximum amount per Tap to Pay payment exists besides the CVM limit.
6. Austria: Anlage 1 drinks at 10 % in restaurants; location of voucher rules in UStG 1994.
7. Germany: sauna rate when sold with pool access (UStAE 12.11 not read).

Confidence: **high** for Stripe availability, schemes, girocard exclusion, offline rules and German order signing (raw primary text). **Medium** for Austrian order handling (inferred from the decree's definition of cash turnover) and for tax rates of spa services (inferred from closed statutory lists). **Low** for the CVM amounts (read through a summary) and the items listed as UNVERIFIED.

## Sources

Stripe (raw Markdown from docs.stripe.com, fetched 2026-09-30, `Accept-Language: en-US`)
- [P1] Tap to Pay on iPhone — https://docs.stripe.com/terminal/payments/setup-reader/tap-to-pay?platform=ios
- [P2] Tap to Pay on Android — https://docs.stripe.com/terminal/payments/setup-reader/tap-to-pay?platform=android
- [P3] Terminal global availability and payment methods — https://docs.stripe.com/terminal/payments/collect-card-payment/supported-card-brands
- [P4] Regional considerations, Germany, Austria, Switzerland — https://docs.stripe.com/terminal/payments/regional?integration-country=DE ; ?integration-country=AT ; ?integration-country=CH
- [P5] Accept offline payments, overview (mobile, smart, Tap to Pay variants) — https://docs.stripe.com/terminal/features/operate-offline/overview?reader-type=bluetooth ; ?reader-type=internet ; ?reader-type=tap-to-pay
- [P6] Regional contactless limits (read through a summarising fetch) — https://support.stripe.com/questions/what-are-the-regional-contactless-limits-for-stripe-terminal-transactions
- [P7] Use Terminal with Connect, direct charges — https://docs.stripe.com/terminal/features/connect?connect-charge-type=direct
- [P8] Connect to a Tap to Pay reader, iOS — https://docs.stripe.com/terminal/payments/connect-reader?terminal-sdk-platform=ios&reader-type=tap-to-pay
- [P9] Collect on-reader tips — https://docs.stripe.com/terminal/features/collecting-tips/on-reader
- [P10] Collect tips, overview — https://docs.stripe.com/terminal/features/collecting-tips/overview
- [P11] Pricing pages (raw HTML) — https://stripe.com/de/pricing ; https://stripe.com/at/pricing ; https://stripe.com/ch/pricing
- [P12] Mobile readers — https://docs.stripe.com/terminal/mobile-readers
- [P13] BBPOS WisePad 3 — https://docs.stripe.com/terminal/readers/bbpos-wisepad3
- [P14] Stripe Reader S700/S710 — https://docs.stripe.com/terminal/readers/stripe-reader-s700-s710
- [P15] Network transitions on cellular readers — https://docs.stripe.com/terminal/features/operate-offline/network-transitions
- [P16] Configure the cellular network (country list) — https://docs.stripe.com/terminal/fleet/cellular?dashboard-or-api=api
- [P17] Collect card payments while offline (Android, smart and mobile readers) — https://docs.stripe.com/terminal/features/operate-offline/collect-card-payments?terminal-card-present-integration=terminal&reader-type=internet&terminal-sdk-platform=android ; same with reader-type=bluetooth

Germany
- [G2] KassenSichV — https://www.gesetze-im-internet.de/kassensichv/BJNR351500017.html (via fiscal research)
- [G3] AEAO zu § 146a, consolidated text as reproduced by NWB Datenbank (raw HTML), Nr. 1.10.2, 1.11.1, 1.14, 2.2.2, 2.2.3.3, 2.2.3.6.1, 2.2.3.6.2, 2.5 — https://datenbank.nwb.de/Dokument/500001_146a/
- [D1] DSFinV-K version 2.4 (`20231215_DSFinV_K_2_4.pdf` in the official BZSt archive), Tz. 2, 2.7, 4.2.2, 4.2.3, 4.2.6, Annex B, Annex C, Annex H, Annex I — https://www.bzst.de/SharedDocs/Downloads/DE/Aussenpruefung/dsfinv_k_v_2_4.zip?__blob=publicationFile&v=19
- [U1] UStG § 12 — https://www.gesetze-im-internet.de/ustg_1980/__12.html
- [U2] UStG § 3 (13) to (15) — https://www.gesetze-im-internet.de/ustg_1980/__3.html
- [U3] UStG § 4 Nr. 14 — https://www.gesetze-im-internet.de/ustg_1980/__4.html
- Not readable: BMF letter on Bewirtungsaufwendungen of 30.06.2021 — https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Steuerarten/Einkommensteuer/2021-06-30-bewirtungsaufwendungen.pdf (browser check, then HTTP 404)

Austria
- [A1] RKSV — https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=Bundesnormen&Gesetzesnummer=20009390 (via fiscal research)
- [A4] BMF, Erlass zur Einzelaufzeichnungs-, Registrierkassen- und Belegerteilungspflicht, 23.12.2019, BMF-010102/0007-I/8/2019, sections 2.4.1, 2.4.4, 2.4.6, 3.1.2, 3.2.1, 4.4, 4.5.3, 4.5.4, 6.7 (raw PDF text) — https://findok.bmf.gv.at/findok/resources/pdf/a8ae01cd-b8d6-4e66-9954-f77ac33b8df2/77231.1.1.pdf
- [U4] UStG 1994 § 10, in force from 01.07.2026 — https://www.ris.bka.gv.at/NormDokument.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10004873&Paragraf=10

Switzerland
- [C3] ESTV, MWST-Steuersätze — https://www.estv.admin.ch/de/mwst-steuersaetze-schweiz

fiskaly
- [F13] SIGN AT FAQ (via fiscal research) — https://workspace.fiskaly.com/countries/austria/faq/
- [F15] DSFINVK process and business case types — https://workspace.fiskaly.com/dsfinvk/process-types-business-transaction-types/

Search budget: the session's web search quota was exhausted before this research began; all sources above were fetched directly from known vendor and government URLs.
