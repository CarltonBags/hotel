# Notifications model

Map: ../map.md
Type: grilling
Status: resolved
Blocked by: 44

## Question

Define every message the system sends and how. Decide: the list of automatic messages to guests and to staff, the trigger and timing of each, channels per message (email, SMS), sender identity per property (own domain, reply address), templates per language with placeholders and the property's branding, legal footers, unsubscribe rules for non-transactional messages, delivery tracking and failures shown to staff, and quiet hours. Must fit the delivery providers found in research.

## Answer

Resolved 2026-09-29 by grilling, within the constraints of "Email, SMS and WhatsApp delivery providers".

**Transports in v1**
- Guests: **email only**, always carrying the Portal Link where one exists.
- Staff: in-app always; email by each user's setting; **SMS only for urgent alerts to Property Manager and Owner**, from our own sender name.
- SMS and WhatsApp to guests belong to "Guest messaging extensions".
- This replaces earlier mentions of SMS as an option for the Portal Link and the one-time code: in v1 both go by email.

**Automatic messages to guests**
| Message | When | Switchable by property |
|---|---|---|
| Booking confirmation, change, cancellation | at once | own confirmation for channel bookings: yes |
| Deposit Invoice, payment receipt, final Invoice, refund notice, no-show or cancellation fee notice | at once | no |
| Request to store a card again (Card Guarantee not secured) | at once | no |
| Request to pay the balance due | at once | yes |
| Voucher to recipient, copy to buyer | at once | no |
| Pre-arrival invitation to Pre-check-in | days before arrival set by property, within sending hours | yes, default on |
| Welcome during stay (Wi-Fi, breakfast, reaching reception) | after check-in, within sending hours | yes |
| Departure-eve message with checkout time and express checkout link | evening before departure | yes |
| Thanks after stay with invoice link | after check-out, within sending hours | yes |
| Off-hours reply in a Conversation | per guest inbox ticket | yes |

**Not sent in v1** (owner's choices)
- **Room-ready notice and arrival-day message.** This changes "Self check-in guest interface": a guest who is Arrived, Waiting for Room is told by staff, not by an automatic message. It also removes "room ready" from the automatic messages listed in "Guest inbox and messaging model".
- A message about an expiring Inventory Hold.
- Offers, review requests, newsletters. The thanks message carries neither. Hotels export guests with recorded marketing consent for their own tools. The law on consent for advertising messages was not researched.

**Timing**: documents, confirmations and requests go out at once at any hour. Service messages go out only within the property's sending hours, default 08:00 to 20:00 property time. Each message type is sent once per reservation; a changed booking re-sends only the confirmation.

**Sender**: the hotel's own domain once it is verified; until then our platform domain with the hotel's name shown. The property sees "verified" or "pending". A free-mail address cannot be the sender. Replies always reach the Conversation.

**Templates**: fixed layout with the hotel's branding. We ship finished texts for every message type in all guest languages. The property may edit subject and text blocks per language with placeholders. Layout, the legal footer from the Legal Entity and mandatory content cannot be removed. Preview, test send to one's own address, reset to our text.

**Language**: the guest's language, taken from the booking or set by staff, if the property has enabled it; otherwise the property's fallback language.

**Delivery state**: every sent message shows sent, delivered or failed, on the reservation and in the Conversation. After a hard bounce the address is flagged on the Guest profile and no mail is tried until corrected. For critical messages (card request, balance due, confirmation) front desk is alerted to call the guest. A spam complaint stops all non-essential mail to that address.

**Staff alerts**: guest message, Approval request, Card Hold expiring, payment failed, channel synchronisation failed, Night Audit overdue, Held Rooms near release, prices running out, fiscal outage, Device revoked. By SMS only: service outage, fiscal outage, unanswered guest message after escalation, Night Audit overdue.

**Technical constraints taken from the research**: one delivery record per attempt with provider state; inbound mail acknowledged after raw storage; automatic answers such as out-of-office notes are detected and do not count as guest messages; raw mail kept, stripped text shown.

> Update 2026-09-29 from "Guest messaging extensions": where a property has the WhatsApp Module and the guest opted in, service messages may go by WhatsApp as approved templates; documents stay email; each message goes on one transport only, with email as fallback.

> Update 2026-09-29: booking confirmations cover bookings entered by staff and, if switched on, channel bookings. There are no bookings made on our own page.
