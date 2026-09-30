# Email, SMS and WhatsApp delivery providers

Researched: 2026-09-29. Scope: European hotels (Germany, Austria, Switzerland first), data kept in the EU.
Ticket: `.scratch/hotel-pms-v1/issues/44-message-delivery-provider-research.md`.
Builds on `.scratch/hotel-pms-v1/issues/19-guest-inbox-messaging.md` (Conversation and Guest Inbox model) and `.scratch/hotel-pms-v1/issues/08-tech-stack-detail.md` (worker receives webhooks).

Facts were pulled from each provider's own documentation and pricing pages, and for WhatsApp from Meta's own developer and business documentation. Points no primary source settled are marked **UNVERIFIED**. Prices are as published on the day of research and change often.

## Verdict at a glance

| Channel | Recommended | Alternative | In v1 | Confidence |
|---|---|---|---|---|
| Email | Mailgun, EU region, Foundation plan or higher | Amazon SES, Frankfurt | Yes | Medium-high. Open: EU data centre country, inbound size limit. |
| SMS | seven.io | Twilio | No | Medium. seven.io's server location and Austrian registration service were not confirmed from a primary page. |
| WhatsApp | Meta Cloud API directly, PMS vendor as Tech Provider, local storage DE or CH | 360dialog Partner Platform | No | High for the rules, low for prices (rate card not readable). |

Three findings that change the model:

1. **WhatsApp allows free text only for 24 hours after the guest's last message.** Outside that window every message is a template approved by Meta in advance, per language. Texts that the property edits freely (ticket 19) cannot be sent through WhatsApp without a new review each time.
2. **Austria delivers SMS with a sender name only if the name is registered with RTR, from 1 October 2026.** Registration is per hotel, exact in upper and lower case, and takes 14 days to become valid.
3. **No WhatsApp route keeps processing inside the EU.** Storage can be fixed to Germany or Switzerland; processing may happen anywhere for up to 60 minutes.

## 1. Email

### 1.1 What the Guest Inbox needs from email

From ticket 19: automated and staff messages go out as email notifications with a Portal Link; each notification carries a reply address unique to the Conversation; the reply text and attachments (images and PDF, 10 MB each) are added to the thread. From ticket 08: the worker receives webhooks, stores them raw, acknowledges, then processes them as idempotent jobs. So the provider must offer: EU processing, many sender domains (one per hotel), inbound mail to a webhook with attachments, and bounce/complaint events.

### 1.2 Comparison

