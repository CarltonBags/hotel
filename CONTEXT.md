# Hotel PMS

A multi-tenant SaaS property management system for hotel companies operating one or more hotels in Europe, with a staff-facing PMS, a public booking engine and a guest-facing self-service surface.


German words for every term: see `docs/glossary/german-terms.md`. Add the German word there whenever a term is added here.

## Language

**Tenant**:
A hotel company that subscribes to the product and owns one or more properties.
_Avoid_: Account, organisation, customer (ambiguous with guest)

**Property**:
A single hotel with its own rooms, rates, legal jurisdiction and tax configuration, belonging to one tenant.
_Avoid_: Hotel (informal), venue, site, location

**Approval**:
A property manager's recorded consent that lets another user complete an action beyond their role's limit.
_Avoid_: Override, manager PIN, authorisation

**Floor View**:
The reduced view of a reservation shown to housekeeping and maintenance staff: room, surname, stay dates, guest count and housekeeping notes.
_Avoid_: Limited view, housekeeping view

**Legal Entity**:
A company owned by a tenant that issues invoices; every property belongs to exactly one legal entity, which carries the VAT ID, bank details and invoice numbering.
_Avoid_: Company, billing entity, GmbH

**User**:
A staff member's login, belonging to exactly one tenant, holding at most one tenant role and any number of property roles. Identified by an email that is unique across the platform.
_Avoid_: Employee, staff account, member

**Username**:
The short name a user types with their password to sign in at their tenant's address; unique within the tenant and set when the user is invited.
_Avoid_: Login, handle, account name

**Tenant Role**:
Owner or Tenant Admin; grants Property Manager rights on every property of the tenant. Owner also controls the subscription.
_Avoid_: Global role, admin level

**Property Role**:
One of Property Manager, Front Desk, Housekeeper, Housekeeping Supervisor, Maintenance, Accounting, Revenue, Service, Spa Staff or Outlet Manager, granted to a user for one specific property.
_Avoid_: Permission group, job title

**Guest**:
A person who stays at a property. May or may not be the person who made the booking.
_Avoid_: Customer, client, user

**Channel Manager**:
The single third-party service through which rates, availability and reservations are synchronised with online travel agencies.
_Avoid_: OTA integration, distribution system

**Guest Portal**:
The guest-facing surface tied to a reservation for pre-arrival, check-in, payment and messaging.
_Avoid_: Guest app, guest area

**Meldeschein**:
The statutory guest registration form a guest must complete and confirm at arrival; who needs one and how it is confirmed depends on the property's country.
_Avoid_: Registration card, reg card, check-in form

**Canton Profile**:
The registration rules a Swiss property follows: who is registered, fields, form grouping, signature, identity document copies, retention and transmission.
_Avoid_: Swiss settings, canton rules

**ID Check**:
The staff member's recorded confirmation that a guest's registration details were compared with their passport, with any discrepancy noted.
_Avoid_: ID verification, passport scan, KYC

**Workspace Tab**:
An in-app tab inside the staff PMS holding one open record such as a reservation, guest or report, independent of browser tabs.
_Avoid_: Browser tab, window, panel

## Reservations

**Room Type**:
A sellable category of rooms at a property; the unit of availability.
_Avoid_: Category, room class, unit type

**Room**:
A physical room belonging to one room type.
_Avoid_: Unit, accommodation

**Availability**:
The number of unsold units of a room type on a given night.
_Avoid_: Inventory, allotment, stock

**Booking**:
The commercial umbrella made by one booker in one act, holding one or more reservations, a source and a confirmation number.
_Avoid_: Order, group (unless a real group), reservation (for the umbrella)

**Reservation**:
One room type for one date range with one occupancy and its guests; consumes one unit of availability per night and has one or more folios.
_Avoid_: Booking (for the single room), stay, room night

**Room Assignment**:
The link between a reservation and a physical room for a date range; a room move adds a new assignment on the same reservation.
_Avoid_: Room allocation, room block

**Country of Residence**:
The country where a guest lives, recorded for every guest separately from nationality; the basis of official tourism statistics.
_Avoid_: Country, origin, home country, nationality

**Booker**:
The person or company that made a booking and is billed by default.
_Avoid_: Customer, contact, client

