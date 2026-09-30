# Door lock systems common in German hotels, and how an established PMS reaches them

Researched: 2026-09-29. Ticket: `.scratch/hotel-pms-v1/issues/62-german-lock-market-research.md`.
Extends `docs/research/door-lock-integration.md` (cloud lock APIs, key flows, Seam). That file is not repeated here; its source tags (e.g. [S-SP2], [SE-2]) are reused where cited.

Method: integration lists and help articles of PMS vendors, lock vendors and middleware vendors were downloaded directly (curl) and read as raw text; quotes are verbatim from that text. Only one summarising fetch was attempted (Häfele, refused), so no statement here rests on a machine summary. The session's web search budget was already used up, so sources were found by following links from vendor sites, sitemaps, embedded page data and the public Zendesk API of the Cloudbeds help centre, not by search. Tags in square brackets point to the source list at the end; tags like [S-SP2], [A-BR], [SE-2], [O-1], [D-1], [N-1] refer to the source list of `door-lock-integration.md`. **UNVERIFIED** marks points no primary source could confirm. **Inference** marks conclusions drawn here.

**Market share is not measured anywhere in this document.** Section 2 counts how often a vendor appears in integration lists. That is the best available proxy, and a weak one.

## 1. Lock vendors supported per PMS

Each list below was read from the PMS vendor's own integration page (raw page text, not a summary). A listing proves that an integration exists or is announced. It does not prove how many hotels use it.

### 1.1 SIHOT (GUBSE AG)

SIHOT's integration finder, category "Hotel Operations", sub-label "Access Systems", lists these lock systems [SH-1][SH-2]:

- dormakaba
- Vingcard (ASSA ABLOY)
- Vostio by Assa Abloy ("a cloud-based guest access service")
- Salto SPACE
- OnPortal by Onity. The page adds: "DirectKey™ mobile key solution (currently not integrated with Sihot)"
- TESA (ASSA ABLOY)
- Messerschmitt ("MESSERSCHMITT Systems, an ASSA ABLOY company ... 'made in Germany'")
- Hotek
- OS ACCESS by Omnitec
- Secom Access Management Solution
- "Keycard PIN Code Generator" by Key & Card AG: "Compatible with various locking systems via hotelplatform.io". Key & Card says its systems run "lokal vor Ort (on premise) oder cloudbasiert"

The raw page text shows the string "COMING SOON" before every entry in the category, including SIHOT's own modules, so it is read here as a page template element, not as a status; the actual status of each integration is **UNVERIFIED**.

The category "Check-in Experience" adds middleware: "char pmslink": "pmslink integrates SIHOT.PMS with more than 150 hotel equipment and systems: PBX, Keycard, Key Mobile Accesses, ..." [SH-3].

**What the "built-in lock function" in SIHOT is.** No SIHOT page found describes a lock system made by SIHOT. SIHOT's own products are PMS modules; the kiosk module says guests "erhalten Schlüsselkarte oder einen mobilen Zugang" [SH-4], and SIHOT's finder shows the locks as partner integrations with a "Connect to SIHOT" request form [SH-2]. **Inference**: a hotel that "has the lock function built into SIHOT" most likely runs one of the listed lock systems with its SIHOT interface, so that staff encode cards from the SIHOT screen. Which vendor a given SIHOT hotel uses has to be asked per hotel. How SIHOT physically connects to on-premises lock servers (SIHOT is also sold as an on-premises and hosted product) is **UNVERIFIED**; no public SIHOT interface specification was found.

### 1.2 Stayntouch

Stayntouch's integrations page [ST-1] has two lists.

Category "Access Management & Door Locks" (direct cloud integrations): "Salto and Salto mobile", "Dormakaba Saflok", "Ving Vingcard", "4Suites", "Lynx", "Dormakaba Ambiance", "Zaplox", "Openkey", "Intelity Keypr", "AXBase 3000", "Concept 4000", "devicethread", "Portal by Goki", "ASSA ABLOY Hospitality".

A second list headed "Keyless Entry/Door Locks | comtrol" names the legacy lock interfaces reached through Comtrol. Entries include "Hafele | All", "Messerschmitt Systems GmbH | MSTPmsService 1.0.6", "Salto | Hams V1.3", "Salto | Industry Standard V 1.9", "VingCard | Visionline", "VingCard | Vision 5.x TCPIP", "VingCard | Vision 5.x Serial", many "Kaba – ILCO" and "Saflok" versions, "ONITY (formerly TESA Entry Systems) | HT24", "Timelox | DC One (PMS Plus)", "CISA | CS9500", "Miwa Lock Co., LTD. | AL5HP", "NSP Europe | SIL01 Hotel Lock Management system" [ST-1].

Stayntouch states how it reaches these: "Some systems—especially older hardware or specialized accounting tools—require a 'translator' to talk to the cloud. We use industry-leading partners like COMTROL (for legacy door locks and PBX phone systems) ... to act as a secure bridge. This allows you to keep your existing hardware while still enjoying the benefits of a modern mobile PMS." [ST-1]

### 1.3 Mews