| | Amazon SES (Frankfurt) | Mailgun (EU region) | Brevo | Postmark | Scaleway TEM |
|---|---|---|---|---|---|
| EU data residency | Yes. SES API endpoint in `eu-central-1` (also Ireland, Paris, Stockholm, Milan, Zurich) [E1]. AWS: "We will not move or replicate your content outside of your chosen AWS Region(s) without your agreement" [E5]. US-owned. | Yes for message data: "it never leaves the region that it is processed by". Region-bound: messages, event logs, suppressions, routes, IPs. Global (not region-bound): account information, users, billing, API keys, domain names [E7]. Country of the EU data centre: **UNVERIFIED**. | Stated as EU-only hosting (own servers, OVH in France and Germany, Google Cloud in Belgium), but the help page returned HTTP 403 and was read only as a search snippet [E12]: **UNVERIFIED**. | No. "Postmark's primary data and servers are hosted at Deft's data center (located outside of Chicago), and Amazon Web Services"; "We currently don't have plans to add servers in the EU"; relies on SCCs [E10]. | Yes, "natively integrated in Scaleway's European cloud" [E13]. EU-owned. |
| Sending from each hotel's own domain | Each domain is a verified identity with Easy DKIM CNAME records; 10,000 identities per region [E2]. Verification, DKIM and SMTP credentials are per region [E3]. | Custom sending domains: 1 on Free and Basic, 1,000 on Foundation and Scale [E8]. | Supported (domain authentication); limits not checked: **UNVERIFIED**. | 5 domains on Basic, 10 on Pro, unlimited on Platform [E11]. | SPF, DKIM and DMARC on custom domains [E13]. |
| Isolation between hotels | **Tenants**: a container per customer with its own identities, configuration sets, templates and reputation metrics; a tenant with bad bounce or complaint rates is paused "without affecting the sending capability of other tenants"; optional suppression list per tenant. 10,000 tenants by default [E4]. | Per-domain reputation and suppressions are region-bound data [E7]; no tenant construct checked: **UNVERIFIED**. | Not checked. | Servers and message streams (5 to unlimited servers by plan) [E11]. | Not checked. |
| Inbound replies | Yes in Frankfurt (`inbound-smtp.eu-central-1.amazonaws.com`) [E1]. Delivers "the raw, unmodified email" in MIME format to S3 (max 40 MB) or inside an SNS notification (max 150 KB) [E6][E2]. No parsing, no quoted-text stripping: the worker must parse MIME itself. Recipient matching uses the SMTP envelope recipient [E6]. Spam and virus verdicts are added as headers (`X-SES-Virus-Verdict`) [E6]. | Yes. Routes POST "a parsed version of the received email" to a URL, including `stripped-text` ("the text version of the message without quoted parts and signature block"); attachments as multipart form data or base64 in JSON. Retries for 8 hours on any code other than 200 or 406 [E9]. Inbound MX for EU: `mxa.eu.mailgun.org`, `mxb.eu.mailgun.org`; API `api.eu.mailgun.net` [E18]. Size limit: **UNVERIFIED**. | Yes. MX of a reply subdomain points to Brevo; JSON webhook with `ExtractedMarkdownMessage` (signature removed), `InReplyTo`, `SpamScore`; attachments fetched separately by `DownloadToken`. Brevo itself notes "a 100% success rate on inbound parsing is impossible" [E14]. | Yes on Pro and Platform only. `MailboxHash` splits `user+hash@domain` for threading; `StrippedTextReply` works for English only; attachments base64, total at most 35 MB [E11][E15]. | **No**: "currently you can only send transactional emails with TEM" [E13]. |
| Deliverability tools | Virtual Deliverability Manager (per-tenant dashboards by ISP), tenant reputation findings, account and tenant suppression lists, dedicated IPs, bounce/complaint events through SNS or EventBridge [E4][E16]. | Tracking, analytics and webhooks on all plans; dedicated IP on Scale; log retention 1 to 30 days by plan [E8]. | Delivery, open, click, bounce and spam webhooks [E12]: **UNVERIFIED** (snippet). | 45 days of message retention [E11]. | Webhooks (1 per domain on Essential), managed dedicated IP on Scale [E13]. |
| Pricing (published 2026-09-29) | $0.10 per 1,000 outbound, $0.10 per 1,000 inbound plus $0.09 per 1,000 incoming chunks, $0.12 per GB of attachments sent; tenants $0.005 per tenant per month plus $0.005 per 1,000; dedicated IP $24.95 per month [E16]. | Basic $15 for 10,000 ($1.80 per extra 1,000); Foundation $35 for 50,000 ($1.30); Scale $90 for 100,000 ($1.10). Inbound routes: 5 on Basic, unlimited from Foundation [E8]. | Not retrieved: **UNVERIFIED**. | Basic $15, Pro $16.50, Platform $18, each for 10,000; extra 1,000 at $1.80, $1.30, $1.20 [E11]. | Essential: 300 included then EUR 0.25 per 1,000. Scale: EUR 80 per month, 100,000 included then EUR 0.20 per 1,000 [E13]. |
| Limits | Sandbox on a new account: 200 emails per 24 hours, 1 per second, until production access is granted per region. Message max 40 MB (v2 API or SMTP), 50 recipients per message [E2]. | Free plan 100 per day [E8]. | Not checked. | Free plan 100 per month [E11]. | Not checked. |

### 1.3 Rules of the large mailbox providers

Google's sender guidelines [E17] apply to mail sent to Gmail addresses, which is a large share of guests:

- All senders need SPF or DKIM; senders of 5,000 or more messages a day need SPF, DKIM and DMARC, and "the domain in the sender's From: header must be aligned with either the SPF domain or the DKIM domain".
- Senders must not "impersonate Gmail From: headers". A hotel whose only address is `hotel@gmail.com` cannot be used as the From address.
- Spam rate in Postmaster Tools must stay below 0.3 %.
- One-click unsubscribe is demanded for marketing and subscribed messages of bulk senders, not for transactional mail.

How Google counts the 5,000 a day threshold when one platform sends for many hotel domains, or for many hotels through one shared platform domain, is **UNVERIFIED**.

### 1.4 Recommendation for email

**Mailgun, EU region, Foundation plan or higher**, with **Amazon SES in Frankfurt as the named fallback**.

Reasons:

1. Reply by email is a v1 requirement. Mailgun hands the worker a parsed reply with the quoted history and signature removed and the attachments attached, by plain HTTP POST with retries [E9]. That fits the worker's "store raw, acknowledge, process as job" webhook design without any AWS plumbing.
2. Message data stays in the EU region [E7], and 1,000 sending domains cover several hundred tenants [E8].
3. SES is about ten times cheaper per message and has the best multi-tenant isolation (tenants) [E4][E16], but inbound arrives as raw MIME through S3 and SNS [E6], so the project would own MIME parsing and reply extraction, and would add AWS as a further vendor. It becomes the better choice if volume or the 1,000-domain ceiling becomes a problem.
4. Postmark is excluded by the EU data requirement [E10]. Scaleway TEM is excluded because it cannot receive mail [E13]. Brevo stays a candidate only after its data location is confirmed from a retrievable primary source.

