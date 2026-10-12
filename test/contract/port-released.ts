import { createServer } from "node:net";

export async function assertPortReleased(port: number) {
  const probe = createServer();
  try { await new Promise<void>((resolve, reject) => { probe.once("error", reject); probe.listen(port, "127.0.0.1", resolve); }); }
  finally { if (probe.listening) await new Promise<void>((resolve, reject) => probe.close((error) => error ? reject(error) : resolve())); }
}
