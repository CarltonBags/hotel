import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import type { Actor } from "@hoteloftware/domain";
import { migrateControl } from "../src/control/migrate-control";
import { controlMigrations, tenantMigrations } from "../src/migrations/load";
import { provisionTenant, type Tenant } from "../src/tenant/provision";
import { createLegalEntity } from "../src/tenant/legal-entities";
import { createProperty } from "../src/tenant/properties";
import { applyTaxPreset, listTaxCodes } from "../src/tenant/tax-codes";
import { createService } from "../src/tenant/services";
import { createCompany } from "../src/tenant/companies";
import { createCashRegister, openShift, receiptByToken, setCashDesk } from "../src/tenant/cash";
import { invoiceDocument, setInvoiceNumberRange } from "../src/tenant/invoices";
import {
  addBillItem,
  createOutlet,
  invoiceOutletBill,
  moveOutletBill,
  openOutletBill,
  outletBill,
  outletFloor,
  payOutletBillCash,
  removeBillLine,
  reportPrintJob,
  saveMenuItem,
  savePrinter,
  saveTable,
  sendOrderRound,
  setOutletManagers,
  splitOutletBill,
  takePrintJobs,
} from "../src/tenant/outlets";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seams: an order round prints on the right printer with table and
 * modifiers; splits and moves keep totals; an Outlet Manager changes only own
 * outlets; an Outlet Sale in cash closes through the outlet's Shift with a
 * Receipt, or is invoiced on account to a Company.
 */
