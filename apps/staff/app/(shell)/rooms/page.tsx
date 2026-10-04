import { can, cleanlinessScope, roomViewScope, type Cleanliness } from "@hoteloftware/domain";
import { listRoomStates, listTenantUsers } from "@hoteloftware/db";
import { requireAllowed } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";
import { fill } from "@/i18n/messages";
import { RoomsBoard } from "./rooms-board";

/** Every room's Cleanliness, Occupancy, Room Blocks and Housekeeping Task on the Business Date (ticket 33); a Housekeeper sees own rooms. */
export default async function RoomsPage() {
  const shell = await loadShell();
  const { messages: m } = shell;
  const property = shell.properties.find((p) => p.id === shell.scope);
  if (!property) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-medium">{m["module.housekeeping"]}</h1>
        <p className="mt-2 text-ink-60">{m["lists.pickProperty"]}</p>
      </div>
    );
  }
  const { tenant, actor, session } = await requireAllowed("view_rooms", property.id);
  const [state, users] = await Promise.all([listRoomStates(pool(), tenant.schemaName, property.id, { userId: session.user.id, actor }), listTenantUsers(pool(), tenant.id)]);
  const housekeepers = users
    .filter((u) => !u.pendingInvitation && u.propertyRoles.some((r) => r.propertyId === property.id && r.role === "housekeeper"))
    .map((u) => ({ id: u.id, name: u.name }));
  const names = Object.fromEntries(users.map((u) => [u.id, u.name]));
  const set = (to: Cleanliness) => cleanlinessScope(actor, property.id, to) !== "none";
  return (
    <div className="mx-auto grid max-w-6xl gap-4 p-6">
      <div>
        <h1 className="text-xl font-medium">
          {m["module.housekeeping"]} <span className="text-ink-60">· {property.name}</span>
        </h1>
        <p className="text-sm text-ink-60">
          {fill(m["rs.help"], { date: state.businessDate })} {roomViewScope(actor, property.id) === "own" ? m["rs.own"] : ""}
        </p>
      </div>
      <RoomsBoard
        propertyId={property.id}
        businessDate={state.businessDate}
        inspectionRequired={state.inspectionRequired}
        rooms={state.rooms}
        housekeepers={housekeepers}
        names={names}
        rights={{
          dirty: set("dirty"),
          clean: set("clean"),
          inspected: set("inspected"),
          outOfOrder: can(actor, "manage_out_of_order", property.id),
          outOfService: can(actor, "manage_out_of_service", property.id),
          assign: can(actor, "assign_housekeeping", property.id),
          settings: can(actor, "manage_property_settings", property.id),
        }}
        m={m}
      />
    </div>
  );
}
