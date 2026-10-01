import { ForbiddenError } from "./authorize";

export interface FormState {
  error?: string;
  ok?: boolean;
  /** Anything a form wants to show after success, for example an invitation link. */
  message?: string;
}

/** Run a server action body and turn thrown errors into form state instead of a 500. */
export async function formAction(fn: () => Promise<FormState | void>): Promise<FormState> {
  try {
    return (await fn()) ?? { ok: true };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: "You are not allowed to do this." };
    // Next.js uses thrown errors for redirect(); let those through.
    if (err instanceof Error && "digest" in err && String((err as { digest?: unknown }).digest).startsWith("NEXT_")) throw err;
    // Database driver errors carry a code; their text is not for the browser.
    if (err instanceof Error && !("code" in err)) return { error: err.message };
    console.error(err);
    return { error: "Something went wrong. Please try again." };
  }
}

export function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

/** A checkbox preceded by a hidden "off" field, so an unticked box still sends the field. */
export function flag(formData: FormData, name: string): boolean {
  return formData.getAll(name).includes("on");
}

/** A decimal typed into a number input; a comma decimal separator is accepted; empty is null. */
export function decimalOrNull(formData: FormData, name: string): number | null {
  const raw = field(formData, name).replace(",", ".");
  if (raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${name}: number expected`);
  return n;
}

/** A required decimal. */
export function decimal(formData: FormData, name: string): number {
  const n = decimalOrNull(formData, name);
  if (n === null) throw new Error(`${name}: number expected`);
  return n;
}

/** A whole number; empty is null. */
export function integerOrNull(formData: FormData, name: string): number | null {
  const raw = field(formData, name);
  if (raw === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new Error(`${name}: whole number expected`);
  return n;
}
