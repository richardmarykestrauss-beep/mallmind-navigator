# Demo / pilot QR codes — MallMind published origin

Published origin (Lovable, from `main`): **`https://mallmind-navigator.lovable.app`** — the single
source of truth is `VITE_PUBLIC_APP_ORIGIN` in the committed `.env`. Regenerate whenever it changes:

```
node scripts/navigation/generate-demo-qr.mjs        # reads VITE_PUBLIC_APP_ORIGIN from .env / .env.local / env
```

| Anchor | File | Payload (decoded from the PNG) |
|---|---|---|
| Garden Route Mall · Entrance 4 | `garden-route-mall--grm-entrance-4.{svg,png}` | `https://mallmind-navigator.lovable.app/navigate?mall=garden-route-mall&start=grm-entrance-4&via=qr` |
| Menlyn Park · Entrance 13 | `menlyn-park--menlyn-lf-entrance-13.{svg,png}` | `https://mallmind-navigator.lovable.app/navigate?mall=menlyn-park&start=menlyn-lf-entrance-13&via=qr` |
| Mall@Reds · Main Entrance | `mallreds-pilot--entrance-main.{svg,png}` | `https://mallmind-navigator.lovable.app/navigate?mall=mallreds-pilot&start=entrance-main&via=qr` |

Every SVG poster is labelled "DEMO / PILOT QR — NOT OFFICIAL SIGNAGE"; the PNG is the bare code.
The app validates mall + start on every scan (unknown mall, unknown anchor and an anchor of another
mall all fall back to manual start selection with a notice). The generator refuses to run without a
valid `https://` origin, so it can never encode a guessed hostname.

Phone check: scan the Garden Route code (or tap the payload URL); the Navigate tab must open on
Garden Route Mall, "Starting from Entrance 4 · from the QR code you scanned".
