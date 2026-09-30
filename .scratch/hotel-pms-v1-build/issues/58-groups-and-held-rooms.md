# 58 — Groups, Held Rooms, Tentative and Definite, release and Series

**What to build:** Front Desk or Property Manager creates a Group with contract data, organiser, dates, Held Rooms per room type and night with a Release Date, contract prices per room type and night with included Services, terms as text and reduction rules. Tentative groups do not reduce availability but show demand in the Calendar with a warning when availability falls below it and lapse at their option date; Definite groups take Held Rooms out of availability everywhere including channels. On the release date unsold Held Rooms return to sale and channels update; staff are warned 3 days before and may extend. Series create one dated holding per departure. Revenue edits prices and release dates. Held Rooms of Definite groups count as sold in pace figures.

**Blocked by:** 22 Edit, move and cancel reservations with audit log and forced overbooking, 37 Channex connection and ARI outbox

**Status:** ready-for-agent

- [ ] Definite group of 10 Doubles lowers availability by 10 and reaches Channex
- [ ] Release job returns 4 unsold rooms and updates channels
- [ ] Tentative demand above availability shows the warning without blocking
- [ ] Series of 8 Saturdays creates 8 holdings with their own release dates
