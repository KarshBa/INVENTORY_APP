
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Persistent disk directory (Render disk mounted at /data)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DATA_PATH = path.join(DATA_DIR, 'shrink_records.json');
const DEPT_PATH = path.join(__dirname, 'public', 'departments.json');

// ─── helpers ───────────────────────────────────────────────────────
const readJSON  = p => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : {});
const writeJSON = (p, obj) => fs.writeFileSync(p, JSON.stringify(obj, null, 2));

// initialise once – but **only** if the file doesn’t exist yet
if (!fs.existsSync(DATA_PATH)) {
  const bootstrap = {};
  DEPARTMENTS.forEach(d => (bootstrap[slug(d)] = []));
  writeJSON(DATA_PATH, bootstrap);
}

app.use(express.json());
app.use((req,res,next)=>{
  if(req.path.match(/\.(js|css|json)$/)) res.set('Cache-Control','no-store');
  next();
});
app.use(express.static(path.join(__dirname,'public')));

// Departments
let DEPARTMENTS = readJSON(DEPT_PATH);
if (!DEPARTMENTS.length) DEPARTMENTS = ['GENERAL'];
writeJSON(DEPT_PATH, DEPARTMENTS);

// Init shrink_records
let store = readJSON(DATA_PATH);
DEPARTMENTS.forEach(d => { const key=d.trim().toUpperCase(); if(!store[key]) store[key]=[]; });
writeJSON(DATA_PATH, store);

const slug = s=>s.trim().toUpperCase();

app.get('/api/departments',(_,res)=>res.json(DEPARTMENTS));

app.post('/api/shrink/:list',(req,res)=>{
  const listKey = slug(req.params.list);
  const {itemCode,brand,description,quantity,price}=req.body;
  const record={id:crypto.randomUUID(),timestamp:new Date().toISOString(),itemCode,brand,description,quantity,price};
  store = readJSON(DATA_PATH);
  if(!store[listKey]) store[listKey]=[];
  store[listKey].push(record);
  writeJSON(DATA_PATH,store);
  res.json({success:true,record});
});

app.get('/api/shrink/:list',(req,res)=>{
  const listKey=slug(req.params.list);
  store = readJSON(DATA_PATH);
  res.json(store[listKey]||[]);
});

// ─── CSV exporter for ONE list ─────────────────────────────────────
app.get('/api/shrink/:list/export', (req, res) => {
  const key     = slug(req.params.list);
  const store   = readJSON(DATA_PATH);
  const rows    = store[key] || [];

  const headers = ['id','timestamp','itemCode','brand',
                   'description','quantity','price'];
  const esc     = v => `"${String(v ?? '').replace(/"/g,'""')}"`;
  const csv     = [
    headers.join(','),
    ...rows.map(r => headers.map(h => esc(r[h])).join(','))
  ].join('\n');

  res.setHeader('Content-Type',        'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition',
    `attachment; filename="shrink_${key.replace(/\\s+/g,'_')}.csv"`);
  res.send(csv);
});

// ─── CSV exporter for ALL lists ────────────────────────────────────
app.get('/api/shrink/export-all', (_req, res) => {
  const store   = readJSON(DATA_PATH);
  const headers = ['list','id','timestamp','itemCode','brand',
                   'description','quantity','price'];
  const esc     = v => `"${String(v ?? '').replace(/"/g,'""')}"`;

  const csvRows = [];
  Object.entries(store).forEach(([k, arr]) =>
    arr.forEach(r =>
      csvRows.push([k, r.id, r.timestamp, r.itemCode, r.brand,
                    r.description, r.quantity, r.price].map(esc).join(','))
    )
  );

  const csv = [headers.join(','), ...csvRows].join('\n');
  res.setHeader('Content-Type',        'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="shrink_all_lists.csv"');
  res.send(csv);
});

app.listen(PORT,()=>console.log('Listening on',PORT));