**Primary Guest**:
The guest on a reservation who holds the registration and, unless routed, the folio.
_Avoid_: Lead guest, main guest, occupant

**Company**:
An organisation that can act as booker or bill-to for reservations, such as a corporate client or travel agency.
_Avoid_: Account, corporate, agency (as a type name)

**Source**:
How a booking entered the system: Direct (entered by staff) or Channel (carrying the name of the booking site or the hotel's website tool).
_Avoid_: Origin, channel (for the enum as a whole)

**Night Audit**:
The staff-run process that closes a property's business date: missing arrivals and overdue departures are decided, the day's records are fixed, and the business date advances.
_Avoid_: End of day, day close, EOD

**Late Arrival**:
A confirmed reservation whose guest did not arrive on the arrival date and was deliberately excluded from no-show at the night audit; the room stays held.
_Avoid_: Delayed arrival, pending no-show

**Business Date**:
The operational date a property is currently on, advanced only by the night audit.
_Avoid_: Hotel date, system date, today

## Guest portal

**Portal Link**:
A signed, expiring link that gives access to one reservation's (or one booking's) guest portal without an account.
_Avoid_: Magic link, guest login, token

**Pre-check-in**:
The guest's completion of registration and payment before being at the hotel; it never sets a reservation to Checked-in.
_Avoid_: Online check-in, remote check-in, self check-in

**Self Check-in**:
Check-in completed by the guest on a lobby kiosk or on their own phone while at the hotel, without staff when the check-in conditions hold.
_Avoid_: Express check-in, kiosk check-in, online check-in

**Check-in Conditions**:
The property-configured requirements that must all hold for self check-in to complete without staff.
_Avoid_: Eligibility rules, check-in policy

**Arrived, Waiting for Room**:
The state of a guest who has completed registration and payment on site but has no inspected room assigned yet.
_Avoid_: Waitlist, early arrival, pending check-in

**Guest Inbox**:
The staff-facing, chat-style list of conversations with guests for a property.
_Avoid_: Messages page, chat, support inbox

**Conversation**:
The thread of messages between the property and the guests of one reservation, or the booker of one booking.
_Avoid_: Chat, ticket, case

**Device**:
A piece of hardware enrolled to one property: a guest-facing tablet or kiosk that shows only what staff push to it, or a staff phone or tablet on which enrolled users sign in.
_Avoid_: Terminal, tablet session, iPad

**PIN Sign-in**:
Signing in on an enrolled device by choosing one's own name and entering a personal PIN; available to floor and service roles only.
_Avoid_: Quick login, shared login, badge login

**Message**:
One entry in a conversation, sent by a guest, a staff member or automatically.
_Avoid_: Chat, mail, notification

**Transport**:
The way a message travels to or from a guest: portal, email or WhatsApp.
_Avoid_: Channel (reserved for booking channels), medium

**Messaging Consent**:
A guest's recorded agreement to receive messages on a given transport, with time, source and wording.
_Avoid_: Opt-in flag, permission, subscription

**Notification**:
A short alert the system shows a staff user inside the app (as a toast and, later, in a list), for example an Approval request or a worker check; never sent to guests. Distinct from a Message, which belongs to a Conversation with a guest.
_Avoid_: Push, alert, system message

**Internal Note**:
A staff-only entry in a conversation that the guest never sees.
_Avoid_: Comment, remark, private message

**Sending Hours**:
The hours of the day, in the property's time, within which service messages to guests go out.
_Avoid_: Quiet hours, send window

**Desk Hours**:
The times a property's front desk is staffed, used for automatic replies and escalation.
_Avoid_: Opening hours, reception hours

**Site Bridge**:
Our small program on a hotel PC that connects on-premises lock systems and FIAS-based tills to the service, outbound only.
_Avoid_: Lock Bridge (former name), agent, connector, gateway, interface box

**Lock Plugin**:
The adapter for one lock vendor behind the product's single lock interface, declaring which key actions it supports.
_Avoid_: Driver, integration, adapter (as the product term)

**Digital Key**:
A per-property opt-in that lets a checked-in guest open their room through an integrated door-lock system.
_Avoid_: Mobile key, e-key

## Staff app shell

**Main Menu**:
The single button at the top left of the staff app that opens the nested menu of every list and function.
_Avoid_: Start menu, hamburger, sidebar

