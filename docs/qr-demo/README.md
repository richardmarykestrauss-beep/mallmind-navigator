# Demo / pilot QR codes — awaiting a published public origin

No QR assets are committed yet, on purpose. As of 2026-09-08 the MallMind frontend has **no
published public origin**: the Lovable project "MallMind Navigator" is unpublished and its preview
tracks `main`, which does not contain the navigation session. A QR code encodes a hostname
permanently, so generating one against a guessed host (`https://mallmind.app` was used once and has
been removed) would print codes that can never work.

Generate the assets the moment the app is published:

```
# .env.local (or the environment) — the ONE public-origin seam
VITE_PUBLIC_APP_ORIGIN=https://<published-host>

node scripts/navigation/generate-demo-qr.mjs            # → docs/qr-demo/*.svg, *.png, manifest.json
```

Payloads produced (canonical deep links, validated by the app on every scan):

| Anchor | Payload |
|---|---|
| Garden Route Mall · Entrance 4 | `<origin>/navigate?mall=garden-route-mall&start=grm-entrance-4&via=qr` |
| Menlyn Park · Entrance 13 | `<origin>/navigate?mall=menlyn-park&start=menlyn-lf-entrance-13&via=qr` |
| Mall@Reds · Main Entrance | `<origin>/navigate?mall=mallreds-pilot&start=entrance-main&via=qr` |

The script refuses to run without a valid `https://` origin (http only for localhost, for local
development), so it cannot silently fall back to a placeholder. Every SVG is labelled
"DEMO / PILOT QR — NOT OFFICIAL SIGNAGE". Verify a printed code by scanning it on a phone and
checking the app shows "from the QR code you scanned" with the expected mall and entrance.
