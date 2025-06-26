
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();
app.disable('etag');
const PORT = process.env.PORT || 3000;

// Persistent disk
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
console.log('[Shrink-App] DATA_DIR →', DATA_DIR);
fs.mkdirSync(DATA_DIR, { recursive: true });
const DATA_PATH = path.join(DATA_DIR, 'shrink_records.json');

// Departments
const DEPT_PATH = path.join(__dirname, 'public', 'departments.json');
let DEPARTMENTS = fs.existsSync(DEPT_PATH)
  ? JSON.parse(fs.readFileSync(DEPT_PATH, 'utf-8'))
  : ['GENERAL'];
fs.mkdirSync(path.dirname(DEPT_PATH), { recursive: true });
fs.writeFileSync(DEPT_PATH, JSON.stringify(DEPARTMENTS, null, 2));

/* ------------------------------------------------------------------
 *  Load DEPARTMENTS.csv   (maps sub-dept → top-level list/department)
 *  File format:
 *        Col-A  → sub-department number      (e.g. 40, 40110, 07 …)
 *        Col-B  → list / department name     (e.g. PACKAGE GROCERY)
 *  (No header row)
 * ------------------------------------------------------------------*/
import { parse } from 'csv-parse/sync';

const SUB_TO_LIST = new Map();            // "40" → "PACKAGE GROCERY"

try {
  const depCsv  = fs.readFileSync(path.join(__dirname, 'DEPARTMENTS.csv'), 'utf8');

  /* rows is now an array of arrays: [ [ '40', 'PACKAGE GROCERY' ], … ] */
  const rows = parse(depCsv, {
    columns: false,           // <-- we have NO header row
    skip_empty_lines: true,
    trim: true
  });

  rows.forEach(cells => {
    const subRaw = cells[0];
    const list   = cells[1];

    if (!subRaw || !list) return;          // skip incomplete lines

    /* key is *first two* digits, zero-padded, to match item_list */
    const key = String(subRaw).trim();              // ← no slicing/padding
if (key) SUB_TO_LIST.set(key, String(list).trim().toUpperCase());
  });

  console.log(`[Shrink-App] loaded ${SUB_TO_LIST.size} sub-dept mappings`);
} catch (e) {
  console.warn('[Shrink-App] DEPARTMENTS.csv unreadable – auto-select disabled', e);
}

/* helper: turn a sub-dept into a list name (default OTHER) */
const deriveList = sub =>
  SUB_TO_LIST.get(String(sub).trim()) || 'OTHER';

/* ------------------------------------------------------------
 *  Load item_list.csv  (tolerant header lookup)
 * ------------------------------------------------------------ */

const want = {
  code:        ['maincode'],
  brand:       ['mainitembrand'],
  description: ['mainitemdescription'],
  price:       ['priceregularprice'],
  subdept:     ['subdepartmentnumber']
};

// helper for CSV **header names only**
const cleanHdr = h => String(h)
  .replace(/^\uFEFF/, '')         // remove UTF-8 BOM if present
  .toLowerCase()
  .replace(/[^a-z0-9]/g, '');     // drop everything but a-z & 0-9

// tolerant header lookup
const pick = (row, aliases) => {
  const want = aliases.map(cleanHdr);
  const hit  = Object.keys(row).find(k => want.includes(cleanHdr(k)));
  return hit ? row[hit] : undefined;
};

const masterItems = new Map();

try {
  const csv  = fs.readFileSync(path.join(__dirname, 'item_list.csv'), 'utf8');
  const rows = parse(csv, { columns: true, skip_empty_lines: true });

rows.forEach(r => {
  const code = normCode(pick(r, want.code));

  // 🔒 skip blank / invalid rows
  if (!code || code === '0000000000000') return;

  const subdept = pick(r, want.subdept) || '';     // ← grab once

  masterItems.set(code, {
    code,
    brand      : pick(r, want.brand)       || '',
    description: pick(r, want.description) || '',
    price      : parseFloat(pick(r, want.price) || 0) || '',
    subdept,
    list       : deriveList(subdept)          // ← **add this line**
  });
});
  
  console.log(`[Shrink-App] loaded ${masterItems.size} items`);
} catch (err) {
  console.warn('[Shrink-App] item_list.csv unreadable → look-ups disabled', err);
}

// Initialise store
if (!fs.existsSync(DATA_PATH)) {
  const init = {};
  DEPARTMENTS.forEach(d => (init[d.toUpperCase()] = []));
  fs.writeFileSync(DATA_PATH, JSON.stringify(init, null, 2));
}

