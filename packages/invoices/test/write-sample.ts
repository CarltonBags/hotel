// Writes the fixture invoice to files for external validation: npx tsx test/write-sample.ts <dir>
import { writeFileSync } from "node:fs";
import { invoicePdf, invoiceXml } from "../src/index";
import { finalInvoice } from "./fixture";

const dir = process.argv[2] ?? ".";
writeFileSync(`${dir}/invoice.pdf`, await invoicePdf(finalInvoice));
writeFileSync(`${dir}/invoice.xml`, await invoiceXml(finalInvoice));
console.log("written", dir);
