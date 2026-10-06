# iOS PWA pilot test procedure (manual; Safari behaviour cannot be reproduced by the browser harness)

MallMind's offline promise is: **a venue opened once works offline on the SAME browser context**.
On iOS that context matters more than on Android. This procedure checks the assumptions the
architecture makes (`public/sw.js`, `src/lib/serviceWorker.ts`, `navigationSessionStore.ts`) and
records what Safari actually does. Nothing here claims QR link capture into an installed app on iOS;
Apple does not route scanned links into Home Screen web apps.

## Assumptions under test

| # | Assumption | Code |
|---|---|---|
| A1 | Build assets (incl. the lazy Navigate chunk holding the packs) are precached at install | `sw.js` `PRECACHE_ASSETS` injected by `scripts/pwa/sw-plugin.mjs` |
| A2 | The worker registers before the first page finishes loading | `src/main.tsx` |
| A3 | A navigation request offline is served the cached shell (SPA fallback) | `sw.js` `networkFirstShell` |
| A4 | A new build waits; the visitor reloads when ready | `sw.js` no `skipWaiting`; `UpdateReadyBanner` |
| A5 | A remembered session restores only for the same venue and pack revision | `navigationSessionStore.ts` `packVersion` |
| A6 | Safari's tab context and the Home Screen app have SEPARATE storage; the pack must be fetched again inside the installed app | documented, not worked around |
| A7 | Safari may purge script-written storage after 7 days without interaction (non-installed) | documented, not worked around |
| A8 | A failed chunk load shows the recovery screen, never a blank page | `RouteErrorBoundary` |

## Procedure (one iPhone, Safari, airplane mode available)

1. **Safari first visit (online).** Open `https://<host>/navigate?mall=garden-route-mall&start=grm-entrance-4&via=qr`
   by scanning the printed demo QR with the Camera app. Expect: Garden Route Mall, "Starting from
   Entrance 4", "Location set from MallMind QR". Record: did the page load in Safari (expected) or an
   in-app browser (if scanned from another app)?
2. **Cache state.** Wait 10 s. Settings → Safari → Advanced → Website Data should list the host with
   non-zero data. (A1/A2.) Record the size.
3. **Search, route, walk, then go offline.** Search "Woolworths", open the overview, Start navigation,
   tap Next once. Enable airplane mode. Tap Next again; tap Previous. Expect: steps continue, the
   amber "Offline — directions saved on this phone" pill appears, no error. (A3 is not yet exercised.)
4. **Offline reopen.** Still offline, close the tab, reopen Safari, open the same URL from history or
   scan the QR again. Expect: the app shell opens, Garden Route loads, the session restores on the
   overview or the last confirmed step. Record any blank screen or the recovery screen text. (A3, A8.)
5. **Cold QR offline (negative check).** Still offline, scan a QR for a venue never opened on this
   phone (e.g. Mall@Reds). Expect: the recovery screen "MallMind couldn't load this venue yet" with
   the offline explanation, Retry and Return. No fabricated data.
6. **Home Screen install.** Go online. Share → Add to Home Screen. Open from the icon. Expect: the
   venue list loads (the installed app fetches its own copy; A6). Record whether the session from
   step 3 is present (expected: NOT present, separate storage).
7. **Installed app offline.** In the installed app, open Garden Route, search and route once, then
   airplane mode; close and reopen the icon. Expect: works offline. Record.
8. **QR while installed.** Online, scan the demo QR with the Camera app. Expect: Safari opens (not the
   installed app). Record. This is the documented iOS limitation, not a MallMind bug.
9. **Pack update.** After a deploy that changes the Garden Route pack revision, open the app with a
   remembered walking session. Expect: "A new MallMind version is ready" banner; after Reload the
   session returns to the route overview for the same destination, not to a stale step (A4, A5).
10. **Seven-day purge (non-installed).** Leave the phone 8 days without opening the site in Safari,
    then go offline and open the URL. Expect (A7): the shell may be gone; the recovery screen or
    Safari's offline page appears. Record which.

## Recording template

| Step | Expected | Observed | iOS version | Safari | Date |
|---|---|---|---|---|---|

File results under `docs/navigation/screenshots/ios-pilot/` and summarise in the sprint report.
