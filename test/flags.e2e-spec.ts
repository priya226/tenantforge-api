import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';

import {
  ADMIN,
  createE2eApp,
  createTenant,
  login,
  PASSWORD,
  resetDatabase,
  type Tenant,
} from './e2e-app.js';

interface Flag {
  id: string;
  key: string;
  enabled: boolean;
  rolloutType: string;
  rolloutValue: number;
  rules: {
    attribute: string;
    value: string;
    rolloutType: string;
    rolloutValue: number;
  }[];
  version: number;
  description: string | null;
}

interface AuditRow {
  action: string;
  version: number;
  user_id: string;
  before_json: { version: number; enabled: boolean } | null;
  after_json: { version: number; enabled: boolean } | null;
}

const state = (enabled: boolean, expectedVersion: number) => ({
  expectedVersion,
  enabled,
  rolloutType: 'PERCENT',
  rolloutValue: 100,
  rules: [
    {
      attribute: 'region',
      value: 'IN',
      rolloutType: 'PERCENT',
      rolloutValue: 20,
    },
  ],
});

describe('Flags (e2e)', () => {
  let app: INestApplication<App>;
  let platformToken: string;
  let acme: Tenant;
  let globex: Tenant;
  let adminAuth: { Authorization: string };

  const http = () => request(app.getHttpServer());

  async function createFlag(key: string, body: object = {}): Promise<Flag> {
    const res = await http()
      .post('/flags')
      .set(adminAuth)
      .send({ key, ...body })
      .expect(201);
    return res.body as Flag;
  }

  function auditRows(flagId: string): Promise<AuditRow[]> {
    return app
      .get(DataSource)
      .query(
        'SELECT action, version, user_id, before_json, after_json FROM audit_event WHERE entity_id = $1 ORDER BY version',
        [flagId],
      );
  }

  beforeAll(async () => {
    app = await createE2eApp();
  });

  beforeEach(async () => {
    await resetDatabase(app);
    platformToken = (await login(app, ADMIN.email, ADMIN.password)).accessToken;
    acme = await createTenant(app, platformToken, 'Acme');
    globex = await createTenant(app, platformToken, 'Globex');
    const { accessToken } = await login(app, acme.adminEmail, PASSWORD);
    adminAuth = { Authorization: `Bearer ${accessToken}` };
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /flags', () => {
    it('creates a flag at version 1 with defaults and a CREATE audit row', async () => {
      const flag = await createFlag('new-checkout', {
        rules: [
          {
            attribute: 'region',
            value: 'IN',
            rolloutType: 'PERCENT',
            rolloutValue: 20,
          },
        ],
      });

      expect(flag).toMatchObject({
        key: 'new-checkout',
        enabled: false,
        rolloutType: 'PERCENT',
        rolloutValue: 100,
        version: 1,
        description: null,
        rules: [
          {
            attribute: 'region',
            value: 'IN',
            rolloutType: 'PERCENT',
            rolloutValue: 20,
          },
        ],
      });
      const rows = await auditRows(flag.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: 'CREATE',
        version: 1,
        user_id: acme.adminId,
        before_json: null,
        after_json: { version: 1, enabled: false },
      });
    });

    it('creates a COUNT rollout for the first N users', async () => {
      const flag = await createFlag('beta-search', {
        rolloutType: 'COUNT',
        rolloutValue: 10,
      });

      expect(flag).toMatchObject({ rolloutType: 'COUNT', rolloutValue: 10 });
    });

    it('lets each rule pick PERCENT or COUNT', async () => {
      const rules = [
        {
          attribute: 'region',
          value: 'IN',
          rolloutType: 'COUNT',
          rolloutValue: 10,
        },
        {
          attribute: 'region',
          value: 'US',
          rolloutType: 'PERCENT',
          rolloutValue: 30,
        },
      ];

      const flag = await createFlag('regional-launch', {
        rules,
        rolloutType: 'PERCENT',
        rolloutValue: 0,
      });

      expect(flag.rules).toEqual(rules);
    });

    it('returns 409 for a duplicate key in the same company, but allows it in another', async () => {
      await createFlag('new-checkout');
      await http()
        .post('/flags')
        .set(adminAuth)
        .send({ key: 'new-checkout' })
        .expect(409);

      const { accessToken } = await login(app, globex.adminEmail, PASSWORD);
      await http()
        .post('/flags')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ key: 'new-checkout' })
        .expect(201);
    });

    it('rejects bad input with 400', async () => {
      const bad = [
        { key: 'Bad_Key' },
        { key: 'x' },
        { key: 'ok-key', rolloutValue: 101 },
        { key: 'ok-key', rolloutType: 'COUNT', rolloutValue: 0 },
        { key: 'ok-key', rolloutType: 'COUNT', rolloutValue: 10_001 },
        { key: 'ok-key', rolloutType: 'FIRST', rolloutValue: 5 },
        {
          key: 'ok-key',
          rules: [
            {
              attribute: 'region',
              value: 'IN',
              rolloutType: 'COUNT',
              rolloutValue: 0,
            },
          ],
        },
        {
          key: 'ok-key',
          rules: [
            {
              attribute: 'region',
              value: 'IN',
              rolloutType: 'PERCENT',
              rolloutValue: 101,
            },
          ],
        },
        {
          key: 'ok-key',
          rules: [
            { attribute: 'region', rolloutType: 'PERCENT', rolloutValue: 10 },
          ],
        },
        {
          key: 'ok-key',
          rules: [
            {
              attribute: 'r',
              value: 'v',
              rolloutType: 'PERCENT',
              rolloutValue: 1.5,
            },
          ],
        },
        { key: 'ok-key', version: 7 },
        {
          key: 'ok-key',
          rules: [
            {
              attribute: 'region',
              value: 'IN',
              rolloutType: 'PERCENT',
              rolloutValue: 1,
            },
            {
              attribute: 'region',
              value: 'IN',
              rolloutType: 'PERCENT',
              rolloutValue: 2,
            },
          ],
        },
      ];
      for (const body of bad) {
        await http().post('/flags').set(adminAuth).send(body).expect(400);
      }
    });

    it('is only for company admins', async () => {
      const viewer = await login(app, acme.viewerEmail, PASSWORD);
      await http()
        .post('/flags')
        .set('Authorization', `Bearer ${viewer.accessToken}`)
        .send({ key: 'new-checkout' })
        .expect(403);
      await http()
        .post('/flags')
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ key: 'new-checkout' })
        .expect(403);
    });
  });

  describe('GET /flags', () => {
    it('lets a viewer read own company flags, sorted by key', async () => {
      await createFlag('zeta');
      await createFlag('alpha');
      const viewer = await login(app, acme.viewerEmail, PASSWORD);
      const auth = { Authorization: `Bearer ${viewer.accessToken}` };

      const list = await http().get('/flags').set(auth).expect(200);
      expect((list.body as Flag[]).map((f) => f.key)).toEqual([
        'alpha',
        'zeta',
      ]);
      await http().get('/flags/alpha').set(auth).expect(200);
    });

    it('hides other companies: 404 for their companyId or key', async () => {
      await createFlag('new-checkout');
      const other = await login(app, globex.adminEmail, PASSWORD);
      const auth = { Authorization: `Bearer ${other.accessToken}` };

      await http()
        .get(`/flags?companyId=${acme.companyId}`)
        .set(auth)
        .expect(404);
      await http().get('/flags/new-checkout').set(auth).expect(404);
      const own = await http().get('/flags').set(auth).expect(200);
      expect(own.body).toEqual([]);
    });

    it('lets a platform admin read any company with ?companyId, which is required', async () => {
      await createFlag('new-checkout');
      const auth = { Authorization: `Bearer ${platformToken}` };

      const list = await http()
        .get(`/flags?companyId=${acme.companyId}`)
        .set(auth)
        .expect(200);
      expect((list.body as Flag[]).map((f) => f.key)).toEqual(['new-checkout']);
      await http()
        .get(`/flags/new-checkout?companyId=${acme.companyId}`)
        .set(auth)
        .expect(200);
      await http().get('/flags').set(auth).expect(400);
    });
  });

  describe('PUT /flags/:key', () => {
    it('replaces the state, bumps the version and audits before/after', async () => {
      const flag = await createFlag('new-checkout');

      const res = await http()
        .put('/flags/new-checkout')
        .set(adminAuth)
        .send({ ...state(true, 1), description: 'New checkout page' })
        .expect(200);

      expect(res.body).toMatchObject({
        version: 2,
        enabled: true,
        description: 'New checkout page',
        rules: [
          {
            attribute: 'region',
            value: 'IN',
            rolloutType: 'PERCENT',
            rolloutValue: 20,
          },
        ],
      });
      const rows = await auditRows(flag.id);
      expect(rows.map((r) => [r.action, r.version])).toEqual([
        ['CREATE', 1],
        ['UPDATE', 2],
      ]);
      expect(rows[1].before_json).toMatchObject({ version: 1, enabled: false });
      expect(rows[1].after_json).toMatchObject({ version: 2, enabled: true });
    });

    it('switches a flag between PERCENT and COUNT', async () => {
      await createFlag('new-checkout');

      const res = await http()
        .put('/flags/new-checkout')
        .set(adminAuth)
        .send({
          ...state(true, 1),
          rolloutType: 'COUNT',
          rolloutValue: 20,
          rules: [],
        })
        .expect(200);

      expect(res.body).toMatchObject({
        version: 2,
        rolloutType: 'COUNT',
        rolloutValue: 20,
      });
    });

    it('rejects a stale expectedVersion with 409 and changes nothing', async () => {
      const flag = await createFlag('new-checkout');
      await http()
        .put('/flags/new-checkout')
        .set(adminAuth)
        .send(state(true, 1))
        .expect(200);

      await http()
        .put('/flags/new-checkout')
        .set(adminAuth)
        .send(state(false, 1))
        .expect(409);

      const now = await http()
        .get('/flags/new-checkout')
        .set(adminAuth)
        .expect(200);
      expect(now.body).toMatchObject({ version: 2, enabled: true });
      expect(await auditRows(flag.id)).toHaveLength(2);
    });

    it('lets exactly one of several same-version saves win', async () => {
      const flag = await createFlag('new-checkout');

      const results = await Promise.all(
        [0, 1, 2, 3, 4].map((i) =>
          http()
            .put('/flags/new-checkout')
            .set(adminAuth)
            .send({ ...state(i % 2 === 0, 1), rolloutValue: i * 10 }),
        ),
      );

      const statuses = results.map((r) => r.status).sort((a, b) => a - b);
      expect(statuses).toEqual([200, 409, 409, 409, 409]);
      const rows = await auditRows(flag.id);
      expect(rows.map((r) => r.version)).toEqual([1, 2]);
    });

    it('rejects a missing expectedVersion, a key change and bad state with 400', async () => {
      await createFlag('new-checkout');
      const { expectedVersion: _, ...noVersion } = state(true, 1);
      const bad = [
        noVersion,
        { ...state(true, 1), key: 'renamed' },
        { ...state(true, 1), rolloutValue: -1 },
        { expectedVersion: 1, enabled: true },
      ];
      for (const body of bad) {
        await http()
          .put('/flags/new-checkout')
          .set(adminAuth)
          .send(body)
          .expect(400);
      }
    });

    it('returns 404 for a missing flag or another company flag', async () => {
      await http()
        .put('/flags/missing')
        .set(adminAuth)
        .send(state(true, 1))
        .expect(404);

      const other = await login(app, globex.adminEmail, PASSWORD);
      await createFlag('new-checkout');
      await http()
        .put('/flags/new-checkout')
        .set('Authorization', `Bearer ${other.accessToken}`)
        .send(state(true, 1))
        .expect(404);
    });

    it('is not available to a viewer', async () => {
      await createFlag('new-checkout');
      const viewer = await login(app, acme.viewerEmail, PASSWORD);

      await http()
        .put('/flags/new-checkout')
        .set('Authorization', `Bearer ${viewer.accessToken}`)
        .send(state(true, 1))
        .expect(403);
    });
  });

  describe('DELETE /flags/:key', () => {
    it('soft-deletes at the expected version, audits it and frees the key', async () => {
      const flag = await createFlag('new-checkout');

      await http()
        .delete('/flags/new-checkout?expectedVersion=1')
        .set(adminAuth)
        .expect(204);

      await http().get('/flags/new-checkout').set(adminAuth).expect(404);
      const rows = await auditRows(flag.id);
      expect(rows[1]).toMatchObject({
        action: 'DELETE',
        version: 2,
        before_json: { version: 1 },
        after_json: null,
      });
      const again = await createFlag('new-checkout');
      expect(again.id).not.toBe(flag.id);
      expect(again.version).toBe(1);
    });

    it('needs the current expectedVersion: missing 400, stale 409', async () => {
      await createFlag('new-checkout');
      await http()
        .put('/flags/new-checkout')
        .set(adminAuth)
        .send(state(true, 1))
        .expect(200);

      await http().delete('/flags/new-checkout').set(adminAuth).expect(400);
      await http()
        .delete('/flags/new-checkout?expectedVersion=1')
        .set(adminAuth)
        .expect(409);
      await http().get('/flags/new-checkout').set(adminAuth).expect(200);
    });
  });

  describe('history and rollback', () => {
    interface HistoryItem {
      version: number;
      action: string;
      userId: string;
      before: { enabled: boolean; rolloutValue: number } | null;
      after: { enabled: boolean; rolloutValue: number } | null;
    }
    interface HistoryPage {
      items: HistoryItem[];
      total: number;
    }

    async function save(enabled: boolean, version: number, rolloutValue = 100) {
      await http()
        .put('/flags/new-checkout')
        .set(adminAuth)
        .send({ ...state(enabled, version), rolloutValue })
        .expect(200);
    }

    async function rollback(body: object, status: number) {
      return http()
        .post('/flags/new-checkout/rollback')
        .set(adminAuth)
        .send(body)
        .expect(status);
    }

    async function history(query = '', auth = adminAuth): Promise<HistoryPage> {
      const res = await http()
        .get(`/flags/new-checkout/history${query}`)
        .set(auth)
        .expect(200);
      return res.body as HistoryPage;
    }

    it('lists every change newest first, with who and before/after', async () => {
      await createFlag('new-checkout');
      await save(true, 1, 40);

      const page = await history();

      expect(page.total).toBe(2);
      expect(page.items.map((e) => [e.version, e.action])).toEqual([
        [2, 'UPDATE'],
        [1, 'CREATE'],
      ]);
      expect(page.items[0]).toMatchObject({
        userId: acme.adminId,
        before: { enabled: false, rolloutValue: 100 },
        after: { enabled: true, rolloutValue: 40 },
      });
    });

    it('pages with limit and offset', async () => {
      await createFlag('new-checkout');
      await save(true, 1);
      await save(false, 2);

      const first = await history('?limit=2');
      const second = await history('?limit=2&offset=2');

      expect(first.items.map((e) => e.version)).toEqual([3, 2]);
      expect(second.items.map((e) => e.version)).toEqual([1]);
      expect([first.total, second.total]).toEqual([3, 3]);
    });

    it('is readable by a viewer and a platform admin, and hidden from other companies', async () => {
      await createFlag('new-checkout');
      const viewer = await login(app, acme.viewerEmail, PASSWORD);
      const other = await login(app, globex.adminEmail, PASSWORD);

      await history('', { Authorization: `Bearer ${viewer.accessToken}` });
      await history(`?companyId=${acme.companyId}`, {
        Authorization: `Bearer ${platformToken}`,
      });
      await http()
        .get('/flags/new-checkout/history')
        .set('Authorization', `Bearer ${other.accessToken}`)
        .expect(404);
    });

    it('restores an old state as a new version with a ROLLBACK audit row', async () => {
      await createFlag('new-checkout');
      await save(true, 1, 40);
      await save(true, 2, 90);

      const res = await rollback({ toVersion: 2, expectedVersion: 3 }, 200);

      expect(res.body).toMatchObject({
        version: 4,
        enabled: true,
        rolloutValue: 40,
      });
      const page = await history();
      expect(page.items.map((e) => [e.version, e.action])).toEqual([
        [4, 'ROLLBACK'],
        [3, 'UPDATE'],
        [2, 'UPDATE'],
        [1, 'CREATE'],
      ]);
      expect(page.items[0]).toMatchObject({
        before: { rolloutValue: 90 },
        after: { rolloutValue: 40 },
      });
    });

    it('can roll back a rollback', async () => {
      await createFlag('new-checkout');
      await save(true, 1);
      await rollback({ toVersion: 1, expectedVersion: 2 }, 200);

      const res = await rollback({ toVersion: 2, expectedVersion: 3 }, 200);

      expect(res.body).toMatchObject({ version: 4, enabled: true });
    });

    it('rejects a stale expectedVersion with 409 and writes nothing', async () => {
      await createFlag('new-checkout');
      await save(true, 1);
      await save(false, 2);

      await rollback({ toVersion: 1, expectedVersion: 2 }, 409);

      expect((await history()).total).toBe(3);
    });

    it('rejects a current, future or missing target version with 400', async () => {
      await createFlag('new-checkout');
      await save(true, 1);

      await rollback({ toVersion: 2, expectedVersion: 2 }, 400);
      await rollback({ toVersion: 5, expectedVersion: 2 }, 400);
      await rollback({ expectedVersion: 2 }, 400);
      await rollback({ toVersion: 0, expectedVersion: 2 }, 400);
    });

    it('is only for company admins, and 404 for a deleted flag', async () => {
      await createFlag('new-checkout');
      await save(true, 1);
      const viewer = await login(app, acme.viewerEmail, PASSWORD);

      await http()
        .post('/flags/new-checkout/rollback')
        .set('Authorization', `Bearer ${viewer.accessToken}`)
        .send({ toVersion: 1, expectedVersion: 2 })
        .expect(403);

      await http()
        .delete('/flags/new-checkout?expectedVersion=2')
        .set(adminAuth)
        .expect(204);
      await rollback({ toVersion: 1, expectedVersion: 3 }, 404);
      await http()
        .get('/flags/new-checkout/history')
        .set(adminAuth)
        .expect(404);
    });
  });

  it('deleting a company soft-deletes its flags', async () => {
    await createFlag('new-checkout');

    await http()
      .delete(`/companies/${acme.companyId}`)
      .set('Authorization', `Bearer ${platformToken}`)
      .expect(204);

    const [{ count }] = (await app
      .get(DataSource)
      .query(
        'SELECT count(*)::int AS count FROM feature_flag WHERE company_id = $1 AND is_deleted = false',
        [acme.companyId],
      )) as { count: number }[];
    expect(count).toBe(0);
  });
});