// Helpers
const readJSON  = p => JSON.parse(fs.readFileSync(p, 'utf-8'));
const writeJSON = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 2));
const slug      = s => s.trim().toUpperCase();
const esc       = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
const fmtLocal = iso =>
  new Date(iso).toLocaleString('en-US', {
    // pick whatever zone you want; omit timeZone to use server's
    timeZone: 'America/Chicago',
    dateStyle: 'short',
    timeStyle: 'medium'
  });

// digits-only  →  strip UPC-A check-digit (if present) →  left-pad to 13
const normCode = s => {
  const d = String(s || '').replace(/\D/g,'');
  if (d.length === 12) return d.slice(0,11).padStart(13,'0'); // UPC-A + check
  if (d.length === 11) return d.padStart(13,'0');             // UPC-A no check
  return d.padStart(13,'0');                                  // EAN-13, PLU …
};

/* ── variable-weight (scale-label) decoder ────────────────────────────
 *  UPC-A 12-digit label that starts with “2”.
 *  Format: 2 + 5-digit PLU + 5-digit price/weight + check-digit
 *          example 270880507071
 *            2 70880 50707 1
 *            |  PLU |price|cd
 *
 *  We keep the *first* 7 digits (2 + PLU + first price digit) and turn
 *  it into the 13-digit “catalogue” code used in item_list.csv:
 *      00  +  <7-digits> + 0000      ← 13 digits
 *      2708805  → 0027088050000
 *
 *  The sell-price → last 4 of the payload (digits 8-11 of the UPC):
 *      270880507071  →  0707  →  $7.07
 */
const decodeScale = upc => {
  if (!/^[0-9]{12}$/.test(upc) || upc[0] !== '2') return null;

  const body      = upc.slice(0, -1);          // drop check digit
  const catCode = normCode('00' + body.slice(0,7) + '0000');
  const priceCents= parseInt(body.slice(7, 11), 10);           // last-4 digits
  return { catCode, price: (priceCents / 100).toFixed(2) };
};
// ─── New local‐date inRange helper ────────────────────────────────────
const inRange = (ts, from, to) => {
  const t      = new Date(ts);
  // local start at 00:00:00
  const start  = from ? new Date(`${from}T00:00:00`) : null;
  // local end   at 23:59:59.999
  const end    = to   ? new Date(`${to}T23:59:59.999`) : null;
  return (!start || t >= start) && (!end || t <= end);
};

// Middleware
app.use(express.json());
app.use((req, res, next) => {
  if (req.path.match(/\.(js|css|json)$/)) res.set('Cache-Control', 'no-store');
  next();
});

app.get('/__debug_favicon', (_req, res) => {
  const p = path.join(__dirname, 'public', 'favicon.ico');
  res.sendFile(p, err => {
    if (err) console.error('Favicon test failed:', err);
  });
});

app.use(express.static(path.join(__dirname, 'public')));

/* ------------------------------------------------------------
 *  single item lookup
 * ------------------------------------------------------------ */

app.get('/api/item/:code', (req, res) => {
  const rawDigits = String(req.params.code || '').replace(/\D/g,'');
  const code13    = normCode(rawDigits);
  let hit         = masterItems.get(code13);
  /* 2️⃣ variable-weight (scale) label ------------------------------ */
  if (!hit && rawDigits.length === 12 && rawDigits[0] === '2') {

    const body   = rawDigits.slice(0, -1);          // minus check-digit
    const price  = (parseInt(body.slice(7, 11), 10) / 100).toFixed(2);

    /* ---------- NEW helper makes sure the result is 13 digits ---- */
    const catFromPLU = plu => ('00' + plu).padEnd(13, '0');

    const code7 = catFromPLU(body.slice(0, 7));     // 7-digit variant
    const code6 = catFromPLU(body.slice(0, 6));     // 6-digit variant

    hit = masterItems.get(code7) || masterItems.get(code6);

    if (hit) {
      hit = { ...hit, price };                      // merge price
    } else {
      hit = { price, code: code7 };                 // no match at all
    }
  }

  res.json(hit || {});                              // {} → “not found”
});

// ---- Routes ----

