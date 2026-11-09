# Pruitt's Parts

Type what you need, see where it's stored: **Area › Spot › Bin**, the way the Home Depot app shows *Aisle › Bay*.
Each person signs in with an email and password and has their own private inventory. Works in Safari on a MacBook and on an iPhone (Share → Add to Home Screen makes it open like an app).

**Site:** https://producerpruitt-dotcom.github.io/Pruitts-Parts/ (live once the setup below is done)

Nothing to install for the people using it, and no paid accounts. The site is hosted free on GitHub Pages; sign-in and storage use Google Firebase's free plan.

## What it does

- **Search** — big search bar on every screen; results update as you type. Matches the item name, notes and location ("truck" lists everything in the truck). "screw" finds "screws"; `1/4"` works.
- **Location strip** — every result shows *Area | Spot | Bin* in bold, so the answer is visible without tapping.
- **Fast entry** — the form remembers the last location and type. With "Add another to the same spot" checked you can empty a drawer into the app one name at a time.
- **Quantity** — − / + on an item when you use or restock it. Zero shows "Out" in red.
- **Locations** — browse by area, see what's in a bin, rename or move a whole bin (everything in it moves too).
- **Works with poor signal** — a copy of your list is kept on the device, so search works in a garage with no bars; changes sync when the connection comes back.
- **Spreadsheet import / backup** — columns `name, type, quantity, area, spot, bin, notes`; import a CSV or download a backup from **Account**.
- **Accounts** — email + password, "Forgot password?" emails a reset link. Each person can only read and write their own items (enforced by `firestore.rules`, not just the page).

## Set up (one time, about 10 minutes, done by the site owner)

### 1. Turn on the site
GitHub repo → **Settings → Pages** → under *Build and deployment*, set **Source** to **GitHub Actions**.
Then **Actions** tab → *Publish site to GitHub Pages* → **Run workflow** (it also runs on every change to `docs/`).

### 2. Create the free Firebase project
1. Go to https://console.firebase.google.com → **Create a project** (any name; Google Analytics can be turned off).
2. **Build → Authentication → Get started → Email/Password → Enable → Save.**
3. **Authentication → Settings → Authorized domains → Add domain:** `producerpruitt-dotcom.github.io`
4. **Build → Firestore Database → Create database** → pick a location near you → *Start in production mode*.
5. In Firestore, open the **Rules** tab, replace everything with the contents of [`firestore.rules`](firestore.rules), click **Publish**.
6. **Project settings** (gear icon) → *Your apps* → click the **`</>`** (Web) icon → register the app (no hosting needed) → copy the four values `apiKey`, `authDomain`, `projectId`, `appId`.

### 3. Connect the two
Edit [`docs/config.js`](docs/config.js) on GitHub (pencil icon), paste the four values, commit. The site redeploys by itself in about a minute.

These values are designed to be public; the rules from step 5 are what keep each person's data private.

### 4. Hand it over
Send the site link. On first visit he taps **Create an account**, enters his email and a password, and he's in. On the iPhone: Share → **Add to Home Screen**.

## Limits of the free plan

Firebase's free plan allows 50,000 item reads and 20,000 saves per day. Opening the app reads the whole list once, so a 2,000-item inventory opened 20 times a day uses about 40,000 reads. Plenty for a household or a small crew; if several heavy users share it, switch the Firebase project to pay-as-you-go (pennies at this size).

## Files

| Path | What it is |
|---|---|
| `docs/` | The website GitHub Pages serves (`index.html`, `app.js`, `app.css`, `config.js`, icons) |
| `firestore.rules` | Database security rules: each person sees only their own items |
| `.github/workflows/pages.yml` | Publishes `docs/` to GitHub Pages |
| `server.js`, `server/`, `public/`, `test/` | Alternative self-hosted version (Node.js + SQLite, its own accounts) — `npm start`, `npm test` |
| `hosted/pruitts-parts.html` | Alternative version that runs as a claude.ai page (needs a Claude account) |
