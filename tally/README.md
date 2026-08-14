# Tally Prime → Mickys CRM: Stock Export

Files:

- `../server/src/assets/mickys-stock.tdl` — the TDL **template** (the sync key appears as `{{TALLY_SYNC_KEY}}`). The backend serves it, key filled in, at
  `https://api.mickys-crm.centrepointgroup.in/api/stock/tdl?key=<TALLY_SYNC_KEY>` — Tally loads it straight from that URL. Defines report `MickysStockReport` (opening / inward / outward / closing stock per item, plus group, category, unit, standard cost/price — and every vendor & customer, i.e. ledgers under Sundry Creditors / Sundry Debtors).
- `sample-stock-request.xml` — the request envelope the CRM backend POSTs to Tally to pull that report.

## 1. One-time Tally setup (on the PC running Tally Prime)

1. **Enable the XML gateway:** F1 (Help) → Settings → Connectivity → Client/Server configuration → set **"TallyPrime acts as" = Both** (leave "Enable ODBC" = No; keep the port it shows — 9001 in our setup). This setting is per-machine: do it only on the one PC the sync will talk to; other users' Tally installs are unaffected.
2. **Load the TDL from the CRM (preferred):** F1 (Help) → TDLs & AddOns → press **F4** (Manage Local TDLs) → set "Load selected TDL files on startup" to **Yes** → enter this URL as the TDL path → **Ctrl+A** to save:

   ```
   https://api.mickys-crm.centrepointgroup.in/api/stock/tdl?key=<TALLY_SYNC_KEY>
   ```

   (replace `<TALLY_SYNC_KEY>` with the real key — same value as the Railway variable). Tally re-fetches the TDL from the CRM on every start, so **deploying the CRM backend automatically rolls out TDL updates** — no more copying files onto the Tally machine. Fallback if the Tally release refuses URL paths: save the served file locally and point the path at the file.
3. Keep the company **open** in Tally (the gateway only serves loaded companies).
4. Sanity check: **"Mickys Stock Export"** should now appear in Gateway of Tally — open it to see the data on screen.

## 2. Pull the data

Edit the dates in `sample-stock-request.xml` (usually `SVFROMDATE` = start of financial year, `SVTODATE` = today), then from the same PC (or any PC on the LAN, using the Tally PC's IP instead of `localhost`):

PowerShell:

```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:9001" -ContentType "text/xml" -InFile ".\sample-stock-request.xml"
```

or curl:

```bash
curl -X POST http://localhost:9001 -H "Content-Type: text/xml" --data-binary @sample-stock-request.xml
```

The response contains one `<STOCKITEM>` element per item:

```xml
<STOCKITEM>
  <NAME>CP Chicken Nuggets 1kg</NAME>
  <GROUP>CP Foods</GROUP>
  <CATEGORY>Frozen</CATEGORY>
  <BASEUNITS>pkt</BASEUNITS>
  <OPENINGQTY>120 pkt</OPENINGQTY>
  <OPENINGRATE>210.00/pkt</OPENINGRATE>
  <OPENINGVALUE>25,200.00</OPENINGVALUE>
  <INWARDQTY>500 pkt</INWARDQTY>
  <INWARDVALUE>1,05,000.00</INWARDVALUE>
  <OUTWARDQTY>430 pkt</OUTWARDQTY>
  <OUTWARDVALUE>90,300.00</OUTWARDVALUE>
  <CLOSINGQTY>190 pkt</CLOSINGQTY>
  <CLOSINGRATE>210.00/pkt</CLOSINGRATE>
  <CLOSINGVALUE>39,900.00</CLOSINGVALUE>
  <STANDARDCOST>200.00/pkt</STANDARDCOST>
  <STANDARDPRICE>245.00/pkt</STANDARDPRICE>
</STOCKITEM>
```

followed by one `<VENDOR>` element per ledger under Sundry Creditors and one
`<CUSTOMER>` element per ledger under Sundry Debtors:

```xml
<VENDOR>
  <NAME>Shree Traders</NAME>
  <GROUP>Sundry Creditors</GROUP>
</VENDOR>
<CUSTOMER>
  <NAME>Hotel Blue Orchid</NAME>
  <GROUP>Sundry Debtors</GROUP>
</CUSTOMER>
```

## 3. Format notes (implemented in server/src/services/tallyStock.service.js)

Confirmed against a real export from TallyPrime 7.0 (Gold):

- Values carry Tally's accounting sign (inward/closing negative, outward positive) — the parser abs()'s them.
- Zero figures export as **empty tags**; file export has **no** thousands separators.
- Quantities include the unit (`360.00 KG`), rates the `/unit` suffix (`78.00/KG`).
- Reserved names come flagged with a `&#4;` control char (`&#4; Primary`, `&#4; Not Applicable`) → treated as "no group/category".
- Validation per item: `closing = opening + inward − outward`.

## 4. Getting it into the CRM

Two ways, both hitting `POST /api/stock/sync` on the backend:

> **Only Semi Finished & Finished goods are kept.** The report exports every
> stock item, but the backend keeps only items whose group or category name
> contains "Finished" (any casing — covers "Finished Goods", "Semi Finished
> Goods", "Semi-Finished", …). Raw material, packing material and everything
> else is skipped, and each sync mirrors Tally, so previously synced items
> outside those groups are removed from the CRM on the next sync.

> **Day-wise opening/closing history.** Every sync also writes a dated
> snapshot, so the CRM builds a per-day register (Stock page → **Day-wise**
> tab). The morning auto-push — it fires when the company is opened, before
> the day's entries — is recorded as that day's **opening**; the day's
> **closing** comes from the next morning's push (until then it shows the
> last sync of the day, marked provisional). For an exact same-day closing,
> press **Ctrl+F10** after the day's last entry.

> **Vendors & customers.** The same export carries every ledger under
> Sundry Creditors (→ **Vendors** tab) and Sundry Debtors (→ **Customers**
> tab). They start appearing once the updated `mickys-stock.tdl` is loaded
> on the Tally PC (quit & reopen Tally after replacing the file).

### a) Manual upload (works today, no setup)
Export the report as XML (open report → Alt+E → Current → XML), then in the CRM
go to **Sales Orders → Stock from Tally → Upload Tally XML** and pick the file.

If the Tally machine is a remote/hosted session that blocks copying files out:
open the exported XML in **Notepad on the remote machine**, Ctrl+A → Ctrl+C,
then on your own PC paste into Notepad and save as `MickysStock.xml` — the text
clipboard usually works even when file copy is blocked.

### b) Automatic push from Tally (hands-free + button)

The TDL also registers a **Load Company event**: every time the company is
opened in Tally, the stock report is pushed to the CRM automatically — no
keypress needed. It's guarded by company name (CENTRE POINT FOODS PRIVATE
LIMITED) so other companies never sync. The button below is for mid-day
refreshes.

