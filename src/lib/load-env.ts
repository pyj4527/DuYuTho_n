import { config } from "dotenv";

config();
config({ override: true, path: ".env.clerk.local" });
