import { housekeepingBoard, listRooms, listSections, listTenantUsers } from "@hoteloftware/db";
import { requireAllowed } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";
import { housekeepersAt } from "@/lib/housekeepers";
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
  const housekeepers = await housekeepersAt(tenant.id, property.id);
  const [board, users, sections, rooms] = await Promise.all([
    housekeepingBoard(pool(), tenant.schemaName, property.id, housekeepers.map((h) => h.id), { userId: session.user.id, actor }),
    listTenantUsers(pool(), tenant.id),
    listSections(pool(), tenant.schemaName, property.id),
    listRooms(pool(), tenant.schemaName, property.id),
  ]);
  // tasks of someone no longer a Housekeeper here still show, in their own column
  const others = [...new Set(board.tasks.map((t) => t.assigneeId).filter((id): id is string => !!id && !housekeepers.some((h) => h.id === id)))].map((id) => ({ id, name: users.find((u) => u.id === id)?.name ?? id }));
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
        others={others}
        rules={board.rules}
        sections={sections.map((x) => ({ id: x.id, name: x.name }))}
        rooms={rooms.map((r) => ({ id: r.id, number: r.number, sectionId: r.sectionId }))}
        m={m}
      />
    </div>
  );
}
