"use server";

import { revalidatePath } from "next/cache";
import { PROPERTY_ROLES, TENANT_ROLES, can, type PropertyRole, type PropertyRoleAssignment, type TenantRole } from "@hoteloftware/domain";
import { countOwners, findTenantUser, inControlTransaction, listProperties, setPropertyRoles, setTenantRole, type Property } from "@hoteloftware/db";
import { inviteUser, pendingUserByEmail } from "@hoteloftware/auth/invitations";
import { authorize, ForbiddenError, requirePrincipal, type Principal } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { env } from "@/lib/env";
import { field, formAction, type FormState } from "@/lib/form";

function isTenantRole(v: string): v is TenantRole {
  return (TENANT_ROLES as readonly string[]).includes(v);
}
function isPropertyRole(v: string): v is PropertyRole {
  return (PROPERTY_ROLES as readonly string[]).includes(v);
}

/**
 * What the form asks for, reduced to what this tenant has: fields named
 * `role:<propertyId>` for properties that exist here, and the tenant role
 * if the field was sent at all.
 */
async function readRoleForm(principal: Principal, formData: FormData) {
  const properties = await listProperties(pool(), principal.tenant.schemaName);
  const known = new Map(properties.map((p) => [p.id, p] as const));
  const wanted = new Map<Property, PropertyRole[]>();
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("role:")) continue;
    const property = known.get(key.slice("role:".length));
    const role = String(value);
    if (!property || !isPropertyRole(role)) continue;
    wanted.set(property, [...(wanted.get(property) ?? []), role]);
  }
  const tenantRoleSent = formData.has("tenantRole");
  const tenantRoleValue = field(formData, "tenantRole");
  return {
    properties,
    wanted,
    tenantRoleSent,
    tenantRole: isTenantRole(tenantRoleValue) ? tenantRoleValue : null,
  };
}

/** Every property the form touches, and the tenant role if sent, go through authorize(). */
async function authorizeRoleForm(form: Awaited<ReturnType<typeof readRoleForm>>): Promise<void> {
  if (form.tenantRoleSent) await authorize("manage_tenant_roles");
  for (const property of form.wanted.keys()) await authorize("manage_property_users", property.id);
}

export async function invite(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const principal = await requirePrincipal();
    const { tenant, session, actor } = principal;
    const form = await readRoleForm(principal, formData);
    await authorizeRoleForm(form);
    const email = field(formData, "email");

    // Re-inviting an already invited person only rotates their link. Allowed only
    // when the inviter may manage every role that person already holds, so a
    // Property Manager can never take over a pending user of another property.
    const pending = await pendingUserByEmail(pool(), tenant.id, email);
    if (pending === "taken") throw new Error("This email address cannot be invited.");
    if (pending) {
      if (pending.tenantRole && !can(actor, "manage_tenant_roles")) throw new ForbiddenError("manage_tenant_roles");
      for (const r of pending.propertyRoles) await authorize("manage_property_users", r.propertyId);
    } else if (form.wanted.size === 0 && !form.tenantRole) {
      throw new Error("Choose at least one role.");
    }

    const propertyRoles: PropertyRoleAssignment[] = [];
    for (const [property, roles] of form.wanted) for (const role of roles) propertyRoles.push({ propertyId: property.id, role });
    const invitation = await inviteUser(pool(), {
      tenantId: tenant.id,
      invitedBy: session.user.id,
      email,
      name: field(formData, "name"),
      tenantRole: form.tenantRole ?? undefined,
      propertyRoles,
    });
    // Built from configuration, never from request headers.
    const scheme = env.authUrl.startsWith("https") ? "https" : "http";
    const link = `${scheme}://${tenant.slug}.${env.appDomain}/invite/${invitation.token}`;
    revalidatePath("/settings/users");
    const days = Math.round((invitation.expiresAt.getTime() - Date.now()) / 86_400_000);
    return {
      ok: true,
      message: `${pending ? "New invitation link" : "Invitation link"} (valid ${days} days), send it to the person: ${link}`,
    };
  });
}

export async function updateRoles(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const principal = await requirePrincipal();
    const { tenant, session, actor } = principal;
    const userId = field(formData, "userId");
    const user = await findTenantUser(pool(), tenant.id, userId);
    if (!user) throw new Error("User not found");
    const form = await readRoleForm(principal, formData);
    await authorizeRoleForm(form);

    // Only properties the actor manages are touched; the user's roles elsewhere stay as they are.
    const managed = form.properties.filter((p) => can(actor, "manage_property_users", p.id));
    if (managed.length === 0 && !form.tenantRoleSent) throw new ForbiddenError("manage_property_users");

    await inControlTransaction(pool(), async (tx) => {
      if (form.tenantRoleSent) {
        if (user.id === session.user.id && !form.tenantRole) throw new Error("You cannot remove your own tenant role.");
        if (user.tenantRole === "owner" && form.tenantRole !== "owner" && (await countOwners(tx, tenant.id)) <= 1) {
          throw new Error("A tenant needs at least one Owner. Make someone else Owner first.");
        }
        await setTenantRole(tx, { tenantId: tenant.id, userId, role: form.tenantRole, grantedBy: session.user.id });
      }
      for (const property of managed) {
        await setPropertyRoles(tx, {
          tenantId: tenant.id,
          userId,
          propertyId: property.id,
          roles: form.wanted.get(property) ?? [],
          grantedBy: session.user.id,
        });
      }
    });
    revalidatePath("/settings/users");
    return { ok: true, message: "Roles saved." };
  });
}
