import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';

import {
  ADMIN,
  createE2eApp,
  createTenant,
  login,
  PASSWORD,
  resetDatabase,
  type Tenant,
} from './e2e-app.js';

interface UserItem {
  id: string;
  email: string;
  name: string;
  companyId: string | null;
  roles: string[];
}

interface Page {
  items: UserItem[];
  total: number;
}

describe('Users (e2e)', () => {
  let app: INestApplication<App>;
  let platformToken: string;
  let acme: Tenant;
  let globex: Tenant;

  const http = () => request(app.getHttpServer());

  async function list(token: string, query = ''): Promise<Page> {
    const res = await http()
      .get(`/users${query}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body as Page;
  }

  beforeAll(async () => {
    app = await createE2eApp();
  });

  beforeEach(async () => {
    await resetDatabase(app);
    platformToken = (await login(app, ADMIN.email, ADMIN.password)).accessToken;
    acme = await createTenant(app, platformToken, 'Acme');
    globex = await createTenant(app, platformToken, 'Globex');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /users', () => {
    it('shows a company admin only their own company, with roles', async () => {
      const { accessToken } = await login(app, acme.adminEmail, PASSWORD);

      const page = await list(accessToken);

      expect(page.total).toBe(2);
      expect(page.items.map((u) => u.companyId)).toEqual([
        acme.companyId,
        acme.companyId,
      ]);
      expect(page.items.map((u) => [u.email, u.roles])).toEqual([
        [acme.viewerEmail, ['VIEWER']],
        [acme.adminEmail, ['COMPANY_ADMIN']],
      ]);
      expect(page.items[0]).not.toHaveProperty('passwordHash');
    });

    it('shows a platform admin every user, newest first', async () => {
      const page = await list(platformToken);

      expect(page.total).toBe(5);
      expect(page.items.map((u) => u.email)).toEqual([
        globex.viewerEmail,
        globex.adminEmail,
        acme.viewerEmail,
        acme.adminEmail,
        ADMIN.email,
      ]);
    });

    it('lets a platform admin filter by company', async () => {
      const page = await list(platformToken, `?companyId=${globex.companyId}`);

      expect(page.total).toBe(2);
      expect(page.items.every((u) => u.companyId === globex.companyId)).toBe(
        true,
      );
    });

    it('returns 404 when a company admin filters by another company', async () => {
      const { accessToken } = await login(app, acme.adminEmail, PASSWORD);

      await http()
        .get(`/users?companyId=${globex.companyId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);
      const own = await list(accessToken, `?companyId=${acme.companyId}`);
      expect(own.total).toBe(2);
    });

    it('searches email and name, case-insensitively, inside the scope', async () => {
      const { accessToken } = await login(app, acme.adminEmail, PASSWORD);

      const byName = await list(accessToken, '?q=VIEWER');
      expect(byName.items.map((u) => u.email)).toEqual([acme.viewerEmail]);

      const byEmail = await list(accessToken, '?q=admin%40acme');
      expect(byEmail.items.map((u) => u.email)).toEqual([acme.adminEmail]);

      const otherCompany = await list(accessToken, '?q=globex');
      expect(otherCompany.total).toBe(0);
    });

    it('treats % and _ in the search as plain characters', async () => {
      const everything = await list(platformToken, '?q=%25');
      const anyChar = await list(platformToken, '?q=_');

      expect(everything.total).toBe(0);
      expect(anyChar.total).toBe(0);
    });

    it('pages with limit and offset; total counts every match', async () => {
      const first = await list(platformToken, '?limit=2&offset=0');
      const second = await list(platformToken, '?limit=2&offset=2');
      const last = await list(platformToken, '?limit=2&offset=4');

      expect([first.total, second.total, last.total]).toEqual([5, 5, 5]);
      const ids = [...first.items, ...second.items, ...last.items].map(
        (u) => u.id,
      );
      expect(ids).toHaveLength(5);
      expect(new Set(ids).size).toBe(5);
    });

    it('rejects bad paging and filters with 400', async () => {
      const auth = { Authorization: `Bearer ${platformToken}` };

      await http().get('/users?limit=101').set(auth).expect(400);
      await http().get('/users?limit=0').set(auth).expect(400);
      await http().get('/users?offset=-1').set(auth).expect(400);
      await http().get('/users?companyId=nope').set(auth).expect(400);
      await http().get('/users?sort=name').set(auth).expect(400);
    });

    it('is not available to a viewer (list)', async () => {
      const { accessToken } = await login(app, acme.viewerEmail, PASSWORD);

      await http()
        .get('/users')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(403);
    });
  });

  describe('PATCH /users/:id', () => {
    it('lets a company admin rename a user of their company', async () => {
      const { accessToken } = await login(app, acme.adminEmail, PASSWORD);
      const auth = { Authorization: `Bearer ${accessToken}` };

      const res = await http()
        .patch(`/users/${acme.viewerId}`)
        .set(auth)
        .send({ name: '  Renamed Viewer  ' })
        .expect(200);

      expect(res.body).toMatchObject({
        id: acme.viewerId,
        name: 'Renamed Viewer',
        email: acme.viewerEmail,
        roles: ['VIEWER'],
      });
      expect(res.body).not.toHaveProperty('passwordHash');
      const again = await http()
        .get(`/users/${acme.viewerId}`)
        .set(auth)
        .expect(200);
      expect((again.body as UserItem).name).toBe('Renamed Viewer');
    });

    it('returns 404 for a user of another company and changes nothing', async () => {
      const { accessToken } = await login(app, acme.adminEmail, PASSWORD);

      await http()
        .patch(`/users/${globex.viewerId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Hacked' })
        .expect(404);

      const res = await http()
        .get(`/users/${globex.viewerId}`)
        .set('Authorization', `Bearer ${platformToken}`)
        .expect(200);
      expect((res.body as UserItem).name).toBe('Globex Viewer');
    });

    it('lets a platform admin rename anyone', async () => {
      await http()
        .patch(`/users/${globex.adminId}`)
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ name: 'Globex Boss' })
        .expect(200);
    });

    it('rejects an empty name, other fields and a bad id with 400', async () => {
      const auth = { Authorization: `Bearer ${platformToken}` };

      await http()
        .patch(`/users/${acme.viewerId}`)
        .set(auth)
        .send({ name: '   ' })
        .expect(400);
      await http()
        .patch(`/users/${acme.viewerId}`)
        .set(auth)
        .send({ name: 'Ok', email: 'new@acme.test' })
        .expect(400);
      await http()
        .patch(`/users/${acme.viewerId}`)
        .set(auth)
        .send({})
        .expect(400);
      await http()
        .patch('/users/not-a-uuid')
        .set(auth)
        .send({ name: 'Ok' })
        .expect(400);
    });

    it('is not available to a viewer, not even for themselves', async () => {
      const { accessToken } = await login(app, acme.viewerEmail, PASSWORD);

      await http()
        .patch(`/users/${acme.viewerId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Me' })
        .expect(403);
    });
  });

  describe('DELETE /users/:id', () => {
    it('deletes a user with roles and sessions; the email becomes free again', async () => {
      const viewer = await login(app, acme.viewerEmail, PASSWORD);
      const { accessToken } = await login(app, acme.adminEmail, PASSWORD);
      const auth = { Authorization: `Bearer ${accessToken}` };

      await http().delete(`/users/${acme.viewerId}`).set(auth).expect(204);

      await http().get(`/users/${acme.viewerId}`).set(auth).expect(404);
      expect((await list(accessToken)).total).toBe(1);
      await http()
        .post('/auth/refresh')
        .send({ refreshToken: viewer.refreshToken })
        .expect(401);
      await http()
        .post('/auth/login')
        .send({ email: acme.viewerEmail, password: PASSWORD })
        .expect(401);
      await http()
        .get('/users/me')
        .set('Authorization', `Bearer ${viewer.accessToken}`)
        .expect(404);
      await http()
        .post('/users')
        .set(auth)
        .send({
          companyId: acme.companyId,
          name: 'Back Again',
          email: acme.viewerEmail,
          password: PASSWORD,
        })
        .expect(201);
    });

    it('returns 404 for a user of another company and deletes nothing', async () => {
      const { accessToken } = await login(app, acme.adminEmail, PASSWORD);

      await http()
        .delete(`/users/${globex.viewerId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);
      await http()
        .get(`/users/${globex.viewerId}`)
        .set('Authorization', `Bearer ${platformToken}`)
        .expect(200);
    });

    it('refuses to delete your own account with 400', async () => {
      const { accessToken } = await login(app, acme.adminEmail, PASSWORD);

      await http()
        .delete(`/users/${acme.adminId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(400);
    });

    it('keeps the last company admin (409) until another admin exists', async () => {
      const auth = { Authorization: `Bearer ${platformToken}` };

      await http().delete(`/users/${acme.adminId}`).set(auth).expect(409);
      await http()
        .put(`/users/${acme.viewerId}/roles`)
        .set(auth)
        .send({ roles: ['COMPANY_ADMIN'] })
        .expect(200);
      await http().delete(`/users/${acme.adminId}`).set(auth).expect(204);
    });

    it('keeps one admin when every admin is deleted at the same moment', async () => {
      const auth = { Authorization: `Bearer ${platformToken}` };
      const adminIds = [acme.adminId];
      for (let i = 0; i < 5; i++) {
        const res = await http()
          .post('/users')
          .set(auth)
          .send({
            companyId: acme.companyId,
            name: `Extra Admin ${i}`,
            email: `extra${i}@acme.test`,
            password: PASSWORD,
            roles: ['COMPANY_ADMIN'],
          })
          .expect(201);
        adminIds.push((res.body as { id: string }).id);
      }

      const results = await Promise.all(
        adminIds.map((id) => http().delete(`/users/${id}`).set(auth)),
      );

      const statuses = results.map((r) => r.status).sort((a, b) => a - b);
      expect(statuses).toEqual([204, 204, 204, 204, 204, 409]);
      const page = await list(platformToken, `?companyId=${acme.companyId}`);
      expect(
        page.items.filter((u) => u.roles.includes('COMPANY_ADMIN')),
      ).toHaveLength(1);
    });

    it('is not available to a viewer', async () => {
      const { accessToken } = await login(app, acme.viewerEmail, PASSWORD);

      await http()
        .delete(`/users/${acme.adminId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(403);
    });
  });
});