Open points to check before signing: Mailgun's EU data centre country, inbound size limit, the DPA and its sub-processor list (all **UNVERIFIED** here).

## 2. SMS

SMS is not a v1 transport (ticket 19: email with Portal Link in v1, other transports later). This section fixes what the model must allow for.

### 2.1 Sender names per country

| Country | Alphanumeric sender name | Registration | Two-way (guest can answer) | Source |
|---|---|---|---|---|
| Germany | Supported, dynamic (any name set per message) | None required | Only with a numeric sender (long code). A sender name is for "one-way text messaging" [S14]. | Twilio country guideline [S1] |
| Austria | Supported, but **from 1 October 2026 only names entered in the RTR directory are delivered**; dynamic names are no longer possible | **Mandatory.** Registered for the holder of the name (the hotel), through a commissioned mobile service provider. Unregistered names are not delivered. Sending alphanumeric SMS to Austrian recipients from abroad is prohibited. | With a numeric sender; dedicated numbers are not affected by the registration duty | RTR [S4]; Twilio [S2]; AWS [S5]; LINK Mobility [S6] |
| Switzerland | Supported, dynamic | None required | With a numeric sender | Twilio country guideline [S3] |

Details on Austria, because it takes effect two days after this research:

- RTR: from 1 October 2026 "nur eingetragene Kennungen an österreichische Endnutzerinnen und Endnutzer zugestellt werden"; "Der Versand alphanumerischer SMS aus dem Ausland an österreichische Kundinnen und Kunden ist künftig untersagt." Legal basis: 10th amendment of the KEM-V [S4]. Gloss: only registered names are delivered; alphanumeric SMS from abroad to Austrian customers is forbidden.
- The holder of the name is registered, not the provider acting for it [S4].
- Format rules as implemented by AWS: 3 to 11 characters, A-Z a-z 0-9 space + - _ &, no umlauts, no generic terms, **case-sensitive** ("MyBrand" does not cover "MYBRAND"); a registration cannot be amended afterwards, a new one has a 14-day activation period; a deleted name can be re-registered after 30 days [S5].
- Fees of the RTR directory: not stated on the RTR page, **UNVERIFIED**.
- How "from abroad" applies to a German or Irish platform sending for an Austrian hotel through a provider with an Austrian operator connection: **UNVERIFIED**, to be asked of the chosen provider.

Common to all three (Twilio guidelines [S1][S2][S3]): opt-in before messaging, STOP and HELP handling in the local language, 160 characters per segment in GSM-7 and 70 in Unicode, no delivery to landlines. Which characters of hotel texts fall outside GSM-7 (umlauts are commonly said to be inside, emoji outside) was not taken from a cited source: **UNVERIFIED**.

### 2.2 Comparison

| | Twilio | seven.io | Sinch | AWS End User Messaging SMS |
|---|---|---|---|---|
| Seat | USA | Germany (Kiel) [S8] | Sweden: **UNVERIFIED** (not checked from a primary source) | USA |
| EU data residency | Ireland region (IE1) carries Programmable Messaging [S9], but Twilio states: "During this initial phase of the rollout of Twilio Regions, Twilio doesn't guarantee that all data will remain within your selected Region"; phone numbers, billing and usage records and console users are global, account-level resources are managed in US1 only [S10]. | "Pure EU Routing", DPA signed online, log files kept for the legally required period and then anonymised [S11]. "Servers exclusively in Germany" was seen only in a search snippet: **UNVERIFIED**. | EU endpoint `eu.sms.api.sinch.com` with storage in Ireland and Sweden; but staff and service providers "located within production server locations and overseas" may access customer data [S12]. | Regional like all AWS services [E5]; regions for SMS not checked: **UNVERIFIED**. |
| Sender name per hotel | Alphanumeric sender free of charge, set per message in DE and CH; AT needs pre-registration with proof of entitlement [S1][S2][S3][S7] | Custom sender supported: **UNVERIFIED** in detail | Not checked: **UNVERIFIED** | Registration form for Austria per sender name, with letter of authorisation [S5] |
| Inbound | Numeric number needed: DE mobile number $30 per month, AT $6, CH $9; inbound $0.0075 per segment [S7] | Numbers from EUR 19.90 per month plus EUR 9.90 setup; replies free [S13] | **UNVERIFIED** | **UNVERIFIED** |
| Price per outbound segment | DE $0.112, AT $0.0979, CH $0.0769 [S7] | EUR 0.075 per SMS as the base price; rates per country outside that base and volume rates from 10,000 a month on request [S13]. Price to Switzerland: **UNVERIFIED**. | **UNVERIFIED** | **UNVERIFIED** |
| WhatsApp from the same vendor | Yes, but WhatsApp is not listed as available in the Ireland region [S9] | **UNVERIFIED** | Yes (not checked) | Yes (AWS End User Messaging Social, not checked) |

