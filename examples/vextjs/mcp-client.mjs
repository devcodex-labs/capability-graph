import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

/** Small stdio client for the integration example; no MCP dependency is added to the graph package. */
export class VextMcpClient {
  pending = new Map(); nextId = 1; buffer = ''; closed = false;
  constructor({ cli, projectRoot, node = process.execPath, timeoutMs = 10000 }) {
    this.timeoutMs = timeoutMs;
    this.child = spawn(node, [cli, 'mcp', '--root', projectRoot], { cwd: projectRoot, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stderr.on('data', () => {});
    this.exited = new Promise((resolve) => { this.child.once('exit', resolve); this.child.once('error', resolve); });
    const fail = () => { for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error('Native MCP transport closed')); } this.pending.clear(); };
    this.child.on('error', fail); this.child.on('exit', fail); this.child.stdin.on('error', fail);
    const decoder = new StringDecoder('utf8');
    this.child.stdout.on('data', (bytes) => {
      this.buffer += decoder.write(bytes);
      if (Buffer.byteLength(this.buffer) > 8 * 1024 * 1024) { this.child.kill('SIGTERM'); fail(); return; }
      let end;
      while ((end = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
        if (!line.trim()) continue;
        let message; try { message = JSON.parse(line); } catch { this.child.kill('SIGTERM'); fail(); return; }
        const item = this.pending.get(message.id);
        if (item) { this.pending.delete(message.id); clearTimeout(item.timer); message.error ? item.reject(new Error('Native MCP request rejected')) : item.resolve(message.result); }
      }
    });
  }
  async initialize() {
    await this.request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'capability-graph-vextjs', version: '1.0.0' } });
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    return this;
  }
  request(method, params) {
    if (this.closed || this.child.exitCode !== null) return Promise.reject(new Error('Native MCP client closed'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id); reject(new Error('Native MCP deadline exceeded'));
        // Kill the transport so a timeout cannot leave work running in the owned subprocess.
        void this.close();
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  async close() {
    this.closed = true; this.child.stdin.end();
    if (this.child.exitCode === null) this.child.kill('SIGTERM');
    const timer = setTimeout(() => { if (this.child.exitCode === null) this.child.kill('SIGKILL'); }, 2000);
    try { await this.exited; } finally { clearTimeout(timer); }
  }
}
