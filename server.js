
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
