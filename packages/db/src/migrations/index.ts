/** Node-only entry: reads migration files from disk. Never import from app code that is bundled. */
export { controlMigrations, loadMigrationsFromDir, tenantMigrations, type Migration } from "./load";
