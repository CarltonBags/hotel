# 16 — Service catalogue and Tax Codes

**What to build:** A Property Manager (Tax Codes and revenue accounts also by Accounting; prices also by Revenue) maintains the Service catalogue per property: name per language, default gross price, Tax Code, revenue account, posting rhythm (once, per night, per person-night). Tax Codes per Legal Entity carry rate and validity dates so an invoice re-renders identically later. Presets for German and Austrian hotel rates ship as a starting point.

**Blocked by:** 12 App shell with tabs, Main Menu, themes and languages

**Status:** done

- [x] Services created with all fields and shown in the catalogue list
- [x] A Tax Code rate change from a date leaves earlier charges untouched
- [x] Only Revenue and Property Manager may change prices; only Accounting and Property Manager may change Tax Codes

## Comments

**Done (2026-10-01).** Tenant migration 0004: `tax_codes` per Legal Entity with dated `tax_code_rates`, `services` per property (gross default price, Tax Code, revenue account, posting rhythm, bookable online, active, sort order, localized names). Domain: `taxRateOn`, `splitGross` (net and VAT derived from gross per ADR 0010), `TAX_PRESETS` DE/AT/CH, `POSTING_RHYTHMS`, `todayIn(timeZone)`. Permissions: `manage_service_prices` (Property Manager, Revenue) and `manage_tax_codes` (Property Manager, Accounting); `saveService` applies field-level rights by diffing against the stored Service, so a forged form field is refused server-side. Screen `/settings/services` with Services and Tax Codes tabs, country preset button, rate history, read-only controls for fields the user may not change.

**Verified:** 126 unit/integration tests green (domain, db against Postgres, auth, staff, worker), typecheck, builds, tenant SQL lint. Browser walkthrough (puppeteer): preset applies 4 German codes; future ACC rate 9 % from 2027 saved while current stays 7 %; Service BRK 18.50 FOOD shows net 17.29 / VAT 1.21; Revenue user changes price, sees Tax Code/account/rhythm/checkboxes read-only, forged Tax Code change refused ("not allowed") and DB unchanged.

**Review fixes applied:** rates in force today or earlier are immutable (only future-dated rates can be replaced or removed); "current rate" uses the property's own date (SQL `now() at time zone p.time_zone` for services, `todayIn` for Tax Codes); hidden `active=off` plus checkbox made `formData.get` always "off" (now `getAll`); read-only selects submit through a hidden field; property existence no longer leaks to users without `view_property`; strict calendar-date check; shared `catalogue-common.ts` helpers; `tax_code_rates.id` uuid instead of bigserial; glossary gained Posting Rhythm and Revenue Account (CONTEXT.md, german-terms.md); missing DE/EN translations marked on the services list and form.

**Decisions / open points:**
- German FOOD preset carries history: 19 % until 2025-12-31, 7 % from 2026-01-01 (per research; gate 03 tax advisor confirms all presets).
- Tax Codes belong to the Legal Entity but the right is checked at the property the user is scoped to; Accounting at one property can edit codes used by sibling properties of the same Legal Entity (consistent with ADR 0002). Revisit if a Legal-Entity-level role appears.
- Tax Code names have no history; renaming applies to past invoices' re-render (code and rate are what matter fiscally). Revisit with ticket 20 (invoices).
- Settings module gated on `view_property`, so Housekeeper/Maintenance can read revenue accounts; permission matrix has no "view catalogue" row. Raise with the owner if that matters.
- `money()` accepts a comma decimal but not thousands separators; inputs are `type=number`.
- Rate "in force" guard uses today; charge references will add a stricter guard in ticket 20.
