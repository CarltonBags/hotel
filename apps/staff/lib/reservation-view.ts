import { can, canAtAnyProperty, formatCurrency, registrationFields, registrationGaps, todayIn, type Language, type RegistrationField } from "@hoteloftware/domain";
import {
  chargeHistory,
  findGuest,
  findProperty,
  findReservation,
  getCityTaxRule,
  listCityTaxExemptions,
  listCardHolds,
  listFixedCharges,
  listInvoices,
  listTerminalReaders,
  listRatePlans,
  listRoomTypes,
  listServices,
  listTaxCodes,
  listTenantUsers,
  loadFolios,
  type FixedCharge,
  type FolioView,
  type Guest,
  type ReservationDetail,
} from "@hoteloftware/db";
import { fill, type Messages } from "@/i18n/messages";
import { paymentProvider } from "@hoteloftware/payments";
import { requireAllowed, requirePrincipal } from "./authorize";
import { pool } from "./db";
import { loadShell } from "./shell";

/**
 * Everything one reservation shows on its tab and in the Today workspace,
 * loaded once with the viewer's rights. Server only. Returns null when the
 * reservation does not exist; throws when the viewer may not see it.
 */
export async function reservationView(id: string, options: { propertyId?: string } = {}) {
  const { tenant } = await requirePrincipal();
  const s = tenant.schemaName;
  const r = await findReservation(pool(), s, id);
  // the Today workspace opens only reservations of its own property
  if (!r || (options.propertyId !== undefined && r.propertyId !== options.propertyId)) return null;
  const { actor } = await requireAllowed("view_reservations", r.propertyId);
  const { messages: m, language } = await loadShell();
  const property = (await findProperty(pool(), s, r.propertyId))!;
  // the front office's working property was checked by requireAllowed above
  const at = (action: Parameters<typeof can>[1]) => can(actor, action, r.propertyId);
  // Charges and folio work only while the stay is open
  const chargeable = r.status === "confirmed" || r.status === "checked_in";
  const rights = {
    manage: at("manage_reservations"),
    checkIn: at("check_in"),
    folio: at("view_folio"),
    post: at("post_charges") && chargeable,
    freeText: at("post_free_text_charges") && chargeable,
    manageFolios: at("manage_folios") && chargeable,
    companies: canAtAnyProperty(actor, "view_companies"),
    guests: canAtAnyProperty(actor, "view_guests"),
    contacts: at("view_guest_contacts"),
    editGuests: canAtAnyProperty(actor, "edit_guests"),
    takePayments: at("take_payments"),
    refunds: at("refund_payments"),
    issueInvoices: at("issue_invoices"),
    correctInvoices: at("correct_invoices"),
    overrideCheckOut: at("override_check_out"),
    /** City Tax exemptions are set while the stay is open. */
    exemptCityTax: at("check_in") && chargeable,
  };
  const [users, roomTypes, plans, folios, chargeLog, services, taxCodes, fixedCharges, guest] = await Promise.all([
    listTenantUsers(pool(), tenant.id),
    listRoomTypes(pool(), s, r.propertyId),
    rights.manage ? listRatePlans(pool(), s, r.propertyId, { includeInactive: true }) : Promise.resolve([]),
    rights.folio ? loadFolios(pool(), s, r.id) : Promise.resolve<FolioView>({ folios: [], routing: [] }),
    rights.folio ? chargeHistory(pool(), s, r.id) : Promise.resolve([]),
    rights.post ? listServices(pool(), s, r.propertyId) : Promise.resolve([]),
    rights.freeText ? listTaxCodes(pool(), s, property.legalEntityId) : Promise.resolve([]),
    rights.folio ? listFixedCharges(pool(), s, r.id) : Promise.resolve<FixedCharge[]>([]),
    rights.guests ? findGuest(pool(), s, r.primaryGuest.id) : Promise.resolve<Guest | null>(null),
  ]);
  const [cityTaxRule, cityTaxExemptions] = await Promise.all([getCityTaxRule(pool(), s, r.propertyId), listCityTaxExemptions(pool(), s, r.id)]);
  const [readers, holds, invoices] = rights.folio
    ? await Promise.all([listTerminalReaders(pool(), s, r.propertyId), listCardHolds(pool(), s, r.id), listInvoices(pool(), s, r.id)])
    : [[], [], []];
  const provider = paymentProvider();
  // TODO(Night Audit ticket): the property's Business Date
  const today = todayIn(property.timeZone);
  const names = new Map(users.map((u) => [u.id, u.name]));
  const plan = plans.find((p) => p.id === r.ratePlan.id);
  const currency = { code: property.currency, language, country: property.country };
  const money = (v: number) => formatCurrency(v, property.currency, language, property.country);
  const fmt = new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: property.timeZone });
  const guestName = `${r.primaryGuest.firstName} ${r.primaryGuest.lastName}`.trim();
  return {
    r,
    property,
    actor,
    m,
    language,
    rights,
    today,
    names,
    fmt,
    money,
    currency,
    guestName,
    guest,
    /** Registration fields the Primary Guest still lacks, and those the property's country asks for. */
    registration: guest ? { gaps: registrationGaps(guest, property.country), fields: registrationFields(property.country, guest.nationality) } : { gaps: [] as RegistrationField[], fields: [] as RegistrationField[] },
    fixedCharges,
    roomTypes,
    actionsProps: actionsProps(r, r.status === "checked_in" && rights.checkIn && r.arrival === today, roomTypes.filter((t) => plan?.roomTypeIds.includes(t.id) ?? t.id === r.roomType.id).map((t) => ({ id: t.id, label: `${t.code} · ${t.name}` })), currency),
    folioProps: folioProps(r, m, guestName, folios, services, taxCodes, chargeLog, names, fmt, money, today, rights, currency),
    serviceOptions: services.filter((x) => x.active).map((x) => ({ id: x.id, label: `${x.code} · ${x.name}`, price: x.defaultPrice })),
    invoices,
    /** Folios with Charges not invoiced yet. */
    openFolios: folios.folios
      .filter((f) => f.charges.some((c) => !c.voided && !c.invoiceId))
      .map((f) => ({ id: f.id, label: fill(m["folio.label"], { n: String(f.number), name: f.billToName }) })),
    /** City Tax exemptions per person; null when the property has no City Tax Rule. */
    cityTax: cityTaxRule.rule
      ? {
          reservationId: r.id,
          persons: [
            ...Array.from({ length: r.adults }, (_, i) => (i === 0 ? fill(m["ctax.primary"], { name: guestName }) : fill(m["ctax.adult"], { n: String(i + 1) }))),
            ...r.childAges.map((age, i) => fill(m["ctax.child"], { n: String(i + 1), age: String(age) })),
          ],
          reasons: cityTaxRule.rule.reasons.filter((x) => x.reason !== "age" && x.reason !== "long_stay"),
          exemptions: cityTaxExemptions,
          canEdit: rights.exemptCityTax,
        }
      : null,
    /** A checked-in guest may be checked out here. */
    canCheckOut: r.status === "checked_in" && rights.checkIn,
    /** Payments and Card Holds: the panels' shared props. */
    payments: {
      reservationId: r.id,
      propertyId: r.propertyId,
      readers: readers.map((x) => ({ readerId: x.readerId, label: x.label })),
      testMode: provider.testMode,
      currency,
      folios: folios.folios.map((f) => ({ id: f.id, number: f.number, billToName: f.billToName, gross: f.totals.gross, balance: f.balance, payments: f.payments })),
      holds,
      /** Open amount on the guest's own folios, what a hold capture takes by default. */
      guestBalance: folios.folios.filter((f) => f.billTo === "guest").reduce((sum, f) => sum + f.balance, 0),
    },
  };
}

