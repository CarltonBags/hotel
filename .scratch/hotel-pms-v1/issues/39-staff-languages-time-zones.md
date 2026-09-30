# Staff app languages and time zones

Map: ../map.md
Type: grilling
Status: resolved
Blocked by: -

## Question

Which languages does the desktop staff app ship in, and how is time handled? Decide: languages at launch and language per user; how domain terms from CONTEXT.md are translated and kept consistent; number, date and currency formats per user or per property; the property's time zone as the basis for Business Date, Desk Hours, check-in times and cancellation deadlines; display for users and guests in other time zones; daylight saving changes during a stay and during the Night Audit.

## Answer

Resolved 2026-09-29 by grilling.

**Languages**
- Desktop staff app at launch: German and English, chosen per user. French and Italian follow when customers need them.
- The floor staff phone view keeps its own ten languages, decided in the phone view ticket. Guest-facing languages are decided in the booking engine ticket.
- **Glossary terms in German**: every term in `CONTEXT.md` gets exactly one German word, taken from what German hotels say, recorded in the glossary beside the English term, so screens, help and support use the same word. Austrian and Swiss variants where trade words differ. Drawing up this list is ticketed as "German terms for the glossary".

**Formats**: dates, numbers and currency follow the user's language setting. Invoices, receipts and guest messages follow the language of the document, not the staff member's. Swiss properties use the Swiss number format. The week starts on Monday everywhere.

**Time**
- Every time in the staff app is the property's local time: arrivals, check-in times, Desk Hours, deadlines, log entries. A user looking from another time zone sees property time, marked with the zone. Consolidated views across properties show each property's own time.
- Guests see property time, named explicitly, for example "Wed 7 Oct, 18:00 (local time at the hotel)". Times are not converted to the guest's device. Sending Hours are in property time.
- **Clock change**: a night is a calendar date, never a span of 24 hours, so stays, rates and City Tax are unaffected. Recorded moments store the exact moment together with the zone, so the doubled hour in autumn stays unambiguous. Night Audit window, Desk Hours and deadlines follow the wall clock.

**Texts the hotel writes** (names of room types, Services, rate plans, policies): each property has one main language. Staff see these names in that language regardless of their own setting. For guests the property enters a version per enabled guest language; a missing version falls back to the property's fallback language and is listed as "translation missing".
