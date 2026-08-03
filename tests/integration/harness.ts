import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

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

/** Fails fast with a clear message when no Docker CLI/daemon is available, instead of a
 * raw spawn error surfacing minutes later inside a test hook timeout. */
async function assertDockerAvailable(): Promise<void> {
  const available = await new Promise<boolean>((resolve) => {
    const proc = spawn("docker", ["info"], { stdio: "ignore" });
    proc.on("error", () => resolve(false));
    proc.on("exit", (code) => resolve(code === 0));
  });
  if (!available) {
    throw new Error(
      "Integration tests need Docker: the `docker` CLI is missing or the daemon is not " +
        "running. Start Docker (or colima/OrbStack) and re-run `npm run test:integration`.",
    );
  }
}

export async function startEmulator(): Promise<void> {
  await assertDockerAvailable();
  await run(["up", "-d"]);
  await waitForManagementApiReady();
}

export async function stopEmulator(): Promise<void> {
  await run(["down", "-v", "--remove-orphans"]);
}
