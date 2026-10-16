// The MCP server as its own process: npm run mcp (dev: npm run mcp:dev, or npm run dev for everything).
import { config } from '../config.js';
import { connectDb } from '../db.js';
import { createMcpApp } from './app.js';

if (!config.agentMasterKey) console.warn('[mcp] AGENT_MASTER_KEY is not set: live calls cannot use the booking tools');
if (config.env === 'production' && !process.env.MCP_SECRET)
  console.warn('[mcp] set MCP_SECRET in production (call tokens are signed with it)');

await connectDb();
const server = createMcpApp().listen(config.mcp.port, config.mcp.host, () => {
  console.log(`Hotel MCP on http://${config.mcp.host}:${config.mcp.port}/mcp  ·  tools call ${config.mcp.backendUrl}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
