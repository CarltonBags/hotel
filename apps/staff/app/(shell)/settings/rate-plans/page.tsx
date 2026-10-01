import { can } from "@hoteloftware/domain";
import { listAgeBands, listCancellationPolicies, listPaymentPolicies, listRatePlans, listRoomTypes, listServices } from "@hoteloftware/db";
import { requireAllowed } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";
import { RatePlansSetup } from "./rate-plans-setup";

/** Rate Plans, policies, Price Floors and close-out shortcuts of the property selected in the navbar. */
export default async function RatePlansPage() {
  const shell = await loadShell();
  const { messages: m } = shell;
  const property = shell.properties.find((p) => p.id === shell.scope);
  if (!property) {
    const manageable = shell.properties.filter((p) => can(shell.principal.actor, "manage_rates", p.id));
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-medium">{m["rates.title"]}</h1>
        <p className="mt-2 text-ink-60">{m["rates.pickProperty"]}</p>
        {manageable.length === 0 ? <p className="mt-2 text-ink-60">{m["rates.noneManaged"]}</p> : null}
      </div>
    );
  }
  const { tenant } = await requireAllowed("manage_rates", property.id);
  const schema = tenant.schemaName;
  const [ratePlans, roomTypes, ageBands, services, paymentPolicies, cancellationPolicies] = await Promise.all([
    listRatePlans(pool(), schema, property.id, { includeInactive: true }),
    listRoomTypes(pool(), schema, property.id),
    listAgeBands(pool(), schema, property.id),
    listServices(pool(), schema, property.id),
    listPaymentPolicies(pool(), schema, property.id),
    listCancellationPolicies(pool(), schema, property.id),
  ]);
  return (
    <RatePlansSetup
      property={{ id: property.id, name: property.name, currency: property.currency, country: property.country }}
      ratePlans={ratePlans}
      roomTypes={roomTypes}
      ageBands={ageBands}
      services={services}
      paymentPolicies={paymentPolicies}
      cancellationPolicies={cancellationPolicies}
      language={shell.language}
      m={m}
    />
  );
}
