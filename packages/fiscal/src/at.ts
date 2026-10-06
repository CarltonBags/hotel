/**
 * The fiscal module for Austria (ticket 52, RKSV): a signature creation
 * unit (SCU) per Legal Entity, registered with FinanzOnline; each Cash
 * Register a registered register whose start receipt the provider signs;
 * every on-site payment signed, refunds as cancellation receipts; monthly
 * and yearly closing receipts made and checked by the provider.
 */

export type AtVatRate = "STANDARD" | "REDUCED_1" | "REDUCED_2" | "SPECIAL" | "ZERO";
export type AtReceiptType = "NORMAL" | "CANCELLATION";
/** Receipts the provider makes itself. */
export type AtSystemReceiptType = "INITIALIZATION" | "MONTHLY_CLOSE" | "YEARLY_CLOSE" | "DECOMMISSION" | "SIGNATURE_CREATION_UNIT_FAULT_CLEARANCE";

/** One Legal Entity's account at the provider (an organisation each: one SCU per organisation). */
export interface AtAccount {
  apiKey: string;
  apiSecret: string;
}

export interface FonCredentials {
  participantId: string;
  userId: string;
  pin: string;
}

export interface AtSignInput {
  registerId: string;
  /** Our id: the same id again never signs twice. */
  receiptId: string;
  type: AtReceiptType;
  /** A second attempt for the same receipt: the provider is asked what it already has. */
  retry?: boolean;
  amountsPerVatRate: { vatRate: AtVatRate; amount: string }[];
  amountsPerPaymentType: { paymentType: "CASH" | "NON_CASH"; amount: string; currency: string }[];
  lineItems: { quantity: string; text: string; pricePerUnit: string }[];
  metadata?: Record<string, string>;
}

export interface AtSignedReceipt {
  receiptNumber: string;
  timeSignature: Date;
  registerSerial: string;
  qrCodeData: string;
  /** False while the SCU is out: the receipt then says "Sicherheitseinrichtung ausgefallen". */
  signed: boolean;
  hints: string[];
}

export interface AtSystemReceipt {
  id: string;
  type: AtSystemReceiptType;
  receiptNumber: string;
  timeSignature: Date;
  qrCodeData: string;
  /** FinanzOnline's check of the receipt, where made. */
  validation: "SUCCESS" | "ERROR" | null;
}

export interface AtFiscalProvider {
  readonly name: string;
  /** FinanzOnline web-service credentials of the taxpayer, once. */
  fonAuth(account: AtAccount, fon: FonCredentials): Promise<void>;
  /** The Legal Entity's SCU, created and registered with FinanzOnline. */
  createScu(account: AtAccount, scuId: string, taxId: { vatId: string } | { taxNumber: string }, name: string): Promise<{ certificateSerial: string }>;
  /** A register, registered with FinanzOnline and initialised (its start receipt signed and checked). */
  createRegister(account: AtAccount, registerId: string, description: string): Promise<{ serial: string; initializationReceiptId: string | null }>;
  /** Sign a receipt; FiscalUnavailable when the provider cannot be reached (signed later), FiscalRefused when it will not sign it. */
  sign(account: AtAccount, input: AtSignInput): Promise<AtSignedReceipt>;
  /** A register out of order, or back (reported to FinanzOnline by the provider). */
  setRegisterOutage(account: AtAccount, registerId: string, outage: boolean): Promise<void>;
  /** The receipts the provider made itself (start, monthly, yearly, fault clearance), with FinanzOnline's check. */
  systemReceipts(account: AtAccount, registerId: string): Promise<AtSystemReceipt[]>;
  /** The data collection log (DEP7) of a register for a period, as JSON. */
  dep(account: AtAccount, registerId: string, from: Date, to: Date): Promise<Uint8Array>;
}
