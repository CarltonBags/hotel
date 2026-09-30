# Door lock systems and their integration with a cloud PMS

Researched: 2026-09-29. Scope: European hotels up to 400 rooms; cloud PMS with no server at the hotel.
Ticket: `.scratch/hotel-pms-v1/issues/40-door-lock-vendor-research.md`.
Builds on the key-handover setting decided in `.scratch/hotel-pms-v1/issues/12-self-checkin-guest-interface.md` (collect at reception, kiosk key-card encoder, Digital Key, door PIN).

Method: vendor documentation, vendor product pages and vendor manuals were read directly; quotes are verbatim. Source tags like [A-VO1] point to the list at the end. Points with no primary source are marked **UNVERIFIED**. Statements marked **Inference** are conclusions drawn here from the quoted facts, not vendor statements.

Limits of this research:

- No primary source was found for market share, so "which systems are common in European hotels" is **UNVERIFIED**. The vendors covered are the ones named in the ticket. One aggregator lists the brands it meets in hotels as "ASSA ABLOY Vingcard, Dormakaba, SALTO, TESA, Omnitec, ISEO Sofia, ASSA ABLOY SmartAir, Exivo and HOTEK" (search-result snippet of flexipass.tech, not confirmed on the fetched page) [F-1].
- No vendor publishes prices for locks, licences or partner programmes. Only Seam and Nuki publish prices.
- Häfele's websites refused every request (HTTP 403), so Häfele is almost entirely **UNVERIFIED**.
- No API was called and no hardware was tested. Everything below is from documents.

## 1. Comparison table

| System | Where the lock software runs | How a cloud PMS reaches it | Key types | Card writing | Usable with no server at the hotel |
|---|---|---|---|---|---|
| **Assa Abloy Vostio** (Vingcard locks) | Vendor cloud [A-BR] | Vostio Guest API; the hotel creates the credentials in the Vostio portal [A-VO1] | Card, mobile key (Seos), Apple and Google Wallet [A-VO1]. PIN: none found in the guide | Network encoder (Encoder 4010, Ethernet or PoE) that talks to the Vostio cloud [A-VO1][A-VO5] | Yes |
| **Assa Abloy Visionline** (Vingcard locks) | Server at the hotel ("local server") [A-BR][SE-1] | Through the on-site server. A cloud PMS needs a tunnel or bridge on site [SE-2] | Card, mobile key [SE-1] | Encoders attached to the Visionline system. Details **UNVERIFIED** | No, unless a bridge runs on the hotel's existing lock PC |
| **Salto KS** | Vendor cloud, plus an IQ hub on site [S-KS4][S-KS5] | Connect API (REST); client ID from the local Salto Business Unit [S-KS1] | Tag (card or fob), Digital Key (Bluetooth), PIN, remote opening [S-KS3][S-KS4] | No encoder. Tags are registered once by tapping a lock, then assigned by ID through the API [S-KS3] | Yes |
| **Salto Space** | Windows server at the hotel [S-SP2] | Legacy PMS protocols (Industry Standard, FIAS, FOLS) over RS232 or TCP/IP on the hotel network [S-SP2]; Hospitality API for Apple Wallet keys only [S-SP1] | Card, JustIN Mobile key, Apple Wallet key [S-SP4][S-SP1] | Ethernet encoder only; "USB encoders cannot be used for any PMS-related functionality" [S-SP2] | No, unless a bridge runs on the hotel's existing lock PC |
| **dormakaba Ambiance Cloud** | Vendor cloud (AWS), plus a gateway on site [D-1] | "FIAS, Ambiance SOAP, and REST APIs" [D-1]. No public API reference found: **UNVERIFIED** | "RFID credentials, mobile keys, and digital wallet access" [D-1]. PIN: **UNVERIFIED** | dormakaba RFID Encoder (GEN II) [D-1]. How the encoder is addressed from a PMS: **UNVERIFIED** | Yes, per vendor claim "Server-free deployment" [D-1] |
| **dormakaba Ambiance (on-premises)** | Server at the hotel [SE-7] | REST and SOAP on the hotel network [SE-7] | Card, mobile key [SE-6] | Encoders "installed and paired with your Ambiance server" [SE-7] | No, unless bridged |
| **Onity OnPortal** | Windows PC at the front desk [O-1] | "Multi-thread property management system (PMS) interface" on site, or Onity CloudConnect, "A cloud-based property management software (PMS) interface" [O-1]. No public API documentation found: **UNVERIFIED** | Card, mobile key (DirectKey, Bluetooth) [O-1][O-2] | RFID encoder that "Connects via USB port or via optional IP to USB hub" [O-1] | Only with CloudConnect, details **UNVERIFIED** |
| **Häfele Dialock** | **UNVERIFIED** (a search snippet of hafele.com mentions a server installation with a local web address) | **UNVERIFIED** | **UNVERIFIED** | **UNVERIFIED** | **UNVERIFIED** |
| **Nuki** (retrofit smart lock) | Vendor cloud; lock connects by built-in Wi-Fi or a bridge [N-1] | Nuki Web API (REST) [N-1] | App permission, keypad code (PIN), remote unlock. No cards [N-1] | Not applicable | Yes |
| **Seam** (aggregator) | Seam cloud; Seam Bridge on a hotel computer for on-premises lock systems [SE-2][SE-3] | One REST API (Access Grants) [SE-5][SE-13] | Card, mobile key, app-less "Instant Key", PIN, depending on the lock system [SE-4] | Encodes on the lock system's encoders through the API [SE-11] | Yes for cloud lock systems; bridge needed for on-premises ones |
| **FLEXIPASS** (aggregator) | Vendor cloud | "FLEXIPASS Open API" and a Mobile Key SDK [F-1] | "Wallet Keys, Webkeys, Mobile Keys and PIN Codes" [F-1] | Not offered. Advises to "Keep a physical-keycard fallback through your hotel's lock system" [F-1] | **UNVERIFIED** per lock brand |
| **Goki** (aggregator and lock maker) | Vendor cloud | PMS connections described only in marketing terms [G-1]. API: **UNVERIFIED** | Wallet, mobile and web keys; own lock adds PIN and card [G-1] | **UNVERIFIED** | **UNVERIFIED** |

