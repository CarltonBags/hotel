import { pricesOn, propertyModules } from "@hoteloftware/db";
import { MODULES, todayIn } from "@hoteloftware/domain";
import { ActionForm } from "@/components/form-fields";
import { requireAllowed } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";
import { fill } from "@/i18n/messages";
import { moduleOffAction, moduleOnAction, moduleStepAction } from "./actions";

/** Modules per property (ticket 88): price shown before switching on; on at once, billed from next month; off at month end, data readable. */
export default async function ModulesPage() {
  const shell = await loadShell();
  const { messages: m } = shell;
  const { tenant } = await requireAllowed("manage_modules");
  const properties = shell.properties.filter((p) => shell.scope === "all" || !shell.scope || p.id === shell.scope);
  let prices: Awaited<ReturnType<typeof pricesOn>> | null = null;
  try {
    prices = await pricesOn(pool(), todayIn("Europe/Berlin"));
  } catch {
    // no price list yet: switching on waits for it
  }
  const money = (n: number) => n.toLocaleString(shell.language === "de" ? "de-DE" : "en-GB", { style: "currency", currency: "EUR" });
  return (
    <div className="mx-auto grid max-w-4xl gap-6 p-6">
      <div>
        <h1 className="text-xl font-medium">{m["module.settings_modules"]}</h1>
        <p className="text-sm text-ink-60">{m["modules.help"]}</p>
      </div>
      {await Promise.all(
        properties.map(async (p) => {
          const mods = await propertyModules(pool(), tenant.schemaName, p.id, todayIn(p.timeZone));
          return (
            <section key={p.id} className="grid gap-3 rounded-2xl bg-surface-2 p-4 text-sm" data-property={p.name}>
              <h2 className="font-medium">{p.name}</h2>
              <ul className="grid gap-3">
                {MODULES.map((mod) => {
                  const x = mods.find((y) => y.module === mod)!;
                  const price = prices?.modules[mod];
                  const priceText = price ? `${money(price.amount)} ${m[price.unit === "room" ? "modules.perRoom" : "modules.perProperty"]}` : m["modules.noPrice"];
                  const hidden = (
                    <>
                      <input type="hidden" name="propertyId" value={p.id} />
                      <input type="hidden" name="module" value={mod} />
                    </>
                  );
                  return (
                    <li key={mod} className="grid gap-2 rounded-xl bg-surface p-3" data-module={mod} data-state={x.state}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{m[`modules.name.${mod}`]}</span>
                        <span className="text-xs text-ink-60">{priceText}</span>
                        <span className="ml-auto text-xs">
                          {x.state === "on" ? fill(m["modules.onSince"], { date: x.onSince ?? "" }) : x.state === "ending" ? fill(m["modules.endsAt"], { date: x.offAt ?? "" }) : x.state === "readable" ? m["modules.readable"] : m["modules.off"]}
                        </span>
                      </div>
                      {x.state === "on" ? (
                        <ActionForm action={moduleOffAction} submitLabel={m["modules.switchOff"]} className="contents">
                          {hidden}
                        </ActionForm>
                      ) : price ? (
                        <ActionForm action={moduleOnAction} submitLabel={m["modules.switchOn"]} className="flex flex-wrap items-center gap-2">
                          {hidden}
                          <label className="flex items-center gap-2">
                            <input type="checkbox" name="confirm" /> {fill(m["modules.confirm"], { price: priceText })}
                          </label>
                        </ActionForm>
                      ) : null}
                      {x.state === "on" && x.checklist.length ? (
                        <ul className="grid gap-1" data-checklist>
                          {x.checklist.map((c) => (
                            <li key={c.step}>
                              <ActionForm action={moduleStepAction} submitLabel={c.done ? m["modules.undo"] : m["modules.done"]} className="flex items-center gap-2">
                                {hidden}
                                <input type="hidden" name="step" value={c.step} />
                                {c.done ? null : <input type="hidden" name="done" value="on" />}
                                <span>{c.done ? "●" : "○"} {m[`modules.step.${c.step}` as keyof typeof m] ?? c.step}</span>
                              </ActionForm>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        }),
      )}
    </div>
  );
}
