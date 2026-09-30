---
status: accepted
---

# Cash and vouchers are in v1, behind a fiscal module from a cloud provider

v1 records cash payments and sells and redeems value vouchers, which makes the product a fiscal cash register in Germany and Austria. All fiscal signing goes through one module that calls a cloud fiscal service provider; no hardware is installed at the hotel. We chose this over a card-and-transfer-only product because many target hotels take cash, and because Austria requires signed receipts even for card payments, so Austrian hotels need the module regardless.

## Consequences

- The product and each hotel take on registration, export and outage duties toward the tax office.
- A third-party provider sits in the payment path at the desk; its outage behaviour is part of the spec.
- Vouchers create a liability per legal entity that the accounting export must carry.
