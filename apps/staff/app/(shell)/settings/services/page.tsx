import { can, isTaxPresetCountry, todayIn } from "@hoteloftware/domain";
import { listServices, listTaxCodes } from "@hoteloftware/db";
import { requireAllowed } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";
import { CatalogueSetup } from "./catalogue-setup";

/** Service catalogue of the selected property and the Tax Codes of its Legal Entity. */
export default async function ServicesPage() {
  const shell = await loadShell();
  const { messages: m } = shell;
  const property = shell.properties.find((p) => p.id === shell.scope);
  if (!property) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-medium">{m["services.title"]}</h1>
        <p className="mt-2 text-ink-60">{m["rooms.pickProperty"]}</p>
      </div>
    );
  }
  const { tenant, actor } = await requireAllowed("view_property", property.id);
  const [services, taxCodes] = await Promise.all([
    listServices(pool(), tenant.schemaName, property.id, { includeInactive: true }),
    listTaxCodes(pool(), tenant.schemaName, property.legalEntityId, { today: todayIn(property.timeZone) }),
  ]);
  return (
    <CatalogueSetup
      property={{ id: property.id, name: property.name, country: property.country, currency: property.currency, legalEntityName: property.legalEntityName, today: todayIn(property.timeZone) }}
      services={services}
      taxCodes={taxCodes}
      rights={{
        settings: can(actor, "manage_property_settings", property.id),
        prices: can(actor, "manage_service_prices", property.id),
        tax: can(actor, "manage_tax_codes", property.id),
      }}
      presetAvailable={isTaxPresetCountry(property.country)}
      language={shell.language}
      m={m}
    />
  );
}