Lock-related apps found in the Mews marketplace sitemap and read on their pages [MW-1..MW-9]: Vostio; Seam; Omnitec; "HOTEK YourMobileKey" (slug `guestkey-by-hotek`); Mews Digital Key; Char PMSLink - HMobile Connect; Inlet Cloud Access Hub; LoxHub; Lockvision; plus in the sitemap only (pages not read): Goki, FLEXIPASS, OpenKey, Zaplox, Tapkey, RemoteLock, Pindora, KAS Keyless Access Security, Keycafe, Vikey, Valnes Weblock, entrykey.

- Mews Digital Key: "Mews Digital Key currently supports Assa Abloy Vingcard (Vostio & Visionline) and Salto Space door locks." [MW-5] Visionline and Salto Space are on-premises systems (see `door-lock-integration.md` 2.2, 2.4). How Mews reaches them is on a help page that could not be retrieved (help.mews.com returned 404 and a script-only page): **UNVERIFIED**.
- Omnitec: "an interface application for cutting keys from Mews, which can be up and running for any property in minutes using any Windows desktop"; "With an off-line Omnitec software such as OS ACCESS DESKTOP or SMARTPASS, the hotel is able to only cut proximity card keys." [MW-4] This is a Windows program at the hotel.
- Char PMSLink / HMobile connect: "a middleware that makes possible the integration of MEWS with hundreds of hotel equipment and systems" [MW-3]. The lock list on that page was cut off in the page text; **UNVERIFIED** which locks.
- Vostio: "Issue room keys for guests directly from Mews"; "Enable your guests to easily create room keys for themselves when checking-in on the Mews Kiosk" [MW-1].
- Seam: "Manage multiple lock brands and access systems through one unified interface" [MW-2].
- No marketplace page for Salto KS, dormakaba, Onity, Häfele or Nuki was found in the Mews English sitemap (980 marketplace slugs searched) [MW-0]. Absence from the sitemap is not proof of no integration.

### 1.4 apaleo

apaleo store, subcategory "Door locks & Keycard encoders", lists seven apps [AP-1]: keyota (keyota GmbH, DE), EULEKTRO/EVesto E-Charging platform (not a lock), "char pmslink / VConnect keycard" (char, ES), "Abitari Locks Connector" (Abitari, ES), BlueID (DE), "Häfele - DIALOCK" (Häfele, DE), Pindora (FI). Subcategory "Mobile key & keyless entry" adds Portal (Goki), Hotel-Doorman, Tuya Hotel, "Guestkey by Hotek" [AP-2].

apaleo itself lists no direct integration with Assa Abloy, Salto, dormakaba or Onity. Those are reached through the two connector apps:

- char pmslink / VConnect keycard: "compatible with different Door Lock Systems providers: ASSA ABLOY - Vingcard / Vostio; ASSA ABLOY - Vingcard / Visionline; DORMAKABA - Ambiance; SALTO ProAccess Space; ONITY; TESA SMARTair *; HOTEK; HCS by Airvent; AXESS Hospitality (DOM); BTV; and more" (* "only PIN codes supported"). Price: 7.50 EUR per room per year, plus "One time fee payment: Remote onboarding / installation (€400)" [AP-3].
- Abitari Locks Connector: "Compatibilities: Assa Abloy, Salto, Onity, Hotek, Tesa, TLJ, 4Suites". Price 0.50 EUR per room per month, "Minimum charge 100 rooms", installation support 450 EUR optional [AP-4].
- Häfele Dialock: the listing describes Dialock and says it is "Kombinierbar mit gängigen Hotelverwaltungssoftware-Programmen". It does not say how it connects [AP-5].

### 1.5 Cloudbeds

Cloudbeds help centre, "Access Management and Door Locks Apps" (updated 2026-09-22) lists [CB-1]: Ambiance by Dormakaba; Check Inn Kiosk; Dekkson, E-Lock, GreatLock, JVD, MasterControls, "Onity by Mecx-Tech", Orbita, proUSB (all "by Mecx-Tech"); Devicethread; Dwarpaal Connect; EntryReady; Flexipass; Goki; Homeit; Hostkit; Infologic; Jervis Systems; KASAccess; Lynx; Omnitec; OpenKey; Operto; Roommatik; Sezam24; SmartCheck by Liverton; SuiteOp; Trevo by Gtriip; True Omni; Valnes Weblock; Vendfun; Vikey; "Visionline by Assa Abloy"; Vouch; Yacan. Salto Space has its own help articles [CB-4] and marketplace page [CB-5].

How Cloudbeds reaches on-premises lock servers, in its own words:

- Visionline: "you will need to install the Cloudbeds Integrator app on your Windows computer. This app enables Visionline and Cloudbeds to communicate. It is highly recommended to install the integrator application on the same machine that is running the Visionline software." Service URL `https://localhost` or `https://<ip_address>` of the Visionline machine; login with the Visionline user name and password [CB-2].
- dormakaba Ambiance: same Cloudbeds Integrator, "highly recommended to install the integrator application on the same machine that is running the Dormakaba software" [CB-3].
- Salto Space: "The Cloudbeds Bridge app is crucial for enabling communication between your local Salto Space application and the cloud-based Cloudbeds system. Install the cloudbeds-bridge-latest.msi file onto the computer." In Salto Space the "Industry Standard" PMS line is enabled on a TCP port ("We recommend using 7070"); the bridge is set to host `https://127.0.0.1` and that port; encoders are added by numeric "Encoder ID" [CB-4].
- Onity: "guest profiles are securely transmitted to the locking system using HTTPS encryption"; "Licensing is based on room count" [CB-6]. The listing name "Onity by Mecx-Tech" [CB-1] shows a third party in between. Whether anything runs at the hotel is **UNVERIFIED**.

