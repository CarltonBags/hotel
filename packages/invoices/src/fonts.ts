import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The embedded Inter fonts (SIL Open Font License), read on first use. Next
 * bundles this package; in some server bundles `import.meta.url` is no file
 * URL, so the fonts are then found through the app's node_modules (the
 * deploy traces them, see apps/staff/next.config.ts).
 */
function fontsDir(): string {
  const here = import.meta.url;
  if (here.startsWith("file:")) {
    const dir = join(dirname(fileURLToPath(here)), "..", "fonts");
    if (existsSync(join(dir, "Inter.ttf"))) return dir;
  }
  const candidates = [process.env.HOTELOFTWARE_FONTS_DIR, join(process.cwd(), "node_modules/@hoteloftware/invoices/fonts"), join(process.cwd(), "../../packages/invoices/fonts")];
  const found = candidates.find((d): d is string => !!d && existsSync(join(d, "Inter.ttf")));
  if (!found) throw new Error("Invoice fonts not found");
  return found;
}

let cached: { regular: Buffer; bold: Buffer } | null = null;
export function fonts(): { regular: Buffer; bold: Buffer } {
  if (!cached) {
    const dir = fontsDir();
    cached = { regular: readFileSync(join(dir, "Inter.ttf")), bold: readFileSync(join(dir, "Inter-SemiBold.ttf")) };
  }
  return cached;
}