### 2.3 Recommendation for SMS

**seven.io as first choice, Twilio as the documented alternative; do not build SMS in v1.**

1. seven.io is a German company with EU routing and an online DPA [S8][S11], which matches "data kept in the EU" without the caveats Twilio and Sinch themselves publish [S10][S12]. Its base price is below Twilio's German price [S13][S7]. Its server location and Austrian registration service must be confirmed in writing before contract (**UNVERIFIED** here).
2. Twilio has the best documentation and the country rules above come from it, but its own text does not guarantee EU residency yet [S10].
3. SMS is one-way with a sender name. A guest cannot answer "Hotel Post". The SMS therefore carries the Portal Link, and answers come through the portal. Two-way SMS would need one rented number per property (EUR 6 to 30 a month each [S7][S13]), which is not worth it next to WhatsApp.

## 3. WhatsApp

WhatsApp is not a v1 transport. The rules below come from Meta's own developer documentation and the WhatsApp Business Messaging Policy. They shape the data model now, because several of them cut across decisions of ticket 19.

### 3.1 Rules of the platform (Meta)

| Rule | What Meta says | Source |
|---|---|---|
| Opt-in | "You may only contact people on WhatsApp if: (a) they have given you their mobile phone number or username; and (b) you have received opt-in permission from the recipient." The opt-in must state clearly that the person opts in to messages from the business and name the business. Any collection method is allowed (website, SMS, paper, in person) if lawful. Opt-out requests must be honoured. | [W1][W2] |
| 24-hour window | When a guest writes, "a 24-hour timer called a customer service window starts" and restarts with each further guest message. Inside the window any message type may be sent, free text included. After it closes, only approved template messages. | [W3][W1] |
| Templates | Every business-initiated message outside the window is an approved template in one of three categories: marketing, utility, authentication. Review takes "up to 24 hours"; only `APPROVED` templates can be sent. Meta does not translate: each language is its own template text. 250 templates per account for unverified businesses, up to 6,000 when verified. Templates with bad feedback or low read rates can be paused. | [W4] |
| Categories | Utility: "triggered by a user action or request", non-promotional, specific to the user (example: order confirmation). Marketing: anything promotional. Mixed content counts as marketing. Meta can recategorise an approved utility template to marketing with one day's notice. | [W5] |
| Number | The number must be owned by the business, have country and area code, and be able to receive a call or SMS. A number registered on the platform "cannot be used with WhatsApp Messenger". It may stay in use with the WhatsApp Business app under the coexistence onboarding (1:1 chats mirrored, no groups, 20 messages per second, 180 days of history synchronised). | [W6][W7] |
| Numbers per business | A new business portfolio may register 2 numbers, 20 once the business is verified or has reached the 2,000 limit. | [W6] |
| Messaging limits | Start at 250 unique contacts per 24 hours, then 2,000, 10,000, 100,000, unlimited. "Messaging limits are calculated and set at the business portfolio level and are shared by all business phone numbers within a portfolio." Only messages outside a customer service window count. The step to 2,000 needs business verification or 2,000 delivered high-quality messages in 30 days. | [W8] |
| Automation | Automated replies need "prompt, clear, and direct escalation paths" to a human (chat transfer, phone, email, web form). | [W1] |
| Forbidden content | Do not "share or ask people to share full length individual payment card numbers, financial account numbers, personal ID card numbers, or other sensitive identifiers". No health information where regulation forbids it. Excluded trades include gambling (with exceptions), drugs, weapons, adult services. | [W1] |
| Privacy duties | The business is "responsible for and must secure all necessary notices, permissions, and consents" and must publish a privacy policy. | [W1] |
| Media | Images JPEG or PNG up to 5 MB; documents (PDF, Office, text) up to 100 MB; audio and video up to 16 MB. Media received by webhook can be downloaded for 7 days; a media URL expires after 5 minutes. | [W9] |

### 3.2 What a guest conversation through WhatsApp may contain

