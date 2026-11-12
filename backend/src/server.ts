import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const { app, ctx } = createApp(config);

const server = app.listen(config.port, () => {
  console.log(JSON.stringify({ level: 'info', msg: 'listening', port: config.port, publicBaseUrl: config.publicBaseUrl }));
});

// Close guest sessions that stopped sending heartbeats, and prune rate-limit windows.
const sweeper = setInterval(() => {
  const closed = ctx.playback.sweepIdleSessions();
  if (closed > 0) console.log(JSON.stringify({ level: 'info', msg: 'idle_sessions_closed', count: closed }));
}, 60_000);
sweeper.unref();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    clearInterval(sweeper);
    server.close(() => process.exit(0));
  });
}