**Quick Access**:
The user-configurable set of buttons in the navbar that open a user's most important functions in one click.
_Avoid_: Favourites, shortcuts, toolbar

**Pinned Tab**:
A workspace tab the user has fixed to the start of the tab strip; shown as an icon, restored at next login.
_Avoid_: Favourite tab, sticky tab

**Stage**:
The single content surface below the tab strip that shows the active workspace tab.
_Avoid_: Main area, canvas, window

## Billing

**Folio**:
The running account of charges and payments for one bill-to within a reservation; becomes one invoice.
_Avoid_: Bill, account, tab, window

**Bill-to**:
The guest or company a folio is invoiced to.
_Avoid_: Payer, invoice recipient, debtor

**Service**:
A sellable item from a property's catalogue, with a default price, tax code and revenue account.
_Avoid_: Article, product, extra, item

**Accommodation Service**:
The service a rate plan's room part is charged as, giving room charges their tax code and revenue account.
_Avoid_: Room service (that is food delivered to a room), room article

**Fixed Charge**:
A service a stay carries for a range of its nights, such as parking or a dog, posted night by night and following the stay when it changes.
_Avoid_: Recurring posting, package add-on, fixed cost

**Charge**:
One service for one service date on a folio, stored as a gross amount with a tax code.
_Avoid_: Posting, line item, transaction

**Service Date**:
The night or day a charge is for, regardless of when it was posted.
_Avoid_: Posting date, charge date

**Tax Code**:
The VAT treatment of a charge, which determines rate and accounting key. Belongs to a Legal Entity; its rate is dated, so a charge keeps the rate in force on its service date.
_Avoid_: VAT rate, tax class

**Posting Rhythm**:
How often a service is charged when attached to a reservation: once, per night, or per person and night.
_Avoid_: Frequency, billing cycle, recurrence

**Revenue Account**:
The accounting key a service's revenue is reported under; the export mapping uses it.
_Avoid_: GL account, ledger, Konto (as the general term)

**City Tax**:
The municipal tourist levy, computed per guest-night by the property's city tax rule and either charged to the guest or absorbed by the hotel.
_Avoid_: Kurtaxe, tourist tax, bed tax, Ortstaxe (as the general term)

**City Tax Rule**:
A property's dated rule for computing city tax: a percentage of the base, a step table, or a flat amount per person-night.
_Avoid_: Tax setting, tourist tax formula

**City Tax Exemption**:
A recorded reason, with its evidence, why a guest owes no city tax for a stay.
_Avoid_: Tax waiver, tax-free flag

**Routing Rule**:
A rule on a reservation that decides which folio a charge lands on.
_Avoid_: Split rule, billing instruction

**Payment**:
Money actually received against a folio, by one tender.
_Avoid_: Transaction, settlement

**Tender**:
The means of a payment: cash, card online, card terminal, bank transfer, on account, voucher, OTA virtual card, OTA collect.
_Avoid_: Payment method, payment type

**Card Hold**:
A pre-authorisation on a guest's card that reserves an amount until it is captured or expires; not a payment.
_Avoid_: Pre-auth, deposit, guarantee

**Invoice**:
The immutable, numbered tax document issued from a folio by a legal entity.
_Avoid_: Bill, receipt, Rechnung

**Deposit Invoice**:
An invoice for money received before the stay, netted on the final invoice.
_Avoid_: Proforma, advance invoice, Anzahlungsrechnung

**Cancellation Invoice**:
The document that cancels an issued invoice by referencing it; the only way to correct one.
_Avoid_: Storno, credit note, reversal

**Void**:
The cancellation of an uninvoiced charge with a reason, kept in the audit log.
_Avoid_: Delete, remove, reverse

**Receivable**:
An issued invoice to an on-account bill-to that is not yet paid.
_Avoid_: Open item, debt, outstanding

## Housekeeping

**Cleanliness**:
A room's cleaning state: Dirty, Clean or Inspected.
_Avoid_: Room status, housekeeping status, HK code

**Occupancy**:
Whether a room is Vacant or Occupied, derived from reservations and never set by hand.
_Avoid_: Room status, occupied flag

**Room Block**:
A dated restriction on a room, either Out of Order or Out of Service, with a reason.
_Avoid_: Closure, maintenance block, lock

