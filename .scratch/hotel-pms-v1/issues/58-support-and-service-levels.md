# Support and service levels

Map: ../map.md
Type: grilling
Status: resolved
Blocked by: -

## Question

What do we promise customers about help and availability? Decide: support channels (in-app chat, email, phone) and hours, given that hotels work around the clock; languages of support; an emergency line for outages at night; response times by severity; the availability target for the service and how it is measured; planned maintenance windows and how hotels are told; what the status page shows; remedies when targets are missed; who at the customer may open a request and what our staff may see and do inside a customer's tenant (with consent and logging).

## Answer

Resolved 2026-09-30 by grilling.

**Channels and hours**: in-app chat and email Monday to Friday 08:00 to 20:00 and Saturday 09:00 to 17:00, in German and English; a phone emergency line around the clock for incidents that stop check-in, check-out, payments or channel synchronisation; a help centre inside the app.

**Response times**
| Severity | Example | First response |
|---|---|---|
| Critical | check-in, payments or channel sync not working | 30 minutes, around the clock |
| High | important function broken, workaround exists | 4 office hours |
| Normal | minor fault | next office day |
| Question | how-to | 2 office days |

**Availability** (the owner's requirement: "a hotel software cannot have an outage")
- **Design goal: no outage a hotel notices.** Database with a standby in a second data centre and automatic switch-over; application and worker in two zones; updates applied while running, no maintenance downtime; the offline functions already decided keep hotels working through a loss of connection (lists on devices, Downtime Reports, point of sale selling offline, floor staff phones).
- **Contractual promise: 99.95 % per month** (about 22 minutes), measured by us and published on the status page, with a credit on the next invoice when missed. A 100 % promise was ruled out because it would be broken at the first incident of any underlying provider.
- Planned maintenance that needs any interruption is announced 7 days ahead and placed between 02:00 and 05:00 property time, outside the Night Audit window.
- This raises the platform requirements in "Tech stack detail and tenancy strategy": the database provider must offer standby with automatic switch-over in the EU, and the worker must run in two instances. The Neon load test should check both.

**Our staff inside a customer's tenant** (owner's choice: standing access): support staff can open any customer's tenant without asking each time. Every access is logged with person, time and reason and visible to the customer's Owner. The processing agreement with customers must state this access. Guest personal data is visible to support; staff are bound to confidentiality.

**Who may open requests**: any user of the customer; critical requests also by phone.
