# Door lock systems used by German hotels and covered by established PMS

Map: ../map.md
Type: research
Status: resolved
Blocked by: -

## Question

The owner wants v1 to support every lock vendor common in German hotels, including systems installed on the hotel's own network. Establish from primary sources: (1) which lock systems the established property management systems in Germany support, from their own interface or partner lists: SIHOT (including what its built-in lock function is and which vendors it drives), protel, Oracle Opera, Mews, apaleo, Hotelkit-adjacent vendors, Gubse, Hetras, Casablanca, Stayntouch, Cloudbeds; (2) which lock vendors appear most often across those lists and in German trade sources (DEHOGA, hotel trade press, vendor reference lists), as the best available proxy for market share; (3) for each common vendor (for example VingCard Visionline and Vostio, Salto Space and KS, dormakaba Ambiance and Saffire, Onity, Häfele Dialock, Hotek, Assa Abloy's German brands, Glutz, SimonsVoss, Nuki): whether it is on-premises or cloud, the interface a PMS uses (vendor interface, FIAS through Oracle's interface, vendor SDK, file or serial link), whether a cloud PMS can reach it without software on the hotel network, and what cloud PMS vendors do in practice for on-premises locks (bridge program, local interface box, middleware such as FIAS-capable interface servers, third-party connectors); (4) certification and partner terms where public. Do not duplicate `docs/research/door-lock-integration.md`; extend it. Conclude with a ranked list of vendors for Germany with the integration route each would need, and the minimum on-site component required to cover on-premises systems.

## Answer

- Most common lock systems across the PMS integration lists (SIHOT, Stayntouch, Mews, apaleo, Cloudbeds, ibelsa): ASSA ABLOY Vingcard Visionline and Salto Space appear in all six lists; then dormakaba Ambiance, Onity and Hotek (four each); the cloud successor Vostio appears in three to five. German brands next: Messerschmitt (ASSA ABLOY) and Häfele Dialock; then Omnitec, TESA. Nuki, Glutz and SimonsVoss appear in no hotel PMS list read.
- This is a proxy, not market share: no market-share source exists; the protel, Oracle OPERA and CASABLANCA lists were not public, and no trade-press data could be retrieved.
- No SIHOT source shows a lock system of its own. Its "built-in lock function" is most likely a SIHOT interface to one of its listed lock partners (inference); the vendor must be asked per hotel.
- On-site component: on-premises systems (Visionline, Salto Space, on-premises Ambiance, Onity OnPortal) cannot be reached from a cloud PMS without a program on the hotel network. Cloudbeds (Windows Integrator/Bridge), Oracle OPERA Cloud (IFC8, "installs on-premise"), Stayntouch (Comtrol) and apaleo (char pmslink) all use one. The minimum is one small Windows agent on the hotel's existing lock server PC, with an outbound-only connection to the cloud, or a bought connector (char pmslink at 7.50 EUR per room per year).
- Confidence: high on the on-site verdict, medium on the ranking.
- Findings: [german-lock-market.md](../../../docs/research/german-lock-market.md)