- Inside the 24-hour window: free text, images, PDF and other documents, location, reply buttons, lists, reactions [W3]. This is enough for the Guest Inbox.
- Outside the window: only the approved template, with its variables filled in (guest name, room, time, link) [W4].
- Never: card numbers, bank account numbers, identity document numbers [W1]. The registration form (Meldeschein), identity data and payment must go through the Portal Link, not through the chat.
- Hotel messages and their categories, read against [W5]: booking confirmation, pre-arrival invitation, balance due and room ready are tied to the guest's booking and carry no promotion, so utility is the fitting category. Post-stay thanks is utility only while it contains no offer, discount or request to book again. The final category is decided by Meta at review: **UNVERIFIED** until real templates are submitted.

### 3.3 Data location

- Meta acts as "data processor/service provider on behalf of the business" for the Cloud API [W10].
- Messages are stored at most 30 days at Meta [W10].
- The Cloud API is not end-to-end encrypted towards the business: Meta's Cloud API decrypts and forwards the content [W10].
- **Local storage** can be switched on per phone number at registration with `data_localization_region`. Accepted European values: **DE, CH, GB** [W11]. It covers data at rest only. Data in use is processed for up to 60 minutes in Meta data centres anywhere [W12].
- Consequence: "data kept in the EU" can be met for storage, not for processing. This must be stated in the hotel's privacy notice and in the processing agreement.

### 3.4 The role of solution providers

Meta names three kinds of intermediaries [W13]:

| | Solution Partner | Tech Provider | Tech Partner |
|---|---|---|---|
| What it is | Meta Business Partner offering "a full range of WhatsApp Business Platform services to other businesses" | Similar service offer, without partner status | Tech Provider that is, or may become, a Meta Business Partner |
| Meta's message fees | Has a credit line that it extends to clients; invoices clients itself | No credit line; each client enters its own payment method and is billed by Meta | As Tech Provider |
| Onboarding of hotels | Embedded Signup | Embedded Signup | Embedded Signup |

Clients onboarded through Embedded Signup own their WhatsApp assets (account, numbers, templates) and can take them to another provider [W13].

### 3.5 Comparison of access routes

| | Meta Cloud API directly, the PMS as Tech Provider | 360dialog | Twilio |
|---|---|---|---|
| Fees on top of Meta | None | Per number EUR 49, 99 or 500 a month; Partner Platform EUR 250 to 1,000 a month base plus EUR 15 to 49 per channel; "no markup on Meta fees" [W14] | $0.005 per message in and out, plus Meta's fees passed through [W15] |
| EU data residency | Data at rest in DE or CH by local storage; data in use up to 60 minutes elsewhere [W11][W12] | Hosting location not stated on the pricing page: **UNVERIFIED** | WhatsApp is not among the products of the Ireland region [S9]; Twilio does not guarantee regional residency [S10] |
| One number per property | Yes, numbers are registered per hotel business; 2 then 20 per business portfolio [W6] | Yes, priced per number or channel [W14] | Yes (not checked in detail) |
| Inbound | Webhooks from Meta to the worker; media fetched within 7 days [W9] | Webhooks (not checked) | Webhooks (not checked) |
| Extra processor of guest messages | None besides Meta | 360dialog | Twilio (USA) |

### 3.6 Pricing (Meta)

- Charged per delivered template message, by category and by the country code of the recipient; in force since 1 July 2025 [W16].
- Free: every non-template message inside the customer service window, and utility templates delivered inside it [W16].
- Marketing templates are always charged [W16].
- Volume tiers lower the utility and authentication rates; they are per market and category and reset monthly [W16].
- Germany has its own rate; rate cards are published as CSV and PDF, "effective July 1, 2026" [W16]. The files and the rate calculator could not be read by the tools used: the amounts for Germany, Austria and Switzerland are **UNVERIFIED**.

### 3.7 Recommendation for WhatsApp

**Meta Cloud API directly, with the PMS vendor registered as Tech Provider, hotels onboarded by Embedded Signup, local storage set to DE (CH for Swiss hotels). Fallback: 360dialog Partner Platform. Not in v1.**

1. Each hotel owns its WhatsApp Business Account and number [W13]. That matches one number per property, keeps messaging limits and quality ratings separate per hotel [W8], and lets Meta bill the hotel directly.
2. No second processor sees the guest's messages, and there is no fee per number.
3. Cost of this route: Meta app review and business verification of the vendor, then business verification of every hotel to leave the 250-contacts limit [W8]. The time these take is **UNVERIFIED**.
4. 360dialog is the fallback if Tech Provider onboarding stalls; its seat and hosting location must be confirmed first (**UNVERIFIED**).
5. Twilio is not recommended for WhatsApp because its EU region does not carry WhatsApp [S9].

## 4. Constraints on the notifications model and the Guest Inbox

