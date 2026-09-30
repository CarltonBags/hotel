# Onboarding and subscription

Map: ../map.md
Type: grilling
Status: resolved
Blocked by: -

## Question

How does a hotel company become a customer and get to its first reservation? Decide: self-service signup or sales-led setup; what the setup guide asks in which order (Legal Entity, Property, room types and rooms, Rate Plans, City Tax Rule, payment provider onboarding of the hotel, channel manager mapping, fiscal registration, users); demo data; trial; plans and what they are priced by (rooms, properties, modules); billing of the subscription and which costs are passed through (channel manager, fiscal provider, card fees); what happens on non-payment and on cancellation, including export of the customer's data.

## Answer

Resolved 2026-09-29 by grilling. Actual prices are a commercial decision and not part of this map.

**Becoming a customer**
- **Trial**: self-service, 30 days, no payment details. The customer chooses one of two forms (owner's choice: both offered):
  1. **Demo data**: a demo property with rooms, rates, reservations, guests and a week of history. Nothing carries over except the user. Deleted 30 days after expiry.
  2. **Own data in Test Mode**: the customer enters real rooms, rates, users and settings; this tenant later goes live.
- In a trial of either form: no real channels, no real card charges, no fiscal signing; emails go only to the trial user.
- **Going live is assisted**: after contract, a setup guide leads the hotel through its steps and our staff check the result.

**Test Mode**: the state of a tenant before go-live. Setup is kept. Reservations, guests, folios, invoices and payments made while testing are marked as test, carry no real invoice numbers, reach no channel, charge no card and sign nothing fiscally. At go-live they are deleted after a preview, and invoice numbering starts.

**Go-live checklist**, checked by our staff
- Required: Legal Entity with tax data; property with time zone and currency; room types and rooms; at least one Rate Plan with prices 500 days ahead; Tax Codes and City Tax Rule; users; invoice numbering; registration mode for the country.
- Required if used: card provider onboarding of the hotel; channel mapping; fiscal registration; booking page domain; foreign booking tool connection.
- Optional: Devices, door locks, data import, point of sale.
- The go-live date sets the first Business Date.

**Price basis**: per room per month for the base (staff app, reservations, housekeeping, billing, reports), with **Modules** as add-ons priced per room or per property: channel connection, booking page, guest portal and self check-in, point of sale, groups.

**Modules**: switched on per property by Owner or Tenant Admin, price shown before confirming, effective at once, billed from the next month. Modules that need setup start their own checklist. Switched off at month end; the module's data stays readable.

**Third-party costs**: fixed services (channel manager, fiscal provider) are inside the module prices. Usage (SMS, WhatsApp messages) is billed monthly at cost plus handling. The hotel pays card fees on its own account with the card provider. Whether we add a platform fee per card transaction is a commercial decision, left open.

**Term**: monthly, cancellable to month end. Discount for yearly prepayment. Setup assistance may carry a one-time fee.

**Billing**: monthly invoice per Legal Entity of the customer, as structured e-invoice. Payment by SEPA direct debit or card; bank transfer for chains on request. Room count is taken on the first of the month; Out of Order rooms count. Usage is billed in arrears. The Owner sees invoices and changes payment details.

**Non-payment**: never a sudden lockout, because a hotel cannot stop checking guests in.
| Days after due date | Effect |
|---|---|
| 0 to 30 | Reminders to the Owner |
| 30 to 60 | Banner for managers; settings and reports locked; operations continue |
| after 60 | No new reservations from booking page and channels; existing stays can be handled and invoiced; export available |
| after 90 | Termination by us |

**Exit**: self-service export in open formats: reservations, guests, companies, folios and payments as spreadsheet files; every invoice and receipt as issued; fiscal exports; registration records still inside their retention. The export stands alone, because the hotel must keep invoices itself. Optional paid read-only archive. Tenant data is deleted 90 days after the end, backups within a further 30 days.

**Support and availability commitments** were not decided here.

> Update 2026-09-29 from "Guest messaging extensions": WhatsApp is an additional Module with its own setup checklist (business verification, number, template approval).

> Update 2026-09-29: the booking page Module and "booking page domain" leave the Module list and the go-live checklist.

> Update 2026-09-30: the go-live checklist gains "Lock Bridge installed and lock plugin tested" for properties with an on-premises lock system.

> Update 2026-09-30: point of sale Module covers restaurant, bar and spa including appointments.
