# Pruitt's Parts

Type what you need, see where it's stored — **Area › Spot › Bin**, the way the Home Depot app shows *Aisle › Bay*.
Each person signs in and has their own inventory. Works in Safari on a MacBook and on an iPhone (add it to the Home Screen and it opens like an app).

## What it does

- **Search** — big search bar at the top of every screen. Results update as you type. Matches the item name, notes, and location ("truck" lists everything in the truck). "screw" finds "screws"; `1/4"` works.
- **Location strip** — every result shows *Area | Spot | Bin* in bold, so the answer is visible without tapping.
- **Add fast** — the form remembers the last location and type. Keep "Add another to the same spot" checked and you can empty a drawer into the app one name at a time.
- **Quantity** — tap − / + on an item when you use or restock it. Zero shows "Out" in red.
- **Locations** — browse by area, see what's in a bin, rename or move a whole bin (everything in it moves too).
- **Spreadsheet import / backup** — on the Mac, put your list in a sheet with columns `name, type, quantity, area, spot, bin, notes`, save as CSV, import from **Account**. Download a CSV backup any time.
- **Accounts** — email + password. Passwords are hashed (scrypt); sessions are HttpOnly cookies that last 60 days; every query is scoped to the signed-in user.

## Run it on your Mac

Requires Node.js 22.5 or newer (`brew install node`). No other installs.

```bash
npm start
```

Open http://localhost:3000 on the Mac. The terminal also prints a `http://192.168.x.x:3000` address — open that in Safari on the iPhone while on the same Wi-Fi, then **Share → Add to Home Screen**.

Data lives in `data/pruitts-parts.db` (one file — back it up, or use the CSV download).

## Use it away from home Wi-Fi

The iPhone needs to reach the server. Two options:

1. **Keep it on the Mac + Tailscale (free).** Install Tailscale on the Mac and iPhone; use the Mac's Tailscale address. Only works while the Mac is awake.
2. **Host it (recommended).** Any host that runs Docker with a persistent disk (Fly.io, Railway, Render, a home server). Mount a volume at `/data` and set `SECURE_COOKIES=1` because it'll be on HTTPS:

```bash
docker build -t pruitts-parts .
```

```bash
docker run -p 3000:3000 -v pruitts-data:/data -e SECURE_COOKIES=1 pruitts-parts
```

Settings (environment variables): `PORT` (default 3000), `DB_FILE` (default `./data/pruitts-parts.db`), `SECURE_COOKIES=1` when served over HTTPS.

## Tests

```bash
npm test
```

Covers sign-up/sign-in, per-user isolation, search behaviour, edits/moves/location merges, and CSV import/export.

## Not built (yet)

- Password reset by email (needs an email service). For now, an admin can delete a user row in the database.
- Photos of items, barcode/QR bin labels, shared "family/crew" inventories.
- Offline mode — search needs a connection to the server.