Partner programme and cost per vendor are in section 6.

## 2. Integration model per vendor

### 2.1 Assa Abloy Vostio

- Cloud system. The vendor lists "No on-premise servers" and "PMS integrations" among its benefits [A-BR].
- The PMS authenticates with Guest API credentials. These are created in the Vostio portal under Settings, Integrations, and "are often handled by ASSA ABLOY technicians, but can also be handled by PMS/Mobile Access vendor technicians or hotel IT technicians" [A-VO1]. Seam's setup guide shows the hotel creating and downloading them itself [SE-14].
- A hardware box, the PMS Converter 4020, exists only for older PMS software that speaks legacy protocols: "Incoming PMS commands are converted to the Vostio Guest API format and forwarded to Vostio" [A-VO3]. A cloud PMS does not need it.
- No public reference for the Guest API was found on the Vostio documentation site. Request and response formats are **UNVERIFIED**.
- Locks are offline by default. Online locks need Zigbee gateways and "a subscription for Vostio Online" [A-VO2].

### 2.2 Assa Abloy Visionline

- On-premises. The vendor brochure describes online audit capacity as "Unlimited (local server)" [A-BR]. Seam calls it "a widely-used on-premises access control platform for hotels" that "uses a data-on-card platform" [SE-1].
- For mobile keys through Seam the hotel must buy "A mobile key license" and "A web services option code" from Assa Abloy [SE-12].
- A cloud PMS cannot reach it without software on the hotel network. Seam's answer is Seam Bridge (section 2.9).
- Assa Abloy's own Visionline interface documentation was not found in public. Details are **UNVERIFIED**.

### 2.3 Salto KS

- Cloud system with a REST API "intended to be used by third-party integrators" [S-KS1].
- One of five client types is a "backend server" with no user interface [S-KS2]. That fits the worker container.
- Model: a site (one property) holds users, locks and access groups. An access group joins users, locks and a time schedule [S-KS3].
- Minimum hardware: "A Salto lock, an IQ, and a subscription to Salto KS" [S-KS4]. The IQ is the hub that connects the locks to the cloud [S-KS5].

### 2.4 Salto Space

- On-premises Windows software. The PMS log path is `C:\SALTO\ProAccess Space\logs\PMS_LOG` [S-SP2].
- PMS link by three protocols, "Industry Standard, Oracle Hospitality PMS (FIAS) and FOLS", over RS232 or TCP/IP. "the PMS functionality is license-dependent" [S-SP2].
- The newer Space Hospitality API is narrow: "This API only supports Apple Wallet keys for hotel guest rooms. Physical cards and staff keys are not supported through this API." It needs Space 6.10 or later, the licence `SPACE-OPT-0041` (Wallet Guest Keys), an Ethernet NCoder in dongle mode, and inbound connections from the PMS to the Space endpoint at the hotel [S-SP1].
- Through Seam, Space needs Seam Bridge and the licence features "0016-1 – Mobile Access (BLE)" and "0018 – SHIP Interface" [SE-12][SE-15].

