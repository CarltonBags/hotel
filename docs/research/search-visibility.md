# Search visibility of hosted booking pages

Resolves ticket `.scratch/hotel-pms-v1/issues/46-search-visibility-research.md`.
Researched 2026-09-29 against search engine documentation, schema definitions and vendor documentation. Anything not backed by a primary source is marked **UNVERIFIED**.

Scope: how the hosted booking pages decided in ticket 14 are found in web search and compared in hotel search and metasearch. "The search engine" is Google throughout; Bing appears under metasearch only.

## Structured data for hotels and offers

### What the schema definitions provide

- `Hotel` sits under `LodgingBusiness` under `LocalBusiness`, which is both an `Organization` and a `Place`. `LodgingBusiness` adds `amenityFeature`, `audience`, `availableLanguage`, `checkinTime`, `checkoutTime`, `numberOfRooms`, `petsAllowed` and `starRating` [G1].
- The schema.org hotel markup guide works with three objects: the lodging business (the establishment), the accommodation (the rentable unit, e.g. `HotelRoom`, `Suite`) and the offer (the commercial proposal to book it) [G2].
- A room is not a product in the vocabulary. The guide says "a hotel room is not a subclass of Product or Service" and tells publishers to give the same entity two types, e.g. `HotelRoom` together with `Product`, so that it can carry an offer [G2].
- Prices belong to offers, not to rooms: "Things do not have prices, but...offers to grant you some rights on the things do have instead" [G2]. A nightly price is a `UnitPriceSpecification` with `price`, `priceCurrency` and `unitCode` `DAY`; several components (rate plus a fee) are bundled in a `CompoundPriceSpecification` [G2].
- `containsPlace` links the hotel to its rooms; `occupancy` and `bed` describe the room; features use `amenityFeature` with `LocationFeatureSpecification` [G2].

### What the search engine documents for general web search

- Google's gallery of structured data features that produce a search result enhancement has **no hotel, lodging or hotel price feature**. The only accommodation entry is "Vacation rental" [G3]. Hotel markup on a page therefore does not by itself earn a documented rich result in ordinary web search.
- The documented feature that does apply to a hotel is **Local business**. Required: `name` and `address` (`PostalAddress`). Recommended: `aggregateRating`, `geo`, `openingHoursSpecification`, `priceRange`, `review`, `telephone`, `url` and others [G4].
- Google asks for the most specific subtype: "Use the most specific `LocalBusiness` sub-type possible" [G4]. For a hotel that is `Hotel` (or `Hostel`, `Resort`, `BedAndBreakfast` ...) [G1].
- `priceRange` "must be shorter than 100 characters", otherwise Google does not show it [G4].
- The markup may sit on any page, "though it may make more sense to put it on a page that contains information about your business" [G4]. That is the hotel's own website start page in most cases, not the booking flow.

### What the search engine documents for hotel search (price validation)

Google Hotels has its own structured data, separate from web search. It is not a way to get listed; it is a way for Google to check the prices a partner already sends.

