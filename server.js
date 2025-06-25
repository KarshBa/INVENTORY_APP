
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

/* ------------------------------------------------------------
 *  Load item_list.csv  (tolerant header lookup)
 * ------------------------------------------------------------ */
import { parse } from 'csv-parse/sync';

const want = {                 // canonical → possible header texts
  code:        ['main code'],
  brand:       ['main item-brand'],
  description: ['main item-description'],
  price:       ['price-regular-price'],
  subdept:     ['sub-department-number']
};

// helper: case/space-insensitive header pick
const pick = (row, aliases) => {
  const keys = Object.keys(row);
  for (const alias of aliases) {
    const k = keys.find(h =>
      h.replace(/\s+/g, '').toLowerCase() ===
      alias.replace(/\s+/g, '').toLowerCase()
    );
    if (k) return row[k];
  }
  return undefined;
};

const masterItems = new Map();

try {
  const csv  = fs.readFileSync(path.join(__dirname, 'item_list.csv'), 'utf8');
  const rows = parse(csv, { columns: true, skip_empty_lines: true });

  rows.forEach(r => {
    const rawCode = pick(r, want.code) || '';
    const code = String(rawCode).replace(/\D/g, '').padStart(13, '0');
    if (!code) return;          // skip rows without a usable code

    masterItems.set(code, {
      code,
      brand:       pick(r, want.brand)       || '',
      description: pick(r, want.description) || '',
      price:       parseFloat(pick(r, want.price) || 0) || '',
      subdept:     pick(r, want.subdept)     || ''
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
  const catCode   = '00' + body.slice(0, 7) + '0000';          // 13-digit lookup
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
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/item/:code', (req, res) => {
  const raw = String(req.params.code || '').replace(/\D/g, '');

  // 1️⃣ normal 13-digit catalogue number
  let hit = masterItems.get(raw.padStart(13, '0'));

  // 2️⃣ variable-weight (scale) label?
  if (!hit) {
    const s = decodeScale(raw);       // uses the helper you added above
    if (s) {
      hit = { ...(masterItems.get(s.catCode) || {}), price: s.price };
      hit.code = s.catCode;           // expose the catalogue code we used
    }
  }

  res.json(hit || {});                // empty object == “not found”
});
// ---- Routes ----

// ─── CSV for ALL lists *with total* ───────────────────────────────
app.get('/api/shrink/export-all', (req, res) => {
  const { from, to } = req.query;
  const store   = readJSON(DATA_PATH);

  const headers = ['list','id','timestamp','itemCode','brand',
                   'description','quantity','price'];
  const esc     = v => `"${String(v ?? '').replace(/"/g,'""')}"`;

  const rows   = [];
  let   total  = 0;

  for (const [list, arr] of Object.entries(store)) {
    arr.filter(r => inRange(r.timestamp, from, to))
       .forEach(r => {
const qty   = parseFloat(r.quantity) || 0;
const price = parseFloat(r.price)     || 0;
total += qty * price;
         rows.push([list, r.id, r.timestamp, r.itemCode, r.brand,
                    r.description, r.quantity, r.price].map(esc).join(','));
       });
  }

  const totalRow = ['TOTAL','','','','','','',esc(total.toFixed(2))].join(',');

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
  const { itemCode, brand, description, quantity, price } = req.body;
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
                   'description','quantity','price'];
  let   total   = 0;

  const rows = (store[listKey] || [])
    .filter(r => inRange(r.timestamp, from, to))
    .map(r => {
const qty   = parseFloat(r.quantity) || 0;
const price = parseFloat(r.price)     || 0;
total += qty * price;
      return headers.map(h => esc(r[h])).join(',');
    });

  const totalRow = ['TOTAL','','','','','',esc(total.toFixed(2))].join(',');

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