Each constraint names the fact it rests on. "Ticket 19" and "ticket 08" are the decisions in `.scratch/hotel-pms-v1/issues/`.

**Model of Message and delivery**

1. A Message needs a **transport** (portal, email, SMS, WhatsApp) and one **delivery record per transport attempt**: provider message id, state (queued, sent, delivered, read, failed, bounced, rejected), time, failure reason. States arrive later by webhook, so they are separate from the Message itself.
2. Provider events are processed idempotently by provider event id, as ticket 08 already demands. Mailgun repeats an inbound POST for 8 hours on any answer other than 200 or 406 [E9]; a worker outage longer than that loses guest replies. The inbound endpoint must therefore acknowledge after storing raw, before any processing.
3. The system's database stays the record of a Conversation. Providers keep copies for a limited time only (Mailgun logs 1 to 30 days by plan [E8], Meta at most 30 days [W10]). Retention of 12 months and erasure (ticket 19) are enforced in the database and file storage; at the providers the copies run out by themselves. Whether an erasure request must also be passed to the provider is a legal point, **UNVERIFIED**.

**Sender identity per property**

4. Sender identity belongs to the **property**, not the tenant, in line with the Guest Inbox being per property: email sending domain with verification state, SMS sender name with registration state per country, WhatsApp number with account id, display name and quality state.
5. A hotel sends from its own domain only after it has published DNS records (DKIM, SPF, DMARC) and the provider has verified them [E2][E8]. Until then the message goes out from a platform domain with the hotel's name as display name. Onboarding needs a "domain pending" state and a check job.
6. A free-mail address (for example `hotel@gmail.com`) cannot be the From address: Gmail forbids impersonating Gmail From headers [E17]. It can only be a Reply-To, and with reply by email the Reply-To is already taken by the Conversation address (constraint 8).
7. Bounces and spam complaints must feed a suppression list per property and show in the Conversation that the guest cannot be reached by email. The spam rate must stay under 0.3 % [E17]; with SES a hotel above the thresholds is paused alone [E4], with Mailgun the isolation is per domain (not verified in detail).

**Reply by email**

8. The reply address unique to the Conversation lives on an inbound domain whose MX points to the provider [E18]. One platform-owned inbound domain is enough; a hotel's own domain would need a further MX record on a subdomain.
9. Ticket 08 resolves the tenant "from the payload via the control schema". For inbound email the only key is the recipient address, so the control schema needs a lookup from reply token to tenant, property and Conversation, or the token must carry the tenant. The token must be unguessable, because knowing it allows writing into the thread.
10. The envelope recipient, not the To header, identifies the Conversation [E6]. The sender address of a reply may differ from the guest's stored address (second mailbox, partner answering). The model needs a rule: accept and mark the differing sender, or hold for staff.
11. Removing quoted history and signatures is imperfect at every provider (Brevo: "a 100% success rate on inbound parsing is impossible" [E14]; Postmark: English only [E15]). Store the raw mail, show the stripped text, and offer "show original".
12. Automatic answers (out of office, bounce messages) arrive at the reply address too. They must be detected and must not count as a guest message, otherwise they trigger unread state, the escalation timer and the off-hours reply, which can loop.
13. Inbound attachments need the virus scan of ticket 19 in the worker. SES gives a virus verdict on inbound mail [E6]; for Mailgun this is **UNVERIFIED**, so the own scan is mandatory.

**Attachments**

14. The limit "10 MB each" of ticket 19 does not hold on every transport. WhatsApp takes images only as JPEG or PNG up to 5 MB, documents up to 100 MB [W9]. Email grows by about a third through base64 encoding and the total message is capped (SES 40 MB [E2]; Mailgun **UNVERIFIED**). Limits and allowed types are per transport, and an oversized file is sent as a Portal Link instead.
15. WhatsApp media must be downloaded by the worker at once: the media URL lives 5 minutes, the media id 7 days [W9]. After that it is stored in the tenant's bucket like any other attachment.

**WhatsApp**

