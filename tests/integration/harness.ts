import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Drives docker compose directly rather than via testcontainers-node, which has open,
// unresolved GitHub issues around Docker-runtime-detection failing specifically under
// Bun. Now that tests run under plain Node, testcontainers-node is not disqualified for
// that reason anymore, but the direct-compose approach already works and adds no
// dependency, so there's no reason to switch. See the plan's Testing strategy section.

const COMPOSE_FILE = fileURLToPath(
  new URL("../../docker/servicebus-emulator/docker-compose.test.yml", import.meta.url),
);

export const TEST_MANAGEMENT_PORT = 5301;
export const TEST_AMQP_PORT = 5673;

export const TEST_MESSAGING_CONNECTION_STRING = `Endpoint=sb://localhost:${TEST_AMQP_PORT};SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=SAS_KEY_VALUE;UseDevelopmentEmulator=true;`;

async function run(args: string[]): Promise<void> {
  const exitCode = await new Promise<number>((resolve, reject) => {
    const proc = spawn("docker", ["compose", "-f", COMPOSE_FILE, ...args], {
      stdio: "inherit",
    });
    proc.on("error", reject);
    proc.on("exit", (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) {
    throw new Error(`docker compose ${args.join(" ")} failed with exit code ${exitCode}`);
  }
}

async function waitForManagementApiReady(timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${TEST_MANAGEMENT_PORT}/`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) return;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(
    `emulator management API did not become ready within ${timeoutMs}ms: ${String(lastError)}`,
  );
}

export async function startEmulator(): Promise<void> {
  await run(["up", "-d"]);
  await waitForManagementApiReady();
}

export async function stopEmulator(): Promise<void> {
  await run(["down", "-v", "--remove-orphans"]);
}
