# Card transfer between providers and re-delivery of existing channel bookings

Resolves ticket `.scratch/hotel-pms-v1/issues/59-card-transfer-and-channel-redelivery-research.md`.
Researched 2026-09-29 against Stripe, Channex and Booking.com documentation. Chosen providers are taken from payments-provider-eu.md (Stripe, Connect direct charges) and channel-manager-selection.md (Channex); their findings are not repeated here.

Anything not backed by a primary source is marked **UNVERIFIED**.

## 1. Importing stored cards into Stripe from another provider or vault

**Verdict: possible in principle, by a manual, Stripe-run procedure. It is a project of weeks, not a switch-day action. For connected accounts it is documented only indirectly; the card-import path for a hotel that is a connected account of our platform is UNVERIFIED and must be confirmed with Stripe in writing.**

### What Stripe offers

- Stripe imports card data from "another payment processor or a custom payment solution". A data migration request is mandatory: "If you have to transfer sensitive payment information, you must complete a Data migration request before you migrate." [ST1]
- The transfer is between the old provider and Stripe. The merchant is told: "Never send sensitive credit card details or customer information directly to Stripe. If you have this data, let us know in your migration request form so we can help you securely transfer your data." [ST1] Files with card numbers are encrypted with Stripe's PGP key and uploaded to Stripe's SFTP server; the credentials are issued by Stripe's data migration team after the request form is submitted [ST1][ST3].
- Any of three transfer types exist: import from another processor, copy between two Stripe accounts (self-serve in the Dashboard), export from Stripe to another processor [ST4].
- "For each type of data migration, we can only assist you if your request includes both customer records and the associated payment data." [ST4]

### What it requires

- The request is made while logged in to the Stripe account that is to receive the data: "Log in to your Stripe account to submit the migration request form" [ST1]. The request-form article (read through a summarising fetch, so wording not quoted) says the form needs a logged-in Stripe account and that Stripe answers within three business days [ST5].
- The account holder has to ask the old provider: "Many processors require the account owner to request a data transfer." [ST1] Stripe's template for that request (read through a summarising fetch) states that Stripe is a PCI Level 1 service provider, that its Attestation of Compliance is available on request, that the export is PGP-encrypted and uploaded by the old provider to Stripe's SFTP [ST6]. Whether Stripe demands proof of the *sender's* certification is not stated on any page read: **UNVERIFIED**. In practice the gate is the old provider or vault, which will only release card numbers to a certified recipient.
- Card file fields: old customer ID, card number, expiry are required. "Network Transaction IDs | Required* | *Mandatory for SCA impacted merchants". Address fields are recommended. There is no field for the card security code [ST2].
- The Stripe integration should be built before the old provider is asked to send data [ST1].

### How long it takes

- "Your previous processor might take a few days or several weeks to transfer the final data to Stripe." [ST1]
- "Stripe typically imports data within 10 business days of receiving the correct data from your previous processor" [ST1]. Before the import Stripe sends a summary "for your final review and approval" [ST1].
- "If customers update their payment information with your previous processor in the window between transferring the data and completing the import, those changes are lost." [ST1] For a hotel this means reservations made in the last weeks before the switch are not covered by the transferred file.
- Copy between two Stripe accounts is much faster: "Most data copies finish within 72 hours ... Copies of fewer than 10,000 customers typically complete within a couple of hours." [ST7]

### Connected accounts on a platform

- Documented: copying customers and cards **between Stripe accounts** into or out of a connected account. "If the recipient account is a Connect account that doesn't have access to the Stripe Dashboard, reach out to your contact at the platform ... The platform account owner, admin, or Data Migration Specialist need to authorize and accept customer data from the sender after the sender shares it." [ST7] This covers a hotel that already had its own Stripe account or was a connected account of another platform.
- Documented only for bank debits: the Bacs import form asks "Whether you're requesting migration on behalf of a connected account" [ST2]. This shows that Stripe's migration team handles imports whose target is a connected account.
- **Not documented for cards**: no page read states that a card import from a foreign provider can target a connected account, nor who files the request when the hotel has no own Dashboard login. **UNVERIFIED.** Since the form is tied to a logged-in account, the likely path is that our platform files one request per hotel, or that the import lands on the platform account and cards are cloned to the hotel's account.
- The cloning path is documented: a card saved on the platform can be cloned to a connected account for direct charges; "Cloning supports PaymentMethods that have `type` set to either `card` or `us_bank_account`", and "the cloned PaymentMethod inherits the setup performed on your platform account, so you don't need to set it up again on the connected account" [ST8]. "Creating a charge with the cloned PaymentMethod consumes it, because it's not attached to a customer"; the platform's card can be cloned again for the next charge [ST8]. "If your platform is in a different country than your connected accounts, the setup performed on your platform might not be sufficient." [ST8]

