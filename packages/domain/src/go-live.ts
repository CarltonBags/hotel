import { addDays } from "./rates-grid";

/** Prices are kept this many days ahead of the Business Date ("Rates and restrictions model"); go-live needs them. */
export const PRICE_HORIZON_DAYS = 500;
/** A trial runs this long, without payment details. */
export const TRIAL_DAYS = 30;
/** A demo tenant is deleted this many days after its trial ends. */
export const DEMO_KEPT_DAYS = 30;

export type TrialKind = "demo" | "own";

/** What the go-live checklist looks at, read from the tenant's setup. */
export interface GoLiveFacts {
  legalEntities: {
    name: string;
    /** VAT id or tax number. */
    hasTaxData: boolean;
    hasTaxCodes: boolean;
    /** A final invoice number range set up on purpose. */
    hasInvoiceNumbering: boolean;
    /** The card provider account, when onboarding was started. */
    card: { chargesEnabled: boolean } | null;
  }[];
  properties: {
    name: string;
    rooms: number;
    /** The last date some Rate Plan has prices for, or null. */
    pricedThrough: string | null;
    cityTaxRule: boolean;
    /** The property's own calendar date: its first Business Date at go-live, from which the price horizon counts. */
    today: string;
  }[];
  /** Active staff users, the Owner included. */
  staffUsers: number;
  devices: number;
}

export type ChecklistLevel = "required" | "if_used" | "optional";

export interface ChecklistItem {
  id: string;
  level: ChecklistLevel;
  /** For an "if used" item: whether the tenant uses it (unused never blocks). */
  used: boolean;
  done: boolean;
  /** Which Legal Entities or properties are still missing it. */
  missing: string[];
}

function item(id: string, level: ChecklistLevel, missing: string[], used = true): ChecklistItem {
  return { id, level, used, done: missing.length === 0, missing };
}

/** The go-live checklist ("Onboarding and subscription"), worked out from the tenant's setup. */
export function goLiveChecklist(f: GoLiveFacts): ChecklistItem[] {
  const les = (ok: (le: GoLiveFacts["legalEntities"][number]) => boolean) => (f.legalEntities.length ? f.legalEntities.filter((le) => !ok(le)).map((le) => le.name) : ["—"]);
  const props = (ok: (p: GoLiveFacts["properties"][number]) => boolean) => (f.properties.length ? f.properties.filter((p) => !ok(p)).map((p) => p.name) : ["—"]);
  const card = f.legalEntities.filter((le) => le.card);
  return [
    item("legal_entity_tax", "required", les((le) => le.hasTaxData)),
    item("property", "required", f.properties.length ? [] : ["—"]),
    item("rooms", "required", props((p) => p.rooms > 0)),
    item("rates_500_days", "required", props((p) => p.pricedThrough !== null && p.pricedThrough >= addDays(p.today, PRICE_HORIZON_DAYS))),
    item("tax_codes", "required", les((le) => le.hasTaxCodes)),
    item("city_tax", "required", props((p) => p.cityTaxRule)),
    // a one-person guesthouse is run by its Owner alone
    item("users", "required", f.staffUsers > 0 ? [] : ["—"]),
    item("invoice_numbering", "required", les((le) => le.hasInvoiceNumbering)),
    item("card_provider", "if_used", card.filter((le) => !le.card!.chargesEnabled).map((le) => le.name), card.length > 0),
    item("devices", "optional", f.devices > 0 ? [] : ["—"]),
  ];
}

/** The items that keep the tenant from going live. */
export function goLiveBlockers(items: ChecklistItem[]): ChecklistItem[] {
  return items.filter((i) => !i.done && (i.level === "required" || (i.level === "if_used" && i.used)));
}

/** Whole days left in the trial, counting a started day; 0 once it ended. */
export function trialDaysLeft(endsAt: Date, now: Date): number {
  return Math.max(0, Math.ceil((endsAt.getTime() - now.getTime()) / 86_400_000));
}

/** A demo tenant goes 30 days after its trial ended. */
export function demoDeletionDue(endsAt: Date, now: Date): boolean {
  return now.getTime() >= endsAt.getTime() + DEMO_KEPT_DAYS * 86_400_000;
}

/** Where an outgoing mail may go: in Test Mode only to the trial user, never to guests (null: not sent). */
export function testModeMailRecipient(mode: { testMode: boolean; trialUserEmail: string }, to: string): string | null {
  if (!mode.testMode) return to;
  return to.trim().toLowerCase() === mode.trialUserEmail.trim().toLowerCase() ? to : null;
}
