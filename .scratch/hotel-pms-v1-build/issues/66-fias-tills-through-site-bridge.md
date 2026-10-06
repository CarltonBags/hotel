# 66 — FIAS-based tills through the Site Bridge

**What to build:** Tills that expect a local interface server (Oracle Simphony, Vectron and others) connect to a FIAS plugin in the Site Bridge on the hotel network, which relays guest lookup, postings and reversals outbound to our room charge interface; totals per tax rate without items are accepted; the Bridge is installed for the till alone where no lock system exists.

**Blocked by:** 65 Room charge interface for external tills and the Lightspeed connection, 68 Site Bridge and plugin kit

**Status:** in review (PR stacked on ticket 68)

- [x] FIAS simulator posts and reverses through the Bridge to the folio
- [x] Bridge health shows the till connection state
- [x] Totals-only posting shows per Tax Code on the folio

## Comments

**Built:** a FIAS till plugin for the Site Bridge (`packages/bridge-kit/template/fias-till.mjs`, published as `fias-till`): it listens on the hotel's network for the till's address only (allowFrom), answers link start with its description and record definitions, answers an inquiry (room or name, never empty) with the checked-in guests our room charge interface allows, and relays postings outbound as totals per tax rate (each FIAS subtotal's rate set in the Bridge; discounts and a set-up service charge included; tip apart), refusing what does not add up, carries tax fields, or names a guest no inquiry offered. A check posted negative for its whole amount is taken back as a Correction; a partial negative is refused. Bill ids carry workstation, the till's date, check and posting number, so repeats across days and split checks never collide. The till always gets an answer (NG when the interface is away). Its health (till connected, last message, interface reachable, last error) shows on the Site Bridge page. The Bridge hosts till plugins beside lock plugins (stopped and replaced on update, the old one restarted if the new one fails). Connection kind "FIAS till" gives the plugin its key; a property with one needs the Site Bridge at go-live even without a lock system. The kit gains a simulated FIAS till.

**Verified:** kit `fias.test.ts` (lookup, totals per rate with tip, partial negative refused, whole check taken back, posting without inquiry refused, health); full db suite 367 passed; walkthrough 8/8 with a real Bridge process, the real room charge interface and the simulated FIAS till (till connected shown in the Bridge's health, inquiry, totals per Tax Code on the folio with the tip apart, reversal as Corrections).

**Review fixes:** unique bill ids per day and posting; whole-check-only reversal; totals checked against TA, tax fields and unset service charge refused; inquiry required before posting; till restricted to its address and no empty lookups; answers on interface errors; port errors reported, not fatal; framing hardened (no STX, buffer cap) and latin1 both ways; link description and record definitions on link start; reachability checked at most once a minute; ADR 0014 amended (the FIAS plugin listens on the hotel network); kinds as one constant.

**Open points:**
- Not checked against the FIAS 2.20 specification text or a real Simphony/Vectron till; tested with our own simulator (documented in docs/bridge/install.md).
- Partial reversals of a check are done at the desk.
- The posted-checks memory for reversals lives while the plugin runs: after a Bridge restart a check from before is taken back at the desk.
