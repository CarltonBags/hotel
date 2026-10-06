-- Usage per property (ticket 44): WhatsApp messages are counted per property and month.
alter table control.usage_events add column property_id uuid;
create index usage_events_property_idx on control.usage_events(tenant_id, property_id, kind, at);
