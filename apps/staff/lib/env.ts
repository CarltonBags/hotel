function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export const env = {
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  get appDomain() {
    return required("APP_DOMAIN");
  },
  get authSecret() {
    return required("BETTER_AUTH_SECRET");
  },
  get authUrl() {
    return required("BETTER_AUTH_URL");
  },
};
