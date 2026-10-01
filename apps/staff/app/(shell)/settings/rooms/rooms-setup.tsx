"use client";

import { useState } from "react";
import type { AgeBand, Room, RoomFeature, RoomType, Section } from "@hoteloftware/db";
import type { Messages } from "@/i18n/messages";
import { ActionForm, Field, Select, inputClass } from "@/components/form-fields";
import { addFeature, addRooms, addSection, removeFeature, removeRoom, removeRoomType, saveBands, saveFeature, saveRoom, saveRoomType, saveSection } from "./actions";

type Tab = "types" | "rooms" | "features" | "sections" | "ageBands";

export function RoomsSetup({
  property,
  roomTypes,
  rooms,
  features,
  sections,
  ageBands,
  m,
}: {
  property: { id: string; name: string };
  roomTypes: RoomType[];
  rooms: Room[];
  features: RoomFeature[];
  sections: Section[];
  ageBands: AgeBand[];
  m: Messages;
}) {
  const [tab, setTab] = useState<Tab>(roomTypes.length === 0 ? "types" : "rooms");
  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "types", label: m["rooms.roomTypes"], count: roomTypes.length },
    { id: "rooms", label: m["rooms.rooms"], count: rooms.length },
    { id: "features", label: m["rooms.features"], count: features.length },
    { id: "sections", label: m["rooms.sections"], count: sections.length },
    { id: "ageBands", label: m["rooms.ageBands"], count: ageBands.length },
  ];
  return (
    <div className="mx-auto max-w-6xl p-6">
      <h1 className="text-xl font-medium">
        {m["rooms.title"]} <span className="text-ink-60">· {property.name}</span>
      </h1>
      <div role="tablist" className="mt-4 flex flex-wrap gap-1 rounded-full bg-surface-2 p-1">
        {tabs.map((t) => (
          <button
            type="button"
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`h-9 rounded-full px-4 text-sm ${tab === t.id ? "bg-surface font-medium shadow-pill" : "text-ink-80 hover:bg-ink-5"}`}
          >
            {t.label} <span className="text-ink-60">{t.count}</span>
          </button>
        ))}
      </div>
      <div className="mt-6">
        {tab === "types" && <RoomTypesTab property={property} roomTypes={roomTypes} m={m} />}
        {tab === "rooms" && <RoomsTab property={property} roomTypes={roomTypes} rooms={rooms} features={features} sections={sections} m={m} />}
        {tab === "features" && <FeaturesTab property={property} features={features} m={m} />}
        {tab === "sections" && <SectionsTab property={property} sections={sections} m={m} />}
        {tab === "ageBands" && <AgeBandsTab property={property} ageBands={ageBands} m={m} />}
      </div>
    </div>
  );
}

function Hidden({ property, id }: { property: { id: string }; id?: string | undefined }) {
  return (
    <>
      <input type="hidden" name="propertyId" value={property.id} />
      {id ? <input type="hidden" name="id" value={id} /> : null}
    </>
  );
}

function RoomTypeForm({ property, type, m }: { property: { id: string }; type?: RoomType; m: Messages }) {
  return (
    <ActionForm action={saveRoomType} submitLabel={type ? m["action.save"] : m["action.create"]} pendingLabel={m["action.saving"]} className="grid gap-3 md:grid-cols-3">
      <Hidden property={property} id={type?.id} />
      <Field label={m["rooms.code"]} name="code" defaultValue={type?.code} required />
      <Field label={m["rooms.nameMain"]} name="name" defaultValue={type?.name} required />
      <div className="hidden md:block" />
      <Field label={`${m["rooms.nameDe"]}${type && !type.names.de ? ` (${m["rooms.missingTranslation"]})` : ""}`} name="name_de" defaultValue={type?.names.de} />
      <Field label={`${m["rooms.nameEn"]}${type && !type.names.en ? ` (${m["rooms.missingTranslation"]})` : ""}`} name="name_en" defaultValue={type?.names.en} />
      <div className="hidden md:block" />
      <Field label={m["rooms.maxOccupancy"]} name="maxOccupancy" type="number" defaultValue={String(type?.maxOccupancy ?? 2)} required />
      <Field label={m["rooms.maxAdults"]} name="maxAdults" type="number" defaultValue={String(type?.maxAdults ?? 2)} required />
      <div className="grid grid-cols-2 gap-3">
        <Field label={m["rooms.bedPlaces"]} name="bedPlaces" type="number" defaultValue={String(type?.bedPlaces ?? 2)} required />
        <Field label={m["rooms.extraBeds"]} name="extraBeds" type="number" defaultValue={String(type?.extraBeds ?? 0)} />
      </div>
    </ActionForm>
  );
}

