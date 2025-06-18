
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

// ────────────────────────────────────────────────────────────────
//  load master item list  (reads item_list.csv once and keeps it in memory)
// ----------------------------------------------------------------
import { parse } from 'csv-parse/sync';              // keep this import

const ITEM_CSV_PATH = path.join(__dirname,'item_list.csv');

// helper to normalise header names
const clean  = s => String(s||"").replace(/"/g,"").trim().toLowerCase();
const wanted = {
  code : ["main code"],
  brand: ["main item-brand"],
  description: ["main item-description"],
  price: ["price-regular-price"],
  subdept: ["sub-department-number"]
};
const pick = (row, aliases) =>
  aliases.reduce((v,a)=>v??row[Object.keys(row).find(k=>clean(k)===a)],undefined);

const masterItems = new Map();                       // ← will replace ITEM_MAP
try{
  const csv  = fs.readFileSync(ITEM_CSV_PATH,'utf8');
  const rows = parse(csv,{columns:true,skip_empty_lines:true});
  
/* ---------------------------------------------------- *
 * Build SUB_MAP  { "sub-dept-number" → "Shrink List" } *
 * ---------------------------------------------------- */
const SUB_MAP = {};
try {
  // we already saved departments.json earlier; reuse it
  const deptCSV = fs.readFileSync(
      path.join(__dirname, 'DEPARTMENTS.csv'), 'utf8');

  // every line:  Sub-Department-Number, Shrink-List
  deptCSV.split(/\r?\n/).forEach(line=>{
    const [sub,list] = line.split(',').map(s=>s.trim());
    if (sub && list) SUB_MAP[sub] = list.toUpperCase();
  });
  console.log(`[Shrink-App] mapped ${Object.keys(SUB_MAP).length} sub-depts`);
} catch { /* skip silently if file missing */ }

  rows.forEach(r=>{
    /* ――― tolerant header lookup ――― */
  const code = String(pick(r, wanted.code) || '')
                 .replace(/\D/g,'')        // digits only
                 .padStart(13,'0');        // keep 13-digit UPC
  if (!code) return;

  const sub = pick(r, wanted.subdept) || '';

  masterItems.set(code, {
    code,
    brand:       pick(r, wanted.brand)       || '',
    description: pick(r, wanted.description) || '',
    price:       parseFloat(pick(r, wanted.price) || 0) || '',
    subdept:     sub,
    list:        SUB_MAP[sub] || ''          // ← NEW
  });
 });
  console.log(`[Shrink-App] loaded ${masterItems.size} items from item_list.csv`);
}catch(err){
  console.warn('[Shrink-App] item_list.csv not found / unreadable → look-ups disabled');
}

app.get('/api/item/:code', (req, res) => {
  const code = norm(req.params.code).padStart(13,'0');
  res.json(masterItems.get(code) || {});          // empty object == “not found”
});

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
// normalise an item code → remove everything except digits, then drop leading 0s
const norm = s => String(s ?? '')
                    .replace(/\D/g,'')   // keep digits only
                    .replace(/^0+/, ''); // strip leading zeros
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
       list, r.id, r.timestamp, r.itemCode, r.brand,
       r.description, r.quantity, r.price, lineTot.toFixed(2)
     ].map(esc).join(','));
   });
  }

  const totalRow = ['TOTAL','','','','','','','',esc(total.toFixed(2))].join(',');

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
        esc(r.timestamp),
        esc(r.itemCode),
        esc(r.brand),
        esc(r.description),
        esc(r.quantity),
        esc(r.price),
        esc((qty * price).toFixed(2))        // new per-row total
      ].join(',');
    });

  const totalRow = ['TOTAL','','','','','','',esc(total.toFixed(2))].join(',');

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