### 2.5 dormakaba Ambiance and Ambiance Cloud

- Ambiance Cloud: "Server-free deployment with no need for on-site infrastructure". The starter kit still contains an encoder, a maintenance unit and an "Ambiance Cloud Gateway for secure communication between cloud platform and on-site devices" [D-1].
- Keys can be created "via cloud-based web client or third-party PMS systems" [D-1].
- Seam connects to both variants. For the on-premises variant it requires Seam Bridge; for a hosted one a "Cloud connection". It needs Ambiance 2.11.2 or later, and for mobile keys "A Dormakaba Mobile Access license" and "An active LEGIC Connect account" [SE-7].
- "Dormakaba Ambiance locks do not support remote web unlock." [SE-6]

### 2.6 Onity

- OnPortal is "Windows®-10 based" and runs "side-by-side with your PMS system on a desktop PC" [O-1]. That is a front-desk PC model, not a cloud model.
- CloudConnect "Removes the need for PMS on-premise hardware and wiring" and "Enables seamless creation of key cards and digital keys" [O-1]. No technical documentation is public. Whether it can target an encoder in a kiosk is **UNVERIFIED**.
- Mobile key: "Onity provides a Software Development Kit (SDK) and integration assistance." [O-2]
- Onity pages now sit on Honeywell's website [O-1].

### 2.7 Häfele Dialock

- **UNVERIFIED**. hafele.com, hafele.co.uk and hafele.com.de returned HTTP 403 on every attempt; the Mews help article returned 401.
- The apaleo store lists a Häfele Dialock app and states "Häfele - DIALOCK has not shared public pricing." [H-1]
- Search-result snippets (not retrieved pages) say the Dialock software is web-based, installed on a server at the site, and that a connection to hotel software "may cause additional costs for interface programming". Treat as a lead, not a finding.

### 2.8 Nuki

- REST API at `https://api.nuki.io`. It is asynchronous: a 200 or 204 answer "does not mean that the action was successfully executed". Success is confirmed by a later GET or a webhook [N-1].
- "Smartlocks and other devices require an internet connection to interact with the REST API." [N-1]
- Commercial integration needs the Smart Hosting service per lock: "You will need a separate Smart Hosting Service Package for each Smart Lock you want to integrate with a partner system." [N-2]
- Limits: "Older devices can store 100 authorizations, whereas newer devices can store 200 authorizations." [N-1]
- **Inference**: Nuki fits apartments and very small properties, not a hotel with many rooms and common doors. It is a retrofit for a mechanical cylinder and has no cards.

### 2.9 Aggregators

**Seam**
- Covers, among others, Vostio, Visionline, Salto KS, Salto Space, dormakaba Ambiance, Nuki and 4SUITES [SE-19].
- One model for all: create a user identity, create an Access Grant with entrances, start and end time and the wanted key types, then deliver the key [SE-13].
- On-premises lock systems need Seam Bridge, which "runs on a computer within the same local network as the access system and creates a secure tunnel between Seam Cloud and the access system" [SE-2]. Setup guides exist for Windows, macOS and Linux [SE-16].
- The hotel connects its lock system through a hosted form (Connect Webview) embedded in the PMS [SE-2].
- App-less mobile key ("Instant Key"): a link by text or email; "There's no app to install and no account to create" [SE-4]. It "uses BLE to unlock doors offline, without relying on Wi-Fi or cellular" [SE-12].
- Where Seam stores data and whether it offers European hosting and a data processing agreement: **UNVERIFIED**. This must be settled before guest names and phone numbers are sent to it.

**FLEXIPASS** and **Goki**
- Both centre on digital keys. Neither documents card encoding [F-1][G-1].
- FLEXIPASS: "Compatibility depends on your lock provider, model, access software and configuration" [F-1].

## 3. Key types

