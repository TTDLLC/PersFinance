import { app } from "./app.js";
import { env } from "./config/env.js";
import { pool } from "./db/index.js";

const server = app.listen(env.PORT, () => {
  console.log(`PersFinance app running at http://localhost:${env.PORT}`);
});

const shutdown = async () => {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
