# Arrival-day card transaction for registration

Map: ../map.md
Type: research
Status: resolved
Blocked by: -

## Question

"Meldeschein tablet signing flow" ships the German card path: under BMG §29(5) Nr. 1 the guest confirms their registration data by triggering "einen kartengebundenen Zahlungsvorgang mit einer starken Kundenauthentifizierung" on the day of arrival, with the purpose-bound number of the payment instrument stored. Establish from primary sources (BMG, BeherbMeldV and its official reasoning, Bundestag printed matter, BMI or BSI guidance, DEHOGA or DTV guidance): (1) whether a card pre-authorisation (hold) with strong customer authentication counts, or only a captured payment; (2) whether a zero-amount or minimal-amount card verification counts; (3) whether a payment made before the arrival day (prepaid rate, booking engine payment with 3-D Secure) counts, or the transaction must happen on the arrival day; (4) whether the card must belong to the registering guest, and what happens when a company or another person pays; (5) what exactly must be stored as the purpose-bound number and provider name, and how a Stripe PaymentIntent, PaymentMethod or Terminal transaction maps onto it; (6) where the official XML schema for the electronic record is published and its current version. Conclude with the rules the spec must state for when the card path is offered and when the system must fall back to the printed form.

## Answer

Full findings with verbatim statute and reasoning: [arrival-day-card-transaction.md](../../../docs/research/arrival-day-card-transaction.md). Resolved 2026-09-28.

1. Pre-authorisation with SCA: probably counts. The statute asks for a "Zahlungsvorgang" the guest "auslöst", not a completed debit; the reasoning (BT-Drs. 19/13959 p. 29) names a "Zahlungs- oder Reservierungsvorgang". No official source says it expressly. UNSETTLED, lawyer to confirm; prefer holds that are later captured.
2. Zero-amount verification: treat as not qualifying (no "Geldbetrag", Stripe SetupIntent creates no charge). Minimal amounts count only with proven SCA, which small amounts often skip via exemptions. Law silent, UNSETTLED.
3. Payment before arrival day: does not count on the enacted wording ("am Tag der Ankunft bestätigt, indem ... auslöst"). The government reasoning and a 2020 BMI press release suggest a reservation-time token could do, so sources conflict. Safe rule: fresh SCA transaction on the calendar day of arrival, else paper.
4. Card ownership: the guest must personally trigger the transaction and be the cardholder; the token's purpose is to identify "eine bestimmte Person". Company, agent or companion paying means paper form. Company card in the guest's own name is UNSETTLED.
5. Stored data: one token string plus the name of the hotel's payment provider (`Zahlungstoken`, `NameZahlungsdienstleister`). Proposed mapping: Stripe PaymentMethod ID as token, PaymentIntent and charge IDs plus SCA evidence kept alongside; provider name configurable. Mapping is not officially defined, lawyer to confirm.
6. XSD: Bundesanzeiger BAnz AT 10.07.2020 B1 (notice of 17 June 2020), also on the BMI site. Unversioned; identifiers unchanged by BEG IV. No later notice found, which is UNVERIFIED. XML dates are `xsd:date`, not `JJJJMMTT`.

Fallback to the printed, hand-signed form whenever consent, the guest's own card, arrival-day timing or SCA evidence is missing. Section 7 of the findings lists 10 certain rules and 10 that need counsel.