### 1.6 Oracle OPERA (OPERA V5 and OPERA Cloud)

Oracle publishes no list of lock vendors on a public page that could be found. It does publish how OPERA, including OPERA Cloud, reaches lock systems and other property devices: the Hotel Property Interface (IFC8).

- "The Oracle Hospitality Hotel Property Interface installs on-premise to establish and maintain communication with third-party systems and Oracle Hospitality Suite8 or Oracle Hospitality OPERA Property Management System." Supported: "Oracle Hospitality OPERA Cloud release 21.x and higher". Operating systems: Windows 11 Professional, Windows Server 2016 to 2025, with ".NET10.0 Desktop Runtimes x86 required" [OR-1].
- "The Ifc8OperaConnector is used to communicate between each IFC8 instance and the Opera PMS Web Service. It is used to receive actions from OPERA like check-in/checkout notification, Key requests, Credit card requests pass these to the individual vendor software's and relay the responses back to the PMS." Its configuration has a "URL: The Opera URL that services connect to" and optional "Proxy" [OR-2].
- "Oracle recommends installing a maximum of 25 IFC8.NET instances on one Server." [OR-1]
- For Suite8 (Oracle's on-premises PMS widespread in German-speaking hotels), IfcBusi.dll must be on every workstation that issues keys; "For connections with Opera PMS / Opera Cloud the installation of IFCBusi.Net.dll on the Opera Workstations is NOT necessary." [OR-3]

**Inference**: Oracle's own cloud PMS does not reach on-premises lock servers from the cloud. It places a Windows interface server at the hotel that connects outwards to the OPERA web service and inwards to the lock vendor's software. "FIAS" is the protocol lock vendors implement towards this interface (Salto Space lists "Oracle Hospitality PMS (FIAS)" [S-SP2 in door-lock-integration.md]). The FIAS specification itself was not retrieved: **UNVERIFIED** beyond these references.

### 1.7 protel (Planet)

**UNVERIFIED.** Every protel.net page tried (`/de/partners`, `/de/hotel-pms`, `/marketplace`) returned the same generic Planet page with no integration list, and help.protel.net returned a near-empty page [PR-1]. No public protel lock list was found. Third-party lists do name protel as a PMS partner, but those were not read.

### 1.8 CASABLANCA hotelsoftware

CASABLANCA's integrations page has a category "Schließanlagen" [CA-1], but its partner list is loaded by script and was not in the downloaded page; the site's sitemap has no page per integration. Which lock vendors CASABLANCA supports: **UNVERIFIED**.

### 1.9 ibelsa (German cloud PMS, added because it is a German cloud example)

ibelsa's category "Schließanlagen / Kiosk" lists these lock makers [IB-1]: ASSA ABLOY Global Solutions; Häfele; Hotek; Key & Card; LMS & IT GmbH Schließsysteme; Messerschmitt Systems; Omnitec; Salto; Schulte-Schlagbaum (SAFE-O-TRONIC); TESA. The rest are kiosks and guest apps (Ariane, Check 24-7 In, Helloguest, masunt, onstay, Roommatik, sezam 24, straiv, Betterspace).

Details quoted from the same page:
- Salto: "Schnittstelle: Senden der Zutrittsrechte an die Software ProAccess SPACE, mit der Key Cards codiert werden. Außerdem Senden der Zutrittsrechte als mobile Schlüssel direkt an die JustIN Mobile App".
- ASSA ABLOY: "Schnittstelle: An- und Abreisedatum des Hotelgastes, Zimmernummer"; products "Lokale oder Cloud-basierende Hotelschließsystemsoftware".
- Messerschmitt Systems and Omnitec: "Nur in Kombination mit Key & Card Hotelplattform: Durch die Integration können Schließanlagen von ... direkt über ibelsa gesteuert werden."

### 1.10 hetras, Gubse, hotelkit

- hetras: www.hetras.com did not answer (connection failed) [HE-1]. hetras is now part of Shiji; no lock list was found: **UNVERIFIED**.
- GUBSE AG is the company behind SIHOT (SIHOT's press list: "gubse-ag-schliesst-sicherheitsluecken") [SH-6]; covered by 1.1.
- hotelkit is a staff collaboration tool, not a PMS; it appears in SIHOT's list as a non-lock partner [SH-1]. No lock relevance found.

## 2. Frequency across PMS lists and trade sources

**This is a proxy, not market share.** No source found publishes installed-base numbers or market share for hotel locks in Germany. The count below says how many of the integration lists read here name a vendor. A vendor listed everywhere is one that PMS vendors find worth integrating, which suggests demand; it says nothing about how many German hotels use it.

German trade sources: site searches on tophotel.de, ahgz.de and hottelling.net returned no usable result lists (script-rendered or "ergab keinen Treffer") [TP-1]. The web search budget of this session was used up before this ticket, so no DEHOGA or trade-press article could be located. Trade-press frequency: **UNVERIFIED**. Two German sources were used instead: the lock list of the German cloud PMS ibelsa [IB-1] and the German lock maker Messerschmitt's own PMS list [MS-1].

Legend: Y = listed; C = reachable only through a connector listed there (char, Abitari, Comtrol, Key & Card); - = not found in that list; ? = list not retrievable. "Vingcard" entries that do not name the product are counted under Visionline and marked (g) for generic.

| Lock system | SIHOT [SH-1] | Stayntouch [ST-1] | Mews [MW-*] | apaleo [AP-*] | Cloudbeds [CB-1] | ibelsa [IB-1] | Seam [SE-19] | char [AP-3] | Count of PMS lists (of 6) |
|---|---|---|---|---|---|---|---|---|---|
| ASSA ABLOY Vingcard **Visionline** | Y (g) | Y (Comtrol "VingCard / Visionline") | Y (Digital Key) | C | Y | Y (g, "ASSA ABLOY Global Solutions") | Y | Y | 6 |
| **Salto Space** | Y | Y (Comtrol "Salto / Industry Standard"; "Salto and Salto mobile") | Y (Digital Key) | C | Y | Y | Y | Y | 6 |
| **dormakaba Ambiance** | Y (g, "dormakaba") | Y | - | C | Y | - | Y (guide [SE-6] in door-lock-integration.md; not in the index card list read today [SE-19]) | Y | 4 |
| **Onity** (OnPortal) | Y | Y (Comtrol, HT-series) | - | C | Y ("by Mecx-Tech") | - | - | Y | 4 |
| **Hotek** | Y | - | Y (mobile key) | Y (mobile key) and C | - | Y | - | Y | 4 |
| ASSA ABLOY **Vostio** (cloud) | Y | ? ("ASSA ABLOY Hospitality", product not named) | Y | C | - | (g) | Y | Y | 3 to 5 |
| **TESA** (ASSA ABLOY) | Y | - | - | C (char: SMARTair PIN only; Abitari "Tesa") | - | Y | - | Y | 3 |
| **Messerschmitt** (ASSA ABLOY, German) | Y | Y (Comtrol "MSTPmsService") | - (logo on Messerschmitt's own list [MS-1]) | - | - | C (Key & Card) | - | - | 3 |
| **Omnitec** | Y | - | Y (Windows interface) | - | Y | C (Key & Card) | - | - | 4 |
| **Häfele Dialock** (German) | - | Y (Comtrol "Hafele / All") | - | Y | - | Y | - | - | 3 |
| Key & Card (Swiss) | Y | - | - | - | - | Y | - | - | 2 |
| Schulte-Schlagbaum SAFE-O-TRONIC (German) | - | - | - | - | - | Y | - | - | 1 |
| Secom | Y | - | - | - | - | - | - | - | 1 |
| Salto KS (cloud) | - | ? ("Salto and Salto mobile") | - | - | - | - | Y | - | 0 to 1 |
| Nuki | - | - | - | - | - | - | Y | - | 0 |
| Glutz eAccess, SimonsVoss | - | - | - | - | - | - | - | - | 0 |

Notes on the table:
- Oracle OPERA, protel and CASABLANCA could not be counted (no public list, section 1).
- Messerschmitt's own "PMS Interface" section shows logos whose file names are `oracle-hospitality.svg`, `protel_logo`, `mews-logo`, `stayntouch`, `infor` [MS-1]. Its "Keycard Interface" section says: "Anbindung über Room-Level- oder Server-Server-Interface an Lösungen von Salto (ab 2023 zusätzlich an Dormakaba sowie VingCard von Assa Abloy)" [MS-1]. So Messerschmitt also acts as a room-management layer next to other lock brands.
- Glutz, SimonsVoss and Nuki were named in the ticket but appear in none of the hotel PMS lists read. Glutz sells "eAccess Cloud" for browser management [GL-1]; its hotel page speaks of interfaces in general terms only [GL-2]. SimonsVoss: no hotel page found (404) [SV-1]. **Inference**: these are general building or apartment systems, not typical hotel guest-room systems in the PMS market.

## 3. Per vendor: deployment, interface, cloud reach, practice

"Reachable without software at the hotel" means: can a cloud PMS in a data centre call it directly, with nothing installed on the hotel network beyond the lock vendor's own hardware. Details already in `door-lock-integration.md` are only referenced.

| Lock system | Where the lock software runs | Interface a PMS uses | Reachable from a cloud PMS without on-site software | What cloud PMS vendors do in practice |
|---|---|---|---|---|
| Vingcard **Visionline** | Local server at the hotel [A-BR, SE-1 in door-lock-integration.md] | Web service on the Visionline server, logged in with a Visionline user (Cloudbeds: Service URL `https://localhost` or the server's IP) [CB-2]; legacy serial and TCP/IP "Vision" interfaces (Stayntouch/Comtrol list "Vision 5.x Serial", "Vision 5.x TCPIP") [ST-1]; Oracle IFC8 at the hotel [OR-1] | **No** | Cloudbeds: own Windows "Cloudbeds Integrator" on the Visionline machine [CB-2]. Stayntouch: Comtrol [ST-1]. apaleo: char pmslink [AP-3]. Seam: Seam Bridge [SE-2]. Mews: supported, method **UNVERIFIED** [MW-5] |
| Vingcard **Vostio** | Vendor cloud | Vostio Guest API [A-VO1] | **Yes** | Direct cloud integration: SIHOT, Mews (incl. kiosk key creation) [SH-2][MW-1]; Seam; char |
| **Salto Space** | Windows server at the hotel [S-SP2] | "Industry Standard", "FIAS", "FOLS" over RS232 or TCP/IP [S-SP2]; Cloudbeds uses "Industry Standard" on TCP port 7070 [CB-4]; Salto HAMS (Stayntouch/Comtrol "Salto / Hams V1.3") [ST-1]; Hospitality API for Apple Wallet only [S-SP1] | **No** | Cloudbeds: "Cloudbeds Bridge" (`cloudbeds-bridge-latest.msi`) on the Salto machine [CB-4]. Stayntouch: Comtrol. apaleo: char or Abitari. ibelsa: "Senden der Zutrittsrechte an die Software ProAccess SPACE" [IB-1], method not stated. Seam: Seam Bridge |
| **Salto KS** | Vendor cloud | Connect API [S-KS1] | **Yes** | Seam [SE-19]. Rarely listed by the PMS vendors read |
| **dormakaba Ambiance** (on-premises) | Server at the hotel [SE-7] | REST and SOAP on the Ambiance server [SE-7]. FIAS is documented only for Ambiance Cloud [D-1]; for on-premises Ambiance **UNVERIFIED** | **No** | Cloudbeds: Cloudbeds Integrator on the Ambiance machine [CB-3]. apaleo: char. Seam: Seam Bridge |
| dormakaba **Ambiance Cloud** | Vendor cloud plus gateway [D-1] | "FIAS, Ambiance SOAP, and REST APIs" [D-1] | Yes per vendor claim; API **UNVERIFIED** | No PMS list read names Ambiance Cloud separately |
| **Onity OnPortal** | Windows PC at the front desk [O-1] | On-site "Multi-thread" PMS interface, or Onity CloudConnect [O-1]; Comtrol lists HT22/HT24/HT28W [ST-1] | Only via CloudConnect; details **UNVERIFIED** | Cloudbeds: "Onity by Mecx-Tech", "transmitted to the locking system using HTTPS" [CB-6]; Stayntouch: Comtrol |
| **Hotek** | Card system: **UNVERIFIED**. Mobile key "YourMobileKey" is a cloud service, "the next generation of Cloud Low Energy controller (CLE©)" with "open API for 3rd parties" [MW-6] | Mobile key: cloud API from the PMS [MW-6]; card encoding via char or Abitari [AP-3][AP-4] | Mobile key: yes. Cards: **UNVERIFIED** | Mews and apaleo: cloud mobile key app; cards through connectors |
| **TESA** (ASSA ABLOY) | **UNVERIFIED** (tesa.es returned an empty page) | char: SMARTair "only PIN codes supported" [AP-3] | **UNVERIFIED** | Connectors (char, Abitari) |
| **Messerschmitt** | Three variants: "HOCAS" desktop software, "Web HOCAS" ("Zentral gespeichert"), "Cloud HOCAS" ("Speicherung aller system- und sicherheitsrelevanten Daten in der Cloud") [MS-1] | "MSTPmsService" (Comtrol list) [ST-1]; via Key & Card Hotelplattform (ibelsa) [IB-1]; API of Cloud HOCAS: **UNVERIFIED** | HOCAS/Web HOCAS: **No** (Inference: local software). Cloud HOCAS: probably, **UNVERIFIED** | Stayntouch: Comtrol. ibelsa: Key & Card |
| **Häfele Dialock** | **UNVERIFIED**. All Häfele sites refused access (HTTP 401/403) [HF-1] | Comtrol lists "Hafele / All" [ST-1], which suggests a classic on-site PMS link | **UNVERIFIED**, probably no | Stayntouch: Comtrol. apaleo and ibelsa list it without saying how |
| **Omnitec** | "OS ACCESS CLOUD" (cloud) or "OS ACCESS DESKTOP or SMARTPASS" (offline, local) [MW-4] | Mews: "an interface application for cutting keys from Mews ... using any Windows desktop" [MW-4] | Cloud edition: **UNVERIFIED**. Desktop edition: **No** | Mews: Windows app at the hotel. ibelsa: via Key & Card |
| **Key & Card** | "lokal vor Ort (on premise) oder cloudbasiert" [SH-2] | hotelplatform.io (Key & Card Hotelplattform) [SH-1][IB-1] | Cloud variant: probably; **UNVERIFIED** | SIHOT and ibelsa connect other locks (Messerschmitt, Omnitec) through it |
| **Nuki** | Vendor cloud | Nuki Web API [N-1] | Yes | Seam; no hotel PMS list read names Nuki |

### What the middleware products do

| Product | What is at the hotel | Source |
|---|---|---|
| Cloudbeds Integrator / Cloudbeds Bridge | Windows program from Cloudbeds, "highly recommended" on the lock server PC | [CB-2][CB-3][CB-4] |
| Oracle IFC8 + Ifc8OperaConnector | Windows interface server, "installs on-premise", up to 25 interface instances per server | [OR-1][OR-2] |
| Comtrol Lodging Link CC | "a Windows Service-based application with a web-based user interface. LLCC can be installed on a property's PC or in the cloud"; "It is recommended to use a dedicated PC or virtual machine ... can also be installed on a shared machine such as the PMS or GSS server"; Windows Server 2012 R2 or later; serial port hardware (DeviceMaster) for serial locks. Claims connectivity "to over 720 (and growing) GSS interfaces" and offers a "web-based HTTP API (REST/JSON) for your cloud-based system" | [CT-1][CT-2][CT-3] |
| char pmslink / VConnect | "Facilitates Cloud PMS access to local servers: The PMS will make an http request to the key card recording endpoint ... to carry out the process against the server of the electronic lock system". Sold as "SaaS / Cloud" or "Software Subscription / On-premise". "pmslink cloud": "no need to install anything in the hotel" and "Possibility to connect on-premise equipment to pms cloud" without saying how. UI inside the PMS as an iframe | [CH-1][CH-2][AP-3] |
| Abitari Locks Connector | Not stated; "Self installation inside Apaleo UI" | [AP-4] |
| Seam Bridge | Program "on a computer within the same local network as the access system" (Windows, macOS, Linux) | [SE-2][SE-16] |

**Inference**: no source describes any way to reach Visionline, Salto Space, on-premises Ambiance or OnPortal from the cloud without a program on the hotel network. char's "no infrastructure in the hotel" claim is made for cloud access systems; for on-premises locks the same page only says a connection is "possible". Every cloud PMS whose method is documented (Cloudbeds, Stayntouch, Oracle OPERA Cloud, and apaleo through its connector) puts a program on a hotel computer, usually the lock server itself.

## 4. Partner and certification terms (public ones only)

| Party | What is public | Source |
|---|---|---|
| SIHOT | Partner programme in three steps: "Bewerbung einreichen", "Verbindung aufbauen", "Lösung zertifizieren"; "Baue Deine Verbindung selbst mit unserer optimierten API und Testumgebung"; "180+ zertifizierte Integrationen". Terms and fees not published. The FAQ question "Ist die Zertifizierung für alle Partner verpflichtend?" has no answer in the page text | [SH-5] |
| char pmslink (via apaleo) | 7.50 EUR per room per year; one-time "Remote onboarding / installation (€400)". For lock makers: "Integration free of charge" | [AP-3][CH-1] |
| Abitari Locks Connector (via apaleo) | 0.50 EUR per room per month, "Minimum charge 100 rooms", "Billed annually"; optional installation support 450 EUR; "Free with Abitari kiosk" | [AP-4] |
| Cloudbeds, Visionline | "Once you agree on the pricing with the support team you will see the CONNECT APP button" | [CB-2] |
| Cloudbeds, Onity | "Licensing is based on room count" | [CB-6] |
| Comtrol | "PMS Developer Kit" with "software, samples, tools, and documentation"; prices not published | [CT-3] |
| Salto Space | PMS link is licence-dependent; licence codes in door-lock-integration.md section 6 | [S-SP2] |
| Assa Abloy, dormakaba, Onity, Häfele, Hotek, Messerschmitt, TESA | No public PMS partner terms found. Programmes named in door-lock-integration.md section 6 | **UNVERIFIED** |

## Ranked vendors for Germany with integration route

Ranking basis: count across the six PMS lists read (section 2), weighted up for vendors that German sources list (ibelsa, SIHOT, Messerschmitt's own list). This is a proxy for demand, not market share. Confidence in the order of places 1 to 4: medium. Places 5 onwards: low.

| Rank | Vendor and system | Deployment | Route for this project |
|---|---|---|---|
| 1 | ASSA ABLOY Vingcard **Visionline** | On-premises server | On-site agent next to the Visionline server, calling its web service; or Seam Bridge / char pmslink |
| 1 | ASSA ABLOY Vingcard **Vostio** (successor of Visionline) | Cloud | Direct: Vostio Guest API (already recommended in door-lock-integration.md) |
| 2 | **Salto Space** | On-premises Windows server | On-site agent speaking Salto's "Industry Standard" protocol over TCP (Cloudbeds' route [CB-4]); or Seam Bridge / char / Abitari |
| 2 | **Salto KS** | Cloud | Direct: Salto KS Connect API |
| 3 | **dormakaba Ambiance** | On-premises server (also Ambiance Cloud) | On-site agent calling Ambiance REST/SOAP; Ambiance Cloud directly once its API is confirmed |
| 4 | **Onity OnPortal** | Windows PC at the desk (CloudConnect optional) | CloudConnect if the hotel has it (terms **UNVERIFIED**); otherwise on-site agent or a connector (char, Comtrol, Mecx-Tech) |
| 5 | **Hotek** | Cards **UNVERIFIED**; mobile key in the cloud | Mobile key: Hotek cloud API. Cards: connector (char, Abitari) until Hotek's card interface is known |
| 6 | **Messerschmitt** (ASSA ABLOY, German) | HOCAS local, Web HOCAS, Cloud HOCAS | Local variants: on-site agent (protocol "MSTPmsService", spec not public). Cloud HOCAS: ask vendor for API. Alternative: Key & Card Hotelplattform |
| 7 | **Häfele Dialock** (German) | **UNVERIFIED**, probably on-site | Ask Häfele for the PMS interface spec; Comtrol supports it |
| 8 | **Omnitec**, **TESA** | Omnitec: cloud or desktop; TESA: **UNVERIFIED** | Omnitec cloud: ask vendor; desktop: on-site agent. TESA: connectors |
| 9 | Key & Card, Schulte-Schlagbaum, Secom | Mixed | Only on request |
| - | Nuki, Glutz, SimonsVoss | Cloud (Nuki, Glutz eAccess Cloud) | Not in any hotel PMS list read. Nuki only for apartments (door-lock-integration.md) |

**Inference on the owner's two examples**: the Radisson Blu on VingCard Visionline is rank 1 on-premises and needs the on-site component. The SIHOT hotel "with the lock function built in" is running one of the lock systems in SIHOT's partner list through its SIHOT interface (section 1.1); the lock itself must be identified per hotel, and if it is Visionline, Salto Space, Ambiance or OnPortal, it needs the same on-site component.

## Minimum on-site component for on-premises locks

**Verdict: on-premises lock systems cannot be served without a program on the hotel network.** No source describes any other way, and every cloud PMS whose method is documented installs one: Cloudbeds (Integrator and Bridge, Windows) [CB-2][CB-3][CB-4], Oracle OPERA Cloud (IFC8, Windows, "installs on-premise") [OR-1], Stayntouch (Comtrol "as a secure bridge") [ST-1], apaleo (through char pmslink, whose job is "Cloud PMS access to local servers") [CH-1]. Mews also supports Visionline and Salto Space, but its method could not be read [MW-5].

The minimum, derived from what these vendors do (**Inference**):

1. **One small agent program per hotel**, installed on the lock vendor's own server or front-desk PC (all vendors recommend that machine [CB-2][CB-3][CB-4]; Comtrol allows "a shared machine such as the PMS or GSS server" [CT-2]). No new hardware, and no server run by us at the hotel.
2. **Windows support is required**, because the lock software it sits next to is Windows (Salto Space, Onity OnPortal) [S-SP2][O-1] and every documented agent is a Windows program or service.
3. **Outbound connection only** from the agent to our cloud (as Oracle's connector does towards the "Opera URL" with an optional proxy [OR-2]), so the hotel opens no inbound firewall port. **Inference**; the vendors' firewall details were not published.
4. **Vendor protocols inside the agent**, one adapter each: Visionline web service (HTTPS on the lock server, Visionline user login) [CB-2]; Salto "Industry Standard" over TCP [CB-4][S-SP2]; Ambiance REST/SOAP [SE-7]; Onity and others per vendor specification. FIAS is the one protocol several vendors name (Salto Space, dormakaba Ambiance Cloud) [S-SP2][D-1]; the FIAS specification was not retrieved (**UNVERIFIED**).
5. **The agent drives encoders through the lock software**, not directly: the PMS names an encoder, the lock software writes the card (Cloudbeds' Salto setup maps a numeric "Encoder ID" [CB-4]; see door-lock-integration.md section 4).

**Buy instead of build**: the same component can be bought per hotel. char pmslink costs 7.50 EUR per room per year plus 400 EUR onboarding on apaleo, covers Visionline, Vostio, Ambiance, Salto Space, Onity, TESA SMARTair (PIN only) and Hotek, and embeds its key screen in the PMS as an iframe [AP-3]. Abitari costs 0.50 EUR per room per month, minimum 100 rooms [AP-4]. Comtrol Lodging Link CC offers a REST/JSON API for cloud PMS and claims over 720 interfaces, price not public [CT-1][CT-3]. Seam Bridge was covered in door-lock-integration.md (section 2.9), with its open data-protection question.

**Consequence for the architecture decision** "no local server at the hotel": the minimum component is a program on a computer the hotel already runs, not a server we supply. Whether that counts as a breach of the decision is for the owner to decide.

Confidence: high that on-premises locks need an on-site program (four independent vendors document it; none documents an alternative). Medium on the vendor ranking (proxy only; protel, OPERA and CASABLANCA lists missing; no trade-press data).

## Sources

All retrieved 2026-09-29 by direct download (curl) and read as raw page text unless marked otherwise.

SIHOT
- [SH-1] SIHOT integration finder, Hotel Operations. https://finder.sihot.com/categories/Hotel%20Operations.html
- [SH-2] SIHOT finder product pages: https://finder.sihot.com/products/Dormakaba , /Vingcard , /Vostio , /Salto_Systems , /Onity , /TESA , /Messerschmitt , /Hotek , /Omnitec , /Secom , /Key&Card
- [SH-3] SIHOT integration finder, Check-in Experience. https://finder.sihot.com/categories/Check-in%20Experience.html
- [SH-4] SIHOT PMS modules. https://sihot.com/de/produkte/pms-module/
- [SH-5] SIHOT, Partner werden. https://sihot.com/de/produkte/partner-werden/

Stayntouch
- [ST-1] Stayntouch PMS Integrations Hub. https://www.stayntouch.com/integrations/

Mews
- [MW-0] Mews English sitemap. https://www.mews.com/sitemaps/en.xml
- [MW-1] https://www.mews.com/en/products/marketplace/vostio
- [MW-2] https://www.mews.com/en/products/marketplace/seam
- [MW-3] https://www.mews.com/en/products/marketplace/char-pmslink-hmobile-connect
- [MW-4] https://www.mews.com/en/products/marketplace/omnitec
- [MW-5] https://www.mews.com/en/products/marketplace/mews-digital-key
- [MW-6] https://www.mews.com/en/products/marketplace/guestkey-by-hotek
- [MW-7] https://www.mews.com/en/products/marketplace/inlet-cloud-access-hub
- [MW-8] https://www.mews.com/en/products/marketplace/loxhub
- [MW-9] https://www.mews.com/en/products/marketplace/lockvision

apaleo
- [AP-1] apaleo store, Door locks & Keycard encoders. https://store.apaleo.com/operations/door-locks (app data read from the page's embedded JSON)
- [AP-2] apaleo store, Mobile key & keyless entry. https://store.apaleo.com/guest-experience/mobile-key-keyless-entry
- [AP-3] apaleo store, char pmslink / VConnect keycard. https://store.apaleo.com/apps/char-pmslink-keycard
- [AP-4] apaleo store, Abitari Locks Connector. https://store.apaleo.com/apps/abitari-locks-connector
- [AP-5] apaleo store, Häfele - DIALOCK. https://store.apaleo.com/apps/haefele-dialock

char (middleware)
- [CH-1] pmslink for LOCKS / pmslink keycard. https://charpmslink.com/pmslink-keycard/
- [CH-2] pmslink cloud. https://charpmslink.com/for-distributors/landing-for-pmslink-cloud/
- [CH-3] pmslink keycard for apaleo, presentation (PDF). https://charpmslink.com/download/doc/keycard/presentation_pmslink_keycard_apaleo_en.pdf

Cloudbeds (help-centre articles read through the public Zendesk API, /api/v2/help_center/en-us/articles/{id}.json)
- [CB-1] Access Management and Door Locks Apps. https://myfrontdesk.cloudbeds.com/hc/en-us/articles/7295607768603
- [CB-2] Visionline (Assa Abloy) - How to Connect. https://myfrontdesk.cloudbeds.com/hc/en-us/articles/4408608357915
- [CB-3] How to connect Ambiance (by Dormakaba). https://myfrontdesk.cloudbeds.com/hc/en-us/articles/4430427183771
- [CB-4] How to connect Salto Space. https://myfrontdesk.cloudbeds.com/hc/en-us/articles/37588053064731
- [CB-5] Cloudbeds marketplace, Salto Space. https://www.cloudbeds.com/integrations/salto-space/
- [CB-6] Cloudbeds marketplace, Onity. https://www.cloudbeds.com/integrations/onity/

Oracle
- [OR-1] Oracle Hospitality Hotel Property Interface 8.17, Installation Guide (G55561-05, PDF). https://docs.oracle.com/en/industries/hospitality/hotel-property/8.17/hpiig/G55561_05.pdf
- [OR-2] Oracle Hospitality IFC8 OperaConnector guide (G55569-05, PDF). https://docs.oracle.com/en/industries/hospitality/hotel-property/8.17/ifcoc/G55569_05.pdf
- [OR-3] Oracle Hospitality IfcBusi.Net.dll guide (G55564-05, PDF). https://docs.oracle.com/en/industries/hospitality/hotel-property/8.17/hpind/G55564_05.pdf

protel, CASABLANCA, ibelsa, hetras
- [PR-1] protel partner page (redirects to Planet generic content). https://www.protel.net/de/partners
- [CA-1] CASABLANCA, Schnittstellen & Integrationen. https://www.casablanca.at/software/schnittstellen-integrationen/
- [IB-1] ibelsa, Anbindungen: Schließanlagen / Kiosk. https://www.ibelsa.com/anbindungen/auswahl-der-anbindungsart-schliessanlagen-kiosk
- [HE-1] https://www.hetras.com/ (no response)
- [SH-6] SIHOT sitemap (press entries). https://sihot.com/sitemap.xml

Lock vendors and middleware
- [MS-1] MESSERSCHMITT Systems, Software und Schnittstellen. https://www.messerschmitt.com/services/software-und-schnittstellen/
- [GL-1] Glutz, eAccess Cloud. https://www.glutz.com/ch/de/eaccess-cloud
- [GL-2] Glutz, Hotel & Gastronomie. https://www.glutz.com/ch/de/zugang/gebaeude/hotel-gastronomie
- [SV-1] SimonsVoss hotel page (HTTP 404). https://www.simons-voss.com/de/loesungen/hotel.html
- [HF-1] Häfele (refused: HTTP 401 and 403). https://www.hafele.de/de/info/loesungen/dialock/ ; https://www.dialock.com/de/ ; https://www.hafele.com/us/en/info/about-haefele/haefele-exclusive/haefele-dialock/dialock-faqs/94521/
- [CT-1] Pepperl+Fuchs Comtrol Hospitality. https://comtrolhpd.com/
- [CT-2] Comtrol, Lodging Link. https://comtrolhpd.com/lodging-link/
- [CT-3] Comtrol, PMS Developer Kit. https://comtrolhpd.com/pms-developer-kit/
- [SE-19] Seam, Device and system integration guides (index). https://www.seam.co/docs/device-and-system-integration-guides/index.md

Trade press (no usable result)
- [TP-1] https://www.tophotel.de/?s=Salto ; https://www.ahgz.de/suche?q=Salto ; https://www.hottelling.net/?s=Salto
