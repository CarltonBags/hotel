"use server";

import { setFloorLanguage } from "@hoteloftware/db";
import { floorContext } from "@/lib/floor";
import { pool } from "@/lib/db";

/** The phone view's language, a setting per user. */
export async function setFloorLanguageAction(language: string): Promise<void> {
  const ctx = await floorContext();
  if (!ctx) return;
  await setFloorLanguage(pool(), ctx.session.user.id, language);
}