### What comes back

- A mapping file, CSV or JSON, that maps the old provider's customer and card IDs to Stripe IDs. Per card: Stripe ID, fingerprint, last four digits, expiry month and year, brand. No card number [ST1].
- Cards arrive as legacy `card_` objects by default, or as `pm_` PaymentMethods "if you specify this in your migration request" [ST1][ST2]. We need `pm_`.
- Stripe creates one Customer per unique old customer ID, or attaches to existing Customers if a mapping of old customer ID to Stripe customer ID is supplied [ST1][ST9]. **The old provider's customer ID is the only join key.** Our import must therefore carry the old provider's customer or token ID per reservation, or the returned tokens cannot be tied to reservations.

### Charging without the guest present, and authentication status

- Imported cards are treated as cards on file: "Make sure you store imported payment data and label payments using those cards on file with the correct `off_session` parameter." [ST1]
- Proof of earlier authentication travels as the network transaction ID: "Network transaction IDs from your previous processor show that a customer authenticated a transaction using SCA with the previous processor, enabling Stripe to apply for SCA exemptions for future transactions. ... removing their need to re-authenticate." If the old provider cannot supply them, Stripe offers unspecified "alternative options" [ST2].
- No guarantee: "Exemptions aren't guaranteed, and off-session payments might still require authentication by the bank." [ST10] Stripe lists `authentication_required` among the declines to expect after a migration, because "Some migrated payment data might be missing initial card validation details, such as the network token or original transaction ID." [ST1]
- Merchant-initiated charges "require an agreement (also known as a mandate) between you and your customer" [ST10]. Stripe imports the card, not the agreement. Whether the guest agreed at the old system to later charges such as no-show or cancellation fees is the hotel's burden of proof.
- The mapping file carries no authentication status per card [ST1]. The system cannot know in advance which imported card will pass; it learns this at the first charge or hold.
- Cards in digital wallets other than Apple Pay cannot be migrated [ST2].

## 2. What Channex delivers for bookings that already exist at the booking sites

**Verdict: nothing arrives by itself. Existing future reservations are fetched by an explicit action per channel connection, only on channels that support it, and the result is poorer than a normal booking. For Booking.com the fetched reservations lack guest contact data, taxes and fees, commission and card details.**

### Normal operation, for comparison

- Activating a connection "starts the data exchange: a full synchronisation pushes availability, rates and restrictions to the channel, and bookings begin to flow back." [CX1] This concerns bookings made or changed from then on. No page read says that activation re-delivers reservations made earlier.
- A normal booking revision carries, per room, the price per night (`days`, e.g. `"2019-05-09": "100.00"`), occupancy with children's ages, guests, services, taxes, and at booking level customer, amount, currency, notes, `payment_collect`, `payment_type`, `ota_commission` and the `guarantee` object [CX2].

### Fetching existing future reservations

- It is an action on an existing connection: `POST /api/v1/channels/{channel_id}/execute/{action}` with the action `load_future_reservations`. "POST (or PUT) runs the action synchronously and returns its result. A GET variant of the same path also exists, but it only schedules the action asynchronously" [CX3]. The schema names `load_future_reservations` as the only possible action value [CX1].
- Which connection supports it is declared per channel in the `actions` list of the channel descriptor [CX1][CX3].

