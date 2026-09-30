# Door lock systems and their integration

Map: ../map.md
Type: research
Status: resolved
Blocked by: -

## Question

Which electronic door lock systems are common in European hotels up to 400 rooms, and how can a cloud property management system integrate with them without a server at the hotel? Compare Salto, Assa Abloy (Vingcard, Visionline, Vostio), dormakaba, Onity, Hafele, Nuki and aggregators that offer one interface to many lock brands. Report from primary sources: integration model (cloud interface, on-site server, encoder hardware), key types (card, phone key, PIN), what is needed to write a key card at a front desk and at a kiosk, how keys are issued, extended, revoked and expire, partner programme and certification, costs, and offline behaviour. Recommend an integration approach and list constraints on check-in, room move, extension, no-show and check-out.

## Answer

Resolved 2026-09-29 by research. Findings: [door-lock-integration.md](../../../docs/research/door-lock-integration.md).

- **Recommendation**: keep "collect at reception" as the default with no integration. Put one asynchronous lock interface inside the PMS (issue, change validity, change room, revoke, status, list encoders), run by the worker. Version 1 supports cloud lock systems only: Assa Abloy Vostio, Salto KS, dormakaba Ambiance Cloud, Nuki. First adapter is the aggregator Seam, on condition that European data handling and hotel pricing are confirmed (both UNVERIFIED); otherwise direct adapters for Vostio, then Salto KS.
- **On-premises systems** (Visionline, Salto Space, on-premises Ambiance, Onity OnPortal) cannot be reached without software on the hotel network. They stay on "collect at reception" unless the hotel accepts a bridge program on its lock computer.
- **Card writing**: the browser never writes a card. The PMS names a network encoder and the lock system drives it, so every desk workstation and kiosk Device needs an encoder setting. USB encoders do not work. Salto KS needs no encoder; tags are assigned by ID.
- **Offline locks**: a card keeps working after check-out or a room move until its written expiry or until a newer key is used at that door. The expiry written at issue is the real security limit.
- **Room move and extension**: mobile keys and PINs update by themselves; cards on offline locks must be rewritten at a desk or kiosk, so the PMS must create a "key update needed" task.
- **Check-in and no-show**: a key needs an assigned room; key failure must not undo the check-in; no key is issued before presence is proven, so a no-show needs no lock action.
- **Not verified**: market share in Europe, all vendor prices and partner terms except Seam and Nuki, everything about Häfele (website refused requests), and no hardware was tested. A pilot with one Vostio hotel and one Salto KS hotel is needed before commitment.
