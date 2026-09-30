import { describe, expect, it } from "vitest";
import { PROPERTY_ROLES, can, type Actor } from "../src/permissions";

/**
 * Seam: the permission matrix as one pure function. Every server action asks
 * `can(actor, action, propertyId?)`. Roles add up; Owner and Tenant Admin act
 * as Property Manager at every property.
 */
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

const owner: Actor = { tenantRole: "owner", propertyRoles: [] };
const tenantAdmin: Actor = { tenantRole: "tenant_admin", propertyRoles: [] };
const pmAtA: Actor = { propertyRoles: [{ propertyId: A, role: "property_manager" }] };
const frontDeskAtA: Actor = { propertyRoles: [{ propertyId: A, role: "front_desk" }] };
const nobody: Actor = { propertyRoles: [] };

describe("tenant-level actions", () => {
  it("Owner and Tenant Admin manage Legal Entities, Properties and tenant roles", () => {
    for (const actor of [owner, tenantAdmin]) {
      expect(can(actor, "manage_legal_entities")).toBe(true);
      expect(can(actor, "manage_properties")).toBe(true);
      expect(can(actor, "manage_tenant_roles")).toBe(true);
    }
  });

  it("only the Owner manages the subscription and may delete the tenant", () => {
    expect(can(owner, "manage_subscription")).toBe(true);
    expect(can(tenantAdmin, "manage_subscription")).toBe(false);
    expect(can(owner, "delete_tenant")).toBe(true);
    expect(can(tenantAdmin, "delete_tenant")).toBe(false);
  });

  it("a Property Manager cannot assign tenant roles or create Legal Entities", () => {
    expect(can(pmAtA, "manage_tenant_roles")).toBe(false);
    expect(can(pmAtA, "manage_legal_entities")).toBe(false);
    expect(can(pmAtA, "manage_properties")).toBe(false);
  });
});

describe("property-level actions", () => {
  it("a Property Manager manages users and roles at their own property only", () => {
    expect(can(pmAtA, "manage_property_users", A)).toBe(true);
    expect(can(pmAtA, "manage_property_users", B)).toBe(false);
  });

  it("Front Desk at property A can open A but not B", () => {
    expect(can(frontDeskAtA, "view_property", A)).toBe(true);
    expect(can(frontDeskAtA, "view_property", B)).toBe(false);
    expect(can(frontDeskAtA, "manage_property_users", A)).toBe(false);
  });

  it("Owner and Tenant Admin act as Property Manager at every property, even ones created later", () => {
    for (const actor of [owner, tenantAdmin]) {
      expect(can(actor, "manage_property_users", B)).toBe(true);
      expect(can(actor, "view_property", B)).toBe(true);
    }
  });

  it("a property action without a property is never allowed", () => {
    expect(can(owner, "view_property")).toBe(false);
  });

  it("roles add up: Front Desk at A plus Property Manager at B", () => {
    const both: Actor = {
      propertyRoles: [
        { propertyId: A, role: "front_desk" },
        { propertyId: B, role: "property_manager" },
      ],
    };
    expect(can(both, "view_property", A)).toBe(true);
    expect(can(both, "manage_property_users", A)).toBe(false);
    expect(can(both, "manage_property_users", B)).toBe(true);
  });

  it("every one of the ten property roles may view its own property", () => {
    const roles = [
      "property_manager",
      "front_desk",
      "housekeeper",
      "housekeeping_supervisor",
      "maintenance",
      "accounting",
      "revenue",
      "service",
      "spa_staff",
      "outlet_manager",
    ] as const;
    for (const role of roles) {
      expect(can({ propertyRoles: [{ propertyId: A, role }] }, "view_property", A)).toBe(true);
    }
  });

  it("of the ten property roles only Property Manager manages users and settings at the property", () => {
    for (const role of PROPERTY_ROLES) {
      const actor: Actor = { propertyRoles: [{ propertyId: A, role }] };
      expect(can(actor, "manage_property_users", A)).toBe(role === "property_manager");
      expect(can(actor, "manage_property_settings", A)).toBe(role === "property_manager");
      expect(can(actor, "manage_tenant_roles")).toBe(false);
    }
  });

  it("nobody with no roles can do nothing", () => {
    expect(can(nobody, "view_property", A)).toBe(false);
    expect(can(nobody, "manage_legal_entities")).toBe(false);
  });
});