**Out of Order**:
A room block that removes the room from sale for its date range.
_Avoid_: OOO, closed, blocked

**Out of Service**:
A room block that flags a defect but keeps the room sellable.
_Avoid_: OOS, limited, soft block

**Housekeeping Task**:
A unit of cleaning work for one room on one day, of a type (departure, stayover, arrival preparation, linen change) with a time value.
_Avoid_: Job, cleaning, assignment

**Housekeeping Note**:
A remark on a reservation meant for floor staff, picked from the property's fixed list or written as free text.
_Avoid_: Special request, room note, trace

**Section**:
A named group of rooms, such as a floor or wing, used to distribute housekeeping tasks.
_Avoid_: Zone, area, floor (as the general term)

**Maintenance Issue**:
A reported defect in a room or public area, worked by maintenance staff, optionally carrying a room block.
_Avoid_: Ticket, repair, work order

**Room Feature**:
A fixed attribute of a room used when choosing a room for a guest, such as floor, view, bed type or accessibility.
_Avoid_: Amenity, attribute, tag

## Booking engine

**Payment Policy**:
What a rate plan requires from the guest at booking: payment in full, a deposit, a card guarantee, or nothing.
_Avoid_: Guarantee type, prepayment rule, deposit policy

**Cancellation Policy**:
Until when a reservation on a rate plan can be cancelled free of charge, and the fee after that.
_Avoid_: Cancellation terms, refund policy

**Card Guarantee**:
A card stored at booking with strong customer authentication and not charged, against which no-show and late-cancellation fees may be charged.
_Avoid_: Credit card guarantee, card on file, deposit

**Rate Code**:
A code that selects rate plans that are not public, used by staff when booking and by channels that support it.
_Avoid_: Promo code, coupon, voucher, discount code

## Rates

**Rate Plan**:
A named way of selling rooms at a property, carrying its policies, included services and meal plan, and spanning one or more room types.
_Avoid_: Rate, tariff, price list, rate code

**Base Rate Plan**:
A rate plan whose daily prices are entered directly.
_Avoid_: Parent rate, master rate, BAR

**Derived Rate Plan**:
A rate plan whose prices follow a base rate plan by a fixed amount or percentage.
_Avoid_: Child rate, linked rate, dependent rate

**Rate**:
The gross price of one rate plan for one room type on one date, at base occupancy.
_Avoid_: Price, tariff, rate plan

**Base Occupancy**:
The number of adults a rate is priced for before supplements apply.
_Avoid_: Standard occupancy, included occupancy

**Supplement**:
An amount a rate plan adds or subtracts for occupancy other than the base: single use, extra adult, child per age band.
_Avoid_: Surcharge, extra person fee

**Age Band**:
A property-defined age range that determines a child's supplement and tax treatment.
_Avoid_: Child category, age group

**Restriction**:
A rule on a rate plan, room type and date that limits which stays can be sold: stop sell, closed to arrival, closed to departure, minimum stay on arrival, minimum stay through, maximum stay.
_Avoid_: Rule, constraint, closure

**Meal Plan**:
The board a rate plan includes: none, breakfast, half board or full board.
_Avoid_: Board type, catering

**Event Marker**:
A named date or date range a property marks as special, such as a fair or holiday, shown wherever dates are displayed.
_Avoid_: Special day, season, event

**Price Floor**:
The lowest nightly price for a room type that staff may set without the property manager.
_Avoid_: Minimum rate, bottom rate

**Price Override**:
A manual change to a night's price on a reservation, with a recorded reason.
_Avoid_: Rate change, discount, manual rate

## Cash desk

**Cash Register**:
A named place at a property where cash is kept and counted, with its own cash book.
_Avoid_: Till, drawer, Kasse, POS

**Shift**:
One user's period of responsibility for a cash register, from counted opening float to counted close.
_Avoid_: Session, cashier session, drawer session

**Cash Book**:
The chronological list of every cash movement of a cash register with its running balance.
_Avoid_: Kassenbuch, cash journal, cash log

**Paid-out**:
Cash taken from a register for a small business expense, with reason and receipt.
_Avoid_: Petty cash, expense, withdrawal

**Cash Difference**:
The gap between the expected and the counted cash at the close of a shift.
_Avoid_: Over/short, variance, discrepancy

