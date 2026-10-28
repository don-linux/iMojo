# Visual baselines

Pixel snapshots of `.device` (and the full page for the client-id dialog) from the original iPod UI at commit `33c3053`. Comparison is exact (`maxDiffPixels: 0`).

The dev server is not started by Playwright unless `IPOD_WEB_SERVER` is set. Point the suite at an already running app:

```bash
IPOD_URL=http://127.0.0.1:3000 pnpm test:visual
```

Update snapshots only when intentionally recapturing a baseline:

```bash
IPOD_URL=http://127.0.0.1:3100 pnpm test:visual:update
```

`IPOD_URL` defaults to `http://127.0.0.1:3000`. Use `127.0.0.1`, not `localhost` (the app redirects localhost). Screenshots live in `tests/visual/__screenshots__/`.
