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

## 3. Parsing notes (for the backend sync)

- Quantities come with the unit (`190 pkt`) and amounts use Indian comma grouping (`1,05,000.00`). Normalize with something like:

  ```js
  const num = (v) => parseFloat(String(v ?? "").replace(/,/g, "")) || 0;
  ```

- Validation check per item: `closing = opening + inward − outward`.
- If `INWARDQTY` / `OUTWARDQTY` come back empty on your Tally release, tell me the exact TallyPrime release number — those two method names vary slightly across releases and I'll adjust just those fields. Opening/closing will always work.

## 4. Getting this into the hosted CRM

The backend runs on Railway and **cannot reach Tally on the shop PC directly** (Tally is on the local network, not the internet). The plan is a small **local sync agent** — a Node script running on the Tally PC that pulls this report on a schedule and POSTs it to a CRM API endpoint (e.g. `POST /api/stock/sync` with an API key). That's the next build step after the TDL is verified.