**Receipt**:
The document given for a payment at the desk, carrying the fiscal signature data; separate from the invoice.
_Avoid_: Beleg, bon, slip, invoice

**Voucher**:
A prepaid amount sold by a legal entity, redeemable against charges at its properties until used up.
_Avoid_: Gift card, coupon, Gutschein, credit

## Reporting

**Available Rooms**:
The rooms of a property on a night, minus those that are Out of Order; the base of occupancy figures.
_Avoid_: Inventory, capacity, rooms to sell

**Occupancy (figure)**:
Occupied rooms divided by available rooms for a period, as a percentage.
_Avoid_: Utilisation, load, fill rate

**Net Room Revenue**:
The room component of charges by service date, without VAT, included services or city tax.
_Avoid_: Room revenue, lodging revenue, turnover

**Average Daily Rate**:
Net room revenue divided by occupied rooms.
_Avoid_: ADR, average price, average rate

**Revenue per Available Room**:
Net room revenue divided by available rooms.
_Avoid_: RevPAR, yield

**Pickup**:
The change in booked room nights for a future date between two points in time.
_Avoid_: Booking pace, gain

**Budget**:
The planned monthly figures a property enters for a year, against which reports show variance.
_Avoid_: Forecast, plan, target

## Groups

**Group**:
A contract with an organiser for several rooms, holding held rooms, prices, terms and a master folio; its reservations are linked to it.
_Avoid_: Block, group booking, event

**Held Rooms**:
Rooms per room type and night reserved for a group before names are known, until a release date.
_Avoid_: Allotment, room block, contingent, option

**Tentative**:
The state of a group whose offer is out; its held rooms do not reduce availability.
_Avoid_: Option, provisional, pending

**Definite**:
The state of a group whose contract is signed; its held rooms reduce availability everywhere.
_Avoid_: Confirmed (reserved for reservations), firm

**Release Date**:
The date on which held rooms without a reservation return to sale.
_Avoid_: Cut-off date, option date (that belongs to tentative groups)

**Series**:
A group contract that repeats on a pattern of arrival dates, each with its own held rooms and rooming list.
_Avoid_: Recurring group, allotment contract

**Rooming List**:
The organiser's list of names and room sharing for a group arrival.
_Avoid_: Name list, guest list

**Master Folio**:
The folio of a group, billed to the organiser, onto which group routing rules place charges.
_Avoid_: Group account, paymaster, city ledger

## Downtime

**Downtime Reports**:
The set of printable lists that let a front desk work on paper: arrivals, expected departures, in-house, room rack and blank registration forms.
_Avoid_: Emergency lists, backup reports, contingency reports

**Room Rack**:
The list of every room on one line with its state, occupant and next arrival, grouped by floor.
_Avoid_: Room list, room status report, rack

**Catch-up Entry**:
The entry, after an outage, of what happened on paper, with its real time and a mark that it was entered later.
_Avoid_: Back-dating, late posting

## Subscription

**Module**:
An optional part of the product a tenant switches on per property and pays for separately.
_Avoid_: Add-on, feature, package, plan

**Test Mode**:
The state of a tenant before go-live, in which setup is kept and all test records are discarded at go-live.
_Avoid_: Sandbox, trial mode, staging

**Import Batch**:
One upload of records from a previous system, checked in a dry run first and undoable as a whole until go-live.
_Avoid_: Migration, data load, upload

**Go-live**:
The moment a property leaves test mode: test records are cleared, invoice numbering starts, and the first business date is set.
_Avoid_: Launch, activation, cut-over

## Outlets

**Outlet**:
A place at a property that sells to guests and visitors, such as bar, restaurant or spa, with its own menu, printers, cash register and reports.
_Avoid_: Point of sale (for the place), venue, department

**Outlet Sale**:
A sale at an outlet to someone without a reservation, paid on the spot or invoiced to a company.
_Avoid_: Walk-in sale, cash sale

**Room Charge**:
Posting an outlet bill to a checked-in guest's folio, allowed within the reservation's spending limit.
_Avoid_: Charge to room, transfer, city ledger

**Spending Limit**:
The amount per night a reservation may accumulate in room charges without direct payment or manager approval.
_Avoid_: Credit limit, charge limit

