import { housekeepingBoard, listRoomTypes, listTenantUsers } from "@hoteloftware/db";
import { requireAllowed } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";
import { HousekeepingBoardView } from "./board";

/** The Housekeeping Supervisor's board of the Business Date (ticket 34). */
export default async function HousekeepingPage() {
  const shell = await loadShell();
  const { messages: m } = shell;
  const property = shell.properties.find((p) => p.id === shell.scope);
  if (!property) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-medium">{m["module.housekeeping_tasks"]}</h1>
        <p className="mt-2 text-ink-60">{m["lists.pickProperty"]}</p>
      </div>
    );
  }
  const { tenant, actor, session } = await requireAllowed("assign_housekeeping", property.id);
  const users = await listTenantUsers(pool(), tenant.id);
  const housekeepers = users.filter((u) => !u.pendingInvitation && u.propertyRoles.some((r) => r.propertyId === property.id && r.role === "housekeeper")).map((u) => ({ id: u.id, name: u.name }));
  const [board, types] = await Promise.all([
    housekeepingBoard(pool(), tenant.schemaName, property.id, housekeepers.map((h) => h.id), { userId: session.user.id, actor }),
    listRoomTypes(pool(), tenant.schemaName, property.id),
  ]);
  return (
    <div className="mx-auto grid max-w-7xl gap-4 p-6">
      <div>
        <h1 className="text-xl font-medium">
          {m["module.housekeeping_tasks"]} <span className="text-ink-60">· {property.name} · {board.businessDate}</span>
        </h1>
        <p className="text-sm text-ink-60">{m["hk.help"]}</p>
      </div>
      <HousekeepingBoardView
        propertyId={property.id}
        board={board}
        housekeepers={housekeepers}
        roomTypes={types.map((t) => ({ id: t.id, code: t.code, name: t.name }))}
        rules={board.rules}
        m={m}
      />
    </div>
  );
}
