# Point-of-sale systems and room charge interfaces

Research date: 2026-09-29. Ticket: `.scratch/hotel-pms-v1/issues/42-point-of-sale-research.md`.
Scope: how restaurant and bar point-of-sale systems used in German-speaking hotels post charges to a guest's room, and what that means for the folio, Tax Codes and the fiscal module of a multi-tenant web PMS with no server at the hotel.
Background not repeated here: ticket 10 (folio and billing domain), ticket 18 (cash and fiscal module), `fiscal-service-provider-selection.md`.

Every claim cites a source in the "Sources" list. Claims that could not be confirmed from a primary source are marked **UNVERIFIED**. Statements that are the researcher's own conclusion are marked **(inference)**.

How the sources were read. Read as raw text and quoted verbatim: DSFinV-K 2.4 (official BZSt archive), AEAO zu § 146a (NWB reproduction), the Austrian decree, the FIAS specification, UStG and UStDV, the Hypersoft documentation, the gastronovi price list, the ready2order API document, and four pages of the Lightspeed integration guide (search, example requests, parameters, configuration). Read through a summarising fetch tool, so wording should be re-checked before it is relied on in a contract: the Lightspeed API reference, the other Lightspeed guide pages and support articles, Oracle Simphony web pages, apaleo, Mews, Omniboost, Chift, orderbird, SumUp, Vectron.

## 1. Comparison of systems and aggregators

There are three integration patterns. The pattern decides who has to build what.

- **Pattern A, the till defines the interface and the PMS implements it.** The PMS runs endpoints that the till calls. Lightspeed K-Series, Oracle Simphony, FIAS.
- **Pattern B, the PMS publishes an interface and the till vendor or a middleware builds the connector.** apaleo and Mews work this way [AP1][M1]. gastronovi and Omniboost build such connectors [N1][N2][OB1].
- **Pattern C, the till has a general public interface without any hotel function.** A room charge can only be assembled from generic parts. ready2order [R1].

