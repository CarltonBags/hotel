# Guest messaging extensions

Map: ../map.md
Type: grilling
Status: resolved
Blocked by: 44

## Question

With the delivery research in hand, decide what v1 adds to the Guest Inbox: WhatsApp and SMS as transports beside email (opt-in, which messages may go where), translation of messages (dropped earlier by the owner, now back in scope: provider kind, on demand or automatic, what leaves the system), turning a message into a Housekeeping Task or Maintenance Issue, and whether a combined inbox across properties exists after all.

## Answer

Resolved 2026-09-29 by grilling, within the constraints of "Email, SMS and WhatsApp delivery providers".

**WhatsApp**: in v1 as a Module per property.
- Each hotel connects its own business account and number; the platform owner requires one account per hotel with business verification.
- The hotel's existing business number can be kept through the platform's coexistence onboarding, or a new number is used. A number in private WhatsApp must be removed there first. The setup guide explains; our staff assist at Go-live.
- **Opt-in** per guest and transport, recorded with time, source and wording: at booking, in Pre-check-in, or by the guest writing first. Withdrawal stops WhatsApp only.
- **24-hour window**: free text only within 24 hours after the guest's last message. The composer shows whether the window is open; outside it staff send an approved template or switch to email.
- **Automatic messages by WhatsApp**: service messages only (pre-arrival invitation, welcome, departure-eve, requests to store a card or pay a balance), for guests who opted in. Documents stay email: confirmations, invoices, receipts, voucher delivery. The same message is never sent on two transports. If no approved template exists or delivery fails, email is used.
- **Templates**: we ship standard templates and submit them for approval when a property connects. The property may edit placeholders and short blocks; each edit goes back to review and the previous version is used meanwhile. State per template: in review, approved, rejected.
- **Matching**: an incoming message is matched to a Conversation by phone number and the guest's current or next reservation at that property. Unknown numbers, several reservations and shared numbers land in an **Unassigned** section of the Guest Inbox, where staff link them.
- **Attachments** follow the transport's limits (images up to 5 MB on WhatsApp); media are downloaded at once and stored like other attachments.
- Card numbers, bank details and identity document data are never requested in WhatsApp; the composer warns; payment and registration go through the Portal Link.
- Usage is billed per message at cost plus handling. With WhatsApp on, "all data stays in the EU" is not a claim.

**SMS to guests**: not in v1. Guests receive email; WhatsApp covers the mobile case.

**Translation**: not in v1 (owner's decision, confirmed a second time).

**Message to task**: in v1. A message becomes a Housekeeping Task or Maintenance Issue for the guest's room in one click, linked back to the Conversation.

**Combined inbox** (owner's choice, reversing "always per property" in "Guest inbox and messaging model"): with "All properties" selected, the Guest Inbox lists conversations of every property the user may access, each labelled with its hotel. The badge counts across the selected scope. With one property selected the inbox shows that property only.
