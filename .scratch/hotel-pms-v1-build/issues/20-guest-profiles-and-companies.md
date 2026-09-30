# 20 — Guest profiles and Companies

**What to build:** Front Desk creates and edits tenant-wide Guest profiles (ADR 0004): names, date of birth, nationality, Country of Residence with postal code for Austrian and German residents, contact data, preferences, marketing consent with proof, identity document fields; stay history across all properties. Duplicate detection on email, phone and name plus date of birth at creation, with manual merge that keeps the most complete data. Companies with billing data, payment terms and default Routing Rules. Guest tab and Company tab open as record tabs in the shell; cross-property guest search.

**Blocked by:** 12 App shell with tabs, Main Menu, themes and languages

**Status:** ready-for-agent

- [ ] Creating a guest with an email that exists shows the possible duplicate and offers to use it
- [ ] Merging two profiles keeps both stay histories and logs the merge
- [ ] A guest created at property A is found at property B of the same tenant
- [ ] Revenue sees no contact details on a guest (permission matrix)
