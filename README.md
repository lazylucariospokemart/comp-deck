# Comp Deck — setup

Comp Deck is a tablet page for card shows: live camera → card number read by Claude → TCGplayer market prices inline → your buy offer → comp log.

It has two parts:

1. **The page** (`index.html`, `manifest.webmanifest`, `icon-*.png`) — hosted free on GitHub Pages.
2. **The relay** (`worker.js`) — a small Cloudflare Worker that holds your API keys. The page never contains a key.

Total setup is about 15 minutes. Do the relay first so you have its URL ready.

---

## Part 1 — The relay (Cloudflare Worker)

1. Log in at dash.cloudflare.com → **Workers & Pages** → **Create** → **Create Worker**.
2. Name it `comp-deck-relay` → **Deploy** (it deploys a hello-world first; that's fine).
3. Click **Edit code**, select everything in the editor, delete it, and paste the full contents of `worker.js`. Click **Deploy**.
4. Go to the worker's **Settings** → **Variables and Secrets** → **Add**. Add these one at a time (type = **Secret**):

   | Name | Value |
   |---|---|
   | `ANTHROPIC_API_KEY` | your key from console.anthropic.com → API keys |
   | `JUSTTCG_API_KEY` | your JustTCG key (the same one Card Vault uses) |
   | `APP_PIN` | any short code you'll remember, e.g. `4471`. The tablet sends it with every request so nobody else can run up your keys. |
   | `ALLOWED_ORIGINS` | `https://lazylucariospokemart.github.io` (type = Text is fine) |

   Optional: `MODEL` = `claude-sonnet-5-5` if Haiku misreads too often (costs more per scan). `JUSTTCG_GAME` only if the Test button says One Piece wasn't found — put the game id it lists.

5. Copy the worker URL from the overview page. It looks like `https://comp-deck-relay.<your-subdomain>.workers.dev`.
6. Sanity check in a browser: open `https://comp-deck-relay.<your-subdomain>.workers.dev/health` — you'll get `bad_pin` (expected, since the browser didn't send the PIN). That means the worker is live.

## Part 2 — The page (GitHub Pages)

1. On github.com (signed in as **lazylucariospokemart**) → **New repository** → name `comp-deck` → Public → **Create**.
2. **Add file → Upload files**, drag in: `index.html`, `manifest.webmanifest`, `icon-192.png`, `icon-512.png`. Commit.
3. Repo **Settings → Pages** → Source: **Deploy from a branch** → Branch `main`, folder `/ (root)` → Save.
4. After a minute the page is live at **https://lazylucariospokemart.github.io/comp-deck/**

(If you use a different GitHub account or repo name, put that site's address in `ALLOWED_ORIGINS` on the worker instead.)

## Part 3 — The tablet

1. Open the page in Safari (iPad) or Chrome (Android) on the tablet.
2. Tap **Settings** (top right) → paste the relay URL and your PIN → **Test connection**. You want: *Connected. Model claude-haiku-5-5, One Piece = …* → **Save**.
3. Tap **Start camera** → allow the camera. The dot next to Settings turns green when the relay is healthy.
4. Install it like an app so it opens full screen with no browser bar:
   - **iPad:** Share button → **Add to Home Screen**.
   - **Android:** Chrome menu (⋮) → **Add to Home screen** / **Install app**.

## Using it at a show

- **Scan card** grabs what's inside the gold box and reads it. Fix any field it got wrong.
- Prices load automatically. The highlighted row is your chosen condition + finish and is copied into **Market $**; tap any other row to use that one instead.
- Pick your **Buy at %** → the **Offer** updates. **Add to comp log** keeps a running lot total.
- **Download CSV** at the end of the day. The log lives on the tablet only (clear it when you're done with a lot).
- If the live camera is ever blocked, the button becomes **Take photo** and uses the tablet's camera app.

## Costs

- GitHub Pages and the Cloudflare Worker free tier: $0.
- Each scan is one small Claude Haiku image request (a fraction of a cent).
- JustTCG calls count against your plan's daily limit; one price lookup per card.

## Changing things later

Edit `index.html` or `worker.js`, re-upload (GitHub) or re-paste + Deploy (Cloudflare). The tablet gets the new page on next open.
