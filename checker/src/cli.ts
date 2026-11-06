// pnpm checker  -  run the risk checker as a standalone HTTP server (GET /health, POST /verdict).
import { configFromEnv, REPO_ROOT } from "./config.ts";
import { buildServer, createChecker } from "./server.ts";

async function main() {
  try {
    process.loadEnvFile(`${REPO_ROOT}/.env`);
  } catch {
    // no .env: rely on the process environment
  }
  const config = configFromEnv();
  const checker = createChecker(config);
  const app = buildServer(checker);
  const addr = await app.listen({ host: config.host, port: config.port });
  console.log(`checker listening on ${addr} (vault ${config.vault}, key ${checker.key.publicKey})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