| Key type | Works when the lock has no network | Needs at the door | Notes |
|---|---|---|---|
| Card or fob, data on card (Vostio, Visionline, Salto Space, Ambiance, Onity) | Yes. The rights travel on the card | RFID reader in the lock | Must be written on an encoder. Changes need a rewrite or an online lock |
| Tag, registered by ID (Salto KS) | Yes, if offline access is enabled for the tag [S-KS5] | Salto KS lock | No encoder. "Block the tag and hand out a new one!" [S-KS4] |
| Mobile key over Bluetooth | Yes, once delivered to the phone [SE-12][S-KS4] | Bluetooth-capable lock | Phone must be online to receive the key [S-SP4]. Often needs a paid licence (section 6) |
| Wallet key (Apple, Google) | **UNVERIFIED** | NFC-capable lock | Vostio, Salto Space and Ambiance Cloud list it [A-VO1][S-SP1][D-1] |
| Web key or remote unlock | No. Lock must be online | Online lock | Salto KS: "the lock should open within seconds" [S-KS3]. Not available on dormakaba Ambiance [SE-6] |
| PIN | Salto KS: yes, offline access is automatic for PINs [S-KS5] | Keypad | Salto KS generates the PIN; it cannot be chosen [SE-8]. Nuki codes have 6 digits, no zero, must not start with 12 [N-1] |

Older Vingcard locks need hardware changes for mobile keys: magnetic-stripe locks need an RFID reader, and control units 6333 or 6334 need an added Bluetooth module [SE-12].

## 4. Writing a key card at the front desk and at a kiosk

What the sources establish:

1. The encoder belongs to the lock system, not to the PMS. The PMS sends a request that names an encoder; the lock system drives it.
   - Vostio: the PMS names the encoder and Vostio maps it through the "PMS encoder ID" field. Example from the manual: "Encoder name = Front Desk Left", "PMS encoder ID = 1" [A-VO3].
   - Salto Space: "Ensure the encoder name in Space matches the name used in the PMS software" [S-SP2].
   - Seam: list encoders, then call encode with the `acs_encoder_id`. "A site may have several encoders, such as one at each front desk." [SE-11]
2. The encoder must be a network device.
   - Vostio Encoder 4010: Ethernet, powered by a DC supply or PoE; "The USB cables are only for communication, not for powering the encoder" and serve the service tool [A-VO5].
   - Salto Space: "Salto encoders used in PMS integrations must be ethernet-based" [S-SP2].
   - Onity's encoder attaches by USB to the OnPortal PC, or through an "IP to USB hub" [O-1].
3. Encoding is asynchronous and can fail. Seam: "confirm that encoding succeeded before you hand the card to your user". Named errors: `no_card_on_encoder`, `incompatible_card_format` [SE-11].
4. A person places the card. Vostio: "the encoder will start beeping and you will be urged to place a keycard on the encoder" [A-VO1]. Salto Space: "Place the key on the encoder when the LED light begins to flash." [S-SP4]
5. Kiosk use is foreseen by Seam: "self-serve check-in kiosks with built-in physical encoders" [SE-10].

What follows for this project (**Inference**):

- The browser never writes the card. The PMS backend asks the lock system, or the aggregator, to encode on a named encoder. So no browser plug-in, no USB access and no local software are needed on the desk computer or kiosk.
- Each front-desk workstation and each kiosk (an enrolled Device) needs a setting that names its encoder. Without it the PMS cannot know where the card lies.
- A kiosk needs a network encoder within reach of the guest and a supply of blank cards. A motorised card dispenser with a built-in encoder was not found in any primary source: **UNVERIFIED**.
- Salto KS needs no encoder. The kiosk or desk hands out a tag that is already registered and the PMS assigns the tag's ID to the guest. The PMS then has to learn which tag was handed out, for example by a printed number or a scan. How to do that at a kiosk is **UNVERIFIED**.
- Hotels with Onity OnPortal without CloudConnect, Visionline, Salto Space or on-premises Ambiance cannot be served without software on the hotel network.

## 5. Issue, extend, revoke, expiry

### 5.1 Issue

- Every system binds a key to doors and a time window. Vostio has "Valid from" and "Valid to" date and time, the latter prefilled from "Default guest check-out time" [A-VO1]. Salto Space defaults the expiry time to 12.00 [S-SP4]. Salto KS treats schedule dates with a time "as check-in and check-out values" [S-KS3].
- Keys can start in the future (Vostio "Future validity") [A-VO1].
- Mobile and wallet keys "will be delivered to the guest's app (may take up to one minute)" [A-VO1].
- A second card for the same stay is a "joiner", not a new key. A new key replaces the old one (5.3) [A-VO1].
- Seam: "You can encode each access method onto only one card." [SE-11]

### 5.2 Extend and room move

