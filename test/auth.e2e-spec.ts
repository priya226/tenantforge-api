import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';

import {
  ADMIN,
  createE2eApp,
  createTenant as createTenantVia,
  login,
  PASSWORD,
  resetDatabase,
} from './e2e-app.js';

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let platformToken: string;

  const http = () => request(app.getHttpServer());

  const createTenant = (name: string) =>
    createTenantVia(app, platformToken, name);

  beforeAll(async () => {
    app = await createE2eApp();
  });

  beforeEach(async () => {
    await resetDatabase(app);
    platformToken = (await login(app, ADMIN.email, ADMIN.password)).accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('login', () => {
    it('returns an access token, its lifetime and a refresh token', async () => {
      const res = await http()
        .post('/auth/login')
        .send({ email: ADMIN.email, password: ADMIN.password })
        .expect(200);

      expect(res.body).toEqual({
        accessToken: expect.any(String),
        expiresIn: 900,
        refreshToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      });
    });

    it('gives the same 401 for a wrong password and an unknown email', async () => {
      const wrongPassword = await http()
        .post('/auth/login')
        .send({ email: ADMIN.email, password: 'not-the-password' })
        .expect(401);
      const unknownEmail = await http()
        .post('/auth/login')
        .send({ email: 'nobody@e2e.test', password: 'not-the-password' })
        .expect(401);

      expect(wrongPassword.body).toEqual(unknownEmail.body);
    });

    it('rejects a malformed body with 400', async () => {
      await http()
        .post('/auth/login')
        .send({ email: 'not-an-email', password: 'x' })
        .expect(400);
    });
  });

  describe('protected routes', () => {
    it('return 401 without a token or with a bad one', async () => {
      await http().get('/roles').expect(401);
      await http()
        .get('/roles')
        .set('Authorization', 'Bearer not.a.jwt')
        .expect(401);
    });

    it('return 403 when the role is not allowed', async () => {
      const acme = await createTenant('Acme');
      const viewer = await login(app, acme.viewerEmail, PASSWORD);
      const admin = await login(app, acme.adminEmail, PASSWORD);

      await http()
        .get('/companies')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(403);
      await http()
        .get(`/users/${acme.viewerId}`)
        .set('Authorization', `Bearer ${viewer.accessToken}`)
        .expect(403);
    });

    it('let any logged-in user read GET /roles', async () => {
      const acme = await createTenant('Acme');
      const viewer = await login(app, acme.viewerEmail, PASSWORD);

      await http()
        .get('/roles')
        .set('Authorization', `Bearer ${viewer.accessToken}`)
        .expect(200);
    });
  });

  describe('GET /users/me', () => {
    it('returns the caller, including a viewer, without the password hash', async () => {
      const acme = await createTenant('Acme');
      const viewer = await login(app, acme.viewerEmail, PASSWORD);

      const res = await http()
        .get('/users/me')
        .set('Authorization', `Bearer ${viewer.accessToken}`)
        .expect(200);

      expect(res.body).toMatchObject({
        id: acme.viewerId,
        email: acme.viewerEmail,
        companyId: acme.companyId,
        roles: ['VIEWER'],
      });
      expect(res.body).not.toHaveProperty('passwordHash');
    });
  });

  describe('tenant scope', () => {
    it('lets a company admin manage users of their own company', async () => {
      const acme = await createTenant('Acme');
      const admin = await login(app, acme.adminEmail, PASSWORD);
      const auth = { Authorization: `Bearer ${admin.accessToken}` };

      await http().get(`/users/${acme.viewerId}`).set(auth).expect(200);
      await http()
        .put(`/users/${acme.viewerId}/roles`)
        .set(auth)
        .send({ roles: ['COMPANY_ADMIN'] })
        .expect(200);
      await http()
        .post('/users')
        .set(auth)
        .send({
          companyId: acme.companyId,
          name: 'New',
          email: 'new@acme.test',
          password: PASSWORD,
        })
        .expect(201);
    });

    it('hides other companies behind 404', async () => {
      const acme = await createTenant('Acme');
      const globex = await createTenant('Globex');
      const admin = await login(app, acme.adminEmail, PASSWORD);
      const auth = { Authorization: `Bearer ${admin.accessToken}` };

      await http().get(`/users/${globex.adminId}`).set(auth).expect(404);
      await http().get(`/users/${globex.adminId}/roles`).set(auth).expect(404);
      await http()
        .put(`/users/${globex.adminId}/roles`)
        .set(auth)
        .send({ roles: ['VIEWER'] })
        .expect(404);
      await http()
        .post('/users')
        .set(auth)
        .send({
          companyId: globex.companyId,
          name: 'Spy',
          email: 'spy@acme.test',
          password: PASSWORD,
        })
        .expect(404);

      const roles = await http()
        .get(`/users/${globex.adminId}/roles`)
        .set('Authorization', `Bearer ${platformToken}`)
        .expect(200);
      expect(roles.body).toEqual({ roles: ['COMPANY_ADMIN'] });
    });
  });

  describe('refresh and logout', () => {
    it('rotates the refresh token on every refresh', async () => {
      const first = await login(app, ADMIN.email, ADMIN.password);

      const res = await http()
        .post('/auth/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(200);
      const second = res.body as { accessToken: string; refreshToken: string };

      expect(second.refreshToken).not.toBe(first.refreshToken);
      await http()
        .get('/users/me')
        .set('Authorization', `Bearer ${second.accessToken}`)
        .expect(200);
    });

    it('ends the whole session when an old refresh token is replayed', async () => {
      const first = await login(app, ADMIN.email, ADMIN.password);
      const rotated = await http()
        .post('/auth/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(200);
      const current = (rotated.body as { refreshToken: string }).refreshToken;

      await http()
        .post('/auth/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(401);
      await http()
        .post('/auth/refresh')
        .send({ refreshToken: current })
        .expect(401);
    });

    it('logout ends only that session', async () => {
      const laptop = await login(app, ADMIN.email, ADMIN.password);
      const phone = await login(app, ADMIN.email, ADMIN.password);

      await http()
        .post('/auth/logout')
        .send({ refreshToken: laptop.refreshToken })
        .expect(204);

      await http()
        .post('/auth/refresh')
        .send({ refreshToken: laptop.refreshToken })
        .expect(401);
      await http()
        .post('/auth/refresh')
        .send({ refreshToken: phone.refreshToken })
        .expect(200);
    });

    it('refresh picks up a role change', async () => {
      const acme = await createTenant('Acme');
      const viewer = await login(app, acme.viewerEmail, PASSWORD);
      await http()
        .put(`/users/${acme.viewerId}/roles`)
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ roles: ['COMPANY_ADMIN'] })
        .expect(200);

      const refreshed = await http()
        .post('/auth/refresh')
        .send({ refreshToken: viewer.refreshToken })
        .expect(200);
      const token = (refreshed.body as { accessToken: string }).accessToken;

      await http()
        .get(`/users/${acme.adminId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });
  });
});
