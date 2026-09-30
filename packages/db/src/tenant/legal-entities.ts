import type { Pool } from "pg";
import { isCountryCode } from "@hoteloftware/domain";
import { withTenant } from "./with-tenant";

export interface LegalEntityInput {
  name: string;
  addressLine1?: string;
  addressLine2?: string;
  postalCode?: string;
  city?: string;
  country: string;
  vatId?: string;
  iban?: string;
  bic?: string;
  accountHolder?: string;
}

export interface LegalEntity extends Required<LegalEntityInput> {
  id: string;
  createdAt: Date;
}

interface Row {
  id: string;
  name: string;
  address_line1: string;
  address_line2: string;
  postal_code: string;
  city: string;
  country: string;
  vat_id: string;
  iban: string;
  bic: string;
  account_holder: string;
  created_at: Date;
}

function toLegalEntity(r: Row): LegalEntity {
  return {
    id: r.id,
    name: r.name,
    addressLine1: r.address_line1,
    addressLine2: r.address_line2,
    postalCode: r.postal_code,
    city: r.city,
    country: r.country,
    vatId: r.vat_id,
    iban: r.iban,
    bic: r.bic,
    accountHolder: r.account_holder,
    createdAt: r.created_at,
  };
}

function validate(input: LegalEntityInput): void {
  if (!input.name.trim()) throw new Error("A Legal Entity needs a name");
  if (!isCountryCode(input.country)) throw new Error(`Unknown country: ${input.country}`);
}

const COLUMNS = "id, name, address_line1, address_line2, postal_code, city, country, vat_id, iban, bic, account_holder, created_at";

export async function createLegalEntity(pool: Pool, schema: string, input: LegalEntityInput): Promise<LegalEntity> {
  validate(input);
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<Row>(
      `insert into legal_entities (name, address_line1, address_line2, postal_code, city, country, vat_id, iban, bic, account_holder)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning ${COLUMNS}`,
      [
        input.name.trim(),
        input.addressLine1 ?? "",
        input.addressLine2 ?? "",
        input.postalCode ?? "",
        input.city ?? "",
        input.country,
        (input.vatId ?? "").replaceAll(" ", "").toUpperCase(),
        (input.iban ?? "").replaceAll(" ", "").toUpperCase(),
        (input.bic ?? "").trim().toUpperCase(),
        input.accountHolder ?? "",
      ],
    );
    return toLegalEntity(rows[0]!);
  });
}

export async function updateLegalEntity(pool: Pool, schema: string, id: string, input: LegalEntityInput): Promise<LegalEntity> {
  validate(input);
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<Row>(
      `update legal_entities set name = $2, address_line1 = $3, address_line2 = $4, postal_code = $5, city = $6, country = $7,
         vat_id = $8, iban = $9, bic = $10, account_holder = $11, updated_at = now()
       where id = $1 returning ${COLUMNS}`,
      [
        id,
        input.name.trim(),
        input.addressLine1 ?? "",
        input.addressLine2 ?? "",
        input.postalCode ?? "",
        input.city ?? "",
        input.country,
        (input.vatId ?? "").replaceAll(" ", "").toUpperCase(),
        (input.iban ?? "").replaceAll(" ", "").toUpperCase(),
        (input.bic ?? "").trim().toUpperCase(),
        input.accountHolder ?? "",
      ],
    );
    if (!rows[0]) throw new Error("Legal Entity not found");
    return toLegalEntity(rows[0]);
  });
}

export async function listLegalEntities(pool: Pool, schema: string): Promise<LegalEntity[]> {
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<Row>(`select ${COLUMNS} from legal_entities order by name`);
    return rows.map(toLegalEntity);
  });
}

export async function findLegalEntity(pool: Pool, schema: string, id: string): Promise<LegalEntity | null> {
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<Row>(`select ${COLUMNS} from legal_entities where id = $1`, [id]);
    return rows[0] ? toLegalEntity(rows[0]) : null;
  });
}
