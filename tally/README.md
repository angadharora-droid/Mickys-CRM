# Tally Prime → Mickys CRM: Stock Export

Files here:

- `mickys-stock.tdl` — the TDL to load into Tally Prime. Defines report `MickysStockReport` (opening / inward / outward / closing stock per item, plus group, category, unit, standard cost/price).
- `sample-stock-request.xml` — the request envelope the CRM backend POSTs to Tally to pull that report.

## 1. One-time Tally setup (on the PC running Tally Prime)

1. **Enable the XML gateway:** F1 (Help) → Settings → Connectivity → Client/Server configuration → set **"TallyPrime acts as" = Both** (leave "Enable ODBC" = No; keep the port it shows — 9001 in our setup). This setting is per-machine: do it only on the one PC the sync will talk to; other users' Tally installs are unaffected.
2. **Load the TDL:** F1 (Help) → TDLs & AddOns → press **F4** (Manage Local TDLs) → set "Load selected TDL files on startup" to **Yes** → enter the full path to `mickys-stock.tdl` → **Ctrl+A** to save. Tally will show it as loaded.
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

## 3. Format notes (implemented in server/src/services/tallyStock.service.js)

Confirmed against a real export from TallyPrime 7.0 (Gold):

- Values carry Tally's accounting sign (inward/closing negative, outward positive) — the parser abs()'s them.
- Zero figures export as **empty tags**; file export has **no** thousands separators.
- Quantities include the unit (`360.00 KG`), rates the `/unit` suffix (`78.00/KG`).
- Reserved names come flagged with a `&#4;` control char (`&#4; Primary`, `&#4; Not Applicable`) → treated as "no group/category".
- Validation per item: `closing = opening + inward − outward`.

## 4. Getting it into the CRM

Two ways, both hitting `POST /api/stock/sync` on the backend:

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
1. In `mickys-stock.tdl`, edit the `MickysSyncURL` formula: replace
   `YOUR-BACKEND-URL` with the CRM backend host (the Railway domain). The
   `key=` value is the shared secret — leave it as generated.
2. On Railway, add the environment variable `TALLY_SYNC_KEY` set to that same
   key value, and redeploy.
3. Reload the TDL in Tally (quit & reopen Tally, or F1 → TDLs & AddOns).
4. Open **Mickys Stock Export**, set the period if needed (F2), press
   **Ctrl+F10** (or click "Sync to CRM" in the right-hand button bar). The
   CRM's Stock page will show the new "last synced" time
   (source: Tally push).

Rotating the key: generate a new random string, update both the Railway
variable and the TDL URL.