const AUTO_VOIDS = ["early_departure", "stay_changed", "check_in_cancelled"] as const;
const isAutoVoid = (v: unknown): v is (typeof AUTO_VOIDS)[number] => typeof v === "string" && (AUTO_VOIDS as readonly string[]).includes(v);

export type ReservationView = NonNullable<Awaited<ReturnType<typeof reservationView>>>;

function actionsProps(r: ReservationDetail, canCancelCheckIn: boolean, roomTypes: { id: string; label: string }[], currency: { code: string; language: Language; country: string }) {
  return {
    reservation: {
      id: r.id,
      status: r.status,
      arrival: r.arrival,
      departure: r.departure,
      adults: r.adults,
      childAges: r.childAges,
      roomTypeId: r.roomType.id,
      nights: r.nights.map((n) => n.date),
      assignments: r.assignments,
      cancellationFee: r.cancellationFee,
      cancellationFeeStatus: r.cancellationFeeStatus,
      openInBooking: r.booking.openReservations,
      canCancelCheckIn,
    },
    roomTypes,
    currency,
  };
}

function folioProps(
  r: ReservationDetail,
  m: Messages,
  guestName: string,
  view: FolioView,
  services: Awaited<ReturnType<typeof listServices>>,
  taxCodes: Awaited<ReturnType<typeof listTaxCodes>>,
  chargeLog: Awaited<ReturnType<typeof chargeHistory>>,
  names: Map<string, string>,
  fmt: Intl.DateTimeFormat,
  money: (v: number) => string,
  today: string,
  rights: { post: boolean; freeText: boolean; manageFolios: boolean; companies: boolean },
  currency: { code: string; language: Language; country: string },
) {
  return {
    reservationId: r.id,
    view,
    services: services.filter((x) => x.active).map((x) => ({ id: x.id, label: `${x.code} · ${x.name} · ${money(x.defaultPrice)}` })),
    taxCodes: taxCodes.map((t) => ({ id: t.id, label: `${t.code} · ${t.name}` })),
    parties: [
      { kind: "guest" as const, id: r.primaryGuest.id, label: `${guestName} (${m["folio.billTo.guest"]})` },
      ...(r.booking.bookerCompanyId ? [{ kind: "company" as const, id: r.booking.bookerCompanyId, label: r.booking.bookerName }] : []),
      ...(r.booking.rateCodeCompanyId && r.booking.rateCodeCompanyId !== r.booking.bookerCompanyId
        ? [{ kind: "company" as const, id: r.booking.rateCodeCompanyId, label: r.booking.rateCodeCompanyName ?? "" }]
        : []),
    ],
    log: chargeLog.map((e) => ({
      at: fmt.format(new Date(e.at)),
      user: names.get(e.userId) ?? e.userId,
      action: e.action,
      description: e.origin === "fee" ? m["folio.earlyDepartureFee"] : e.description,
      reason: isAutoVoid(e.detail.auto) ? m[`folio.autoVoid.${e.detail.auto}`] : typeof e.detail.reason === "string" ? e.detail.reason : null,
    })),
    today,
    rights: { post: rights.post, freeText: rights.freeText, manage: rights.manageFolios, companies: rights.companies },
    currency,
  };
}


/** Props both payment panels share. */
export function paymentProps(v: ReservationView) {
  const { reservationId, propertyId, readers, testMode, currency } = v.payments;
  return { reservationId, propertyId, readers, testMode, currency };
}