### The "Sync to CRM" button
The TDL defines a button on the report (right-hand button bar, shortcut
**Ctrl+F10**; Alt+Z is reserved by TallyPrime's Exchange menu) that
HTTP-POSTs the report straight to the CRM — works from
hosted/cloud Tally too because it's an outbound HTTPS call, like e-invoicing.

One-time setup:
1. On Railway, set the environment variable `TALLY_SYNC_KEY` (done — the
   served TDL picks it up automatically; the template never holds the key).
2. Load the TDL via the URL (section 1, step 2).
3. Open **Mickys Stock Export**, set the period if needed (F2), press
   **Ctrl+F10** (or click "Sync to CRM" in the right-hand button bar). The
   CRM's Stock page will show the new "last synced" time
   (source: Tally push).

Rotating the key: generate a new random string, update the Railway variable,
then update the `key=` in the TDL URL configured in Tally — both the served
file's sync URL and the download gate use the env value, so nothing else
changes.

## 5. Hosted Tally (Spectra "App Anywhere") — gotchas & troubleshooting

Our Tally runs on a hosted multi-user server, which changes how TDLs behave:

**The TDL entry keeps disappearing / other users don't see it.** The Manage
Local TDLs setting is saved into each Windows user's *own* virtualized
profile, and the hosting provider resets those profiles during maintenance —
so the entry survives only for the user who added it, and only until the next
reset. Fixes, best first:

1. **Ask Spectra support to register the TDL URL centrally** (same as they
   deploy e-invoicing TDLs): add
   `https://api.mickys-crm.centrepointgroup.in/api/stock/tdl?key=<TALLY_SYNC_KEY>`
   as a TDL path in the central Tally configuration so it loads for every
   user and survives resets. No file needs to be placed on the server at
   all, and updates arrive automatically. This is the proper fix.
2. Otherwise add that URL via F1 → TDLs & AddOns → F4 in each user's session.
   Re-add after a profile reset (it's one URL to retype, not a file to
   re-transfer).
3. File-based loading still works as a fallback (one copy in a shared folder
   like `EXPORTFiscal`/`TALLYBACKUP`), but updates then need manual copying —
   avoid if possible.

**Auto-push isn't firing.** Check in this order:

1. Is the TDL loaded at all? "Mickys Stock Export" must appear in Gateway of
   Tally (see above — the entry may have been reset away).
2. Press **Ctrl+F10** on the report. Success response → backend and key are
   fine. Unauthorized/error → `TALLY_SYNC_KEY` on Railway is missing or
   doesn't match the `key=` in `MickysSyncURL`.
3. The event fires only when the company is **opened**. A hosted session that
   keeps the company open 24×7 never re-fires it — the first user to open
   the company each morning triggers the day's push. Repeat opens/pushes the
   same day are harmless (the CRM just refreshes; the first push of the day
   becomes that day's opening in the Day-wise register).