// ─── CSV for ALL lists *with total* ───────────────────────────────
app.get('/api/shrink/export-all', (req, res) => {
  const { from, to } = req.query;
  const store   = readJSON(DATA_PATH);

  const headers = ['list','id','timestamp','itemCode','brand',
                   'description','quantity','price','total'];   // ⬅️ new column
  const esc     = v => `"${String(v ?? '').replace(/"/g,'""')}"`;

  const rows   = [];
  let   total  = 0;

  for (const [list, arr] of Object.entries(store)) {
    arr.filter(r => inRange(r.timestamp, from, to))
   .forEach(r => {
     const qty      = parseFloat(r.quantity) || 0;
     const price    = parseFloat(r.price)    || 0;
     const lineTot  = qty * price;
     total += lineTot;

     rows.push([
       list, r.id, fmtLocal(r.timestamp), r.itemCode, r.brand,
       r.description, r.quantity, r.price, lineTot.toFixed(2)
     ].map(esc).join(','));
   });
  }

  const totalRow = ['SHRINK TOTAL','','','','','','','',esc(total.toFixed(2))].join(',');

  const csv = [headers.join(','), ...rows, totalRow].join('\n');
  res.status(200).set({
    'Cache-Control':  'no-store',
    'Content-Type':   'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="shrink_all_lists.csv"'
  }).send(csv);
});

// Departments list
app.get('/api/departments', (_req, res) => res.json(DEPARTMENTS));

// Add record
app.post('/api/shrink/:list', (req, res) => {
  const key = slug(req.params.list);
  const store = readJSON(DATA_PATH);
  if (!store[key]) store[key] = [];
  let { itemCode, brand, description, quantity, price } = req.body;
  itemCode = normCode(itemCode);          // ← strip check-digit & left-pad
  if (!itemCode || quantity === undefined) {
    return res.status(400).json({ error: 'itemCode and quantity required' });
  }
  const record = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    itemCode, brand, description, quantity, price
  };
  store[key].push(record);
  writeJSON(DATA_PATH, store);
  res.json({ success: true, record });
});

// Get records for one list filtered by date range
app.get('/api/shrink/:list', (req, res) => {
  const { from, to } = req.query;
  const store = readJSON(DATA_PATH);
  const rows = (store[slug(req.params.list)] || []).filter(r => inRange(r.timestamp, from, to));
  res.json(rows);
});

// ── NEW: delete ONE record by ID ────────────────────────────────
app.delete('/api/shrink/:list/:id', (req, res) => {
  const key   = slug(req.params.list);
  const recId = req.params.id;
  const store = readJSON(DATA_PATH);

  if (!store[key]) {
    return res.status(404).json({ error: 'list-not-found' });
  }

  const before = store[key].length;
  store[key]   = store[key].filter(r => r.id !== recId);

  if (store[key].length === before) {
    return res.status(404).json({ error: 'record-not-found' });
  }

  writeJSON(DATA_PATH, store);
  res.json({ success: true });
});

// Delete records in range or entire list
app.delete('/api/shrink/:list', (req, res) => {
  const { from, to } = req.query;
  const key = slug(req.params.list);
  const store = readJSON(DATA_PATH);
  if (from || to) {
    store[key] = (store[key] || []).filter(r => !inRange(r.timestamp, from, to));
  } else {
    store[key] = [];
  }
  writeJSON(DATA_PATH, store);
  res.json({ success: true });
});

// ─── CSV for ONE list *with total* ────────────────────────────────
app.get('/api/shrink/:list/export', (req, res) => {
  const { from, to } = req.query;
  const listKey = slug(req.params.list);
  const store   = readJSON(DATA_PATH);

  const headers = ['id','timestamp','itemCode','brand',
                   'description','quantity','price','total'];   // ⬅️ new column
  let   total   = 0;

  const rows = (store[listKey] || [])
    .filter(r => inRange(r.timestamp, from, to))
    .map(r => {
const qty   = parseFloat(r.quantity) || 0;
const price = parseFloat(r.price)     || 0;
total += qty * price;
            return [
        esc(r.id),
        esc(fmtLocal(r.timestamp)),
        esc(r.itemCode),
        esc(r.brand),
        esc(r.description),
        esc(r.quantity),
        esc(r.price),
        esc((qty * price).toFixed(2))        // new per-row total
      ].join(',');
    });

  const totalRow = ['SHRINK TOTAL','','','','','','',esc(total.toFixed(2))].join(',');

  const csv = [headers.join(','), ...rows, totalRow].join('\n');
  res.status(200).set({
    'Cache-Control':  'no-store',
    'Content-Type':   'text/csv; charset=utf-8',
    'Content-Disposition':
      `attachment; filename="shrink_${listKey}.csv"`
  }).send(csv);
});

// Start server
app.listen(PORT, () => console.log('Inventory Shrink app running on port', PORT));