describe("Outlets", () => {
  let pool: Pool;
  let tenant: Tenant;
  let propertyId = "";
  let bar = "";
  let restaurant = "";
  let barRegister = "";
  let deskRegister = "";
  let gin = "";
  let schnitzel = "";
  let barPrinter = "";
  let kitchen = "";
  let t1 = "";
  let t2 = "";
  let company = "";
  const s = () => tenant.schemaName;
  const pm: { userId: string; actor: Actor } = { userId: "user_pm", actor: { propertyRoles: [] } };
  const om: { userId: string; actor: Actor } = { userId: "user_om", actor: { propertyRoles: [] } };
  const waiter: { userId: string; actor: Actor; name: string } = { userId: "user_mia", actor: { propertyRoles: [] }, name: "Mia" };
  const other: { userId: string; actor: Actor; name: string } = { userId: "user_tom", actor: { propertyRoles: [] }, name: "Tom" };

  beforeAll(async () => {
    pool = testPool(10);
    await resetTestDatabase(pool);
    await migrateControl(pool, controlMigrations());
    tenant = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    const le = (await createLegalEntity(pool, s(), { name: "A GmbH", country: "DE", addressLine1: "Ring 1", postalCode: "10115", city: "Berlin", vatId: "DE123456789", taxNumber: "1" })).id;
    propertyId = (await createProperty(pool, s(), { name: "Haus am Ring", legalEntityId: le, country: "DE", timeZone: "Europe/Berlin", currency: "EUR" })).id;
    pm.actor = { propertyRoles: [{ propertyId, role: "property_manager" }] };
    om.actor = { propertyRoles: [{ propertyId, role: "outlet_manager" }] };
    waiter.actor = { propertyRoles: [{ propertyId, role: "service" }] };
    other.actor = { propertyRoles: [{ propertyId, role: "service" }] };
    await applyTaxPreset(pool, s(), le, "DE");
    const codes = await listTaxCodes(pool, s(), le);
    const code = (c: string) => codes.find((x) => x.code === c)!.id;
    const drinks = await createService(pool, s(), { propertyId, code: "DRINK", name: "Getränke", defaultPrice: 0, taxCodeId: code("STD"), revenueAccount: "8410", postingRhythm: "once", bookableOnline: false });
    const food = await createService(pool, s(), { propertyId, code: "FOODS", name: "Speisen", defaultPrice: 0, taxCodeId: code("FOOD"), revenueAccount: "8400", postingRhythm: "once", bookableOnline: false });
    await setCashDesk(pool, s(), propertyId, { enabled: true, tolerance: 5, paidOutLimit: 100, differenceAccount: "1370" });
    deskRegister = await createCashRegister(pool, s(), propertyId, "Front desk");
    barRegister = await createCashRegister(pool, s(), propertyId, "Bar till");
    await setInvoiceNumberRange(pool, s(), le, "final", "RE-{YYYY}-{NNNNN}");
    company = (await createCompany(pool, s(), { name: "Event AG", addressLine1: "Platz 1", postalCode: "10115", city: "Berlin", country: "DE", onAccount: true }, { userId: pm.userId })).id;

    bar = await createOutlet(pool, s(), propertyId, { name: "Bar", kind: "bar", cashRegisterId: barRegister, active: true }, pm);
    restaurant = await createOutlet(pool, s(), propertyId, { name: "Restaurant", kind: "restaurant", cashRegisterId: null, active: true }, pm);
    await setOutletManagers(pool, s(), bar, [om.userId], pm);
    barPrinter = await savePrinter(pool, s(), bar, { name: "Bar printer", kind: "bar", address: "http://192.168.1.50", active: true }, om);
    kitchen = await savePrinter(pool, s(), bar, { name: "Kitchen", kind: "kitchen", address: "", active: true }, om);
    t1 = await saveTable(pool, s(), bar, { name: "T1", seats: 4, sortOrder: 1, active: true }, om);
    t2 = await saveTable(pool, s(), bar, { name: "T2", seats: 2, sortOrder: 2, active: true }, om);
    gin = await saveMenuItem(pool, s(), bar, { serviceId: drinks.id, name: "Gin Tonic", category: "Drinks", price: 9.5, printerId: barPrinter, modifiers: [{ name: "no ice", price: 0 }, { name: "double", price: 4 }], active: true, sortOrder: 1 }, om);
    schnitzel = await saveMenuItem(pool, s(), bar, { serviceId: food.id, name: "Schnitzel", category: "Food", price: 19, printerId: kitchen, modifiers: [], active: true, sortOrder: 2 }, om);
    await saveMenuItem(pool, s(), restaurant, { serviceId: food.id, name: "Suppe", category: "Food", price: 7, printerId: null, modifiers: [], active: true, sortOrder: 1 }, pm);
  });
  afterAll(() => pool.end());

  it("an Outlet Manager of the bar cannot edit the restaurant's menu", async () => {
    const svc = (await pool.query(`select id from ${s()}.services where code = 'FOODS'`)).rows[0].id;
    await expect(saveMenuItem(pool, s(), restaurant, { serviceId: svc, name: "Steak", category: "Food", price: 29, printerId: null, modifiers: [], active: true, sortOrder: 2 }, om)).rejects.toThrow(/Outlet Manager/);
    await expect(savePrinter(pool, s(), restaurant, { name: "Pass", kind: "kitchen", address: "", active: true }, om)).rejects.toThrow(/Outlet Manager/);
    // Service takes orders but changes no menu
    await expect(saveTable(pool, s(), bar, { name: "T9", seats: 2, sortOrder: 9, active: true }, waiter)).rejects.toThrow(/Outlet Manager/);
  });

  it("an order round prints on the right printer with the table and the modifiers", async () => {
    const bill = await openOutletBill(pool, s(), bar, { tableId: t1, label: "" }, waiter);
    await addBillItem(pool, s(), bill, { menuItemId: gin, quantity: 2, modifiers: ["double", "no ice"], note: "" }, waiter);
    await addBillItem(pool, s(), bill, { menuItemId: schnitzel, quantity: 1, modifiers: [], note: "well done" }, waiter);
    expect(await sendOrderRound(pool, s(), bill, waiter)).toEqual({ round: 1, jobs: 2 });
    const jobs = await takePrintJobs(pool, s(), bar, waiter);
    const barJob = jobs.find((j) => j.printerId === barPrinter)!;
    expect(barJob.address).toBe("http://192.168.1.50");
    expect(barJob.text).toContain("Tisch/Table T1");
    expect(barJob.text).toContain("2 x Gin Tonic");
    expect(barJob.text).toMatch(/- double\n {2}- no ice|- no ice\n {2}- double/);
    expect(barJob.text).not.toContain("Schnitzel");
    expect(jobs.find((j) => j.printerId === kitchen)!.text).toContain("1 x Schnitzel\n  ! well done");
    // taken jobs are not handed out twice; a failed one comes back
    expect(await takePrintJobs(pool, s(), bar, waiter)).toEqual([]);
    await reportPrintJob(pool, s(), barJob.id, { ok: true }, waiter);
    await reportPrintJob(pool, s(), jobs.find((j) => j.printerId === kitchen)!.id, { ok: false, error: "paper out" }, waiter);
    expect((await takePrintJobs(pool, s(), bar, waiter)).map((j) => j.printerId)).toEqual([kitchen]);
    // nothing new to send: no round
    expect(await sendOrderRound(pool, s(), bill, waiter)).toEqual({ round: null, jobs: 0 });
    const view = await outletBill(pool, s(), bill, waiter);
    expect(view.total).toBe(2 * 13.5 + 19);
    expect(view.lines.every((l) => l.round === 1)).toBe(true);
    // a sent item is not taken back
    await expect(removeBillLine(pool, s(), bill, view.lines[0]!.id, waiter)).rejects.toThrow(/not sent/);
  });

  it("splitting by items and moving a bill between tables keep the totals", async () => {
    const bill = await openOutletBill(pool, s(), bar, { tableId: t1, label: "" }, waiter);
    for (const q of [1, 2, 3]) await addBillItem(pool, s(), bill, { menuItemId: gin, quantity: q, modifiers: [], note: "" }, waiter);
    await sendOrderRound(pool, s(), bill, waiter);
    const before = (await outletBill(pool, s(), bill, waiter)).total;
    const lines = (await outletBill(pool, s(), bill, waiter)).lines;
    const other = await splitOutletBill(pool, s(), bill, [lines[1]!.id], waiter);
    const a = await outletBill(pool, s(), bill, waiter);
    const b = await outletBill(pool, s(), other, waiter);
    expect(a.total + b.total).toBe(before);
    expect(b.total).toBe(19);
    expect(b.tableId).toBe(t1);
    await expect(splitOutletBill(pool, s(), bill, [], waiter)).rejects.toThrow(/Choose items/);
    await moveOutletBill(pool, s(), other, t2, waiter);
    const floor = await outletFloor(pool, s(), bar, waiter);
    expect(floor.tables.find((t) => t.id === t2)!.bills.map((x) => [x.id, x.total])).toEqual([[other, 19]]);
    expect(floor.tables.find((t) => t.id === t1)!.bills.find((x) => x.id === bill)!.total).toBe(before - 19);
  });

  it("an Outlet Sale in cash closes through the outlet's Shift with a Receipt", async () => {
    const bill = await openOutletBill(pool, s(), bar, { tableId: null, label: "Walk-in" }, other);
    await addBillItem(pool, s(), bill, { menuItemId: gin, quantity: 1, modifiers: [], note: "" }, other);
    await expect(payOutletBillCash(pool, s(), bill, { customerName: "" }, other)).rejects.toThrow(/Send the open items/);
    await sendOrderRound(pool, s(), bill, other);
    // without a Shift no cash; a Shift on the desk's register is not the bar's
    await expect(payOutletBillCash(pool, s(), bill, { customerName: "" }, other)).rejects.toThrow(/Open your Shift/);
    await expect(openShift(pool, s(), { registerId: deskRegister, count: {} }, other)).rejects.toThrow(/Not allowed/);
    await openShift(pool, s(), { registerId: barRegister, count: {} }, other);
    const paid = await payOutletBillCash(pool, s(), bill, { customerName: "Herr Weiß" }, other);
    expect(paid.total).toBe(9.5);
    const receipt = (await receiptByToken(pool, s(), paid.receiptToken))!;
    expect(receipt).toMatchObject({ amount: 9.5, tender: "cash", guestName: "Herr Weiß", outletSale: { outlet: "Bar", lines: [{ description: "Gin Tonic", quantity: 1, amount: 9.5 }] } });
    const cash = (await pool.query(`select m.register_id, m.amount from ${s()}.cash_movements m where m.payment_id = $1`, [paid.paymentId])).rows;
    expect(cash).toEqual([{ register_id: barRegister, amount: "9.50" }]);
    // the revenue stands as Charges on the bill's folio
    const charges = (await pool.query(`select c.description, c.amount, c.origin from ${s()}.charges c join ${s()}.folios f on f.id = c.folio_id where f.outlet_bill_id = $1`, [bill])).rows;
    expect(charges).toEqual([{ description: "Gin Tonic", amount: "9.50", origin: "outlet" }]);
    expect((await outletBill(pool, s(), bill, other)).status).toBe("paid");
    await expect(addBillItem(pool, s(), bill, { menuItemId: gin, quantity: 1, modifiers: [], note: "" }, other)).rejects.toThrow(/closed/);
  });

  it("a Company event is invoiced on account to the Company", async () => {
    const bill = await openOutletBill(pool, s(), bar, { tableId: t2, label: "Event AG" }, waiter);
    await addBillItem(pool, s(), bill, { menuItemId: schnitzel, quantity: 10, modifiers: [], note: "" }, waiter);
    await sendOrderRound(pool, s(), bill, waiter);
    const inv = await invoiceOutletBill(pool, s(), bill, { companyId: company }, waiter);
    expect(inv.receivable).toBe(true);
    const doc = await invoiceDocument(pool, s(), inv.id);
    expect(doc.buyer.name).toBe("Event AG");
    expect(doc.reference).toBe(`Bar ${(await outletBill(pool, s(), bill, waiter)).number}`);
    expect(doc.totals.gross).toBe(190);
  });
});