function RoomTypesTab({ property, roomTypes, m }: { property: { id: string }; roomTypes: RoomType[]; m: Messages }) {
  return (
    <div className="grid gap-4">
      {roomTypes.map((t) => (
        <details key={t.id} className="rounded-2xl bg-surface-2 p-5">
          <summary className="cursor-pointer">
            <span className="font-mono text-ink-80">{t.code}</span> <span className="font-medium">{t.name}</span>{" "}
            <span className="text-ink-60">
              · {t.roomCount} {m["rooms.roomCount"]} · {m["rooms.maxOccupancy"]} {t.maxOccupancy} · {m["rooms.maxAdults"]} {t.maxAdults}
              {!t.names.de || !t.names.en ? ` · ${m["rooms.missingTranslation"]}` : ""}
            </span>
          </summary>
          <div className="mt-4 grid gap-3">
            <RoomTypeForm property={property} type={t} m={m} />
            {t.roomCount === 0 ? (
              <ActionForm action={removeRoomType} submitLabel={m["action.delete"]} className="grid">
                <Hidden property={property} id={t.id} />
              </ActionForm>
            ) : (
              <p className="text-xs text-ink-60">{m["rooms.roomsLeft"]}</p>
            )}
          </div>
        </details>
      ))}
      <section className="rounded-2xl bg-surface-2 p-5">
        <h2 className="mb-3 font-medium">{m["rooms.newRoomType"]}</h2>
        <RoomTypeForm property={property} m={m} />
      </section>
    </div>
  );
}

function RoomsTab({
  property,
  roomTypes,
  rooms,
  features,
  sections,
  m,
}: {
  property: { id: string };
  roomTypes: RoomType[];
  rooms: Room[];
  features: RoomFeature[];
  sections: Section[];
  m: Messages;
}) {
  const [filter, setFilter] = useState("");
  const typeOptions = roomTypes.map((t) => ({ value: t.id, label: `${t.code} ${t.name}` }));
  const sectionOptions = [{ value: "", label: m["rooms.noSection"] }, ...sections.map((s) => ({ value: s.id, label: s.name }))];
  const shown = rooms.filter((r) => !filter || r.number.includes(filter) || r.roomTypeCode.toLowerCase().includes(filter.toLowerCase()) || r.floor === filter);
  return (
    <div className="grid gap-4">
      {roomTypes.length === 0 ? <p className="text-ink-60">{m["rooms.needRoomType"]}</p> : null}
      <section className="rounded-2xl bg-surface-2 p-5">
        <h2 className="mb-1 font-medium">{m["rooms.addRooms"]}</h2>
        <p className="mb-3 text-sm text-ink-60">{m["rooms.addRoomsHelp"]}</p>
        <ActionForm action={addRooms} submitLabel={m["action.add"]} pendingLabel={m["action.saving"]} className="grid gap-3 md:grid-cols-4">
          <Hidden property={property} />
          <Field label={m["rooms.numbers"]} name="numbers" required />
          <Select label={m["rooms.roomType"]} name="roomTypeId" options={typeOptions} />
          <Field label={m["rooms.floor"]} name="floor" />
          <Select label={m["rooms.section"]} name="sectionId" options={sectionOptions} />
        </ActionForm>
      </section>
      <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`${m["shell.search"]}…`} aria-label={m["shell.search"]} className={`${inputClass} max-w-xs`} />
      <div className="overflow-x-auto rounded-2xl bg-surface-2">
        <table className="w-full text-sm">
          <thead className="text-left text-ink-60">
            <tr>
              <th className="px-4 py-2">{m["rooms.number"]}</th>
              <th className="px-2 py-2">{m["rooms.roomType"]}</th>
              <th className="px-2 py-2">{m["rooms.floor"]}</th>
              <th className="px-2 py-2">{m["rooms.section"]}</th>
              <th className="px-2 py-2">{m["rooms.features"]}</th>
              <th className="px-2 py-2">{m["rooms.bedPlaces"]}</th>
              <th className="px-2 py-2">{m["rooms.extraBeds"]}</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <RoomRow key={r.id} property={property} room={r} typeOptions={typeOptions} sectionOptions={sectionOptions} features={features} m={m} />
            ))}
          </tbody>
        </table>
        {shown.length === 0 ? <p className="p-4 text-ink-60">{m["shell.nothingFound"]}</p> : null}
      </div>
    </div>
  );
}

