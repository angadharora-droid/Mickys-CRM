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
   edited) requires confirmation.
3. **Rate Review** — rates pre-fill from the master. The exec can override any net rate within
   `floor ≤ net ≤ MRP`; deviations from standard show in orange, net+GST recomputes live, and every
   override is logged. "Confirm rates" locks them in.
4. **Generate** — the system builds one brand-accurate PDF per document, rendered from live data
   (client details, confirmed rates, and the product catalogue), and bundles them into
   `MickysSalesKit_[Client]_[Ref].zip`.
5. **Deliver** — email the ZIP to the client (sent via the shared SMTP account but presented as the
   exec, with reply-to set to them and the kit inbox BCC'd) or download it / individual PDFs.

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

```bash
cd server
npm run sync:meta                          # dry run — prints what it would import, writes nothing
npm run sync:meta -- --apply               # import new rows once
npm run sync:meta -- --apply --interval=15 # stay running, re-check the sheet every 15 minutes
npm run sync:meta -- --apply --file=leads.csv   # import a downloaded CSV instead of fetching
```

The sync is idempotent — it keys on the Meta lead id, so re-running it only ever adds rows it hasn't
imported before. Meta's `<test lead: …>` rows are ignored, and a row whose phone number already
belongs to another lead is reported and skipped (override with `--allow-duplicate-phone`).

Point it at a different sheet or tab with `--sheet=<id>` / `--gid=<id>`, or the `META_SHEET_ID`,
`META_SHEET_GID` and `META_SHEET_CSV_URL` environment variables.

**Keeping it up to date.** `--interval` is the simplest option — run it under pm2
(`pm2 start npm --name meta-sync -- run sync:meta -- --apply --interval=15`) so it restarts with the
server. Alternatively drop the one-shot form into cron (`*/15 * * * * cd /path/server && npm run
sync:meta -- --apply`) or Windows Task Scheduler. Note this is polling: new leads appear in the CRM
within one interval of Meta writing them to the sheet, not instantly.

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
