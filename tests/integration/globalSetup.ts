import { startEmulator, stopEmulator } from "./harness.ts";

export default async function setup() {
  await startEmulator();
  return async () => {
    await stopEmulator();
  };
}