16. The Conversation must know the **time of the guest's last WhatsApp message**. The composer shows whether the 24-hour window is open. When it is closed, staff can send only an approved template or switch to email [W3].
17. Automated messages and quick replies cannot be free text on WhatsApp outside the window. Each automated message type needs a template per property, language and transport with a state: draft, in review, approved, rejected, paused [W4]. Editing the text (ticket 19: "the property edits the texts per language") starts a new review of up to 24 hours. Either the property edits only the email and portal text and WhatsApp uses fixed platform templates with variables, or the editor shows the review state. This is a decision for the owner.
18. The off-hours automatic reply is sent inside the window, so it may be free text [W3]. It must name a way to reach a human [W1]; the emergency phone number of ticket 19 covers this.
19. A WhatsApp thread exists between one guest number and one hotel number. It is **not tied to a Reservation**. An incoming message has to be matched to a Conversation through the guest's phone number and the current or next Reservation at that property. Unknown numbers, a guest with two Reservations, and a number shared by two guests need an "unassigned" place in the Guest Inbox and a manual assignment. This cuts across "one Conversation per Reservation" of ticket 19.
20. Consent is stored **per guest and per transport**: time, source, the wording shown, the business named [W1][W2]. Withdrawal (STOP by SMS, block or opt-out on WhatsApp) stops that transport only.
21. Card numbers, bank details and identity document numbers must not be asked for or sent in WhatsApp [W1]. Staff need a hint in the composer; payment and registration go through the Portal Link.
22. Each hotel needs its own Meta business portfolio with business verification. Limits are shared by all numbers of a portfolio and start at 250 unique contacts per 24 hours [W8]; numbers are capped at 2, then 20 per portfolio [W6]. One platform-owned portfolio for all hotels is therefore not possible. Onboarding of a property gets the steps: Embedded Signup, verification, number registration with storage region, display name approval.
23. The hotel's existing WhatsApp number can be kept only through the coexistence onboarding of the WhatsApp Business app [W7]. A number used in the private WhatsApp app must be deleted there first [W6].
24. Template messages cost money per delivered message by category and country of the guest's number [W16]. The model needs usage per property, transport, category and country, for cost display and re-billing.

**SMS**

25. An SMS with a sender name cannot be answered [S14]. It always carries the Portal Link, and it never opens a reply path into the Conversation.
26. The sender name is per property and per destination country, with a registration state. For Austria: exact spelling in upper and lower case, 3 to 11 characters, no umlauts, 14 days until valid, no later change [S4][S5]. "Hotel Müller" must be registered as "HotelMueller" or similar.
27. Text length is counted in segments: 160 characters in GSM-7, 70 in Unicode [S1]. The template editor shows the number of segments, and a link shortener for the Portal Link is worth having.
28. Opt-in before SMS and STOP handling in the local language are expected in all three countries [S1][S2][S3].

**Across all transports**

29. Choice of transport per automated message needs an order of preference per guest (for example WhatsApp if consent and template exist, otherwise email) and a fallback when delivery fails. The same message must not arrive on three transports.
30. All three providers become sub-processors. Each needs a processing agreement; Mailgun keeps account data globally [E7], Meta processes outside the EU for up to 60 minutes [W12]. Like the hosting decision in ticket 08, "all data stays in the EU" is not a sales claim once WhatsApp is switched on.

## Sources

All retrieved 2026-09-29.

**Email**

- [E1] AWS General Reference, Amazon SES endpoints and quotas: https://docs.aws.amazon.com/general/latest/gr/ses.html
- [E2] Amazon SES Developer Guide, Service quotas: https://docs.aws.amazon.com/ses/latest/dg/quotas.html
- [E3] Amazon SES Developer Guide, Regions and Amazon SES: https://docs.aws.amazon.com/ses/latest/dg/regions.html
- [E4] Amazon SES Developer Guide, Tenants: https://docs.aws.amazon.com/ses/latest/dg/tenants.html
- [E5] AWS Data Privacy FAQ: https://aws.amazon.com/compliance/data-privacy-faq/
- [E6] Amazon SES Developer Guide, Email receiving concepts: https://docs.aws.amazon.com/ses/latest/dg/receiving-email-concepts.html
- [E7] Mailgun, Regions: https://www.mailgun.com/about/regions/
- [E8] Mailgun, Pricing: https://www.mailgun.com/pricing/
- [E9] Mailgun documentation, Receive messages via HTTP (routes): https://documentation.mailgun.com/docs/mailgun/user-manual/receive-forward-store/receive-http
- [E10] Postmark, EU privacy: https://postmarkapp.com/eu-privacy
- [E11] Postmark, Pricing: https://postmarkapp.com/pricing
- [E12] Brevo help, Data storage location (HTTP 403 on direct retrieval, read as search snippet only): https://help.brevo.com/hc/en-us/articles/360001005510-Data-storage-location
- [E13] Scaleway, Transactional Email: https://www.scaleway.com/en/transactional-email-tem/
- [E14] Brevo API documentation, Parse inbound email: https://developers.brevo.com/docs/inbound-parse-webhooks
- [E15] Postmark developer guide, Parse an email: https://postmarkapp.com/developer/user-guide/inbound/parse-an-email
- [E16] Amazon SES, Pricing: https://aws.amazon.com/ses/pricing/
- [E17] Google Workspace Admin Help, Email sender guidelines: https://support.google.com/a/answer/81126
- [E18] Mailgun documentation, API overview (US and EU endpoints): https://documentation.mailgun.com/docs/mailgun/api-reference/api-overview

