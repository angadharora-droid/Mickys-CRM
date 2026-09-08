# Micky's — Sales CRM (Sales Kit Generation System)

A full-stack sales-enablement CRM. A **Sales Executive** captures a client's details, picks a
**Distributor** or **Institutional** kit, reviews/overrides rates pulled from a central **Rate Master**,
and **generates a bundle of pre-filled, branded PDFs** (price card, distributor agreement / quotation,
onboarding checklist) packaged as a single **ZIP**. The kit is then **emailed** to the client
(presented as the exec) or **downloaded**. **Managers** see all leads; **Admins** control the rate
master, users and settings, with a full audit trail.

| Layer | Stack |
|---|---|
| Frontend | React 18 + Vite, Tailwind CSS, ShadCN-style UI (Radix), React Hook Form + Zod, Recharts, Context API |
| Backend | Node.js + Express, services layer, Zod validation, Helmet, rate limiting |
| Database | MongoDB + Mongoose |
| Auth | JWT access token (15 min) + rotating refresh token (httpOnly cookie, 7 days) |
| Files | Local storage via Multer (`server/uploads/`), served statically |
| Email | Resend (preferred) with Nodemailer SMTP fallback (configurable from Admin → Settings or `.env`) |
| PDF / ZIP | PDFKit (kit documents) + archiver (kit ZIP) |

---

## Project Structure

```
├── server/                  # Express REST API
│   ├── src/
│   │   ├── config/          # env + db connection
│   │   ├── models/          # User, RateItem, Lead, ActivityLog, Counter, Setting
│   │   ├── middleware/      # auth (JWT), RBAC, multer upload, zod validate, error handler
│   │   ├── services/        # token, email, kit (PDF+ZIP), activity-log services
│   │   ├── controllers/     # request handlers
│   │   ├── validators/      # zod schemas
│   │   ├── routes/          # /api router
│   │   └── seed/            # demo data seeder
│   └── uploads/             # generated kits (auto-created)
├── client/                  # React app (Vite)
│   └── src/
│       ├── components/ui/   # shadcn-style components
│       ├── components/      # layout + shared (StatusBadge, Pagination, …)
│       ├── context/         # AuthContext, ThemeContext (dark mode)
│       ├── lib/             # axios client w/ auto-refresh, constants, utils
│       └── pages/           # dashboards, leads, rate-master, users, logs, settings
└── docs/API.md              # API documentation
```

---

## Getting Started

### 1. Prerequisites

