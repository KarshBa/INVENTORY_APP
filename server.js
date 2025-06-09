// server.js – persistent‑disk ready, full CSV exporters
// -----------------------------------------------
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Persistent data directory (Render disk) ────────────────────
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DATA_PATH = path.join(DATA_DIR, 'shrink_records.json');

// ─── Helper functions ───────────────────────────────────────────
const slug      = s => s.trim().toUpperCase();
const readJSON  = p => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p,'utf-8')) : {});
const writeJSON = (p,obj) => fs.writeFileSync(p, JSON.stringify(obj,null,2));

// ─── Department list  (front‑end dropdown) ──────────────────────
const DEPT_PATH   = path.join(__dirname, 'public', 'departments.json');
let DEPARTMENTS   = [];

if (fs.existsSync(DEPT_PATH)) {
  DEPARTMENTS = JSON.parse(fs.readFileSync(DEPT_PATH,'utf-8'));
}
if (!DEPARTMENTS.length) DEPARTMENTS = ['GENERAL'];
fs.mkdirSync(path.dirname(DEPT_PATH), { recursive: true });
writeJSON(DEPT_PATH, DEPARTMENTS);

// ─── Initialise shrink_records.json *once* ──────────────────────
if (!fs.existsSync(DATA_PATH)) {
  const bootstrap = {};
  DEPARTMENTS.forEach(d => (bootstrap[slug(d)] = []));
  writeJSON(DATA_PATH, bootstrap);
}

// ─── Express middleware ─────────────────────────────────────────
app.use(express.json());
app.use((req,res,next) => {
  if (req.path.match(/\.(js|css|json)$/)) res.set('Cache-Control','no-store');
  next();
});
app.use(express.static(path.join(__dirname,'public')));

// ─── API routes ─────────────────────────────────────────────────

// List names
app.get('/api/departments', (_req,res) => res.json(DEPARTMENTS));

// Add shrink record
app.post('/api/shrink/:list', (req,res) => {
  const key     = slug(req.params.list);
  const store   = readJSON(DATA_PATH);
  if (!store[key]) store[key] = [];

  const { itemCode, brand, description, quantity, price } = req.body;
  if (!itemCode || quantity === undefined) {
    return res.status(400).json({ error:'itemCode and quantity required' });
  }
  const record = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    itemCode, brand, description, quantity, price
  };
  store[key].push(record);
  writeJSON(DATA_PATH, store);
  res.json({ success:true, record });
});

// Get records for one list
app.get('/api/shrink/:list', (req,res) => {
  const store = readJSON(DATA_PATH);
  res.json(store[slug(req.params.list)] || []);
});

// Delete all records in one list
app.delete('/api/shrink/:list', (req,res) => {
  const key   = slug(req.params.list);
  const store = readJSON(DATA_PATH);
  store[key] = [];
  writeJSON(DATA_PATH, store);
  res.json({ success:true });
});

// Export CSV for one list
app.get('/api/shrink/:list/export', (req,res) => {
  const key     = slug(req.params.list);
  const store   = readJSON(DATA_PATH);
  const rows    = store[key] || [];

  const headers = ['id','timestamp','itemCode','brand','description','quantity','price'];
  const esc     = v => `"${String(v ?? '').replace(/"/g,'""')}"`;
  const csv     = [
    headers.join(','),
    ...rows.map(r => headers.map(h => esc(r[h])).join(','))
  ].join('\n');

  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition',`attachment; filename="shrink_${key.replace(/\s+/g,'_')}.csv"`);
  res.send(csv);
});

// Export CSV for all lists
app.get('/api/shrink/export-all', (_req,res) => {
  const store   = readJSON(DATA_PATH);
  const headers = ['list','id','timestamp','itemCode','brand','description','quantity','price'];
  const esc     = v => `"${String(v ?? '').replace(/"/g,'""')}"`;

  const csvRows = [];
  Object.entries(store).forEach(([k,arr]) => {
    arr.forEach(r => {
      csvRows.push([k, r.id, r.timestamp, r.itemCode, r.brand,
                   r.description, r.quantity, r.price].map(esc).join(','));
    });
  });

  const csv = [headers.join(','), ...csvRows].join('\n');
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition','attachment; filename="shrink_all_lists.csv"');
  res.send(csv);
});

// ─── Start server ───────────────────────────────────────────────
app.listen(PORT, () => console.log('Inventory Shrink app running on port', PORT));