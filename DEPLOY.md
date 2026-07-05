# Project Planner — projectplanners.app deploy guide

One Cloudflare Pages project serves both the site (`site/`) and the sync API
(`functions/api/sync.js` → `https://projectplanners.app/api/sync`). Same origin,
so there is no CORS anywhere.

## Project layout

```
projectplanners/
  wrangler.toml            Pages config + KV binding
  site/
    index.html             the planner (sync layer + PWA built in)
    manifest.webmanifest   PWA manifest
    sw.js                  service worker (offline shell cache)
    icon-192.png, icon-512.png, apple-touch-icon.png
  functions/
    api/
      sync.js              the sync API (Pages Function)
```

Copy the whole folder to `/Users/tim/Projects/projectplanners/`.

## One-time setup (run from the project root on the Mac)

```bash
cd ~/Projects/projectplanners

# 1. Log in to Cloudflare (opens a browser; one-time)
npx wrangler login

# 2. Create the KV namespace that holds the synced data
npx wrangler kv namespace create PLANNER_KV
#    → prints an id. Paste it into wrangler.toml where PASTE_KV_ID_HERE is.

# 3. First deploy — creates the Pages project ("projectplanners")
npx wrangler pages deploy
#    If it asks to create the project, say yes and accept the name.

# 4. Generate a sync token and set it as a secret
openssl rand -hex 24        # copy the output — this is your sync token
npx wrangler pages secret put SYNC_TOKEN
#    → paste the token when prompted

# 5. Deploy again so the KV binding + secret are live on the deployment
npx wrangler pages deploy
```

Then in the Cloudflare dashboard (one-time): **Workers & Pages →
projectplanners → Custom domains → Set up a custom domain →
`projectplanners.app`**. Since the domain is already on your account,
Cloudflare wires the DNS automatically.

## Enable sync on each device — desktop FIRST

Order matters once: set up the device that has your real data (the desktop
browser you've been using) before any other device, so it seeds the server.

1. Open `https://projectplanners.app` **in the same browser/profile where your
   planner data currently lives**. localStorage is per-origin, so if you've
   been using the planner from a local file or another URL, first Export .md
   backups of each project from the old location and Import them here.
2. Click the **Sync** button (top right), paste the token, **Save & sync**.
   Dot turns green — the server is now seeded.
3. On the iPhone/iPad: open the site in Safari, tap Sync, paste the token.
   Your projects appear. Then **Share → Add to Home Screen** — it launches
   full-screen like an app from then on.
4. Same for the Windows laptop browser.

## Day-to-day behavior

- Edits push automatically ~2 s after you stop typing (dot: amber → green).
- Opening the app / returning to its tab pulls the latest silently.
- Offline: everything keeps working from localStorage; the dot shows
  "Offline" and the next edit, focus, or reconnect pushes the backlog.
- Conflicts merge per project, last write wins — phone edits to one project
  never fight desktop edits to a different one.
- Deleting a project removes it from **all** synced devices (the confirm
  dialog says so now). Export a .md first if you want a keepsake.

## Redeploying after site changes

```bash
npx wrangler pages deploy
```

If `site/index.html` changed, also bump `CACHE_VERSION` in `site/sw.js`
(e.g. `planner-v1` → `planner-v2`) before deploying so installed home-screen
apps drop their cached shell. Either way the service worker refreshes in the
background — changes show up by the second open at the latest.

## Sanity checks

```bash
# 401 without the token:
curl -i https://projectplanners.app/api/sync
# Full store with it:
curl -s -H "Authorization: Bearer YOUR_TOKEN" https://projectplanners.app/api/sync | head -c 400
```
