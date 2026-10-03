import { keepReminderPdf, reminderDocument } from "@hoteloftware/db";
import { renderReminderPdf } from "@hoteloftware/invoices";
import { authorize, requirePrincipal } from "@/lib/authorize";
import { pool } from "@/lib/db";

/** A reminder letter as PDF: rendered once from its frozen document and kept. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { tenant } = await requirePrincipal();
  let reminder;
  try {
    reminder = await reminderDocument(pool(), tenant.schemaName, id);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  try {
    await authorize("manage_receivables", reminder.propertyId);
  } catch {
    return new Response("Not allowed", { status: 403 });
  }
  if (!reminder.pdf) await keepReminderPdf(pool(), tenant.schemaName, id, await renderReminderPdf(reminder.document));
  const pdf = reminder.pdf ?? (await reminderDocument(pool(), tenant.schemaName, id)).pdf!;
  return new Response(new Uint8Array(pdf), {
    headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="reminder-${reminder.document.level}-${reminder.document.invoices[0]?.number ?? id}.pdf"`, "cache-control": "private, no-store" },
  });
}
