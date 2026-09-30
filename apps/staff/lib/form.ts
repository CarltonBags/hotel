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