| Channel | Fetch of existing future reservations | Stated gaps | Source |
|---|---|---|---|
| Booking.com | Yes. "useful right after activating a connection for a hotel that already has reservations" | "it will not include Taxes of Fees; Personal Details like email, address, telephone etc.; Commission details; Credit Card Details". "Importing bookings will not affect the availability in Channex." | [CX3][CX4] |
| Expedia | Yes. "This channel connection supports pulling all the future bookings from Expedia." | None stated. Cancellations are filtered out (changelog 2022-08-22). Completeness **UNVERIFIED** | [CX5][CX6][CX7] |
| Airbnb | Yes, per listing or for the whole connection. "The import runs in the background and does not trigger guest notifications or availability changes." | None stated | [CX8] |
| Ctrip / Trip.com | Yes | "Some personal details may be missing and some bookings may be missing. It depends if the booking was successfully sent to a channel manager before ... There is nothing we can do to know if any are missing." | [CX9] |
| Despegar | Yes (added 2025-03-18) | Not stated | [CX7] |
| Agoda | No. The descriptor example shows `"actions": []` | - | [CX10] |
| HRS | Not mentioned in the HRS guide. **UNVERIFIED**; assume no | - | [CX11] |

### Form and completeness

- **Form**: the documentation does not say whether fetched reservations appear in the booking revisions feed as revisions with status `new`, or only in the bookings list. **UNVERIFIED.** To be tested on the staging server with the Booking.com test hotels before the first customer switch.
- **Per-night prices**: not named among the gaps for Booking.com [CX4]. That they are present and correct is therefore likely but **UNVERIFIED**. Since taxes and fees are missing for Booking.com [CX4], totals may differ from what the booking site shows the guest.
- **Guest data**: for Booking.com the guest's email, address and telephone are missing [CX4]. Whether the guest name is present is not stated; "Personal Details like ... etc." leaves it open. **UNVERIFIED.**
- **Card data**: not included for Booking.com [CX4]. See section 3.
- **Availability**: fetched reservations do not reduce availability in Channex [CX4][CX8]. Availability after the switch comes solely from what our system pushes, so our import must already contain these reservations.
- **Retention**: Channex removes bookings 3 months after checkout and card data 7 days after checkout or cancellation [CX12]. Channex is not an archive.
- Later changes and cancellations of a reservation made before the switch: whether they arrive through the normal feed, and whether they can be matched, depends on the booking site's reservation number. The revision payload carries the OTA reservation code [CX2]; our import stores the channel booking number per reservation (ticket 37), which is the join key. That a modification of an older reservation is delivered complete is **UNVERIFIED**.

## 3. How OTA virtual cards are obtained for existing bookings

**Verdict: for bookings made before the switch, the virtual card is obtained from the booking site's extranet. The channel manager's card routes serve bookings that arrive after the connection. Booking.com: card usable from its activation date until 12 months after check-out. Expedia: UNVERIFIED.**

### Card routes Channex offers, and what each demands of us

| Route | What it does | Demand on us | Source |
|---|---|---|---|
| Secure endpoint (`secure.channex.io`) | Delivers full card data in the booking payload | "provide us list of your IP address that should be white-listed and your PCI DSS certificate". Proof is "your SAQ D (Service Provider) AOC document, this should be a Level 1 or level 2 document not older than 12 months"; with a tokenisation service, that service's AOC | [CX2][CX13] |
| Stripe Tokenization App | "pass Credit Card data from Channex PCI Storage into your Stripe Account". Two calls per booking return a Stripe card token or a Stripe PaymentMethod token | No certification. A Stripe account connected through OAuth in the Channex user profile, and the app installed per property. "token will be created at your account" | [CX14] |
| Payment App | Charge, pre-authorise, settle, void, refund through the Channex API "directly to the properties Stripe account". Refuses to charge more than the virtual card's balance | No certification. Property's Stripe account connected through OAuth. "We charge a small fee to the connected Stripe account each time a card is charged" | [CX15] |
| PCI App | A person views the card in the Channex screen, with a code sent by email; every view is logged | None on our system; it is outside our system | [CX16] |

- Without the secure endpoint the payload still shows a masked card number, the flag `is_virtual`, and for virtual cards `virtual_card_effective_date` ("Date, when virtual credit card will be active for charges"), `virtual_card_expiration_date`, `virtual_card_current_balance` and currency [CX2]. Activation date, expiry and balance are therefore available to us for **new** bookings without any card number.
- Channex deletes card data 7 days after checkout or cancellation, and "if booking is acknowledged no CC provided via API" [CX12].
- How the Stripe Tokenization App and the Payment App behave when the hotel is a connected account of our platform is not documented. The token is created on the Stripe account connected to Channex [CX14]; with our platform account connected, the card would then be cloned to the hotel's account as in [ST8]. **UNVERIFIED**; to be tested.

