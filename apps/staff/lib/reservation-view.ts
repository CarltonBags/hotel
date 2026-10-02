import { can, canAtAnyProperty, formatCurrency, registrationFields, registrationGaps, todayIn, type Language, type RegistrationField } from "@hoteloftware/domain";
import {
  chargeHistory,
  findGuest,
  findProperty,
  findReservation,
  listFixedCharges,
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
import type { Messages } from "@/i18n/messages";
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
    actionsProps: actionsProps(r, roomTypes.filter((t) => plan?.roomTypeIds.includes(t.id) ?? t.id === r.roomType.id).map((t) => ({ id: t.id, label: `${t.code} · ${t.name}` })), currency),
    folioProps: folioProps(r, m, guestName, folios, services, taxCodes, chargeLog, names, fmt, money, today, rights, currency),
    serviceOptions: services.filter((x) => x.active).map((x) => ({ id: x.id, label: `${x.code} · ${x.name}`, price: x.defaultPrice })),
  };
}

export type ReservationView = NonNullable<Awaited<ReturnType<typeof reservationView>>>;

function actionsProps(r: ReservationDetail, roomTypes: { id: string; label: string }[], currency: { code: string; language: Language; country: string }) {
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
      reason: e.detail.auto === "early_departure" || e.detail.auto === "stay_changed" ? m[`folio.autoVoid.${e.detail.auto}`] : typeof e.detail.reason === "string" ? e.detail.reason : null,
    })),
    today,
    rights: { post: rights.post, freeText: rights.freeText, manage: rights.manageFolios, companies: rights.companies },
    currency,
  };
}

