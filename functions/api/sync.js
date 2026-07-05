// ============================================================
//  Project Planner sync API — Cloudflare Pages Function
//  Route: https://projectplanners.app/api/sync
//
//  Auth:  Authorization: Bearer <SYNC_TOKEN>   (Pages secret)
//  Store: single KV value under key "store", bound as PLANNER_KV
//
//  GET  /api/sync  -> returns the full store (debugging / initial pull)
//  PUT  /api/sync  -> merges the client snapshot into the store
//                     (per-project last-write-wins) and returns the
//                     merged store, so every PUT is also a pull.
//
//  Store shape:
//  {
//    projects: { [id]: { id, name, color, order, updatedAt, deleted } },
//    plans:    { [id]: { plan: {...}, updatedAt } }
//  }
//  Deleted projects remain as tombstones ({ deleted: true }) so a
//  device that was offline during the delete can't resurrect them.
// ============================================================

const STORE_KEY = 'store';

function emptyStore() {
  return { projects: {}, plans: {} };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

// ISO timestamps compare correctly as strings; treat missing as epoch.
function ts(v) {
  return typeof v === 'string' && v ? v : '1970-01-01T00:00:00.000Z';
}

function newer(a, b) {
  return ts(a) > ts(b);
}

// Merge an incoming client snapshot into the stored one, entry by entry.
function merge(store, incoming) {
  const inProjects = (incoming && incoming.projects) || {};
  const inPlans = (incoming && incoming.plans) || {};

  // --- Project registry entries (including tombstones) ---
  for (const id of Object.keys(inProjects)) {
    const inc = inProjects[id];
    if (!inc || typeof inc !== 'object') continue;
    const cur = store.projects[id];
    if (!cur || newer(inc.updatedAt, cur.updatedAt)) {
      store.projects[id] = {
        id,
        name: inc.deleted ? undefined : String(inc.name || id),
        color: inc.deleted ? undefined : (inc.color || null),
        order: inc.deleted ? undefined : (Number.isFinite(inc.order) ? inc.order : 0),
        updatedAt: ts(inc.updatedAt),
        deleted: !!inc.deleted,
      };
    }
  }

  // --- Plans (skipped for deleted projects) ---
  for (const id of Object.keys(inPlans)) {
    const inc = inPlans[id];
    if (!inc || typeof inc !== 'object' || !inc.plan) continue;
    const reg = store.projects[id];
    if (reg && reg.deleted) continue;
    const cur = store.plans[id];
    if (!cur || newer(inc.updatedAt, cur.updatedAt)) {
      store.plans[id] = { plan: inc.plan, updatedAt: ts(inc.updatedAt) };
    }
  }

  // --- Drop plans belonging to tombstoned projects ---
  for (const id of Object.keys(store.plans)) {
    const reg = store.projects[id];
    if (reg && reg.deleted) delete store.plans[id];
  }

  return store;
}

export async function onRequest(context) {
  const { request, env } = context;

  if (!env.SYNC_TOKEN) {
    return json({ error: 'SYNC_TOKEN secret is not configured' }, 500);
  }

  const auth = request.headers.get('Authorization') || '';
  if (auth !== 'Bearer ' + env.SYNC_TOKEN) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const kv = env.PLANNER_KV;
  if (!kv) {
    return json({ error: 'PLANNER_KV binding is not configured' }, 500);
  }

  if (request.method === 'GET') {
    const raw = await kv.get(STORE_KEY);
    return json(raw ? JSON.parse(raw) : emptyStore());
  }

  if (request.method === 'PUT') {
    let incoming;
    try {
      incoming = await request.json();
    } catch (e) {
      return json({ error: 'Invalid JSON body' }, 400);
    }
    const raw = await kv.get(STORE_KEY);
    const store = raw ? JSON.parse(raw) : emptyStore();
    merge(store, incoming);
    await kv.put(STORE_KEY, JSON.stringify(store));
    return json(store);
  }

  return json({ error: 'Method not allowed' }, 405);
}