### Why these routes do not reach existing bookings

- Booking.com: "For security reasons, we send out the customer's full credit card details in the first pull only." For modifications: "For most modifications, you won't receive the guest's credit card details ... However, if the credit card itself has been updated in the system, you will receive the full credit card details." [BK2] The first pull of an existing booking went to the hotel's previous channel manager.
- Channex's fetch of future reservations from Booking.com does not include "Credit Card Details" [CX4]. With no card in Channex's storage the tokenisation call answers `"booking_id": ["has no token"]` [CX14].
- Booking.com's own summary interface for unstayed reservations "only provides summary information and doesn't include guest details, other than the guest's name"; it does carry the price per night and the total per room [BK1]. The gaps Channex lists match this interface. That Channex uses it is an inference, not stated by Channex.
- Booking.com offers connectivity providers a Payments API that returns the virtual card of a reservation by reservation number, including card number, security code and expiry, for reservations "with the checkout date in the last 18 months" [BK3][BK5]. It may answer "Virtual Credit Card details cannot be shared for this reservation" [BK3]. Channex exposes connection settings that turn Booking.com's virtual-card events into booking modifications (`allow_virtual_credit_card_update`, `allow_vcc_balance`) [CX3]. Whether Channex would thereby obtain the card of a booking made before the switch is **UNVERIFIED**; ask Channex.

### Booking.com virtual cards: where, from when, until when

- Where: in the extranet, under the reservation ("View credit card details") and under Finance, "Virtual cards management" [BK4].
- What it is: "a temporary digital Mastercard", only for hotels on Payments by Booking.com [BK4].
- From when: "Every new VCC you receive will be activated according to the reservation policy. For non-refundable bookings, this is the same date as the booking date. For all other reservations, you can charge the VCC when the reservation becomes at least 90% non-refundable." This early activation holds for hotels in good standing; "If you're a new property or don't meet the criteria above, you can charge the VCCs one day after check-in (or at check-in for US properties)." [BK4]
- Until when: "You can charge the VCC for up to 12 months from the check-out date, after which the VCC will expire. After the expiration date, you can't access the funds ... We'll also not reissue a new VCC for this particular reservation." [BK4]
- How: "You can charge a VCC multiple times until the balance reaches zero." "don't pre-authorise the VCC." "You can only charge VCCs if you're a merchant registered as an accommodation provider". Before the activation date the charge is declined [BK4].
- States: `AVAILABLE` (not yet activated) > `NOT_LOADED` or `FUNDED` > `PARTIALLY_CHARGED` or `FULLY_CHARGED` > `CANCELLED` [BK3].
- Refund duty: a charged card of a cancelled booking must be refunded "within 45 days of receiving the first refund reminder email", otherwise Booking.com raises a chargeback [BK4].

### Booking.com guest cards (not virtual)

- "Properties can only view a guest's credit card details three times, for up to 10 days after the check-out date." [BK2] Each look in the extranet uses up one of three views.

### Expedia

- Activation and validity of Expedia's virtual card, and whether card data can be retrieved again for existing bookings: **UNVERIFIED**. Expedia's developer documentation now redirects to a portal that did not deliver content in two attempts [EX1]; the partner help article redirected to a page behind login [EX2].

## What is possible at the switch

Without card numbers passing through our system:

1. **Guest cards held by the old provider can be transferred to Stripe**, provider to provider, if the old provider or vault cooperates. It takes weeks (old provider: days to several weeks; Stripe: typically 10 business days after correct data) [ST1]. It must be started about two months before the switch and cannot be part of the switching day. For hotels as connected accounts the card path is UNVERIFIED and needs Stripe's written confirmation.
2. **Hotels that already use Stripe** (own account or another platform) can have customers and cards copied between Stripe accounts within hours to 72 hours, including into a connected account [ST7].
3. **Tokens come back without authentication status.** They can be charged without the guest present, flagged as such; the bank may still refuse and demand authentication [ST1][ST10]. Where the old provider supplies network transaction IDs, Stripe can request exemptions [ST2].
4. **Existing channel reservations come from the old system through our import, not from the channel manager.** The fetch in Channex exists for Booking.com, Expedia, Airbnb, Ctrip and Despegar, but it is incomplete and serves as a cross-check [CX3][CX4][CX5][CX8][CX9].
5. **Virtual cards of existing bookings stay at the booking site.** Staff read them in the extranet and key them into a Stripe-owned entry (reader in telephone-order mode, see payments research [S10][S11]); our system records the payment, never the number.
6. **For bookings arriving after the switch**, the Stripe Tokenization App turns cards held by Channex into Stripe tokens without any certification on our side [CX14]; activation date, expiry and balance of virtual cards arrive in the normal payload [CX2].
7. **Everything else**: the guest stores the card again through a Portal Link (ticket 37).