- Mobile keys and PINs update without the guest. Vostio "automatically updates all applicable Wallet keys and Seos keys" [A-VO1]. Seam: for PIN and mobile key the credential is updated automatically [SE-17].
- Cards on offline locks must be rewritten. Seam: "The physical card must be re-encoded with the new credential" and "the guest will need to visit the front desk" [SE-17].
- With online locks the card can be updated at the door. Vostio Online: "a guest can without going to the reception get a room change or get the hotel stay extended. The system automatically updates the locks, and the card is then updated by the guest directly at the guest door." [A-VO2]
- That Vostio feature has conditions: lock firmware 3.x.11.31 or higher, "not applicable for MIFARE Plus cards/tags", "Only one room at a time can be moved", and a request to Assa Abloy "at least 10 working days in advance" [A-VO4]. The document is labelled Internal but is published on the public documentation site.
- Visionline offers "Change room" and "Extended stay" from reception, and for offline sites an "Automatic Card Update Station" [A-BR]. Which of these need online locks could not be read from the brochure table: **UNVERIFIED**.
- Salto Space re-rooming is "controlled by licensing" [S-SP3].
- While Seam re-programs a key after a change, "each access method temporarily becomes invalid" [SE-17].

### 5.3 Revoke and check-out

- On offline, data-on-card locks a check-out does not lock the guest out.
  - Salto Space: check-out "does not invalidate the key. When the new guest uses their key to access the room, this invalidates the previous key." [S-SP5]
  - Vostio: "the old guest key(s) will still work until a new guest key is presented at the door" [A-VO1].
- Cancelling a key before its expiry reaches online locks only. Vostio: "For offline doors, Vostio Service Tool must be presented at the applicable doors for the cancellation to take effect." The portal then shows the status 'Manual cancellation needed' [A-VO1].
- Mobile keys are revoked from the cloud [A-VO1].
- Salto KS: removing the user from the access group removes access; "their keys automatically lose their offline access rights" [S-KS5]. How fast this reaches a lock that has lost its connection is **UNVERIFIED**.
- Seam: delete the Access Grant at check-out; delete one access method for a lost card [SE-17].

### 5.4 Expiry

- The expiry written at issue is the only limit that an offline lock enforces by itself (**Inference** from 5.3).
- Salto KS: "all PIN codes in Salto KS expire after 90 days by default" [S-KS4].
- Vostio removes keys "30 days after all keys have expired" [A-VO1]. The PMS cannot rely on the lock system as a long-term record.
- Nuki: "Consider in your implementation to delete non-used and expired authorizations." [N-1]

## 6. Partner programme, certification and costs

| Vendor | Programme | What is published | Cost |
|---|---|---|---|
| Assa Abloy | "Certified Partner Program" for third-party apps; Mobile Access SDK "together with dedicated onboarding services" [A-BR] | Steps and requirements for a PMS: **UNVERIFIED** | **UNVERIFIED**. Hotel pays for mobile key licence, web services option (Visionline) and Vostio Online subscription [SE-12][A-VO2] |
| Salto | Technology Partner Program: partners "integrate and certify their solutions"; categories include "Property Management Systems, Check-in Solutions" [S-TP]. For KS a test site "will be created for testing purposes by their local Salto Business Unit" [S-KS3] | Certification steps: **UNVERIFIED** | **UNVERIFIED**. Hotel pays a KS subscription, or Space licence options for PMS, mobile and re-rooming [S-KS4][S-SP2][S-SP3] |
| dormakaba | Mobile Access Integrator Program: SDK workshop, "Architecture Design Review", "Mobile App Validation", and an on-site "System Integration Test" before go-live [D-2] | Covers mobile key apps. A programme for PMS card interfaces: **UNVERIFIED** | **UNVERIFIED** |
| Onity | SDK "and integration assistance" [O-2] | **UNVERIFIED** | **UNVERIFIED** |
| Häfele | **UNVERIFIED** | **UNVERIFIED** | "has not shared public pricing" [H-1] |
| Nuki | None needed; API access comes with Smart Hosting [N-2] | Published | "69,00 € /year/Smart Lock" [N-2] |
| Seam | Self-service sign-up | Published | Free plan; "Unit Access $5 /device/month" with "5 actions/device/day"; "High Traffic $50 /device/month"; "Volume pricing starts at 500+ devices"; paid support plans at $20,000 and $50,000 per year [SE-18]. What counts as a device in a hotel lock system: **UNVERIFIED** |
| FLEXIPASS, Goki | **UNVERIFIED** | Goki: "Hardware priced separately" [G-1] | **UNVERIFIED** |

At Seam's list price a 100-room hotel would cost 500 US dollars a month if each room counts as one device. That is a calculation from the list price, not a quote.

## 7. Offline behaviour

