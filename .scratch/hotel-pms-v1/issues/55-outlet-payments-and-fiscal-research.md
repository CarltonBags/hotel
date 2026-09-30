# Card acceptance on phones and fiscal duties of an outlet point of sale

Map: ../map.md
Type: research
Status: resolved
Blocked by: -

## Question

For an own point of sale in bar, restaurant and spa, establish from primary sources: (1) card acceptance on a staff phone without extra hardware through the chosen payment provider: availability in Germany, Austria and Switzerland, supported phones, card schemes including the German debit scheme, limits, PIN entry, how it works under the platform model with each hotel's own account, and tipping on the device; (2) mobile card readers for table service from the same provider; (3) fiscal duties of a restaurant point of sale in Germany and Austria beyond what the fiscal provider research covers: when an order must be recorded and signed (order, bill, payment), receipt contents for hospitality, tips, cancellations of orders, training mode, and what must work during an internet outage; (4) whether spa treatments and product sales carry rules of their own (tax rates, vouchers). Conclude with constraints on the point of sale model.



Added by "Front desk without internet": (5) whether the payment provider's card terminals can accept payments on their own while the connection is lost (store and forward), in which countries, with which limits and liability, and how such payments reach the hotel's account afterwards.

## Answer

Findings: [outlet-payments-and-fiscal.md](../../../docs/research/outlet-payments-and-fiscal.md).

1. Stripe Tap to Pay (iPhone XS+, Android 13+ with GMS) is generally available in DE, AT and CH with PIN entry, Visa/Mastercard/Amex/Discover/Maestro, but **no girocard**; girocard needs a WisePad 3 or S700. Under direct charges each hotel's account accepts Apple's terms once; an iPhone serves at most 3 Stripe accounts per 24 hours. Tips on phones go into the PaymentIntent amount; on-reader tipping exists only on readers.
2. Table service: WisePad 3 (Bluetooth to the staff phone) or S700/S710 handheld running the outlet app; S710 cellular in AT and DE, not CH.
3. Germany: each order round is signed as `Bestellung` (within 45 s of changes); the bill and payment are signed as `Kassenbeleg` when the bill is created, with the first order's start time printed and a shared `ABRECHNUNGSKREIS`. Cancellations are new negative signed records; training is `AVTraining`; card tips are `TrinkgeldAN`/`TrinkgeldAG`. Austria signs only the payment (card counts as cash); split table bills may use one receipt. The outlet must run and print marked receipts without internet.
4. Spa: DE pool 7 %, massage/sauna 19 % (sauna UNVERIFIED), food 7 %, drinks 19 %; AT pool/thermal 13 %, restaurant 10 %, treatments 20 %; cross-outlet vouchers are multi-purpose (DE).
5. Stripe readers (not phones) store and forward offline: chip and PIN only in the EEA, no girocard, max 10,000 USD equivalent per payment, the hotel bears decline and tamper risk, payments reach the hotel's connected account when forwarded.
