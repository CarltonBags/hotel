// Writes the fixture documents to files for external validation: npx tsx test/write-sample.ts <dir>
import { writeFileSync } from "node:fs";
import { invoicePdf, invoiceXml, renderReminderPdf } from "../src/index";
import { cancellationInvoice, finalInvoice, reminder } from "./fixture";

const dir = process.argv[2] ?? ".";
writeFileSync(`${dir}/invoice.pdf`, await invoicePdf(finalInvoice));
writeFileSync(`${dir}/invoice.xml`, await invoiceXml(finalInvoice));
writeFileSync(`${dir}/cancellation.pdf`, await invoicePdf(cancellationInvoice));
writeFileSync(`${dir}/cancellation.xml`, await invoiceXml(cancellationInvoice));
writeFileSync(`${dir}/reminder.pdf`, await renderReminderPdf(reminder));
console.log("written", dir);
