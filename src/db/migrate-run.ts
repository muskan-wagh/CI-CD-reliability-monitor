import { loadConfig } from "../config.js";
import { migrate } from "./migrate.js";

const config = loadConfig();
const applied = await migrate(config.databaseUrl);

if (applied.length > 0) {
  console.log(`Applied migrations: ${applied.join(", ")}`);
} else {
  console.log("No pending migrations.");
}
