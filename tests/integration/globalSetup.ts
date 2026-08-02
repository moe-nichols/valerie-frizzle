import { startEmulator, stopEmulator } from './harness'

export default async function setup() {
  await startEmulator();
  return async () => {
    await stopEmulator();
  };
}
