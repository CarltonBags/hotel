import { createHash, randomUUID } from "node:crypto";
import { FiscalUnavailable } from "./provider";
import type { AtAccount, AtFiscalProvider, AtSignInput, AtSignedReceipt, AtSystemReceipt, FonCredentials } from "./at";

/**
 * A stand-in for the Austrian provider (ticket 52): registers and signs at
 * once, makes the monthly and yearly closing receipts as the provider does
 * at month end, and can play an unreachable provider (`down`) or an SCU
 * outage (`scuDown`, receipts come back unsigned).
 */
export class FakeAtFiscalProvider implements AtFiscalProvider {
  readonly name = "fake";
  down = false;
  scuDown = false;
  readonly fon = new Map<string, FonCredentials>();
  readonly registers = new Map<string, { serial: string; counter: number; outage: boolean; system: AtSystemReceipt[]; created: Date }>();
  readonly signed = new Map<string, AtSignedReceipt & { input: AtSignInput }>();

  async fonAuth(a: AtAccount, fon: FonCredentials): Promise<void> {
    if (this.down) throw new FiscalUnavailable("not available");
    this.fon.set(a.apiKey, fon);
  }

  async createScu(a: AtAccount, scuId: string): Promise<{ certificateSerial: string }> {
    if (this.down) throw new FiscalUnavailable("not available");
    if (!this.fon.has(a.apiKey)) throw new Error("FinanzOnline credentials missing");
    return { certificateSerial: createHash("sha256").update(scuId).digest("hex").slice(0, 16) };
  }

  private register(registerId: string) {
    let r = this.registers.get(registerId);
    if (!r) {
      const created = new Date();
      r = { serial: `HS-AT-${registerId.slice(0, 8).toUpperCase()}`, counter: 1, outage: false, created, system: [] };
      r.system.push({ id: randomUUID(), type: "INITIALIZATION", receiptNumber: "1", timeSignature: created, qrCodeData: `_R1-AT1_${r.serial}_1`, validation: "SUCCESS" });
      this.registers.set(registerId, r);
    }
    return r;
  }

  async createRegister(_a: AtAccount, registerId: string): Promise<{ serial: string; initializationReceiptId: string | null }> {
    if (this.down) throw new FiscalUnavailable("not available");
    const r = this.register(registerId);
    return { serial: r.serial, initializationReceiptId: r.system[0]!.id };
  }

  async sign(_a: AtAccount, input: AtSignInput): Promise<AtSignedReceipt> {
    if (this.down) throw new FiscalUnavailable("Signature service not available");
    const done = this.signed.get(input.receiptId);
    if (done) return done;
    const r = this.register(input.registerId);
    r.counter += 1;
    const hints = [...(this.scuDown ? ["Sicherheitseinrichtung ausgefallen"] : []), ...(input.type === "CANCELLATION" ? ["Stornobuchung"] : [])];
    const out: AtSignedReceipt = {
      receiptNumber: String(r.counter),
      timeSignature: new Date(),
      registerSerial: r.serial,
      qrCodeData: `_R1-AT1_${r.serial}_${r.counter}_${new Date().toISOString().slice(0, 19)}_${input.amountsPerVatRate.map((x) => x.amount).join("_")}_FAKE`,
      signed: !this.scuDown,
      hints,
    };
    this.signed.set(input.receiptId, { ...out, input });
    return out;
  }

  async setRegisterOutage(_a: AtAccount, registerId: string, outage: boolean): Promise<void> {
    if (this.down) throw new FiscalUnavailable("not available");
    this.register(registerId).outage = outage;
  }

  /** The closing receipts of the months passed since the register was made (December's is the yearly one). */
  async systemReceipts(_a: AtAccount, registerId: string, now = new Date()): Promise<AtSystemReceipt[]> {
    if (this.down) throw new FiscalUnavailable("not available");
    const r = this.register(registerId);
    const month = (d: Date) => d.getUTCFullYear() * 12 + d.getUTCMonth();
    for (let m = month(r.created); m < month(now); m++) {
      const y = Math.floor(m / 12);
      const mo = m % 12;
      const type = mo === 11 ? "YEARLY_CLOSE" : "MONTHLY_CLOSE";
      if (r.system.some((s) => s.type === type && s.timeSignature.getUTCFullYear() === y && s.timeSignature.getUTCMonth() === mo)) continue;
      r.counter += 1;
      r.system.push({ id: randomUUID(), type, receiptNumber: String(r.counter), timeSignature: new Date(Date.UTC(y, mo + 1, 0, 23, 59)), qrCodeData: `_R1-AT1_${r.serial}_${r.counter}_CLOSE`, validation: type === "YEARLY_CLOSE" ? "SUCCESS" : null });
    }
    return [...r.system];
  }

  async dep(_a: AtAccount, registerId: string): Promise<Uint8Array> {
    if (this.down) throw new FiscalUnavailable("not available");
    const r = this.register(registerId);
    return new TextEncoder().encode(JSON.stringify({ "Belege-Gruppe": [{ Signaturzertifikat: "FAKE", Zertifizierungsstellen: [], "Belege-kompakt": [...this.signed.values()].filter((x) => x.registerSerial === r.serial).map((x) => x.qrCodeData) }] }));
  }
}