| Failure | Effect | Source |
|---|---|---|
| Hotel internet down, data-on-card locks | Guests keep opening doors. Existing cards work. | [SE-1]: "the locks can function offline" |
| Hotel internet down, new card needed (Vostio) | A "fallback web" on the encoder's local address can write cards. "Wallet keys and Seos keys cannot be created in fallback mode." It "should only be used as a temporary" measure. Newer encoders (RED 2022/30 variant) have no fallback. It runs outside the PMS. | [A-VO1] |
| Salto KS lock loses the IQ or the cloud | Keys with offline access keep working. Automatic for PINs, manual setting for Digital Keys and tags. | [S-KS5] |
| Phone has no data connection at the door | A delivered Bluetooth key still opens. | [SE-12][S-KS4] |
| Phone has no data connection at issue | Key cannot be delivered. "The phone must be online in order to receive the check-in information." | [S-SP4] |
| Nuki lock or bridge offline | API calls do not reach the lock. | [N-1] |
| PMS, aggregator or lock cloud down | No new keys through the integration. Existing keys keep working. | **Inference** |

## 8. Recommendation

1. **Keep "collect at reception" as the default with no integration.** Staff write cards in the lock vendor's own software. This works with every lock system and needs nothing from us. It is already the default in the self check-in decision.

2. **Put one lock interface inside the PMS and hide vendors behind it.** Operations: issue key, change validity, change room, revoke, read status, list encoders. All of them asynchronous, run by the worker container, with a stored state per key (requested, waiting for card, issued, failed, revoked, manual action needed). Reason: encoding and Nuki calls are asynchronous [SE-11][N-1], and offline locks produce states that need staff action [A-VO1].

3. **Support cloud lock systems only, in version 1.** These need nothing at the hotel beyond the vendor's own encoder and gateway: Vostio, Salto KS, dormakaba Ambiance Cloud, Nuki. Hotels with Visionline, Salto Space, on-premises Ambiance or Onity OnPortal stay on "collect at reception" unless they accept a bridge program on their existing lock computer.

4. **Start with an aggregator as the first adapter, on two conditions.** Seam is the only option found that documents card encoding, kiosk use, mobile keys, PIN and room changes for Vostio, Salto and dormakaba in one public API. One integration replaces three or four vendor programmes whose terms are not public.
   - Condition A: data protection. European hosting and a data processing agreement must be confirmed. **UNVERIFIED** today.
   - Condition B: price. The list price of 5 US dollars per device and month, and the limit of 5 actions per device and day, must be negotiated for hotels.
   - If either fails, build direct adapters in this order: Vostio Guest API (the hotel can create credentials itself), then Salto KS Connect API (public documentation, client ID from Salto).

5. **Offer these key modes per property**, matching the existing setting:
   - Digital Key: app-less link or wallet key. Works for self check-in with no hardware in the lobby.
   - Door PIN: only for Salto KS and Nuki properties.
   - Kiosk key-card encoder: only where the lock system has a network encoder that the cloud can address.

6. **Run a pilot before any commitment.** One Vostio hotel and one Salto KS hotel. Nothing in this document was tested against hardware.

Confidence: medium. The lock behaviour (sections 4, 5, 7) rests on vendor manuals and is solid. The choice of aggregator rests on the aggregator's own documentation and on unpublished vendor terms.

## 9. Constraints on check-in, room move, extension, no-show and check-out

**Check-in**

1. A key can be issued only after a room is assigned. A key is bound to doors and a time window [S-KS3][A-VO1]. A guest in the state "Arrived, waiting for room" gets no key.
2. Issuing the key is a separate step after the reservation becomes Checked-in. A failed key must not undo the check-in. It leads to the screen "Reception will help you" and an alert.
3. The PMS sends an explicit start and end time in the property's time zone. Vendor defaults differ (Salto Space 12.00, Vostio a property setting) [S-SP4][A-VO1].
4. For cards, the PMS must name the encoder. Each desk workstation and each kiosk needs an encoder setting [A-VO3][S-SP2][SE-11].
5. The encoder must be a network encoder known to the lock system. USB encoders do not work [S-SP2].
6. The screen may say "take your card" only after the lock system confirms success. "No card on encoder" must lead to a retry [SE-11].
7. Extra cards for the same stay are issued as copies (joiner), never as new keys. A new key invalidates the earlier cards at the door [A-VO1][S-SP5].
8. A mobile key needs the guest's phone to be online at delivery, and delivery can take up to a minute [S-SP4][A-VO1].
9. The property must hold the vendor licences for the chosen key mode. The PMS needs a per-property setup check [SE-12][S-SP2].

**Room move**

