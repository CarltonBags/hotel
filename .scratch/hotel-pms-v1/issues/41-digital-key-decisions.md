# Digital key and key card handling

Map: ../map.md
Type: grilling
Status: resolved
Blocked by: 40 62

## Question

With the lock research in hand, decide: which lock systems v1 supports and through what; key card encoding at desk and kiosk; Digital Key on the guest's phone; door PIN; when a key is issued (at Checked-in only), how it follows a room move and an extension, when it is revoked (check-out, no-show, cancellation, lost key); what staff see; and behaviour when the lock system is unreachable. Digital key stays a per-property opt-in.

From the research: the browser never writes a card, the lock system drives a network encoder, so each desk workstation and kiosk Device needs an encoder setting; lock systems installed on the hotel's own network cannot be reached without software there; on offline locks a card keeps working after check-out or room move until its written expiry or until a newer key is used at that door; published prices exist for only two vendors. Decide also whether a pilot with one or two hotels precedes any commitment.

## Comments

2026-09-29: grilled with the owner. Ticket stays open until "Door lock systems used by German hotels and covered by established PMS" is answered.

**Owner's instruction on lock systems**: v1 must support all lock vendors common in Germany, including systems installed on the hotel's own network. Examples given: a hotel group running SIHOT with its lock function built in, and a Radisson Blu hotel running VingCard Visionline separately. This goes beyond the earlier research recommendation (cloud lock systems only). Consequence to settle after research: on-premises lock systems cannot be reached without a component on the hotel network, which "Tech stack detail and tenancy strategy" ruled out ("no local server at the hotel").

**Draft decisions, agreed**
- Key types: key card encoded at the desk; key card at the kiosk; phone key in the Guest Portal; door PIN.
- Validity: keys are issued only when the reservation is Checked-in, valid until the property's checkout time on the departure day plus a grace period (default 1 hour). Extension or late checkout needs the card re-encoded or the phone key or PIN updated. Room move: new key for the new room; the old room is revoked where the lock is online, otherwise the old card runs to its expiry and staff see a warning.
- Revocation: automatic at check-out, no-show and cancellation; manual for a lost key. Online locks and phone keys are revoked at once. Offline card locks cannot be revoked remotely; the next guest's key overrides the old one at that door. All issue and revoke events are logged on the reservation.

From "Door lock systems used by German hotels and covered by established PMS": most frequent in PMS lists are VingCard Visionline and Salto Space (in all six lists read), then dormakaba Ambiance, Onity and Hotek; Vostio next; German brands Messerschmitt and Häfele after. Every cloud PMS that documents its method reaches on-premises locks through a program on the hotel network; the minimum is a small Windows agent on the hotel's lock server PC connecting outbound only, or a bought connector (one offers 7.50 EUR per room per year plus 400 EUR onboarding). SIHOT shows no lock system of its own; its lock function is an interface to partners, so each hotel's lock must be asked. Decision needed: allow an on-site agent (reversing "no local server at the hotel") or buy a connector, or stay cloud-only.

## Answer

Resolved 2026-09-30 by grilling. The draft decisions in the Comments above on key types, validity and revocation are confirmed. Added:

**Reaching lock systems on the hotel's network**: our own **Lock Bridge**, a small Windows program installed on the PC that already runs the hotel's lock software. It connects outbound only to our service; no open ports at the hotel. This reverses "no local server at the hotel" from "Tech stack detail and tenancy strategy" for this purpose only. Our staff install it during Go-live. Cloud lock systems are reached from our worker service directly or through an aggregator, without the Bridge.

**Built for many vendors** (owner's requirement: "onboard other lock vendors easily and cover a huge number of vendors out of the box"):
- One internal lock interface with a small set of operations: issue key, extend or modify, revoke, read card, list encoders, health. Everything in the product talks only to this interface.
- Each vendor is a **Lock Plugin** behind it. Plugins run either in the Bridge (on-premises systems) or in the worker (cloud systems), and are versioned and updated from our side without reinstalling the Bridge.
- A plugin kit (template, test harness against a simulated lock system, certification checklist) so a new vendor is added without touching the product.
- Capabilities differ by vendor (phone key, PIN, remote revoke, online locks). Each plugin declares what it supports; the product offers only those actions for that property.

**Launch set** (owner's choice): every vendor that appeared in the PMS integration lists of "Door lock systems used by German hotels and covered by established PMS": VingCard Visionline and Vostio, Salto Space and KS, dormakaba Ambiance and cloud, Onity, Hotek, Messerschmitt, Häfele Dialock, Omnitec, TESA; plus Nuki. The owner's current hotel runs Messerschmitt and is the natural first pilot.

**Unsupported lock**: no hotel is turned away. When a customer brings a lock system without a plugin, we build one. Until it is ready, keys are made in the lock vendor's own program and our system shows "key by lock software".

**Dependency**: most on-premises vendors release their interface and developer kit only under a partner agreement, sometimes with certification and fees. Ticketed as "Lock vendor partner agreements".

- ADR: `docs/adr/0014-lock-bridge-and-plugins.md`.

> Update 2026-09-30: the Lock Bridge is renamed Site Bridge; it also carries FIAS-based till connections.
