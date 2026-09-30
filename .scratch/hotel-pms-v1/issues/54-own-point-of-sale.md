# Own point of sale for bar, restaurant and spa

Map: ../map.md
Type: grilling
Status: resolved
Blocked by: -

## Question

On 2026-09-29 the owner stated that the product needs its own point of sale, integrated with the rest, for bar, restaurant and wellness spa. Staff there must be able to charge to a room when the guest's card is authorised, or take payment directly on a phone or a card terminal.

This adds a surface that the Destination does not name. Decide first how far v1 goes, then the model:

1. **Scope of the point of sale**: quick sale of catalogue items only, or also open tabs per table or guest, table plan, courses and kitchen tickets (printer or screen), modifiers ("no ice"), split bills, happy-hour prices, stock. For the spa: selling treatments and products only, or also appointments with therapists and rooms.
2. **Room charge rule**: what "card is authorised" means precisely. Candidates: reservation is Checked-in and has a Card Hold or Card Guarantee with enough remaining amount; Bill-to on account; spending limit per reservation and per day; what the waiter sees (Floor View plus "may charge to room: yes or no" and the limit, never the card).
3. **Direct payment**: card terminal at the outlet, card acceptance on a staff phone, cash with a Cash Register and Shift per outlet, voucher redemption, tips (on card and in cash).
4. **Customers without a reservation**: walk-in restaurant guests, day spa visitors, events. Where their sales are recorded, since the folio belongs to a reservation.
5. **Fiscal consequence**: with an own point of sale the product is the fiscal cash register for every outlet sale, in Germany and Austria, not only for payments at the front desk. Receipts, outage rules and exports extend to the outlets.
6. **Without internet**: a bar cannot stop selling. What works offline and how it is signed afterwards.
7. **Roles and devices**: new property roles for service and spa staff, their rights, sign-in on shared devices, which devices (phone, tablet, fixed till).
8. **Relation to third-party tills**: whether the connection to external tills researched in "Point-of-sale systems and room charge interfaces" stays in v1 for hotels that keep their existing till, or is dropped.

Related decisions: Service catalogue and Tax Codes in the folio ticket; Card Hold limits in the payments research; Cash Registers, Shifts, Receipts and Vouchers in the cash ticket; fiscal provider research; offline behaviour of the floor staff phone view.

From "Shared-device login for floor staff": PIN Sign-in on enrolled Devices is decided and open to service roles; the point of sale reuses it rather than defining its own sign-in.

## Answer

Resolved 2026-09-30 by grilling. Points that depend on "Card acceptance on phones and fiscal duties of an outlet point of sale" (still running) are marked conditional.

**Outlets**: a property defines **Outlets** (bar, restaurant, spa, others). Each has its own menu from the Service catalogue, printers, Cash Register and reports.

**Restaurant and bar, v1 scope**: table plan per outlet; open bill per table or guest; items with modifiers; orders sent to kitchen or bar printer; split and move bills; room charge; payment by card, cash or Voucher; tips; Receipts. Not in v1: stock, kitchen screens, courses, happy-hour pricing, table reservations.

**Spa, v1 scope** (owner's choice beyond the recommendation): sale of treatments and products; an appointment book per therapist and treatment room, used by staff; appointments of hotel guests linked to the reservation and charged to the room; **guests book treatments themselves in the Guest Portal**, within slots the spa releases. This is a booking surface for services of an existing stay, not for rooms, and does not contradict the removal of the room booking page.

**Room charge** is allowed when the reservation is Checked-in, room charge is not blocked on it ("cash only"), and the charge is covered by a Card Hold, Card Guarantee or on-account Bill-to, within the property's spending limit per night. Above the limit the guest pays directly or a manager approves. The waiter sees room number, surname, "room charge yes/no" and remaining limit, never card data. The guest signs on the device or receipt. Charges land on the folio by Routing Rules, with Tax Codes per item.

**Customers without a reservation**: an **Outlet Sale**, paid on the spot with a Receipt; optional customer name; bills for a Company event can be invoiced on account. No folio.

**Devices and payment**: waiters and spa staff use enrolled phones and tablets with PIN Sign-in; a fixed till is a tablet at the bar. Card payment on a card terminal; tap-to-pay on a staff phone only where the research confirms it for the country and card scheme (conditional). Cash through a Cash Register and Shift per outlet.

**Fiscal**: our point of sale is the fiscal cash register for every outlet sale in Germany and Austria; the fiscal module, Receipts, outage rules and exports extend to the outlets. When exactly an order must be signed (order, bill or payment) follows the research (conditional).

**Offline**: the device keeps menus and open bills. Orders, bills and cash payments continue offline; receipts are marked as issued during an outage per country rules and are signed and sent afterwards. Room charge offline only for guests on the last synced in-house list, within the limit, verified after reconnection. Card payment offline depends on the terminal (conditional).

**Roles**: three new property roles: **Service** (tables, orders, payments, room charge within limit), **Spa Staff** (appointments, spa sales), **Outlet Manager** (menus and prices of own outlet, voids, refunds, discounts, outlet reports). PIN Sign-in for Service and Spa Staff. Role set grows from seven to ten.

**External tills**: hotels that keep their own till connect it through our published room charge interface, Lightspeed first; others use our point of sale. Both in v1.

**Destination**: the map's Destination gains the point of sale.

> Update 2026-09-30 from "Card acceptance on phones and fiscal duties of an outlet point of sale", settling the conditional points:
> - Tap to pay on staff phones works in Germany, Austria and Switzerland for Visa, Mastercard, Amex and Maestro, **not girocard**. girocard needs a card reader (a small reader paired with the phone, or a handheld terminal). Outlets in Germany therefore need at least one reader.
> - Germany: each order round is signed as an order within 45 seconds of each change; the bill and payment are signed when the bill is created; order and bill share a table key; the receipt shows the time of the first order. Cancelled orders become new negative records. Austria: only the payment is signed; a card payment counts as cash there.
> - Offline card payments: possible on readers, not on phones; in Europe only with card inserted and PIN, never girocard; the hotel carries the risk of a later decline; such payments cannot be refunded before they are forwarded.
> - Tips on readers can be entered on the device; on phones the tip is part of the amount.
> - Open for the tax advisor: how an order charged to the room is signed in Germany, and how a signed receipt is corrected when an offline card payment is later declined.
