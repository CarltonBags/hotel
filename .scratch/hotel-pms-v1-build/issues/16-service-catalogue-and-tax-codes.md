# 16 — Service catalogue and Tax Codes

**What to build:** A Property Manager (Tax Codes and revenue accounts also by Accounting; prices also by Revenue) maintains the Service catalogue per property: name per language, default gross price, Tax Code, revenue account, posting rhythm (once, per night, per person-night). Tax Codes per Legal Entity carry rate and validity dates so an invoice re-renders identically later. Presets for German and Austrian hotel rates ship as a starting point.

**Blocked by:** 12 App shell with tabs, Main Menu, themes and languages

**Status:** ready-for-agent

- [ ] Services created with all fields and shown in the catalogue list
- [ ] A Tax Code rate change from a date leaves earlier charges untouched
- [ ] Only Revenue and Property Manager may change prices; only Accounting and Property Manager may change Tax Codes