## Constraints on the import and on Card Guarantees

1. The import must carry, per reservation with a stored card, the **old provider's customer or card reference** (a reference, not a card number). It is the only key in Stripe's mapping file [ST1][ST9]. Without it, transferred tokens cannot be tied to reservations.
2. The import must carry the **channel booking number** per reservation. It is the key for matching later changes and cancellations, and for matching fetched reservations [CX2][BK1].
3. An imported reservation's Card Guarantee starts as **"not secured"**. After a transfer it becomes "card transferred, not yet verified", because the mapping file carries no authentication status [ST1]. It becomes "secured" only after a successful hold or charge. A refusal with "authentication required" leads to a Portal Link.
4. **Cards stored at the old provider after the export date are not transferred** [ST1]. The import needs a cut-off date; reservations created after it are listed for a Portal Link.
5. The hotel must hold the guest's **agreement to later charges** from the old system; Stripe imports cards, not agreements [ST10]. No-show and cancellation charges on transferred cards rest on the hotel's old terms.
6. Transferred cards should arrive as PaymentMethods (`pm_`), which must be stated in the request [ST1].
7. A Card Guarantee needs the kind **"virtual card at booking site"**, with activation date, expiry date and balance, and without a token. For imported reservations these three values are typed from the extranet or left empty; for new bookings they come from the payload [CX2][BK4].
8. Rules for that kind (Booking.com): no hold, charge only; not before the activation date; several charges until the balance is zero; last day 12 months after check-out; refund after cancellation within 45 days of the first reminder [BK4]. Staff need a list "virtual cards to charge" with due and expiry dates.
9. The hotel's Stripe account must be registered as accommodation (MCC 7011), or virtual cards are refused as "Invalid merchant" [BK4]; see also payments research [S19].
10. **Order on the switching day**: final import, connect channels, full push of availability and prices computed from the imported reservations, then fetch future reservations and compare. Fetched reservations do not reduce availability in Channex [CX4][CX8].
11. Fetched reservations must be **matched, not inserted**: same channel booking number means same reservation; the old system's data wins, because the fetch lacks contact data, taxes and fees [CX4]. Reservations found only in the fetch, or only in the import, are listed for staff.
12. For Agoda and HRS no fetch is documented [CX10][CX11]; for Ctrip reservations may be missing [CX9]. For these channels the old system's export is the only source.
13. Guest cards at Booking.com can be viewed three times only [BK2]. Staff guidance: do not open card details in the extranet without need.

### Open points to confirm before the first customer switch

- Stripe, in writing: card import from a foreign provider into a connected account of our platform; who files the request; whether the sender must show certification. UNVERIFIED.
- Channex, on staging: whether fetched reservations appear in the revisions feed; whether guest name and prices per night are complete; whether a virtual card of an older Booking.com reservation can reach Channex's card storage. UNVERIFIED.
- Channex: whether the Stripe Tokenization App works with a platform account and connected accounts. UNVERIFIED.
- Expedia: virtual card dates and retrieval. UNVERIFIED.

### Confidence

High for the Stripe procedure, durations and returned data, for the gaps of the Booking.com fetch, and for Booking.com virtual card dates; all read from raw source text. Medium to low for everything about connected accounts and for the form of fetched reservations, which the sources leave open. Statements from [ST5] and [ST6] rest on a summarising fetch, because those pages need scripts to render.

## Sources