- Purpose: "Hotel prices structured data doesn't replace other methods to send pricing data. It's an additional method to check the accuracy of prices on your website" [G6].
- Types: a `Hotel` with `name`, `address`, `identifier` (the partner's hotel ID, a unique string per hotel) and `makesOffer`; a `HotelRoom` with `offers`, `identifier`, `occupancy` and `bed`; each offer carries `checkinTime`, `checkoutTime` and a `priceSpecification` of type `CompoundPriceSpecification` with `price` and `priceCurrency` [G5].
- The price is the total: "The price amount specified includes all applicable taxes and fees." The breakdown (base rate, taxes, fees, discounts) goes into `priceComponent` entries of type `UnitPriceSpecification` [G5].
- The markup must agree with what the guest sees: "Structured data values must match the visible information on your website to improve price accuracy validations" [G5].
- Which page: "We only validate structured data on the landing page, but we recommend that partners markup both the landing page and final booking page" [G6]. The developer reference adds: "Google rate should always be annotated on your landing page along with your complete rate details" [G5].
- Threshold: "You must achieve a minimum score of 97% to be considered 'Trustable' and eligible for price validations" [G6].
- **Format conflict between two Google sources.** The developer reference says "Google Hotels recommends Microdata format by default to annotate your webpages for hotel price accuracy checks" and "The JSON-LD format is deprecated for price accuracy validation" [G5]. The Hotel Center help article says "We recommend JSON-LD but you can choose other supported formats too" [G6]. Neither page showed a date on retrieval. Which one is current is **UNVERIFIED**; the newer crawler guide [G7] uses Microdata throughout, which supports the developer reference.
- Crawler path tagging: Google's price crawler "verifies rates by sequentially evaluating your booking funnel, simulating a user journey". It starts from the landing page address it was given, performs the marked clicks and reads the price on the final page it can reach. It "cannot provide user inputs (such as guest names or payment details); rates must be accessible using clicks alone" [G7].
- Every page in the funnel that shows rates declares its stage with `data-nav-*` attributes on `<body>`; the last page readable without guest input is marked `data-nav-stage-final="true"`; the elements the crawler must click carry `data-nav-criticalpath="true"`, `data-nav-interactiontype="CLICK"` and `data-nav-interactionorder` [G7].
- The price must be tagged on the visible number: "Tag the visible price number directly on the page using `itemprop="price"`. Don't use hidden metadata" [G7].

## Requirements for pages under the hotel's own domain

The hosted booking page lives on a subdomain of the hotel's domain (e.g. `book.hotel-name.de`), next to a hotel website that we do not control. The points below are Google's documented rules; other search engines were not researched.

### Language versions

- One address per language: "Google recommends using different URLs for each language version of a page rather than using cookies or browser settings to adjust the content language on the page" [G19].
- Subdomains and subdirectories are accepted structures; language in a URL parameter (`?loc=de`) is "Not recommended" [G19].
- No automatic language redirect: "Avoid automatically redirecting users from one language version of a site to a different language version of a site" [G19]. Offer links to the other language versions instead [G19].
- The crawler does not reveal a language: "the crawler sends HTTP requests without setting `Accept-Language` in the request header" and its default addresses "appear to be based in the USA" [G20]. A page that picks its language from the browser setting is therefore seen in its fallback language only.
- Google determines language from the visible text: "We don't use any code-level language information such as `lang` attributes, or the URL" [G19]. Mixed-language pages (interface in one language, hotel texts in another) weaken this signal; the property's own texts per enabled language, as decided in the booking engine ticket, avoid it.
- `hreflang` can be given in HTML, in HTTP headers or in a sitemap [G18]. "Each language version must list itself as well as all other language versions"; "If two pages don't both point to each other, the tags will be ignored" [G18].
- Addresses must be complete: "Alternate URLs must be fully-qualified, including the transport method (http/https)" [G18]. Codes are ISO 639-1 language plus optional ISO 3166-1 Alpha 2 region; `x-default` names the fallback page [G18].

### Canonical addresses

- Signals and their strength: redirects and `rel="canonical"` are strong signals, sitemap inclusion is a weak one [G17].
- "Use absolute paths rather than relative paths with the `rel="canonical"` `link` element" [G17].
- "If you're using `hreflang` elements, make sure to specify a canonical page in the same language, or the best possible substitute language" [G17]. Each language version is its own canonical; they do not all point to the German page.
- "Don't use the robots.txt file for canonicalization purposes" [G17]. "Google prefers HTTPS pages over equivalent HTTP pages as canonical" [G17].
- Consequence for the flow: a search result address with dates, guests and codes in the query string is a variant of the property's entry page. It should name the parameter-free entry page of the same language as canonical.
- Pages that must stay out of the index (details, payment, confirmation, the Portal Link pages) need `noindex` as a meta tag or `X-Robots-Tag` header, and "the page or resource must not be blocked by a robots.txt file" or the rule is never seen [G24].
- Whether Google treats `book.hotel-name.de` as part of the hotel's site or as a separate site for ranking purposes is **UNVERIFIED**; no primary statement was retrieved. The hotel's main website should link to the booking page with ordinary links, because "Google can only discover your links if they are `<a>` HTML elements with an `href` attribute" [G22]. The copy-paste search widget must therefore render a real link, not only a script-driven button.

### Performance and rendering

- Core Web Vitals targets: largest contentful paint "within the first 2.5 seconds of the page starting to load", interaction to next paint "of less than 200 milliseconds", cumulative layout shift "of less than 0.1" [G21]. Google says these align "with what our core ranking systems seek to reward" [G21]; it gives no weight.
- Hard limit in hotel search: a landing page is non-functional "if a user is unable to interact with the page for more than 10 seconds" [G13].
- Indexing uses the phone version: "Google uses the mobile version of a site's content, crawled with the smartphone agent, for indexing and ranking"; content and structured data must be the same on phone and desktop; responsive design is recommended [G23].
- Script-rendered pages are processed in three phases (crawling, rendering, indexing), and "server-side or pre-rendering is still a great idea because it makes your website faster for users and crawlers" [G22]. The entry page with hotel name, address, room types and texts should be delivered as HTML by the server.
- Status codes matter: "Googlebot uses HTTP status codes to find out if something went wrong when crawling the page" [G22]. A disabled property or language must answer 404 or 410, not an empty page with status 200.

## Free booking links and hotel ads

### What they are

- Free booking links are unpaid links in Google's hotel search that show "your site name or hotel name along with the room rate for the itinerary selected" and send the guest to the partner's landing page. "There's no cost for clicks on free booking links" [G8].
- Hotel ads are the paid, auction-based placements in the same price list. Both are fed from the same Hotel Center account and the same prices [G8][G9].

### Eligibility

- Property: "A list of rooms in which paying guests can stay", "A physical presence and fixed location", "Fixed walls and plumbing" and "A minimum stay requirement of no greater than 7 days" [G10].
- Account: an existing Hotel Center partner that takes part in hotel ads is automatically eligible for free booking links; any property with "a bid in a hotel campaign, available rates, and a landing page" qualifies [G8]. Hotels without their own integration connect "through their reservation system provider" or a connectivity partner [G8][G9].
- Order of steps per Google: first free booking links ("Your connectivity partner sends your rates to Google to get you listed on free booking links"), then ads ("After you're live on free booking links, you can expand your reach with hotel ads on Google Ads") [G9].
- Ranking of free links uses "consumer preference, value offered to the user, landing page experience, and historical accuracy of the prices". "Bids have no impact on the ranking of free booking links" and Google's commercial relationship with the provider "has no effect on ranking" [G8].
- Sites whose content is deceptive, misleading, unsafe or unlawful are excluded (Prohibited Practices Policy); not read in full, detail **UNVERIFIED** (search result summary of [G15] only).

### Feed or connectivity partner

- A full integration consists of three parts: a hotel list feed (XML `<listings>`), pricing and room inventory, and a landing pages file with "dynamic landing page URLs" [G10].
- Prices are delivered in one of three modes: Pull (Google asks the partner's server), Changed Pricing (pull with a step that reduces traffic), or ARI (the partner pushes availability, rates and inventory when they change) [G10].
- Google matches the feed's properties to its own map listings; the hotel therefore needs a correct Google Business Profile with the same name, address and phone number. Channex states: "Google matches properties by looking at the Address, Telephone number, and property name" and "Google will check for new properties each week" [C17].

### Price accuracy policy

- The total price on the partner's page must be identical to the one shown on Google, for the exact occupancy, dates and currency selected, and it must be bookable online [G11].
- Google checks "a combination of automated tools and manual processes" on a sample, from the landing page to the final booking page [G11].
- Score levels: Excellent, Fair, Poor, At Risk, Failed. Excellent is preferred in positioning. At "At Risk", "Most of your ads and free booking links will be turned off"; at "Failed", "Your ads and free booking links will be turned off" [G11].
- Counted as inaccurate: a different price on the landing page, day-use rates, room not available for the selected occupancy, currency conversion errors, omitted mandatory taxes or fees [G11].
- "Unavailability of the rate type clicked by the user through the booking flow is considered an accuracy violation" [G13].
- The score is an overall score of the Hotel Center account, and Google may "suspend individual hotels from feeds, or suspend entire accounts" (wording as summarised from [G11]). Inference: on a shared account one hotel's errors weigh on the account's score. How Channex isolates hotels on its shared account is **UNVERIFIED**.

### Taxes and fees policy

- The partner sends base rate, taxes and other mandatory fees as separate values; "Taxes and fees must represent all mandatory charges collected by the partner or the hotel, regardless of when they're due" [G12]. City tax and VAT are named as examples [G12].
- Outside the United States and Canada, Google shows the total inclusive price most prominently [G12].
- "Taxes and fees must be clearly disclosed in the price summary on your final booking page"; a breakdown on the landing page is recommended [G12].
- A partner that cannot split the components may send one price with `all_inclusive` set to true and tax and fee values of zero [G12].

### Landing page and booking flow (referral experience policy)

- "The room and rate the user clicked on from Google must be displayed prominently to the user on your landing page", with hotel name, the same room type, dates and occupancy, and a visible price summary [G13].
- No optional fees in the default total [G13].
- No re-entry: the guest must be able to proceed "without unnecessary clicks that don't take the user closer to booking, or re-entering the selected hotel or dates at any point in the flow" [G13].
- Speed: "A page is also considered non-functional if a user is unable to interact with the page for more than 10 seconds" [G13].
- The final booking page shows hotel name, dates, occupancy and all mandatory taxes and fees in the price summary before it asks for guest data [G13].
- Partners with several brands or booking engines add a `hotel_brand` column to the property list and a matching brand in the landing page settings. "All of the properties in your list should have a landing page associated with them" [G14].

### Ways to take part, compared

| Path | Who sends prices | Landing page | What it costs us | Source |
|---|---|---|---|---|
| Channex shared Hotel Center account | Channex, from the rates and availability the PMS already pushes | Channex Instant Booking Page only | Nothing to build; bookings bypass our booking flow | [C17][C18] |
| Own Hotel Center account, connected by Channex | Channex | Our hosted booking page, through a link template | Application to Google, agreement, more than 25 properties; deep link entry on our pages | [C17] |
| Own direct integration as a connectivity partner | Our own feeds (hotel list, prices, landing pages file) | Our hosted booking page | Six onboarding steps, "between 3 to 9 weeks"; Google assesses "the stability and recognition of the brand" and "a history of successful financial transactions" and may reject "at its sole discretion" | [G10][G25][G26] |
| Rates typed into the Google Business Profile by the hotel | The hotel, by hand | The hotel's booking page address | Nothing to build; prices go stale unless the hotel maintains them | [G16] |

- For the manual path the booking page address "must take travelers who click on your hotel via free booking links to your website to book directly with you, not a third party"; social media pages and online travel agency links are not allowed [G16]. The remaining details of this path (who is eligible, how taxes are entered, how it behaves next to a connectivity partner) are **UNVERIFIED**: the help article [G27] could not be retrieved in two attempts and is known from search result summaries only.
- Google's own landing page file offers many more placeholders than the Channex template: hotel, room and rate plan identifiers (`PARTNER-HOTEL-ID`, `PARTNER-ROOM-ID`, `RATE-PLAN-ID`), dates and `LENGTH`, `NUM-ADULTS`, `NUM-CHILDREN`, `CHILD-AGE`, `USER-LANGUAGE`, `USER-COUNTRY`, `USER-CURRENCY`, `USER-DEVICE`, the displayed total (`PRICE-DISPLAYED-TOTAL`) and a `VERIFICATION` flag for Google's own test clicks. All are optional [G28]. Landing pages are matched by language, country and currency of the user [G29].
- Currency: "When Google validates prices, we check them in the currency that a user would find on Google" [G11]. Our pages show the property currency only. Whether a landing page in the property currency passes when Google shows a converted price to the user is **UNVERIFIED**.
- Google's best practices for free booking links: send all rooms and rates, for stays "up to a year in advance with stays of up to 30 days", update the feed as often as the website price changes, and keep the Google Business Profile verified and current [G30].

### Does the chosen channel manager cover it?

Channex is listed in Google's connectivity partner directory, with "Ads & Non-Ads Partner: FALSE", which the directory uses for partners that support free booking links only [G9]. Channex's channel list contains `GHA` "Google Hotel Ads (through Channex.io)" [C13] and its own documentation describes the channel [C17]:

- "Connecting a property to Google will show for free under the free section." "Adding properties will automatically add them to the free links section. Then you have the option to link to Google Ads to boost your visibility" [C17].
- Content that must be filled in before activation: country, address, phone, map location, time zone, hotel policy, at least one cancellation policy, one facility, one photo and one property description, because "Google has no extranet" [C17].
- **The landing page is the blocker.** On the shared Channex account the link must go to Channex's own booking page: "This section is only if you have your own Hotel Centre, Channex account must use the Channex Instant booking page" [C17]. The FAQ repeats it: "Can I use my own Booking Engine? If you have your own Hotel Centre then yes" [C17].
- Own Hotel Center account: "If you have over 25 properties you can apply for your own Google account and use your own Hotel Centre." "This will require an agreement and setup and implementation time with Google if you are accepted. Note: Channex will connect your Hotel Centre for you once agreed" [C17]. Inference, not stated: the threshold of 25 properties refers to the portfolio of the software company, since the guide addresses Channex's customers, which are software vendors [C10 in `channel-manager-selection.md`].
- With an own Hotel Center account the booking link is a template with placeholders that Channex fills per click: `(CHECKIN_DATE)`, `(CHECKOUT_DATE)` (both `YYYY-MM-DD`), `(LENGTH)`, `(ADULTS)`, `(CURRENCY)`, and day, month and year parts with and without leading zero [C17]. There is **no placeholder for children, room type, rate plan, language or country of the user** in the list [C17].
- Ads: Channex describes linking a Google Ads account to the Hotel Center, either one account of the software company or one per hotel, with pay-per-click as default and commission per booking as an option [C17]. This conflicts with Google's directory entry (free booking links only) [G9]; whether paid hotel ads work through Channex today is **UNVERIFIED**.
- The Channex Instant Booking Page is "the Channex booking engine which is free to use and has no costs of fees" [C18]. Inference, not stated by Channex: bookings made there reach the PMS like any other channel booking through the booking feed, and do not pass through our hosted booking pages, our payment flow or our Payment Policy handling.
- The Google channel is "Available through the Channex API on the WhiteLabel plan. Mapping and certification are handled as part of onboarding" [C19].

## Metasearch requirements

Every metasearch site researched works the same way: a list of properties for matching, live prices and availability from a certified system, and a deep link that opens the booking page with the chosen stay. None accepts a plain web page as a price source.

| Site | What it requires | Payment model | Covered by Channex | Source |
|---|---|---|---|---|
| Google hotel search | Hotel list, prices (pull, changed pricing or ARI push), landing pages file; policies above | Free links; ads per click or per booking | Yes for free links, with the landing page limit described above | [G9][G10][C17] |
| trivago | "FastConnect": an inventory feed "containing all of your online bookable hotels", availability requests answered by the partner's system (search results and item details) and a deep link to the booking page. trivago asks partners not to build before alignment: "Please do not implement or code toward the API for trivago FastConnect before we have aligned or instructed you to." Independent hotels advertise website rates through "Rate Connect" in trivago Business Studio | Cost per click or cost per acquisition | Not in the Channex integrations directory | [T1][T2][T3][C14] |
| Tripadvisor | "Hotel Availability Check API" (TripConnect): the connectivity partner hosts endpoints for configuration, daily hotel inventory and availability requests. Known from search result summaries only; the developer portal answered 403 on every attempt | Cost per click, sponsored placements | Channel codes list "Tripadvisor Feed Channel", but no connectable Tripadvisor channel appears in the integrations directory | **UNVERIFIED** [TA1]; [C13][C14] |
| Bing (Microsoft) | Property feed (XML), landing pages feed and price feeds, pushed or pulled; same three-part structure as Google | Hotel price ads and property promotion ads, paid | Not in the Channex integrations directory | [M1][C14] |
| Kayak | No public documentation found; access is by partner application | **UNVERIFIED** | Not in the Channex integrations directory | [C14] |

- trivago's free booking links were reported as discontinued from mid-January 2025 by secondary sources; trivago's own "Get listed" page today names only the two paid models [T3]. The discontinuation itself is **UNVERIFIED**.
- Response time limits, price rules and landing page rules of trivago and Tripadvisor are not published openly; trivago says "We'll be in touch with further information about trivago and any additional requirements before you launch the API" [T2].

## Recommendation: what v1 builds and what it leaves to the channel manager

**v1 builds the page side. It builds no feed and no metasearch integration.** Price delivery to Google stays with Channex, and the landing page limit of the shared Channex account is accepted for launch.

v1 builds:

1. **Indexable entry page per property and language**, delivered as HTML by the server, with its own address per language, `hreflang` between the versions, a self-referencing canonical address, and `noindex` on every page from guest details onward [G17][G18][G19][G22][G24].
2. **`Hotel` markup on the entry page** with name, address, coordinates, phone, address of the page, check-in and check-out time, star rating and amenities, taken from the property record [G1][G4]. This is cheap and describes the business; it earns no documented rich result [G3].
3. **Deep link entry**: the rooms-with-rates page opens from an address that carries arrival, departure or nights, adults, child ages, language and, optionally, room type and rate plan, and shows that stay without asking again [G13][G28][C17]. The copy-paste widget, the tenant page for chains and any later metasearch link all use the same entry, so the work is not specific to Google.
4. **Price display that already meets the policies**: total for the stay including VAT and City Tax as headline, breakdown beside it, visible before guest data is requested [G11][G12][G13]. The booking engine ticket decided exactly this; no change is needed.
5. **Price markup and crawler path attributes on the rates page** (Microdata on the visible total, `data-nav-*` stage attributes) [G5][G7]. Low effort while the templates are being written, but only useful once a Hotel Center account points at our pages. Build it last; it can slip to the release that adds the own Hotel Center account.

v1 leaves to the channel manager:

- Hotel list, prices, availability and landing page file for Google. The PMS already pushes rates, restrictions and availability to Channex; the Google channel reuses them and needs only mapping and property content [C17][C19].
- Matching of the property with Google's listing [C17].

v1 leaves out entirely:

- A direct integration with Google as connectivity partner (weeks of onboarding, acceptance at Google's discretion, a second price feed to keep accurate) [G25][G26].
- trivago, Tripadvisor, Bing and Kayak. Each needs its own certified integration and a commercial agreement, and Channex offers none of them as a channel [T1][M1][C14].
- Paid hotel ads. Whether they work through Channex is unverified, and campaign management is a service, not a product feature [G9][C17].

Open decisions for the decisions ticket (47):

- **Whether hotels may switch on the Google channel with the Channex Instant Booking Page at launch.** It gives free booking links at once, but the guest books on a Channex page: no hotel domain, none of our Payment Policy, deposit, strong customer authentication or Inventory Hold handling, and the booking arrives as a channel booking [C17][C18]. How that page takes payment is **UNVERIFIED**.
- **When to apply for an own Hotel Center account.** It needs more than 25 properties on the platform [C17]. From that point free booking links can land on our hosted pages, and items 3 and 5 above become the price accuracy surface.
- **Whether to tell hotels about the manual path** (rates typed into the Google Business Profile, link to our hosted page). It needs no build, but hand-maintained prices will drift from live prices and the price accuracy policy still applies [G11][G16].

Confidence: **high** on the page requirements and the Google policies (first-party documentation, quoted). **High** that Channex's shared account cannot land on our pages (stated twice in Channex's own documentation). **Medium** on the price markup format because Google's two pages disagree. **Low** on trivago, Tripadvisor and Kayak details, where primary documentation is closed or blocked.

## Constraints on the hosted booking pages

1. Every enabled language of a property has its own address (path segment or subdomain, not a query parameter, cookie or browser setting) [G19].
2. No automatic redirect by browser language or location. The address decides the language; a visible language switch links to the other versions [G19][G20].
3. Each language version lists itself and all other versions in `hreflang`, with complete `https://` addresses, plus an `x-default` version [G18].
4. Each language version names itself as canonical address, as an absolute address. Addresses with dates, guests or codes in the query string name the parameter-free entry page of the same language as canonical [G17].
5. Guest details, payment, confirmation and Portal Link pages carry `noindex` and are not blocked in robots.txt [G24].
6. The entry page is delivered as complete HTML by the server: hotel name, address, room types, texts and markup are present without running scripts [G22].
7. A property or language that is switched off answers 404 or 410, never an empty page with status 200 [G22].
8. Phone and desktop receive the same content and the same markup from the same address (responsive layout) [G23].
9. Targets on a phone: largest contentful paint within 2.5 seconds, interaction to next paint under 200 milliseconds, layout shift under 0.1 [G21]. Hard limit for a landing page from hotel search: usable within 10 seconds [G13].
10. The entry page carries `Hotel` markup (the most specific type that fits) with at least `name` and `address`, generated from the property record, and only with facts that are visible on the page [G4][G31].
11. The rooms-with-rates page accepts a deep link with arrival date, departure date or number of nights, adults, child ages, language, currency, and optionally room type and rate plan. Dates are accepted as `YYYY-MM-DD` [C17][G28].
12. A deep link shows the requested stay at once. The guest never re-enters hotel, dates or guests at any later step [G13].
13. When a deep link names a room and rate, that room and rate are shown first and marked, with hotel name, dates and occupancy in the stay summary [G13].
14. When the requested room or rate is no longer available, the page says so and shows the alternatives; this case counts against price accuracy, so availability pushed to the channel manager must be current [G11][G13].
15. The headline price is the total for the stay including VAT, City Tax and every other mandatory charge, whether collected online or at the hotel. The breakdown is visible without a further click [G11][G12].
16. Extras and other optional charges are never preselected and never part of the default total [G13].
17. The total and its breakdown are visible before the page asks for guest data, and the same total is shown on the payment page [G12][G13].
18. The price shown for a stay equals the price sent to the channel manager for the same dates, occupancy and rate plan. Both come from one price calculation, including City Tax and rounding [G11].
19. Rate plans hidden behind a Rate Code are never sent to public channels and never appear on a page opened by a public deep link [G11].
20. Day-use rates are not offered through deep links from hotel search [G11].
21. Every page up to and including the last price summary before guest details is reachable by clicks alone. The Inventory Hold starts after that point, so that crawler visits do not hold rooms [G7].
22. Price markup for hotel search is written as Microdata on the visible price number, not as hidden metadata, and must equal the visible price. The template must allow JSON-LD instead, because Google's two documents disagree on the format [G5][G6][G7].
23. Pages of the booking flow that show rates carry the crawler stage attributes on `<body>`, and the last page readable without guest input is marked as final [G7].
24. The widget for the hotel's website renders an ordinary link (`<a href>`) to the hosted booking page, so that the page is discoverable from the hotel's site [G22].
25. The hosted page is served under the hotel's domain over HTTPS, with redirects from HTTP [G17]. A booking page address given to Google must be the hotel's own site, not a third party [G16].

## Sources

Retrieved 2026-09-29 unless stated.

Search engine and schema definitions
- [G1] schema.org `Hotel` and `LodgingBusiness` (type hierarchy, properties): https://schema.org/Hotel
- [G2] schema.org markup guide for hotels (three objects, multi-typed entities, offers and price specifications): https://schema.org/docs/hotels.html
- [G3] Google Search Central, structured data features gallery (no hotel feature; vacation rental only): https://developers.google.com/search/docs/appearance/structured-data/search-gallery
- [G4] Google Search Central, local business structured data (required and recommended properties, most specific subtype, `priceRange` limit): https://developers.google.com/search/docs/appearance/structured-data/local-business
- [G5] Google Hotels, hotel price structured data reference (types, total price, Microdata recommended, JSON-LD deprecated): https://developers.google.com/hotels/hotel-prices/structured-data/hotel-price-structured-data
- [G6] Hotel Center Help, about structured data for price accuracy validation (landing page validated, 97% threshold, JSON-LD recommended): https://support.google.com/hotelprices/answer/14739390?hl=en
- [G7] Google Hotels, enable crawler navigation and price tagging (`data-nav-*` attributes, clicks only, visible price): https://developers.google.com/hotels/hotel-prices/structured-data/generic-crawler-guide
- [G17] Google Search Central, canonical addresses: https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls
- [G18] Google Search Central, localized versions (`hreflang`): https://developers.google.com/search/docs/specialty/international/localized-versions
- [G19] Google Search Central, multi-regional and multilingual sites: https://developers.google.com/search/docs/specialty/international/managing-multi-regional-sites
- [G20] Google Search Central, locale-adaptive pages: https://developers.google.com/search/docs/specialty/international/locale-adaptive-pages
- [G21] Google Search Central, Core Web Vitals: https://developers.google.com/search/docs/appearance/core-web-vitals
- [G22] Google Search Central, JavaScript basics: https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics
- [G23] Google Search Central, mobile-first indexing: https://developers.google.com/search/docs/crawling-indexing/mobile/mobile-sites-mobile-first-indexing
- [G24] Google Search Central, block indexing with `noindex`: https://developers.google.com/search/docs/crawling-indexing/block-indexing
- [G31] Google Search Central, general structured data guidelines (visible content only, no guarantee of display): https://developers.google.com/search/docs/appearance/structured-data/sd-policies

Google hotel search: free booking links, ads, policies
- [G8] Hotel Center Help, about hotel free booking links: https://support.google.com/hotelprices/answer/10472393?hl=en
- [G9] Google, connectivity partner directory (Channex listed, "Ads & Non-Ads Partner: FALSE"; SiteMinder, D-Edge, Cloudbeds, DIRS21/TourOnline listed as TRUE): https://developers.google.com/hotels/connectivity-partners/
- [G10] Google Hotels, integration overview (three feeds, delivery modes, property eligibility): https://developers.google.com/hotels/hotel-prices/dev-guide/data-feeds
- [G11] Hotel Center Help, Price Accuracy Policy: https://support.google.com/hotelprices/answer/6064419?hl=en
- [G12] Hotel Center Help, Taxes and Fees Policy: https://support.google.com/hotelprices/answer/6064432?hl=en
- [G13] Hotel Center Help, Referral experience policy: https://support.google.com/hotelprices/answer/6064406
- [G14] Hotel Center Help, landing pages per brand or booking engine: https://support.google.com/hotelprices/answer/10746367?hl=en
- [G15] Hotel Center Help, Prohibited Practices Policy (search result summary only, UNVERIFIED): https://support.google.com/hotelprices/answer/10227462
- [G16] Hotel Center Help, booking page URL: https://support.google.com/hotelprices/answer/12002439?hl=en
- [G25] Hotel Center Help, connectivity partners: how to get started (six steps, 3 to 9 weeks): https://support.google.com/hotelprices/answer/11947461?hl=en
- [G26] Hotel Center Help, connectivity partners step 1 (eligibility review): https://support.google.com/hotelprices/answer/11946933?hl=en
- [G27] Hotel Center Help, add and manage rates in Google Business Profile (not retrievable, two attempts returned the help index; UNVERIFIED): https://support.google.com/hotelprices/answer/10684696?hl=en
- [G28] Google Hotels, landing page variables and conditions: https://developers.google.com/hotels/hotel-prices/dev-guide/pos-urls
- [G29] Google Hotels, landing pages overview: https://developers.google.com/hotels/hotel-prices/dev-guide/pos-overview
- [G30] Hotel Center Help, best practices for free booking links: https://support.google.com/hotelprices/answer/10472993?hl=en

Channex (numbering continues from `channel-manager-selection.md`)
- [C13] Channel codes (`GHA`, `TRA`, `WEG` present; no trivago, Kayak, Bing): https://docs.channex.io/api-v.1-documentation/channel-codes
- [C14] Integrations directory (Google Hotels & Vacation Rentals is the only metasearch entry): https://channex.io/integrations.md
- [C17] Connect Google Channel (content requirements, booking link template and placeholders, own Hotel Center above 25 properties, Instant Booking Page mandatory on the Channex account): https://docs.channex.io/google/google-hotel-ads
- [C18] Instant Booking Page: https://docs.channex.io/channel-mapping-guides/instant-booking-page
- [C19] Google Hotels & Vacation Rentals integration page (WhiteLabel plan, mapping and certification in onboarding): https://channex.io/integrations/google-hotels-and-vacation-rentals

Metasearch
- [T1] trivago Connectivity Suite: https://developer.trivago.com/
- [T2] trivago FastConnect overview: https://developer.trivago.com/fastconnect/fast-connect-overview.html
- [T3] trivago, Get listed (Rate Connect, cost per click and cost per acquisition): https://company.trivago.com/get-listed/
- [TA1] Tripadvisor developer portal, Hotel Availability Check API (HTTP 403 on every attempt; content from search result summaries only, UNVERIFIED): https://developer-tripadvisor.com/connectivity-solutions/hotel-availability-check-api/documentation/
- [M1] Microsoft Advertising, lodging campaigns (property feed, landing pages feed, price feeds): https://learn.microsoft.com/en-us/advertising/hotel-ads/
