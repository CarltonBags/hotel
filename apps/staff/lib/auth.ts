import { createAuth, type Auth } from "@hoteloftware/auth";
import { pool } from "./db";
import { env } from "./env";

const globalForAuth = globalThis as unknown as { __auth?: Auth };

export function auth(): Auth {
  globalForAuth.__auth ??= createAuth({
    pool: pool(),
    appDomain: env.appDomain,
    secret: env.authSecret,
    baseURL: env.authUrl,
  });
  return globalForAuth.__auth;
}
