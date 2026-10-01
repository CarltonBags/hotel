import { can } from "@hoteloftware/domain";
import { listAgeBands, listRoomFeatures, listRoomTypes, listRooms, listSections } from "@hoteloftware/db";
import { requireAllowed } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";
import { RoomsSetup } from "./rooms-setup";

/** Room Types, Rooms, Room Features, Sections and Age Bands of the property selected in the navbar. */
export default async function RoomsPage() {
  const shell = await loadShell();
  const { messages: m } = shell;
  const property = shell.properties.find((p) => p.id === shell.scope);
  if (!property) {
    const manageable = shell.properties.filter((p) => can(shell.principal.actor, "manage_property_settings", p.id));
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-medium">{m["rooms.title"]}</h1>
        <p className="mt-2 text-ink-60">{m["rooms.pickProperty"]}</p>
        {manageable.length === 0 ? <p className="mt-2 text-ink-60">{m["settings.users.noneManaged"]}</p> : null}
      </div>
    );
  }
  const { tenant } = await requireAllowed("manage_property_settings", property.id);
  const schema = tenant.schemaName;
  const [roomTypes, rooms, features, sections, ageBands] = await Promise.all([
    listRoomTypes(pool(), schema, property.id),
    listRooms(pool(), schema, property.id),
    listRoomFeatures(pool(), schema, property.id),
    listSections(pool(), schema, property.id),
    listAgeBands(pool(), schema, property.id),
  ]);
  return (
    <RoomsSetup
      property={{ id: property.id, name: property.name }}
      roomTypes={roomTypes}
      rooms={rooms}
      features={features}
      sections={sections}
      ageBands={ageBands}
      m={shell.messages}
    />
  );
}
