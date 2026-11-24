import { startFakeMeta } from "./fake-meta";

export default async function globalSetup() {
  const server = await startFakeMeta();
  return () => new Promise<void>((r) => server.close(() => r()));
}
