# Tourism statistics reporting duties

Map: ../map.md
Type: research
Status: resolved
Blocked by: -

## Question

Which official statistics must hotels report in Germany, Austria and Switzerland, and what must a property management system produce for them? Report from primary sources: the legal basis and who must report (size threshold); the figures (arrivals, overnight stays, by country of residence or nationality, beds and rooms offered, occupancy); the period and deadline; the submission channel and file format (online portal, upload format, interface for software vendors); differences between the German federal states; Austrian municipal reporting linked to the guest register; the Swiss accommodation statistics. Conclude with the definition of the report v1 must ship and the data the system must capture at booking or check-in to fill it, in particular country of residence as distinct from nationality.

## Answer

Resolved 2026-09-29 by research. Findings: [tourism-statistics.md](../../../docs/research/tourism-statistics.md).

- **Germany**: monthly report is mandatory for every property with 10 or more bed places (BeherbStatG §§ 3, 4, 6), online only (BStatG § 11a), to the statistical office of the state through IDEV (web form) or eSTATISTIK.core (XML DatML/RAW). Figures: arrivals and overnight stays by country of residence, beds offered, guest rooms at 31 July, and from 25 rooms room days offered and occupied. Deadline is set per state; Bavaria asks for the 5th day after month end.
- **Austria**: every establishment in a municipality with more than 1,000 nights a year reports to the **municipality**, either per guest within 48 hours with the guest register data or monthly by the 5th on form F-B1/2; yearly capacity sheet F-B3 at 31 May, due 5 June. Origin is split by Austrian federal state and German region. No federal interface for hotel software.
- **Switzerland**: mandatory monthly HESTA survey of all hotels to the Federal Statistical Office (BStatV Anhang 1 Nr. 09.27) through eHESTA: opening days, arrivals and overnight stays by country of residence (ISO code), occupied rooms, average takings per person and night.
- **Report definition**: "Official tourism statistics" is one fixed report per property and calendar month in the country's variant, counting persons: arrivals (stay began in the month) and overnight stays (person-nights in the month) by country of residence, plus the capacity figures of that country's form, in the row order and codes of the official form; frozen on submission; export as spreadsheet file and PDF; reminder on the deadline day. Direct machine delivery is not part of v1 because no specification could be read.
- **Data to capture**: country of residence per person as a field of its own next to nationality, asked of all guests including German nationals and companions; postal code for residents of Austria and Germany; actual nights per person; exclusion flag with reason; statistical bed places and extra beds per room; dated room and bed history; opening calendar; statistical identity and deadline per property.
- **Unverified**: the .CORE delivery agreement, deadlines of the other German states, the Swiss deadline and upload format, Austrian municipal interfaces.