Stripe (read 2026-09-29; raw Markdown renderings unless noted)
- [ST1] Request a payments data import: https://docs.stripe.com/get-started/data-migrations/pan-import
- [ST2] Import payment method data (cards: fields, proof of authentication, limitations; Bacs form): https://docs.stripe.com/get-started/data-migrations/payment-method-imports
- [ST3] Upload supplementary data (PGP encryption, SFTP): https://docs.stripe.com/get-started/data-migrations/supplementary-data
- [ST4] Data migrations overview (three transfer types): https://docs.stripe.com/get-started/data-migrations/overview
- [ST5] Support: Request a data migration (summarising fetch): https://support.stripe.com/questions/request-a-data-migration
- [ST6] Support: Request data from a current processor (summarising fetch): https://support.stripe.com/questions/request-data-from-a-current-processor-for-a-data-import-to-stripe
- [ST7] Copy customer and payment method data across Stripe accounts, section "Copy into or out of a Connect account" (text extracted from the page's HTML): https://docs.stripe.com/get-started/data-migrations/pan-copy-self-serve?copy-method=full
- [ST8] Share payment methods across multiple accounts for direct charges (cloning): https://docs.stripe.com/connect/direct-charges-multiple-accounts
- [ST9] Map payment data: https://docs.stripe.com/get-started/data-migrations/map-payment-data
- [ST10] Strong Customer Authentication (off-session, exemptions, agreement): https://docs.stripe.com/strong-customer-authentication
- [S10][S11][S19] as in payments-provider-eu.md in this folder.

Channex (read 2026-09-29; raw Markdown renderings)
- [CX1] Channel API (activation, `actions`, execute path in schema): https://docs.channex.io/api-v.1-documentation/channel-api
- [CX2] Bookings Collection (payload fields, guarantee object, secure endpoint): https://docs.channex.io/api-v.1-documentation/bookings-collection
- [CX3] Channel API example Booking.com (actions, virtual-card settings): https://docs.channex.io/channel-api-examples/booking.com
- [CX4] Mapping guide Booking.com, "Pull Future Reservations": https://docs.channex.io/channel-mapping-guides/booking.com
- [CX5] Mapping guide Expedia, "Pull Future Bookings": https://docs.channex.io/channel-mapping-guides/expedia
- [CX6] Channel API example Expedia: https://docs.channex.io/channel-api-examples/expedia
- [CX7] Changelog (2022-08-22, 2025-03-18, 2026-06-22): https://docs.channex.io/changelog
- [CX8] Channel API example Airbnb, "Load the existing reservations": https://docs.channex.io/channel-api-examples/airbnb
- [CX9] Mapping guide Ctrip / Trip.com, "Pull Future Booking": https://docs.channex.io/channel-mapping-guides/ctrip-trip.com
- [CX10] Channel API example Agoda (`"actions": []`): https://docs.channex.io/channel-api-examples/agoda
- [CX11] Mapping guide HRS: https://docs.channex.io/channel-mapping-guides/hrs
- [CX12] Channex Retention Periods: https://docs.channex.io/guides/channex-retention-periods
- [CX13] Guide to PCI: https://docs.channex.io/guides/guide-to-pci
- [CX14] Stripe Tokenization App: https://docs.channex.io/api-v.1-documentation/stripe-tokenization-app
- [CX15] Payment Application API: https://docs.channex.io/api-v.1-documentation/payment-application-api
- [CX16] PCI App: https://docs.channex.io/app-guide/pci-app

Booking.com (read 2026-09-29; raw text)
- [BK1] Retrieving reservations summary: https://developers.booking.com/connectivity/docs/reservations-api/retrieving-reservations-summary
- [BK2] FAQ Handling payment related data: https://developers.booking.com/connectivity/docs/con-faq-reservations-handling-payment-related-data
- [BK3] Managing payment and payout details (virtual card details, states, limits on sharing): https://developers.booking.com/connectivity/docs/payments-api/managing-payment-and-payout-details
- [BK4] Partner help: Getting paid by virtual credit cards: https://partner.booking.com/en-gb/help/policies-payments/payment-products/everything-you-need-know-about-virtual-credit-cards
- [BK5] Understanding the Payments API; Managing chargeable VCCs: https://developers.booking.com/connectivity/docs/payments-api/understanding-the-payments-api and https://developers.booking.com/connectivity/docs/payments-api/managing-chargeable-vccs

Expedia (not retrievable)
- [EX1] https://developers.expediagroup.com/supply/lodging/docs/booking_apis/booking_retrieval/learn/ redirects to https://connectivityportal.expediagroup.com/documentation/expedia (no content delivered)
- [EX2] https://help.expediapartnercentral.com/s/article/what-is-expedia-virtual-card redirects to a page behind login
