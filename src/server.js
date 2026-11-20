import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCookie from '@fastify/cookie';
import fastifySession from '@fastify/session';
import fastifyFormbody from '@fastify/formbody';
import fastifyHelmet from '@fastify/helmet';
import path from 'node:path';
import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { seed } from './db/seed.js';
import { authRoutes } from './routes/auth.js';
import { apiRoutes } from './routes/api.js';
import { adminRoutes } from './routes/admin.js';
import { startJobs } from './jobs/scheduler.js';
import { checkLatest, shouldCheckOnStartup, currentVersion } from './services/updates.js';

async function buildServer() {
  migrate();
  seed();

  const app = Fastify({
    logger: true,
    trustProxy: true,
  });

  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://cdn.jsdelivr.net', 'https://unpkg.com'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameSrc: ["'none'"],
        // Allow LAN HTTP access; Cloudflare already terminates TLS for public HTTPS.
        upgradeInsecureRequests: null,
      },
    },
  });
  await app.register(fastifyFormbody);
  await app.register(fastifyCookie);
  await app.register(fastifySession, {
    secret: config.sessionSecret,
    cookie: {
      secure: config.env === 'production',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 12,
    },
    saveUninitialized: false,
  });

  await app.register(fastifyStatic, {
    root: config.publicDir,
    prefix: '/',
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    const status = error.statusCode || 400;
    reply.code(status).send({ error: error.message || 'Request failed' });
  });

  await app.register(authRoutes);
  await app.register(apiRoutes);
  await app.register(adminRoutes);

  app.get('/healthz', async () => ({ ok: true, version: currentVersion() }));

  // SPA fallback
  app.setNotFoundHandler(async (request, reply) => {
    if (request.method === 'GET' && !request.url.startsWith('/api') && !request.url.startsWith('/auth')) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: 'Not found' });
  });

  return app;
}

const app = await buildServer();
startJobs(app.log);

await app.listen({ host: config.host, port: config.port });
app.log.info(`Family Bank ${currentVersion()} listening on ${config.host}:${config.port}`);

if (shouldCheckOnStartup()) {
  checkLatest()
    .then((result) => {
      if (result.errorMessage) {
        app.log.warn({ err: result.errorMessage }, 'Startup update check failed');
        return;
      }
      if (result.updateAvailable) {
        app.log.info(
          { current: result.currentVersion, latest: result.latestVersion, url: result.releaseUrl },
          'Update available'
        );
      } else {
        app.log.info({ version: result.currentVersion }, 'Family Bank is up to date');
      }
    })
    .catch((err) => app.log.warn({ err }, 'Startup update check failed'));
}
