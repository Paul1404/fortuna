import packageJson from "../../package.json";
import { pool } from "./db";
import { checkDatabaseSchema } from "./db/health";
import { createHealthCheck } from "./health-check";
import { objectStorageMode, objectStorageReady } from "./object-storage";

export const healthCheck = createHealthCheck(
	{
		database: () => checkDatabaseSchema(pool),
		storageMode: objectStorageMode,
		storage: objectStorageReady,
	},
	packageJson.version,
);