| System | Public interface for room charges | Pattern and transport | Guest lookup | What is posted | Reversal | Access for a new PMS | Public cost |
|---|---|---|---|---|---|---|---|
| **Lightspeed Restaurant K-Series** | Yes, complete and open: integration guide and API reference [L2][L3][L4][L5] | A. HTTPS. The partner registers a base URL with `POST /pms/v1/providers`; Lightspeed then calls `GET {base}/search` and `POST {base}/charge` [L1][L2][L3][L4] | Free text typed by the waiter, name or room; PMS answers with a list of reservations [L3] | The whole receipt with items, tax per line, payments, tip, covers [L4][L7] | New negative posting linked by `initialAccountId`; only from the till [L5] | "Access to the Lightspeed Restaurant K-Series APIs is reserved for Lightspeed partners and approved merchants"; application form [L9] | None published, **UNVERIFIED** |
| **Oracle Simphony** | Yes, specification open [O2][O4] | A. TCP socket. "The third-party PMS application interface must act as a socket-server and accept TCP connections from the Simphony POS system on the default port 5009" [O4] | Text typed by the operator, up to 30 characters; the PMS decides how to interpret it and returns a guest list [O2] | Totals only: up to 16 sales itemizers, 16 discount, 14 service charge, 63 tax itemizers; covers, check number, revenue centre. No menu items [O2] | Not described in the specification [O2], **UNVERIFIED** | Not stated in the specification; Oracle partner terms not examined, **UNVERIFIED** | None published, **UNVERIFIED** |
| **FIAS** (Oracle's hotel interface protocol, release 2.20.25) | Yes, specification open as PDF [O3] | A. TCP or serial, fields separated by the bar character [O3]. Written for Oracle's own PMS as the hotel side; that other tills speak it towards other PMS is common practice but **UNVERIFIED** here | Posting Request used as inquiry, answered by a Posting List [O3] | Totals only: total, subtotals 1-9, taxes 1-9, discounts 1-9, tip, service charge, covers, check number, sales outlet [O3] | Negative amounts are allowed (leading minus); no separate void record found [O3] | The specification points vendors to the "ORACLE Vendor Validation team" [O3] | None published, **UNVERIFIED** |
| **gastronovi** | No technical document public. Product "HOTAPI" connects the till with the PMS [N2] | B (inference from [N3]: to connect, only the API key from gastronovi is needed). Direction and protocol **UNVERIFIED** | "Auslesen aktueller Gäste & Anzeige in der Kasse" [N1] | "Direkte Buchung auf Zimmer/virtuelle Konten aus der Kasse", "Übertragung aller Rechnungen aus der Kasse", master data (payment types, product groups, cost centres) [N1] | **UNVERIFIED** | "Kontaktiere unser Team, um zu erfahren, ob eine Integration möglich oder bereits geplant ist" [N1]; PMS vendors contact "Partnering" [N2] | For the hotel, per PMS interface: 29 EUR / 39 CHF per month or 290 EUR / 390 CHF per year, plus 299 EUR / 399 CHF once for set-up [N1]. Cost for the PMS vendor **UNVERIFIED** |
| **Vectron** | No. The interface page lists more than 20 hotel systems and no developer documentation [V1] | **UNVERIFIED**. A PMS vendor's manual names a Vectron interface "VGPMS" with address and port of a PMS server; that manual could not be retrieved [V2] | **UNVERIFIED** | **UNVERIFIED** | **UNVERIFIED** | Not stated [V1] | None published |
| **Hypersoft** (not in the ticket's list, included because its documentation is the most explicit on the German tax side) | Behaviour documented openly, protocol per PMS [H1][H2] | A and B, depending on the PMS; file exchange or XML [H2] | Loads guest list or searches by name, room or reservation number; requires room number, reservation number and name in the answer [H1] | Items or product groups depending on the PMS connection [H1] | **UNVERIFIED** | Not stated | None published |
| **ready2order** | General REST interface open; nothing for hotels. The document contains neither "hotel" nor "room" [R1] | C. REST plus webhooks; limit "max 60 requests per minute per Account Token" [R1] | None. Customers can be created through `/customers` [R1] | Webhook `invoice.created` delivers the finished receipt with items, tax rate per item, tip total, customer and payment [R1] | `invoice.created` "also fires for the storno document when an invoice is cancelled"; `invoice.cancelled` for the original [R1] | Developer token by request form [R2] | Not stated [R2], **UNVERIFIED** |
| **orderbird** | No public interface document found | **UNVERIFIED** | **UNVERIFIED** | **UNVERIFIED** | **UNVERIFIED** | Partner application form; "from simple data exchange to complete product integration"; no PMS partner named [OR1] | None published |
| **SumUp (Kassensystem Pro)** | None for hotels. The integrations page names no PMS [SU1] | **UNVERIFIED** | **UNVERIFIED** | **UNVERIFIED** | **UNVERIFIED** | Not stated | None published |
| **Omniboost** (aggregator) | Set-up guides only [OB1] | Middleware between a till and a PMS interface. Runs gastronovi to apaleo, gastronovi to Mews and Lightspeed to Mews [N1][OB1] | Through the till's own room charge function (inference) | Till product categories are mapped to PMS accounting categories, with a "Fallback Revenue" for unmapped categories [OB1] | **UNVERIFIED** | Requires the PMS to publish an interface (pattern B) (inference) | None published, **UNVERIFIED** |
| **Chift** (aggregator) | Documentation open [C1][C2] | One reading interface over many tills: "Sales, orders, closures, products, and customers across multiple POS systems" [C1] | None | Finished sales, read after the fact | Not applicable | Connectors exist for Lightspeed, Oracle Simphony, HelloCash, Tiller, Zettle, Square; none for orderbird, gastronovi, Vectron or ready2order [C2] | Not examined |

Findings from the table:

1. Only **Lightspeed K-Series** offers a complete, open, web-based room charge contract that a cloud PMS can implement without anything installed at the hotel [L2][L3][L4].
2. **Simphony and FIAS need a TCP socket server reachable from the hotel network** [O3][O4]. For a PMS without a component at the hotel this means a site-to-site tunnel or a small relay at the property (inference).
3. For **gastronovi, Vectron, orderbird and SumUp** nothing can be built from public documents. The way in is a partner conversation [N1][N2][OR1].
4. **No aggregator covers the tills common in German-speaking hotels for room charges.** Chift reads sales and has no guest lookup [C1][C2]. Omniboost connects tills to a PMS that already has a public interface [OB1].
5. Other aggregators (for example Hapi) were not examined.

## 2. Guest or room lookup

- **Lightspeed**: `GET {base}/search?businessExternalReference=…&apiKey=…&term=…`. The answer is a list `reservations` with `roomId`, `roomDescription`, `clientName`, `reservationId`, optional `creditLimit`, and `blocked` [L3]. "Guests who have not checked in cannot be found using the search function" [L3]. The feature `SEARCH_BY_NAME` is "currently required" [L2]. The API key travels "in the query parameter apiKey" [L2].
- **Spending limit on Lightspeed**: if the charge exceeds `creditLimit` a normal user is stopped, a manager may override. Tips are not counted against the limit [L6].
- **Simphony**: "Guest ID as entered by POS operator. This is not limited other than in input length. It is up to the third-party PMS on how this information should be handled to source a particular guest or a list of guests" [O2].
- **FIAS**: "Inquiries will only return a match on those guests who are currently checked in to the Hotel." "Postings using (PR) must have a preceding inquiry (PR)." The list carries room number, reservation number and guest name, and optionally balance, credit limit and a no-post flag. One room with several guests returns several entries [O3]. The posting can carry a credit limit override flag "Normally only allowed for POS supervisors" [O3].
- **Hypersoft**: "Die Reservierungsnummer ist die einzige eindeutige Zuordnung zwischen PMS und POS, da Namen und Zimmernummern nicht immer eindeutig sein können." The till checks again when the bill is closed; "Abschlüsse auf ausgecheckte Gäste sind nicht möglich". Guests not yet checked in, banquets and company accounts need a "(virtuelle) Zimmernummer" in the PMS [H1].
- **apaleo** (pattern B): the till reads reservations limited to in-house and searches by room number or guest name, then takes "the first folio that contains `AddCharge` in `allowedActions`" or creates a new folio [AP1].
- **Mews** (pattern B): search by first name, last name or room; targets are in-house guests and profiles classified as paymaster account; a profile classified "Cashlist" means no posting to the bill [M1].

Common ground across all systems: search by room or name, only checked-in guests, the reservation is the posting target, a per-guest block and an optional limit.

## 3. Posting and reversing a room charge

**Lightspeed**
- The hotel creates a payment method "Charge to Room" with code `IKPMS` [L2].
- On closing the bill Lightspeed sends `POST {base}/charge`; the path "must end with `/charge`"; header `X-Lightspeed-Idempotency-Key` [L4].
- Answer 200 marks the posting successful; an error answer may carry `customerErrorMessage` of at most 50 characters, shown at the till [L4].
- Optional features: `PARTIAL_PAYMENTS` (part of a bill to the room, rest by another tender), `MULTI_PAYMENTS` (several rooms on one bill), `MIRRORING` ("Every account/receipt created in Lightspeed will be sent to the PMS at the time it is closed, regardless of whether the 'Charge to Room' payment method is used") [L2].
- **No automatic resend**: "unsuccessful postings must be reconciled manually through your PMS software" [L10]. Time limits for the PMS answer are not documented, **UNVERIFIED**.
- **Reversal, same day**: "the whole guest check-in gets voided in the POS which will send a negative posting to the PMS"; the void is a new account "with the same sales lines in it - and negative values - (with a new uuid / accountReference)" [L5]. Only whole bills are voided.
- **Reversal, later day**: staff check by search that the guest is still checked in, then post a new bill with negative items to the same room. "A cancellation on the same day or on a following day is only possible and supported at the POS" [L5].
- `initialAccountId` points to the first account, so a reversal can be matched to its original [L5][L7].
- A tip correction is sent as a negative bill followed by the same bill with the corrected tip [L5].

**Simphony**
- Message pair for charge posting; the PMS answers with status "'P' = Posted 'D' = Declined 'E' = Error" and a text of 30 characters [O2].
- A retransmission carries the same sequence number and the flag "R"; the PMS then repeats its last answer [O4].
- An optional "check facsimile" delivers the printed bill as text, 40 characters per line [O2].

**FIAS**
- Posting Request, answered by Posting Answer with a status. The posting sequence number links request and answer [O3].
- "TA = S1 + [S2] + [S3] + T1 + [T2] + [T3] + D1 + [D2] + [D3] + [TP] + [SC]"; when a bill is split, the till must split subtotals and taxes so that they add up to the posted total [O3].

**Pattern B (apaleo, Mews)**
- apaleo: `POST /finance/v1/folio-actions/{folioId}/charges` with service type, VAT type, name, amount, receipt number and business date. Reversal is the same charge with a negative amount [AP1].
- Mews: "Add order" with full item names, accounting category per item, link to the reservation, till ticket number in the notes. Corrections are negative items; the original cannot be cancelled [M1].

Common ground: a reversal is always a new negative posting, never a change of the first one. This matches the folio rule that nothing is edited or deleted (ticket 10).

## 4. Data delivered

| Data | Lightspeed | Simphony | FIAS | ready2order webhook |
|---|---|---|---|---|
| Items with name and quantity | Yes: `description`, `quantity`, `unitAmount`, `amount`, `sku` [L4][L7] | No, only in the bill text [O2] | No [O3] | Yes [R1] |
| Revenue grouping | Accounting group id and name per line; revenue centre [L4] | Sales itemizers, revenue centre [O2] | Subtotals 1-9, sales outlet [O3] | Accounting code per item [R1] |
| Tax | Per line: tax id, name, rate, included or not; with `ENRICHED_PAYLOAD` several tax lines per item [L7][L8] | Tax itemizers; with the VAT option they hold "Taxable Totals" [O2] | Tax fields only for add-on tax countries; otherwise "subtotal fields should contain tax-inclusive amounts" [O3] | Rate and amount per item [R1] |
| Tip | `gratuity` on the payment: "Tip which is applied without revenue and tax. The tip is not assigned to an accounting group in Lightspeed" [L7] | Service charge itemizers [O2] | Field TP [O3] | `invoice_totalTip` [R1] |
| Covers | `covers` [L4] | Number of guests [O2] | Field CV [O3] | Not found |
| Waiter, table, device | Owner, staff per line, device, bill name such as "Table 5" [L4][L5] | Employee, check number [O2] | User id, table number, workstation [O3] | Table endpoints exist [R1] |
| Till receipt number | `receiptId`, `fiscId`, `uuid` [L4] | Check number [O2] | Check number [O3] | Invoice number [R1] |
| Discounts | Separate lines of type `LineDiscount` or `AccountDiscount` [L4] | Discount itemizers [O2] | Discount fields, negative [O3] | Discount fields per item [R1] |

Points to verify in the Lightspeed test environment, all **UNVERIFIED**:

1. **Gross or net.** The guide says `amount` is "The total amount of this entry including Tax" and `taxIncluded` "True = tax inclusive" [L7]. The API reference describes `amount` as the pre-tax total [L4]. The two texts disagree.
2. **Format of the tax rate.** The example shows `"taxName": "MwSt. 7.7%", "taxRate": 1.0770`, a multiplier and not a percentage [L5].
3. **Tip and payment amount.** The example has items of 6 and 5, `"gratuity": 1` and `"amount": 11` [L5]. The payment amount appears to exclude the tip, so the debit on the folio would be 12.
4. **Timestamps are in UTC** [L4]. The PMS converts them to the property's time and business date.

## 5. Who is the fiscal cash register for the sale

### 5.1 Germany

**The till is the recording system for the sale and secures it with its own security device.** Sources:

- The official interface description contains exactly this case. Annex I lists the example "Transfer von Hotelrestaurant auf Hotelzimmer (getrennte Aufzeichnungssysteme) 100€ zu 19%" with the secured data `AVTransfer^100.00_0.00_0.00_0.00_-100.00^`, process type "AVTransfer", business cases "Umsatz" (19%) 100 and "Forderungsentstehung" (0%) -100 [D1].
- "Der Vorgangstyp „AVTransfer“ dokumentiert alle Vorgänge, die zwar in der Kasse erfasst, aber für den Abrechnungsprozess nicht weiterverarbeitet werden sollen. Die weitere Verarbeitung dieser Vorgänge erfolgt manuell bzw. aus einem anderen System heraus." Such a process is "von der Darstellung im Kassenabschluss ausgeschlossen" (Annex B) [D1].
- "Bei allen Vorgangstypen, die mit AV beginnen (Ausnahme: AVTraining), ist nur die Zahlart „Keine“ möglich" (Annex B) [D1].
- "Forderungsentstehung" records transactions where goods have moved and payment follows later, "wahlweise über ein nachgelagertes System oder in der Kasse" (Annex C) [D1].
- Every recording system with cash function is protected by a security device, and one system belongs to exactly one device (AEAO Nr. 1.6) [G3]. A till vendor confirms the practice: "All orders, transactions, and voids are recorded and sent to Fiskaly to be authenticated and signed" [L11].
- A till vendor on the tax side: "Wenn ein Gast "auf Zimmer" zahlen möchte und ihr PMS die Umsatzsteuer/ Mehrwertsteuer im PMS ausweist, so sollten sie dies nicht auf der Rechnung des POS Systems tun, da Sie sonst in der Regel doppelt steuerpflichtig sind." "Meistens wird im Hypersoftsystem eine Pro Forma Rechnung erstellt und dann nach der Übertragung im PMS versteuert" [H1].

What this means for our fiscal module:

1. **Receiving a room charge is not a cash desk process of the PMS.** The PMS does not sign when the charge arrives (inference from [D1]; AEAO does not mention hotels [G3]). Open point 2 of the fiscal research, whether folio postings are "orders" to be secured, stays with the tax advisor.
2. **The PMS signs when the folio is paid at the desk.** The receipt then carries gross turnover per tax rate and amount per tender (AEAO Nr. 2.2.3.6.1) [G3]. Restaurant charges are part of that split. This is constraint 8 of the fiscal research applied to till charges.
3. **How the restaurant lines appear in the PMS's own cash data export is open.** Two readings are possible. Either they are turnover of the PMS receipt, because the till excluded them from its closing [D1]. Or they settle a receivable recorded in an external system, which needs a reference of type "ExterneRechnung", "ExternerLieferschein" or "ExterneSonstige" with the external receipt id (Annex C) [D1]. **UNVERIFIED**, question for the tax advisor. Either way the PMS must keep the till's receipt number.
4. **Revenue must be reported once.** The hotel's accounts take room-charged revenue from the PMS and must not take it again from the till. This depends on the till being configured to record room charges as a transfer [D1][H1].

### 5.2 Austria

**At the till a pure room charge is not cash turnover. The duty arises when the guest pays, and then at the system that takes the payment.** Sources:

- Cash turnover is turnover "bei denen die Gegenleistung (Entgelt) durch Barzahlung erfolgt"; card payment on site and vouchers count as cash payment (decree 2.4.4, BAO § 131b (1) Z 3) [A4].
- "Entscheidend ist, dass eine Barzahlung erfolgt und nicht, wann die Lieferung oder sonstige Leistung erbracht wird. Daher ist beispielsweise eine Anzahlung für eine noch nicht erbrachte Leistung oder eine nachträgliche Barzahlung elektronisch zu erfassen" (decree section 3) [A4].
- Takings that are not cash turnover need not be recorded in the register. "Werden diese jedoch erfasst, so besteht ab 1. April 2017 keine Pflicht zur Signatur im Sinne § 9 RKSV für solche Belege, es sei denn, sie werden in einem Beleg mit Barumsätzen kombiniert" (decree section 3) [A4].
- "Eine Rechnungsvorbereitung vor erfolgter Barzahlung (zB Ausstellung einer Hotelrechnung am Vorabend der Abreise des Hotelgastes) ist zulässig" (decree 4.4) [A4].
- Collective terms are not allowed on the receipt: "Die Verwendung von allgemeinen Sammelbegriffen oder Gattungsbezeichnungen wie zB Speisen/Getränke … ist aber auch gemäß § 132a BAO nicht zulässig" (decree 4.6.4) [A4].
- Tips for staff, if recorded, are treated like pass-through items (decree 2.4.6) [A4].

What this means for our fiscal module:

1. The till signs nothing for a pure room charge, unless the same bill also contains a cash or card part [A4].
2. **The PMS is the cash register for the payment.** When the guest pays the folio on site, the PMS signs a receipt that includes the restaurant charges with their tax rates. When the guest pays by transfer or online, no register receipt is due (fiscal research, section 5.1).
3. The PMS receipt cannot show "Restaurant 84.50" alone [A4]. Either the items are on the receipt, or the receipt refers to an invoice that already lists them (fiscal research, constraint 12). Whether a reference to the till's bill is sufficient is **UNVERIFIED**.
4. The decree does not treat the room charge case by name. The conclusions above are inference from its general rules and belong on the tax advisor's list.

### 5.3 Both countries: restaurant run by another business

If the restaurant belongs to another taxpayer (lease), the charge on the hotel folio is not hotel revenue. apaleo separates charges "Delivered by the hotel, recorded as revenue and VAT" from charges "Delivered by a third party and are recorded as transitory items" [AP2]. Hypersoft asks the hotel to clarify the case where the outlet "unter einer anderen Steuernummer agiert" [H1]. In Austria pass-through items recorded in the register are marked as not relevant for VAT (fiscal research, section 5.1).

## 6. Partner programmes and costs

| Vendor | Programme | Cost |
|---|---|---|
| Lightspeed | Interface reserved for partners and approved merchants. Approved partners get a developer portal with demo accounts. Application form. The integration must offer the merchant a way to uninstall [L9][L12] | Not published, **UNVERIFIED** |
| gastronovi | Contact form for new PMS connections; "Partnering" for vendors [N1][N2] | Hotel pays 29 EUR per month plus 299 EUR set-up per PMS interface [N1]. Vendor side **UNVERIFIED** |
| Oracle | Specifications open. Vendor validation team named in the FIAS document [O3] | **UNVERIFIED** |
| Vectron | Nothing public [V1] | **UNVERIFIED** |
| orderbird | Partner application form [OR1] | **UNVERIFIED** |
| ready2order | Developer token on request [R2] | **UNVERIFIED** |
| SumUp | Nothing public for hotels [SU1] | **UNVERIFIED** |
| Omniboost | Onboarding through the PMS's marketplace and an Omniboost case [OB1] | **UNVERIFIED** |
| Chift | Open documentation [C1] | Not examined |

The only public price is what gastronovi charges the hotel. All vendor-side costs need a direct enquiry.

## 7. Recommendation for v1

**Recommended: one internal room charge module with three ways in.**

1. **Manual posting at the front desk, for every till.** Staff post a restaurant bill from the Service catalogue, split by Tax Code, with the till's receipt number. This works on day one for orderbird, SumUp, Vectron, ready2order and every other till, and it is the fallback that Lightspeed itself requires for failed postings [L10].
2. **Lightspeed K-Series as the first automatic connection.** It is the only contract that is public, web-based, item-level and needs nothing at the hotel [L2][L3][L4]. It also delivers what the folio needs: reservation as target, tax per line, tip apart from revenue, link from reversal to original [L4][L5][L7].
3. **Our own published room charge interface** (pattern B) with the same three operations: search in-house guests, post a bill, reverse a bill. This is what gastronovi, Omniboost and Hypersoft connect to [N1][OB1][H2]. Publishing it costs little once the module exists. Start the partner conversation with gastronovi first, because it serves the most PMS products in the region and has a fixed public price for the hotel [N1].

**Not in v1: Oracle Simphony, FIAS and Vectron.** They need a network endpoint reachable from the hotel's local network [O3][O4], which conflicts with the architecture (no component at the hotel). They also deliver totals without items [O2][O3]. Revisit when a customer requires it; the solution would be a small relay at the property.

**Not recommended: an aggregator.** None gives the waiter a guest lookup for the tills in question [C1][C2][OB1].

**Fiscal position for v1:** the till stays the fiscal cash register for the sale. The PMS signs nothing on arrival of a room charge and signs the payment of the folio as already decided in ticket 18 and the fiscal research. This position goes to the tax advisor together with the open points below.

Facts that speak against the recommendation, for the owner to weigh:

1. Lightspeed's share among small hotels in Germany, Austria and Switzerland was not measured. The first automatic connection may serve few customers. **UNVERIFIED**.
2. Partner approval by Lightspeed is a precondition and its terms are unknown [L9].
3. Lightspeed does not resend failed postings [L10]. Our endpoint must be available whenever a restaurant is open, including during our own deployments.
4. Lightspeed passes the key in the address of the search request [L2], where it can end up in logs.
5. A published interface of our own creates a support and versioning duty towards third parties.

Confidence: **high** for the interface facts of Lightspeed, Simphony, FIAS and ready2order (primary documents). **Medium** for the fiscal position in Germany (official example exists, the PMS side is inferred). **Medium to low** for Austria (inferred from general rules). **Low** for gastronovi, Vectron, orderbird and SumUp, and for all costs.

## 8. Constraints on folio, Tax Codes and fiscal signing

Folio and posting

1. The posting target is a **Reservation**, identified by its id. Room number and guest name are search keys only [L3][O3][H1].
2. The lookup returns **checked-in reservations only** [L3][O3][AP1]. One entry per guest when several guests share a room [O3][H1].
3. Each Reservation needs a flag **room charge allowed** and an optional **spending limit**. Both are returned in the lookup (`blocked`, `creditLimit`) [L3][O3]. Tips do not count against the limit on Lightspeed, and a manager at the till can override it [L6]. The PMS must decide whether it accepts a posting above the limit.
4. Postings for people who are not in-house guests (events, company accounts, staff meals) need a target without a room. Tills call this a paymaster account or virtual room [H1][M1][N1]. The folio model in ticket 10 has no such target yet.
5. **Routing Rules** choose the Folio. If the chosen Folio is already invoiced, the posting goes to another open Folio or a new one [AP1]. A rejection must carry a message the waiter can read: at most 50 characters on Lightspeed [L4], 30 on Simphony [O2].
6. A till bill is stored as one **external bill** with its Charges: till, outlet, receipt number, fiscal id, opened and closed time, covers, waiter, table, idempotency key [L4]. The Charges of one bill stay grouped on the Folio.
7. **Idempotency**: the key sent by the till is unique per connection. A repeated request returns the first answer and posts nothing [L4][O4].
8. **Reversal is a new negative posting linked to the original**, never an edit [L5][M1][AP1]. It can arrive on a later day [L5]. If the original is already on an issued Invoice, the correction follows the Cancellation Invoice path of ticket 10. If the guest has checked out, the till cannot find the guest [L5]; the front desk corrects by hand.
9. **Service Date** is the business date of the bill at the property. Timestamps arrive in UTC [L4]. A bill closed after midnight but before the Night Audit belongs to the business date still open (rule to be set in ticket 43).
10. **Partial room charge**: the till sends the whole bill, and the payment part for the room may be smaller than the sum of the items [L2][L4]. The PMS needs an allocation rule that splits the charged amount over the Tax Codes of the bill in proportion. FIAS obliges the till to do this split [O3].
11. **Failed postings are not resent** by Lightspeed [L10]. The manual posting screen must accept a till receipt number and must refuse a number already posted.
12. **Mirroring** of all till revenue into the PMS [L2][M1] would make the PMS the book of record for the restaurant. Off in v1 unless ticket 43 decides otherwise.
13. The lookup exposes guest names to the till. Return only room, name, reservation id, block and limit. The key is per property and replaceable, and it is removed from logs [L2].

Tax Codes

14. The till delivers **tax rates, not our Tax Codes**. Each connection needs a mapping from the till's tax id or rate and accounting group to a Tax Code and a revenue account [L4][OB1]. An unmapped line is rejected or posted to a fallback Service; the choice is for ticket 43.
15. **One bill produces at least one Charge per Tax Code.** German restaurant bills mix rates: the reduced rate applies to "die Restaurant- und Verpflegungsdienstleistungen, mit Ausnahme der Abgabe von Getränken" [U1].
16. **Gross is the stored truth** (ADR 0010). The PMS derives gross from the line and its tax data when the till sends net. The meaning of `amount` on Lightspeed must be confirmed by test (section 4).
17. **Items are always stored**, whatever the Folio displays. German invoices need "die Menge und die Art (handelsübliche Bezeichnung)" [U2]; an invoice "kann aus mehreren Dokumenten bestehen", if one of them names the others [U3]. Austria forbids collective terms on the receipt [A4]. A summary line per Tax Code is therefore only possible if it names the till receipt. Tills that deliver totals only (Simphony, FIAS) cannot satisfy the item rule by themselves [O2][O3].
18. **Tip is not revenue.** It is a line without VAT, on its own account, outside the spending limit [L6][L7][A4]. It is owed to the staff and leaves through the cash movement "tips paid out to staff" of ticket 18. A tip that belongs to the owner is taxed; the German export separates the two cases as "TrinkgeldAN" and "TrinkgeldAG" [D1] (fiscal research, constraint 10).
19. **Discounts arrive as separate negative lines** [L4][O3] and are netted within the Tax Code of the items they reduce.
20. **Restaurant of another taxpayer**: a setting per connection. Charges are then pass-through items without hotel VAT and appear apart on the Invoice [AP2][H1].
21. A **service charge** can arrive as its own block [L4][O2][O3]. Rare in the region; reject or map, to be decided.

Fiscal signing

22. **The PMS does not sign on arrival of a room charge.** In Germany the till secures the sale as a transfer with payment type "Keine" [D1]. In Austria a pure room charge is not cash turnover [A4]. Pending tax advisor.
23. **The PMS signs when the Folio is paid at the desk**, with gross per tax rate including the till Charges [G3][A4]. The Tax Code of every till Charge must be known at that moment.
24. The PMS keeps the **till's receipt number and fiscal id** on every external bill, so that the German export can reference the external receipt if the tax advisor requires it [D1].
25. **Revenue once.** Onboarding checks that the till records room charges as transfers and that the hotel's accounting export from the till leaves them out [D1][H1]. The accounting export of the PMS contains them.
26. **Austria**: the receipt at payment lists the items or refers to the Invoice that lists them [A4].
27. A **bill split between room and cash** is signed at the till for the cash part. In Austria the whole receipt is then signed at the till [A4]. The PMS takes only the room part (constraint 10).
28. The PMS is **never registered as the cash register of the restaurant**. Registers, serial numbers and the security device of the PMS are untouched by till connections. A property that runs its bar on an external till has no "Bar" Cash Register in the PMS.
29. A **reversal after the Folio was paid** leads to a refund at the desk, which is a signed process of its own (fiscal research, constraint 13).

## Open points

For the tax advisor

1. Germany: is the arrival of a till charge on a Folio a process the PMS must secure?
2. Germany: are till Charges in the PMS's cash data export turnover, or settlement of an external receivable with reference?
3. Austria: is a reference to the till's bill enough on the PMS receipt, or must the items be printed?
4. Both: treatment of a tip charged to the room and paid out to staff later.
5. Both: leased restaurant, wording on the hotel Invoice.

For vendors

6. Lightspeed: partner terms and cost; time limit for the PMS answer; meaning of `amount`; whether the payment amount includes the tip.
7. gastronovi: direction and protocol of HOTAPI; vendor cost; items or totals.
8. Vectron, orderbird, SumUp: whether any interface for a new PMS exists.

## Sources

Lightspeed Restaurant K-Series

- [L1] API reference, create PMS provider — https://api-docs.lsk.lightspeed.app/operation/operation-pms-apicreateprovider
- [L2] Integration guide, configuring the PMS — https://api-portal.lsk.lightspeed.app/guides/integration-guides/property-management-systems/configuring-the-pms
- [L3] Integration guide, search requests — https://api-portal.lsk.lightspeed.app/guides/integration-guides/property-management-systems/pms-api-requests/pms-search-requests
- [L4] API reference, webhook "Transaction Details" — https://api-docs.lsk.lightspeed.app/operation/operation-transactiondetails
- [L5] Integration guide, example requests — https://api-portal.lsk.lightspeed.app/guides/integration-guides/property-management-systems/pms-api-requests/pms-example-requests
- [L6] Integration guide, credit limit — https://api-portal.lsk.lightspeed.app/guides/integration-guides/property-management-systems/optional-features/pms-credit-limit
- [L7] Integration guide, parameters — https://api-portal.lsk.lightspeed.app/guides/integration-guides/property-management-systems/pms-api-requests/pms-api-parameters
- [L8] Integration guide, enriched payload — https://api-portal.lsk.lightspeed.app/guides/integration-guides/property-management-systems/optional-features/pms-enriched-payload
- [L9] Quick start, access — https://api-portal.lsk.lightspeed.app/quick-start/intro
- [L10] Support article, PMS Postings report — https://k-series-support.lightspeedhq.com/hc/en-us/articles/33960974799259-PMS-Postings-report
- [L11] Support article, German fiscal compliance — https://k-series-support.lightspeedhq.com/hc/en-us/articles/14949401075355-Understanding-German-fiscal-compliance-TSE
- [L12] Integration guide, category page — https://api-portal.lsk.lightspeed.app/category/property-management-systems

Oracle

- [O1] Simphony, Property Management System Interface — https://docs.oracle.com/en/industries/food-beverage/simphony/19.4/simcm/t_shared_services_overview_pmsi.htm
- [O2] Simphony Enhanced PMS Interface Specifications, application data format — https://docs.oracle.com/en/industries/food-beverage/simphony/spmsq/app_data_format.htm
- [O3] Oracle Hospitality Hotel Property Interface IFC8 FIAS Specification, release 2.20.25, May 2022 — https://docs.oracle.com/cd/E94145_01/docs/HGBU-HPI-IFC8-FIAS-Specification2.25.pdf
- [O4] Simphony Enhanced PMS Interface Specifications, message formats and interface methods — https://docs.oracle.com/en/industries/food-beverage/simphony/spmsq/message_formats_inf_methods.htm

Other tills

- [H1] Hypersoft, Beachtenswertes zur Hotel PMS Integration — https://dokumentation.hypersoft.de/Content/Interfaces/PMS_Integration_Remarkable.htm
- [H2] Hypersoft, 3rd Party PMS Integrationen — https://dokumentation.hypersoft.de/Content/Interfaces/Hotelsystemschnittstelle.htm
- [N1] gastronovi, Schnittstellen — https://www.gastronovi.com/schnittstellen/
- [N2] gastronovi, HOTAPI — http://hotel.gastronovi.de/
- [N3] ZimmerSoftware, Inbetriebnahme Gastronovi (HOTAPI), marked by its author as an internal help entry — https://zimmersoftware.de/Hilfe/Inbetriebname-Gastronovi-(HOTAPI)
- [V1] Vectron, software interfaces — https://www.vectron-systems.com/en/software/software-interfaces/
- [V2] Lodgit, Schnittstelle Vectron. Not retrievable (certificate errors, two attempts); known from a search result only — https://dokumentation.lodgit-hotelsoftware.de/schnittstelle-vectron.html
- [R1] ready2order Public API — https://ready2order.com/api/doc
- [R2] ready2order, API page — https://ready2order.com/en/api/
- [OR1] orderbird, partner page — https://www.orderbird.com/en/partner
- [SU1] SumUp, Kassensystem Pro integrations — https://www.sumup.com/de-de/kassensystem-uebersicht/kassensystem-pro/funktionen/integrationen/

PMS interfaces used as reference for pattern B

- [AP1] apaleo, post charges to a guest reservation — https://apaleo.dev/guides/business-cases/pos-integration/guest-reservation-postings
- [AP2] apaleo, POS integration basics — https://apaleo.dev/guides/business-cases/pos-integration/basics.html
- [M1] Mews, Connector API, point of sale — https://docs.mews.com/connector-api/use-cases/point-of-sale

Aggregators

- [OB1] Omniboost, onboarding guide Lightspeed K-Series to Mews — https://help.omniboost.io/en/articles/9651966-onboarding-guide-lightspeed-k-series-to-mews
- [C1] Chift, unified APIs overview — https://docs.chift.eu/unified-apis/overview
- [C2] Chift, documentation index with connector list — https://docs.chift.eu/llms.txt

Law and administration

- [D1] DSFinV-K version 2.4 (file `20231215_DSFinV_K_2_4.pdf` in the official archive), Annex B, Annex C, Annex I page 121, section 4.2.7 — https://www.bzst.de/SharedDocs/Downloads/DE/Aussenpruefung/dsfinv_k_v_2_4.zip?__blob=publicationFile&v=19 ; overview page https://www.bzst.de/DE/Unternehmen/Aussenpruefungen/DigitaleSchnittstelleFinV/digitaleschnittstellefinv_node.html
- [G3] AEAO zu § 146a, consolidated text as reproduced by NWB Datenbank (same source as in the fiscal research) — https://datenbank.nwb.de/Dokument/500001_146a/
- [A4] BMF Austria, Erlass zur Einzelaufzeichnungs-, Registrierkassen- und Belegerteilungspflicht, 23.12.2019 (same source as in the fiscal research; a later version may exist) — https://findok.bmf.gv.at/findok/resources/pdf/a8ae01cd-b8d6-4e66-9954-f77ac33b8df2/77231.1.1.pdf
- [U1] UStG § 12 (2) Nr. 15 — https://www.gesetze-im-internet.de/ustg_1980/__12.html
- [U2] UStG § 14 (4) Nr. 5 — https://www.gesetze-im-internet.de/ustg_1980/__14.html
- [U3] UStDV § 31 (1) — https://www.gesetze-im-internet.de/ustdv_1980/__31.html

Not reachable or not public during this research: Lodgit manual (certificate errors); technical documents of gastronovi HOTAPI, Vectron, orderbird and SumUp for hotel connections; all vendor-side prices.