- **Node.js 18+**
- **MongoDB** — Local (default URI `mongodb://127.0.0.1:27017/mickys_po` already configured) or a
  cloud [Atlas](https://www.mongodb.com/atlas) cluster set in `server/.env` → `MONGO_URI`.

### 2. Configure

`server/.env` is already created with random JWT secrets. Adjust if needed:

```env
PORT=5000
CLIENT_URL=http://localhost:5173
MONGO_URI=mongodb://127.0.0.1:27017/mickys_po
RESEND_API_KEY=re_...          # preferred provider; get one at resend.com/api-keys
EMAIL_FROM="Micky's Sales <no-reply@yourdomain.com>"  # domain must be verified in Resend
SMTP_HOST=smtp.gmail.com       # SMTP fallback, used only when RESEND_API_KEY is empty
SMTP_USER=you@gmail.com
SMTP_PASS=your-app-password
```

> Email is optional in development — if no provider is configured the system logs
> "email skipped" and continues working normally (you can still download the kit ZIP).
> When `RESEND_API_KEY` is set the app sends via Resend; otherwise it falls back to SMTP.

### 3. Install & seed

```bash
cd server && npm install && npm run seed   # creates demo users, both rate masters, demo leads
cd ../client && npm install
```

### 4. Run

```bash
# terminal 1 — API on :5000
cd server && npm run dev

# terminal 2 — UI on :5173 (proxies /api and /uploads to :5000)
cd client && npm run dev
```

Open **http://localhost:5173**.

### Demo accounts (after `npm run seed`)

| Role | Email | Password |
|---|---|---|
| Admin | `admin@mickys.com` | `Admin@12345` |
| Sales Executive | `exec1@mickys.com` | `Exec@12345` |
| Sales Executive | `exec2@mickys.com` | `Exec@12345` |

---

## Kit Pipeline

```
New Lead → Kit Selected → Rates Confirmed → Kit Generated → Delivered
```

1. **Client Data** — the exec captures contact, business and CRM metadata. A quotation reference
   (`MKY-[CITY]-[DDMMYY]-[###]`) is generated automatically and appears on every kit document.
2. **Kit Type** — the exec picks **Distributor** or **Institutional**; the matching rate master is
   snapshotted onto the lead and the client form locks. Switching kit type later (after rates are
   edited, or after the kit has already been delivered) requires confirmation. A delivered lead is
   unlocked with **Edit** first; the switch takes it back to Kit Selected, so the new kit is
   confirmed, generated and delivered afresh.
3. **Rate Review** — rates pre-fill from the master. The exec can override any net rate within
   `floor ≤ net ≤ MRP`; deviations from standard show in orange, net+GST recomputes live, and every
   override is logged. "Confirm rates" locks them in.
4. **Generate** — the system builds one brand-accurate PDF per document, rendered from live data
   (client details, confirmed rates, and the product catalogue), and bundles them into
   `MickysSalesKit_[Client]_[Ref].zip`.
5. **Deliver** — email the ZIP to the client (sent via the shared SMTP account but presented as the
   exec, with reply-to set to them and the kit inbox BCC'd) or download it / individual PDFs.

## Lead Status Funnel & Score Card

Alongside the kit pipeline, every lead sits on a commercial **funnel** and carries a **score card**.

```
New → Live → Client made          (Turned down sits beside the funnel, with a reason)
```

- A lead goes **Live** automatically on its first activity (kit selected, visit or call logged,
  samples given, feedback taken), becomes **Client made** when appointed as a sales-order customer
  (or when its first order is booked), and is **Turned down** by hand with a mandatory reason. Every
  stage can also be set by hand on the lead page; each move is kept in `stageHistory`.
- The **score card** awards points once per milestone (repeat orders per order). Defaults:

  | # | Milestone | Points | Earned when |
  |---|---|---|---|
  | 1 | New lead | 0 | the lead exists |
  | 2 | Kit generated | 10 | Step 4 |
  | 3 | Kit delivered | 10 | Step 5 (email or manual) |
  | 4 | Samples given | 10 | logged under *Samples & Feedback* |
  | 5 | Visit done | 20 | first field visit in the Visit Report |
  | 6 | Feedback taken | 5 | client feedback logged (or order feedback) |
  | 7 | Calls done (at least 2) | 10 | calls in the Visit Report |
  | 8 | Client made | 20 | appointed as customer / marked Client made |
  | 9 | Sample order bought | 10 | first sales order for the customer |
  | 10 | Repeat order | 5 / order | every further sales order |

  Weights are editable under **Settings → Lead Score** (saving recomputes every lead). The score
  shows on the lead page (with the full checklist), the leads list (sortable, filterable by stage),
  both dashboards (funnel + top leads + per-owner league), the Lead Tracker and the
  **Lead Score Card** / **Executive Performance** reports.
- After deploying to an existing database run `cd server && npm run backfill:lead-scores -- --apply`
  once: it infers a stage for old leads (client if appointed, live if already worked) and stores
  their scores. A dry run without `--apply` only reports what it would do.

## Feature Highlights

- **RBAC** - `admin`, `sales_exec`; execs see only their own leads, admins see all; rate master,
  users and activity logs are admin-only.
- **Two rate masters** — Distributor and Institutional, admin-editable; generated kits are immutable
  snapshots, unaffected by later master edits.
- **Brand-accurate kit documents** — price cards, distributor agreement, onboarding checklist and
  quotation are generated to match the official Micky's reference layouts, from the data-driven catalogue.
- **JWT + refresh rotation** — refresh tokens are hashed in DB; reuse detection revokes all sessions.
- **Dashboards** — admin (leads by status/city/business-type/exec, kit split, kits generated),
  exec (own funnel + activity feed).
- **Meta Ads lead sync** — leads from the Facebook/Instagram lead form are pulled off their Google
  Sheet automatically, created under a "Meta Ads" account for an admin to assign.
- **Audit trail** — every login, lead step, rate override, generation and delivery is logged.
- **Dark mode** + responsive layout.

## Meta Ads lead sync

Leads captured by the Meta (Facebook/Instagram) lead form land in a Google Sheet, which
`server/src/scripts/sync-meta-leads.js` pulls into the CRM. Each row becomes a normal `new` lead
created by — and parked on — a dedicated **Meta Ads** account, so an admin can hand it to a sales
exec with the usual reassign action. The account is created inactive: nobody signs in as it, and it
never appears as a reassignment target.

| Sheet column | Lead field |
|---|---|
| `company_name` (falls back to `full_name`) | Business name |
| `full_name` (falls back to `company_name`) | Contact person |
| `phone_number` (the `p:` tag stripped) | Mobile number |
| `email` · `city` | Email · City |
| `business_type_` | Business type, mapped onto the CRM enum |
| `created_time` | Lead date |
| `id` | `metaLeadId` — the dedupe key |
| `platform`, `campaign_name`, `ad_name`, `form_name`, "how much gravy/paste…" | Internal note |

Lead source is set to `Meta Ads` on every imported lead. The remaining columns (`ad_id`, `adset_id`,
`campaign_id`, `form_id`, `lead_status`) are Meta-side identifiers with no CRM equivalent and are
not imported.

The sheet is read through Google's CSV export endpoint, so it must be readable without a login —
**Share → General access → "Anyone with the link" (Viewer)**. No API key or service account needed.

### It runs itself

The API polls the sheet in-process ([`services/metaSync.service.js`](server/src/services/metaSync.service.js)),
starting ~10 seconds after boot and then every 15 minutes. There is nothing else to deploy, schedule
or keep alive: if the API is up, leads are flowing. New leads reach the CRM within one interval of
Meta writing them to the sheet — this is polling, not instant.

| Variable | Default | |
|---|---|---|
| `META_SYNC_ENABLED` | `true` | set to `false` to switch the poller off |
| `META_SYNC_INTERVAL_MIN` | `15` | minutes between checks |
| `META_SHEET_ID` / `META_SHEET_GID` | the campaign sheet / `0` | point at a different sheet or tab |
| `META_SHEET_CSV_URL` | — | an explicit CSV url, overriding the two above |

A pass only logs when it actually imports something, so a healthy idle poller stays quiet. Failures
(an unshared sheet, no network) log one line and are retried on the next tick — the sync can't take
the API down with it.

### Running it by hand

For a first import, a catch-up, or to preview a sheet before trusting it:

```bash
cd server
npm run sync:meta                          # dry run — prints what it would import, writes nothing
npm run sync:meta -- --apply               # import new rows now
npm run sync:meta -- --apply --file=leads.csv   # import a downloaded CSV instead of fetching
```

Also accepts `--interval=<min>` to watch from the CLI, `--sheet=` / `--gid=` / `--url=` to point
elsewhere, and `--allow-duplicate-phone`.

### Why it's safe to re-run

The sync keys on the Meta lead id, kept in the lead's `metaLeadId` field, and only adds rows it
hasn't imported before — so the scheduled poller and a manual run can't tread on each other. A
unique partial index on that field is the backstop: even two runs racing produce one lead, not two.
Meta's `<test lead: …>` rows are ignored, and a row whose phone number already belongs to another
lead is reported and skipped (override with `--allow-duplicate-phone`).

## API

Endpoint documentation lives in [docs/API.md](docs/API.md).

## Production notes

- `cd client && npm run build` produces `client/dist/` — serve via any static host / reverse proxy
  pointing `/api` and `/uploads` at the Node server.
- To host beside an existing website, create a DNS record for `mickys.yourdomain.com` and use
  `deploy/nginx-mickys-subdomain.conf` as the Nginx server block. Replace `yourdomain.com`, set
  `CLIENT_URL=https://mickys.yourdomain.com`, and set `CORS_ORIGINS=https://mickys.yourdomain.com`.
- Set `NODE_ENV=production` so refresh cookies are `Secure` + `SameSite=None`, and serve over HTTPS.
- Rate limiting is enabled on login; passwords are bcrypt-hashed; SMTP password is never returned by the API.
- `server/smoke-test.js` runs an end-to-end check of the whole flow against a running, seeded server.
