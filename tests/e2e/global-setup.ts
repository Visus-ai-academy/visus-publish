import { startFakeAi } from "./fake-ai";
import { startFakeMeta } from "./fake-meta";
import { startFakeMetricool } from "./fake-metricool";

export default async function globalSetup() {
  const servers = [await startFakeMeta(), await startFakeMetricool(), await startFakeAi()];
  return () => Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r())))).then(() => undefined);
}