function RoomRow({
  property,
  room,
  typeOptions,
  sectionOptions,
  features,
  m,
}: {
  property: { id: string };
  room: Room;
  typeOptions: { value: string; label: string }[];
  sectionOptions: { value: string; label: string }[];
  features: RoomFeature[];
  m: Messages;
}) {
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <tr className="border-t border-ink-10">
        <td className="px-4 py-2 font-medium">
          {room.number}
          {room.name ? <span className="ml-2 font-normal text-ink-60">{room.name}</span> : null}
        </td>
        <td className="px-2 py-2">{room.roomTypeCode}</td>
        <td className="px-2 py-2">{room.floor}</td>
        <td className="px-2 py-2">{room.sectionName ?? <span className="text-ink-40">–</span>}</td>
        <td className="px-2 py-2 text-ink-80">{room.features.map((f) => f.name).join(", ")}</td>
        <td className="px-2 py-2">{room.bedPlaces}</td>
        <td className="px-2 py-2">{room.extraBeds}</td>
        <td className="px-2 py-2 text-right">
          <button type="button" onClick={() => setEditing(true)} className="rounded-full px-3 py-1 text-accent hover:bg-ink-5">
            {m["action.edit"]}
          </button>
        </td>
      </tr>
    );
  }
  return (
    <tr className="border-t border-ink-10 bg-surface">
      <td colSpan={8} className="p-3">
        <ActionForm action={saveRoom} submitLabel={m["action.save"]} pendingLabel={m["action.saving"]} className="grid gap-3 md:grid-cols-6">
          <Hidden property={property} id={room.id} />
          <Field label={m["rooms.number"]} name="number" defaultValue={room.number} required />
          <Field label={m["rooms.roomName"]} name="name" defaultValue={room.name} />
          <Field label={m["rooms.nameDe"]} name="name_de" defaultValue={room.names.de} />
          <Field label={m["rooms.nameEn"]} name="name_en" defaultValue={room.names.en} />
          <Select label={m["rooms.roomType"]} name="roomTypeId" options={typeOptions} defaultValue={room.roomTypeId} />
          <Field label={m["rooms.floor"]} name="floor" defaultValue={room.floor} />
          <Select label={m["rooms.section"]} name="sectionId" options={sectionOptions} defaultValue={room.sectionId ?? ""} />
          <Field label={m["rooms.bedPlaces"]} name="bedPlaces" type="number" defaultValue={String(room.bedPlaces)} required />
          <Field label={m["rooms.extraBeds"]} name="extraBeds" type="number" defaultValue={String(room.extraBeds)} />
          <Field label={m["rooms.validFrom"]} name="validFrom" type="date" />
          <fieldset className="md:col-span-5">
            <legend className="text-sm text-ink-80">{m["rooms.features"]}</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {features.map((f) => (
                <label key={f.id} className="flex items-center gap-1">
                  <input type="checkbox" name="featureIds" value={f.id} defaultChecked={room.features.some((x) => x.id === f.id)} />
                  {f.name}
                </label>
              ))}
            </div>
          </fieldset>
        </ActionForm>
        <div className="mt-2 flex gap-2">
          <button type="button" onClick={() => setEditing(false)} className="rounded-full px-3 py-1 text-sm text-ink-60 hover:bg-ink-5">
            {m["shell.close"]}
          </button>
          <ActionForm action={removeRoom} submitLabel={m["action.delete"]} className="inline-grid">
            <Hidden property={property} id={room.id} />
          </ActionForm>
        </div>
      </td>
    </tr>
  );
}

