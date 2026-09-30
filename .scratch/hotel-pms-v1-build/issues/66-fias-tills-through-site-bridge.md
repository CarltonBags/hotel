# 66 — FIAS-based tills through the Site Bridge

**What to build:** Tills that expect a local interface server (Oracle Simphony, Vectron and others) connect to a FIAS plugin in the Site Bridge on the hotel network, which relays guest lookup, postings and reversals outbound to our room charge interface; totals per tax rate without items are accepted; the Bridge is installed for the till alone where no lock system exists.

**Blocked by:** 65 Room charge interface for external tills and the Lightspeed connection, 68 Site Bridge and plugin kit

**Status:** ready-for-agent

- [ ] FIAS simulator posts and reverses through the Bridge to the folio
- [ ] Bridge health shows the till connection state
- [ ] Totals-only posting shows per Tax Code on the folio