10. With cards on offline locks, a room move requires the guest to get the card rewritten at a desk or kiosk [SE-17]. The PMS creates a "key update needed" task.
11. Card update at the door works only with online locks and extra vendor conditions. Vostio: one room at a time, not with MIFARE Plus cards, enabled on request [A-VO4].
12. The key for the old room keeps working on an offline lock until its expiry or until a newer key is used at that door [A-VO1][S-SP5]. The old room must not be treated as secured by the move alone.
13. While a key is re-programmed it is briefly invalid [SE-17]. A move should be done with the guest present or informed.

**Extension and late check-out**

14. Same rule as room move: mobile keys and PINs follow automatically, cards on offline locks need a rewrite [SE-17][A-VO1].
15. Without the rewrite the guest is locked out at the original expiry time. The PMS must warn staff at the moment of the extension.
16. Frequent changes count against plan limits (Seam: 5 actions per device and day on the lower plan) and lock memory (Nuki: 100 or 200 authorizations) [SE-18][N-1].

**No-show and cancellation**

17. No key exists before presence is proven, as decided for self check-in. A no-show then needs no lock action.
18. If a property sends mobile keys or PINs before arrival, their validity must start at check-in time, and no-show or cancellation must revoke them. Cards must never be pre-written for guests who have not arrived (**Inference** from 5.3: an offline lock cannot be told to reject them).

**Check-out**

19. Check-out revokes mobile keys and PINs at once. Cards on offline locks stay valid until the expiry written on them or until the next guest's key is used [S-SP5][A-VO1].
20. So the expiry time written at issue is the real security limit. The PMS writes the planned departure time, never a later buffer.
21. An early departure leaves a working card in circulation until the original expiry. Where this matters staff must cancel at the lock; the PMS shows the vendor status 'Manual cancellation needed' [A-VO1].
22. The next guest's key must be issued as a new key so that it invalidates earlier cards at first use [S-SP5].

**All flows**

23. The PMS keeps its own record of every key event (who, which room, which encoder or channel, when, result). Vostio deletes expired keys after 30 days [A-VO1].
24. If the internet, the lock cloud or the aggregator fails, no new key can be made through the PMS. Each property needs a written manual procedure in the vendor's own tool, and the PMS needs a way to record "key issued manually" [A-VO1].
25. Remote unlock from the PMS is possible only on online locks and not on dormakaba Ambiance [S-KS3][SE-6]. It cannot be a general fallback.

## Sources

All retrieved 2026-09-29.

Salto
- [S-KS1] Salto KS Connect API, overview. https://developer.saltosystems.com/ks/connect-api/
- [S-KS2] Salto KS Connect API, integration types. https://developer.saltosystems.com/ks/connect-api/integration-types/
- [S-KS3] Salto KS, Granting user access via the Connect API. https://developer.saltosystems.com/ks/guides/granting-user-access-ks/
- [S-KS4] Salto KS, General information and a guide to access methods. https://support.saltosystems.com/ks/general/general-information/
- [S-KS5] Salto, Your ultimate guide to offline access in Salto KS. https://saltosystems.com/en/blog/your-ultimate-guide-offline-access-salto-ks/
- [S-SP1] Salto Space Hospitality API. https://developer.saltosystems.com/space/hospitality-api/
- [S-SP2] Salto Space, PMS tab in General options. https://support.saltosystems.com/space/user-guide/operator/general-options/pms/
- [S-SP3] Salto Space, Introduction to the hotel interface. https://support.saltosystems.com/space/user-guide/operator/hotel/introduction/
- [S-SP4] Salto Space, check-in process. https://support.saltosystems.com/space/user-guide/operator/hotel/check-in/
- [S-SP5] Salto Space, check-out process. https://support.saltosystems.com/space/user-guide/operator/hotel/check-out/
- [S-TP] Salto launches integrated Technology Partner Program (2022-07-08). https://saltosystems.com/en/blog/salto-launches-integrated-technology-partner-program/

Assa Abloy
- [A-VO1] Setup and User Guide Vostio. https://docs.vostio.assaabloy.com/setup_user_guide/
- [A-VO2] Vostio Online. https://docs.vostio.assaabloy.com/vostio_online/
- [A-VO3] User Manual ASSA ABLOY PMS Converter 4020 (September 2024). https://docs.vostio.assaabloy.com/pdf/pms_manual/
- [A-VO4] Preparation Guide for Business Units, Vostio Room Move/Extension of Stay (July 2025, labelled Internal). https://docs.vostio.assaabloy.com/pdf/preparation_guide_for_BUs_room_move/
- [A-VO5] User manual ASSA ABLOY Encoder 4010. https://docs.vostio.assaabloy.com/pdf/encoder_manual/
- [A-BR] ASSA ABLOY Global Solutions, Hospitality brochure EMEIA. https://www.assaabloy.com/uk/en/documents/cdw/Hospitality_Brochure_EMEIA_English.pdf