function FeaturesTab({ property, features, m }: { property: { id: string }; features: RoomFeature[]; m: Messages }) {
  return (
    <div className="grid gap-4">
      <ul className="grid gap-2">
        {features.map((f) => (
          <li key={f.id} className="rounded-xl bg-surface-2 px-4 py-3">
            <ActionForm action={saveFeature} submitLabel={m["action.save"]} pendingLabel={m["action.saving"]} className="grid gap-3 md:grid-cols-4">
              <Hidden property={property} id={f.id} />
              <Field label={`${m["rooms.nameMain"]} (${f.code})`} name="name" defaultValue={f.name} required />
              <Field label={m["rooms.nameDe"]} name="name_de" defaultValue={f.names.de} />
              <Field label={m["rooms.nameEn"]} name="name_en" defaultValue={f.names.en} />
            </ActionForm>
            <ActionForm action={removeFeature} submitLabel={m["action.delete"]} className="mt-2 inline-grid">
              <Hidden property={property} id={f.id} />
            </ActionForm>
          </li>
        ))}
      </ul>
      <section className="rounded-2xl bg-surface-2 p-5">
        <h2 className="mb-3 font-medium">{m["rooms.newFeature"]}</h2>
        <ActionForm action={addFeature} submitLabel={m["action.add"]} className="grid gap-3 md:grid-cols-3">
          <Hidden property={property} />
          <Field label={m["rooms.nameMain"]} name="name" required />
          <Field label={m["rooms.nameDe"]} name="name_de" />
          <Field label={m["rooms.nameEn"]} name="name_en" />
        </ActionForm>
      </section>
    </div>
  );
}

function SectionsTab({ property, sections, m }: { property: { id: string }; sections: Section[]; m: Messages }) {
  return (
    <div className="grid gap-4">
      <ul className="grid gap-2">
        {sections.map((s) => (
          <li key={s.id} className="rounded-xl bg-surface-2 px-4 py-2">
            <ActionForm action={saveSection} submitLabel={m["action.save"]} className="flex flex-wrap items-end gap-3">
              <Hidden property={property} id={s.id} />
              <div className="min-w-48">
                <Field label={m["rooms.section"]} name="name" defaultValue={s.name} required />
              </div>
              <button type="submit" name="delete" value="1" className="h-10 rounded-full px-4 text-sm text-danger hover:bg-ink-5">
                {m["action.delete"]}
              </button>
            </ActionForm>
          </li>
        ))}
      </ul>
      <section className="rounded-2xl bg-surface-2 p-5">
        <h2 className="mb-3 font-medium">{m["rooms.newSection"]}</h2>
        <ActionForm action={addSection} submitLabel={m["action.add"]} className="grid max-w-sm gap-3">
          <Hidden property={property} />
          <Field label={m["rooms.section"]} name="name" required />
        </ActionForm>
      </section>
    </div>
  );
}

function AgeBandsTab({ property, ageBands, m }: { property: { id: string }; ageBands: AgeBand[]; m: Messages }) {
  const initial = ageBands.length
    ? ageBands.map((b) => ({ name: b.name, min: String(b.minAge), max: b.maxAge === null ? "" : String(b.maxAge) }))
    : [
        { name: "Infant", min: "0", max: "2" },
        { name: "Child", min: "3", max: "11" },
        { name: "Adult", min: "12", max: "" },
      ];
  const [rows, setRows] = useState(initial);
  return (
    <section className="rounded-2xl bg-surface-2 p-5">
      <p className="mb-3 text-sm text-ink-60">{m["rooms.ageBandsHelp"]}</p>
      <ActionForm action={saveBands} submitLabel={m["action.save"]} pendingLabel={m["action.saving"]} className="grid gap-3">
        <Hidden property={property} />
        {rows.map((r, i) => (
          <div key={i} className="grid gap-3 md:grid-cols-[1fr_8rem_8rem_auto]">
            <label className="grid gap-1 text-sm">
              <span className="text-ink-80">{m["field.name"]}</span>
              <input name="bandName" value={r.name} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className={inputClass} />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-80">{m["rooms.fromAge"]}</span>
              <input name="bandMin" type="number" value={r.min} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, min: e.target.value } : x)))} className={inputClass} />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-80">{m["rooms.toAge"]}</span>
              <input name="bandMax" type="number" value={r.max} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, max: e.target.value } : x)))} className={inputClass} />
            </label>
            <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} className="self-end rounded-full px-3 py-2 text-sm text-ink-60 hover:bg-ink-5">
              {m["action.delete"]}
            </button>
          </div>
        ))}
        <button type="button" onClick={() => setRows([...rows, { name: "", min: "", max: "" }])} className="justify-self-start rounded-full px-3 py-1 text-sm text-accent hover:bg-ink-5">
          + {m["action.add"]}
        </button>
      </ActionForm>
    </section>
  );
}
