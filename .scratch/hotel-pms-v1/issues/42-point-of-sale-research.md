# Point-of-sale systems and room charge interfaces

Map: ../map.md
Type: research
Status: resolved
Blocked by: -

## Question

How do restaurant and bar point-of-sale systems used in German-speaking hotels post charges to a guest's room? Compare systems with public interfaces (for example orderbird, Lightspeed, gastronovi, Vectron, Oracle Simphony, ready2order, SumUp) and aggregators. Report from primary sources: how the point of sale looks up a guest or room, how a room charge is posted and reversed, which data arrives (items, tax rates, tip, covers), who is the fiscal cash register for that sale and what that means for our fiscal module, partner programmes and costs. Recommend an approach for v1 and list constraints on folio, Tax Codes and fiscal signing.

## Answer

Resolved 2026-09-29 by research. Findings: [Point-of-sale systems and room charge interfaces](../../../docs/research/point-of-sale-room-charges.md).

- **Recommendation for v1**: one internal room charge module (search in-house guests, post a bill, reverse a bill) with three ways in: manual posting at the front desk for every till; Lightspeed Restaurant K-Series as the first automatic connection; our own published interface for till vendors and middleware, starting the partner conversation with gastronovi.
- **Why Lightspeed first**: it is the only till with a complete, public, web-based room charge contract that needs nothing installed at the hotel. It delivers items, tax per line, tip apart from revenue, and links a reversal to its original.
- **Not in v1**: Oracle Simphony, FIAS and Vectron. They need a network endpoint reachable from the hotel's local network and deliver totals without items. No aggregator gives the waiter a guest lookup for the tills in question.
- **Fiscal**: the till is the fiscal cash register for the sale. Germany's official cash data description contains the case "Transfer von Hotelrestaurant auf Hotelzimmer" as a transfer with payment type "Keine". In Austria a pure room charge is not cash turnover. The PMS signs nothing on arrival and signs the payment of the folio at the desk. Pending tax advisor.
- **Key constraints**: the posting target is the Reservation, checked-in guests only; one bill gives at least one Charge per Tax Code and items are always stored; tip is a line without VAT outside revenue; a reversal is a new negative posting linked to the original; postings are idempotent; the till's receipt number and fiscal id are kept; revenue is reported once, from the PMS.
- **Gaps**: non-guest targets (paymaster accounts) are missing in the folio model; Lightspeed does not resend failed postings; a partial room charge needs an allocation rule over Tax Codes.
- **Unverified**: all vendor-side costs; any interface of gastronovi, Vectron, orderbird and SumUp for a new PMS; Lightspeed's market share in the region.