**SMS**

- [S1] Twilio, Germany SMS guidelines: https://www.twilio.com/en-us/guidelines/de/sms
- [S2] Twilio, Austria SMS guidelines: https://www.twilio.com/en-us/guidelines/at/sms
- [S3] Twilio, Switzerland SMS guidelines: https://www.twilio.com/en-us/guidelines/ch/sms
- [S4] RTR (Austrian regulator), SMS-Regulierung: https://www.rtr.at/TKP/was_wir_tun/telekommunikation/anbieterservice/sms-regulierung/sms-regulierung.de.html
- [S5] AWS End User Messaging SMS, Austria sender ID registration: https://docs.aws.amazon.com/sms-voice/latest/userguide/registrations-austria.html
- [S6] LINK Mobility, Austria introduces SMS Sender ID registration: https://www.linkmobility.com/news/austria-introduces-sms-sender-id-registration-from-1-october-2026
- [S7] Twilio SMS pricing, Germany, Austria, Switzerland: https://www.twilio.com/en-us/sms/pricing/de , https://www.twilio.com/en-us/sms/pricing/at , https://www.twilio.com/en-us/sms/pricing/ch
- [S8] seven.io, home page: https://www.seven.io/en
- [S9] Twilio, Regional product and feature availability: https://www.twilio.com/docs/global-infrastructure/regional-product-and-feature-availability
- [S10] Twilio, Understanding Twilio Regions: https://www.twilio.com/docs/global-infrastructure/understanding-twilio-regions
- [S11] seven.io, GDPR: https://www.seven.io/en/company/gdpr/
- [S12] Sinch, SMS API reference (regions): https://developers.sinch.com/docs/sms/api-reference/
- [S13] seven.io, Prices: https://www.seven.io/en/prices/
- [S14] Twilio, What is an alphanumeric sender ID: https://www.twilio.com/docs/glossary/what-alphanumeric-sender-id

Not retrieved from the primary page and therefore only named, not relied on: the text of the KEM-V amendment (BGBl. II 2026/66, https://www.ris.bka.gv.at/Dokumente/BgblAuth/BGBLA_2026_II_66/BGBLA_2026_II_66.pdf), which appeared in search results but was not opened; whether it is the amendment in question is **UNVERIFIED**.

**WhatsApp**

- [W1] WhatsApp Business Messaging Policy: https://whatsappbusiness.com/policy/
- [W2] Meta, Get opt-in for WhatsApp: https://developers.facebook.com/docs/whatsapp/overview/getting-opt-in
- [W3] Meta, Send messages (service messages and customer service window): https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages
- [W4] Meta, Message templates guidelines: https://developers.facebook.com/docs/whatsapp/message-templates/guidelines
- [W5] Meta, Template categorization: https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization
- [W6] Meta, Business phone numbers: https://developers.facebook.com/docs/whatsapp/cloud-api/phone-numbers
- [W7] Meta, Onboarding WhatsApp Business app users: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/
- [W8] Meta, Messaging limits: https://developers.facebook.com/docs/whatsapp/messaging-limits
- [W9] Meta, Media reference: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media
- [W10] Meta, Data privacy and security: https://developers.facebook.com/documentation/business-messaging/whatsapp/data-privacy-and-security/
- [W11] Meta, Register a business phone number (`data_localization_region`): https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/registration/
- [W12] Meta, Cloud API local storage: https://developers.facebook.com/docs/whatsapp/cloud-api/overview/local-storage
- [W13] Meta, Solution providers overview: https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/overview
- [W14] 360dialog, Pricing: https://360dialog.com/pricing
- [W15] Twilio, WhatsApp pricing: https://www.twilio.com/en-us/whatsapp/pricing
- [W16] Meta, Pricing on the WhatsApp Business Platform: https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing

## Method and limits of this research

- Pages were read through a fetch tool that summarises the page. Quotations in quotation marks are as returned by that tool; they were not compared character by character with the rendered page.
- Not retrievable after two attempts: Brevo data location (HTTP 403), Mailgun help centre article on regions (HTTP 403), seven.io country price page (HTTP 404), Meta rate card files and rate calculator.
- Not researched: Infobip, Vonage, Bird, LINK Mobility as SMS providers; Mailjet and Resend as email providers; provider processing agreements and sub-processor lists; German, Austrian and Swiss law on consent for electronic messages (UWG, TKG, FMG). The last point decides which automated messages may be sent without separate consent and needs a lawyer.
