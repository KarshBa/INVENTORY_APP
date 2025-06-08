import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const CSV_PATH = path.join(__dirname, 'DEPARTMENTS.csv');
const JSON_PATH = path.join(__dirname, 'public', 'departments.json');
const DATA_PATH = path.join(__dirname, 'shrink_records.json');

// ------------ Helpers -------------
const slug = s => s.trim().toUpperCase();   // canonical key

// ------------ Load Department list -------------
let DEPARTMENTS = [];

if (fs.existsSync(CSV_PATH)) {
    const lines = fs.readFileSync(CSV_PATH, 'utf-8').split(/\r?\n/).filter(Boolean);
    DEPARTMENTS = lines.map(l => {
        const parts = l.split(',');
        return (parts.length > 1 ? parts[1] : parts[0]).trim();
    });
} else if (fs.existsSync(JSON_PATH)) {
    DEPARTMENTS = JSON.parse(fs.readFileSync(JSON_PATH, 'utf-8'));
} else if (fs.existsSync(DATA_PATH)) {
    try { DEPARTMENTS = Object.keys(JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'))); } catch {}
}
if (DEPARTMENTS.length === 0) DEPARTMENTS = ['GENERAL'];

// write departments.json for client
fs.mkdirSync(path.dirname(JSON_PATH), { recursive: true });
fs.writeFileSync(JSON_PATH, JSON.stringify(DEPARTMENTS, null, 2));

// ------------ Initialise data store -------------
let store = {};
if (fs.existsSync(DATA_PATH)) {
    try { store = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8')); } catch {}
}
DEPARTMENTS.forEach(d => {
    const key = slug(d);
    if (!store[key]) store[key] = [];
});
fs.writeFileSync(DATA_PATH, JSON.stringify(store, null, 2));

const readData = () => JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
const writeData = data => fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));

// ------------ Middleware -------------
app.use(express.json());
// Prevent aggressive caching of dynamic assets
app.use((req, res, next) => {
  if (req.path.match(/\.(js|css|json)$/)) {
    res.set('Cache-Control', 'no-store');
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

const validateList = (req, res, next) => {
    const raw = decodeURIComponent(req.params.listName);
    const match = DEPARTMENTS.find(d => slug(d) === slug(raw));
    if (!match) return res.status(400).json({ error: 'Invalid list' });
    req.listName = match;          // human-readable
    req.listKey = slug(match);     // canonical key
    next();
};

// ------------ Routes -------------
app.get('/api/departments', (_req, res) => res.json(DEPARTMENTS));

// Add shrink record
app.post('/api/shrink/:listName', validateList, (req, res) => {
    const { itemCode, brand, description, quantity, price } = req.body;
    if (!itemCode || !quantity) return res.status(400).json({ error: 'itemCode and quantity required' });
    const record = {
        id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2),
        timestamp: new Date().toISOString(),
        itemCode,
        brand,
        description,
        quantity,
        price
    };
    const data = readData();
    if (!data[req.listKey]) data[req.listKey] = [];
    data[req.listKey].push(record);
    writeData(data);
    console.log('Added record to', req.listKey);
    res.json({ success: true, record });
});

// Get list
app.get('/api/shrink/:listName', validateList, (req, res) => {
    const data = readData();
    res.json(data[req.listKey] || []);
});

// Delete list
app.delete('/api/shrink/:listName', validateList, (req, res) => {
    const data = readData();
    data[req.listKey] = [];
    writeData(data);
    res.json({ success: true });
});

// Export list
app.get('/api/shrink/:listName/export', validateList, (req, res) => {
    const records = readData()[req.listKey] || [];
    const headers = ['id','timestamp','itemCode','brand','description','quantity','price'];
    const esc = v => `"${String(v??'').replace(/"/g,'""')}"`;
    const csv = [headers.join(','), ...records.map(r => headers.map(h => esc(r[h])).join(','))].join('\n');
    res.setHeader('Content-Type','text/csv');
    res.setHeader('Content-Disposition',`attachment; filename="shrink_${req.listKey.replace(/\s+/g,'_')}.csv"`);
    res.send(csv);
});

// Export all
app.get('/api/shrink/export-all', (_req, res) => {
    const data = readData();
    const headers = ['list','id','timestamp','itemCode','brand','description','quantity','price'];
    const esc = v => `"${String(v??'').replace(/"/g,'""')}"`;
    const rows = [];
    Object.keys(data).forEach(k => {
        data[k].forEach(r => rows.push([k, r.id, r.timestamp, r.itemCode, r.brand, r.description, r.quantity, r.price].map(esc).join(',')));
    });
    res.setHeader('Content-Type','text/csv');
    res.setHeader('Content-Disposition','attachment; filename="shrink_all_lists.csv"');
    res.send([headers.join(','), ...rows].join('\n'));
});

app.listen(PORT, () => console.log('Shrink app listening on port', PORT));
