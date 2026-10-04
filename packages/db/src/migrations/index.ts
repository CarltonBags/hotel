/** Node-only entry: reads migration files from disk. Bundled app code passes the directory itself (loadMigrationsFromDir): the default location is resolved from this file, which a bundle moves. */
export { controlMigrations, loadMigrationsFromDir, tenantMigrations, type Migration } from "./load";
