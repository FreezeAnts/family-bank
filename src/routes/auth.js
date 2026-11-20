import {
  buildGoogleAuthUrl,
  consumeOAuthState,
  createOAuthState,
  exchangeCodeForUser,
} from '../auth/google.js';
import { config, googleOAuthConfigured } from '../config.js';
import { getUserByEmail, requireUser } from '../auth/rbac.js';
import { writeAudit } from '../services/audit.js';

export async function authRoutes(fastify) {
  fastify.get('/auth/google', async (request, reply) => {
    if (!googleOAuthConfigured()) {
      return reply.code(503).send({
        error: 'Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
      });
    }
    const state = createOAuthState();
    request.session.oauthState = state;
    return reply.redirect(buildGoogleAuthUrl(state));
  });

  fastify.get('/auth/google/callback', async (request, reply) => {
    const { code, state, error } = request.query;
    if (error) return reply.redirect('/?error=oauth_denied');
    if (!code || !state || !consumeOAuthState(state)) {
      return reply.redirect('/?error=oauth_state');
    }
    try {
      const user = await exchangeCodeForUser(code);
      await request.session.regenerate();
      request.session.userId = user.id;
      request.session.role = user.role;
      writeAudit({
        actorUserId: user.id,
        action: 'login',
        entityType: 'session',
        entityId: user.id,
        ip: request.headers['cf-connecting-ip'] || request.ip,
      });
      return reply.redirect('/');
    } catch (err) {
      request.log.error(err);
      return reply.redirect(`/?error=${encodeURIComponent(err.message || 'login_failed')}`);
    }
  });

  fastify.post('/auth/logout', async (request, reply) => {
    const userId = request.session?.userId;
    if (userId) {
      writeAudit({
        actorUserId: userId,
        action: 'logout',
        entityType: 'session',
        entityId: userId,
      });
    }
    await request.session.destroy();
    return reply.send({ ok: true });
  });

  fastify.get('/api/me', async (request, reply) => {
    try {
      const user = requireUser(request);
      return {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        role: user.role,
        googleConfigured: googleOAuthConfigured(),
        currency: 'CAD',
      };
    } catch {
      return reply.code(401).send({
        error: 'Unauthorized',
        googleConfigured: googleOAuthConfigured(),
        devAuthEnabled: config.devAuthEnabled,
      });
    }
  });

  if (config.devAuthEnabled) {
    fastify.post('/auth/dev-login', async (request, reply) => {
      const email = String(request.body?.email || '').toLowerCase();
      const user = getUserByEmail(email);
      if (!user) return reply.code(403).send({ error: 'User not seeded' });
      await request.session.regenerate();
      request.session.userId = user.id;
      request.session.role = user.role;
      return { ok: true, role: user.role };
    });
  }
}
