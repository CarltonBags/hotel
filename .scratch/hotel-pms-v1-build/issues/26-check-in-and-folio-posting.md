# 26 — Check-in with folio posting, Charges and Routing Rules

**What to build:** Front Desk checks a reservation in from the arrivals list or its tab (room assigned): all nights are posted at once as one Charge per night per component with its Service Date (ADR 0009), gross with Tax Code (ADR 0010), packages split into components. A Reservation has one Folio created automatically with a Bill-to, staff add more; Routing Rules per reservation (defaults from the Company) decide where Charges land; staff move uninvoiced Charges between Folios and void them with a mandatory reason, kept in the audit log. Property Manager may post free-text Charges; anyone with the right posts from the Service catalogue. Shortening a stay proposes voiding future Charges plus an early-departure fee; extending posts the added nights; room-type change voids and reposts future nights. The folio tab shows Charges, totals per Tax Code and balance.

**Blocked by:** 22 Edit, move and cancel reservations with audit log and forced overbooking, 25 Today dashboard, operational lists and cross-property search

**Status:** ready-for-agent

- [ ] Check-in of a 3-night package posts 6 Charges (room and breakfast per night) with the right Service Dates and Tax Codes
- [ ] Moving a Charge to a second Folio with a Company Bill-to shows net plus VAT there
- [ ] Void needs a reason and leaves the Charge visible in the log
- [ ] Shortening proposes the voids and posts the fee only after confirmation