dormakaba
- [D-1] Ambiance Cloud product page. https://www.dormakaba.com/ie-en/offering/products/lodging-systems/access-management-systems/ambiance-cloud-access-management-software--dk_100100
- [D-2] Mobile Access Integrator Program. https://www.dormakaba.com/us-en/offering/products/lodging-systems/lodging-systems-mobile-access-solutions/maip-third-party-integrators--ka_500092

Onity
- [O-1] OnPortal front desk systems. https://buildings.honeywell.com/us/en/brands/our-brands/onity/what-we-do/electronic-locking-systems/front-desk-systems
- [O-2] DirectKey. https://buildings.honeywell.com/us/en/brands/our-brands/onity/what-we-do/mobile-access/direct-key

Häfele
- [H-1] apaleo store, Häfele Dialock. https://store.apaleo.com/apps/haefele-dialock
- Not retrievable (HTTP 403): https://www.hafele.com/us/en/info/about-haefele/haefele-exclusive/haefele-dialock/dialock-faqs/94521/ and https://www.hafele.com.de/en/product/dialock-software-generation-2-sw-200-control-sw-300-hotel-or-sw-400-professional/P-01238814/

Nuki
- [N-1] Nuki API, Key API Concepts. https://docs.nuki.io/guide/overview/concepts/
- [N-2] Nuki Smart Hosting pricing. https://nuki.io/en-at/discover-nuki/for-your-vacation-rental/pricing

Seam
- [SE-1] ASSA ABLOY Visionline Access Control System. https://www.seam.co/docs/device-and-system-integration-guides/assa-abloy-visionline-access-control-system
- [SE-2] Hospitality guide, Setting Up the Hotel Site. https://www.seam.co/docs/industry-guides/hospitality-industry-guide/setting-up-the-hotel-site
- [SE-3] Seam Bridge. https://www.seam.co/docs/capability-guides/seam-bridge
- [SE-4] Hospitality guide, Feature Overview. https://www.seam.co/docs/industry-guides/hospitality-industry-guide/feature-overview
- [SE-5] Hospitality guide, Additional Guest Access Actions. https://www.seam.co/docs/industry-guides/hospitality-industry-guide/additional-guest-access-actions
- [SE-6] Dormakaba Ambiance Access Control System. https://www.seam.co/docs/device-and-system-integration-guides/dormakaba-ambiance-access-control-system
- [SE-7] Dormakaba Ambiance Setup Guide. https://www.seam.co/docs/device-and-system-integration-guides/dormakaba-ambiance-access-control-system/dormakaba-ambiance-setup-guide
- [SE-8] Salto KS Access Control System. https://www.seam.co/docs/device-and-system-integration-guides/salto-ks-access-control-system
- [SE-9] Nuki Locks. https://www.seam.co/docs/device-and-system-integration-guides/nuki-locks
- [SE-10] Hospitality guide, Granting Access Using Encoded Plastic Key Cards. https://www.seam.co/docs/industry-guides/hospitality-industry-guide/granting-access-using-encoded-plastic-key-cards
- [SE-11] Using Key Cards. https://www.seam.co/docs/use-cases/granting-access/using-key-cards
- [SE-12] Setting Up Your Site for Instant Keys. https://www.seam.co/docs/use-cases/granting-access/instant-keys/setting-up-your-site-for-instant-keys
- [SE-13] Hospitality guide, Seam API Overview. https://www.seam.co/docs/industry-guides/hospitality-industry-guide/seam-api-overview
- [SE-14] Vostio Setup Guide. https://www.seam.co/docs/device-and-system-integration-guides/assa-abloy-vostio-access-control-system/vostio-setup-guide
- [SE-15] Salto ProAccess Space Access System. https://www.seam.co/docs/device-and-system-integration-guides/salto-proaccess-space-access-system
- [SE-16] Documentation index of guides. https://www.seam.co/docs/_llms/guides.md
- [SE-17] Managing Access Grants. https://www.seam.co/docs/use-cases/granting-access/managing-access-grants
- [SE-18] Pricing. https://www.seam.co/pricing
- [SE-19] Device and system integration guides, list of supported systems. https://www.seam.co/docs/device-and-system-integration-guides

Other aggregators
- [F-1] FLEXIPASS home page. https://flexipass.tech/
- [G-1] Goki home page. https://www.gokitech.com/
