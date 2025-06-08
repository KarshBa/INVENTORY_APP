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

// ---- Resolve departments ----
let DEPARTMENTS = [];
if (fs.existsSync(CSV_PATH)) {
    const lines = fs.readFileSync(CSV_PATH, 'utf-8')
                    .split(/\r?\n/)
                    .map(l => l.trim())
                    .filter(Boolean);
    DEPARTMENTS = lines.map(l => {
        const parts = l.split(',');
        return (parts.length > 1 ? parts[1] : parts[0]).trim();
    });
} else if (fs.existsSync(JSON_PATH)) {
    DEPARTMENTS = JSON.parse(fs.readFileSync(JSON_PATH, 'utf-8'));
} else if (fs.existsSync(DATA_PATH)) {
    try { DEPARTMENTS = Object.keys(JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'))); }
    catch { }
}
if (DEPARTMENTS.length === 0) DEPARTMENTS = ['General'];

// keep departments.json for client
fs.mkdirSync(path.dirname(JSON_PATH), { recursive: true });
fs.writeFileSync(JSON_PATH, JSON.stringify(DEPARTMENTS, null, 2));

// ---- Init data ----
let dataObj = {};
if (fs.existsSync(DATA_PATH)) {
    try { dataObj = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8')); }
    catch { }
}
let touched = false;
DEPARTMENTS.forEach(d => {
    if (!dataObj[d]) { dataObj[d] = []; touched = true; }
});
if (touched || !fs.existsSync(DATA_PATH)) {
    fs.writeFileSync(DATA_PATH, JSON.stringify(dataObj, null, 2));
}

const readData = () => JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
const writeData = obj => fs.writeFileSync(DATA_PATH, JSON.stringify(obj, null, 2));

// ---- Middleware ----
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Case‑insensitive list validation
const validateList = (req, res, next) => {
    const raw = decodeURIComponent(req.params.listName);
    const canonical = DEPARTMENTS.find(d => d.toUpperCase() === raw.toUpperCase());
    if (!canonical) return res.status(400).json({ error: 'Invalid list' });
    req.listName = canonical;
    next();
};

// ---- Routes ----
app.get('/api/departments', (req,res) => res.json(DEPARTMENTS));

app.post('/api/shrink/:listName', validateList, (req,res) => {
    const { itemCode, brand, description, quantity, price } = req.body;
    if (!itemCode || !quantity) return res.status(400).json({ error: 'itemCode and quantity required' });
    const record = { 
        id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2),
        timestamp: new Date().toISOString(),
        itemCode, brand, description, quantity, price
    };
    const store = readData();
    if (!store[req.listName]) store[req.listName] = [];
    console.log('Adding record to', req.listName, record);
        store[req.listName].push(record);
    writeData(store);
    res.json({ success:true, record });
});

app.get('/api/shrink/:listName', validateList, (req,res) => {
    const store = readData();
    res.json(store[req.listName] || []);
});

app.delete('/api/shrink/:listName', validateList, (req,res) => {
    const store = readData();
    store[req.listName] = [];
    writeData(store);
    res.json({ success:true });
});

app.get('/api/shrink/:listName/export', validateList, (req,res) => {
    const records = readData()[req.listName] || [];
    const headers = ['id','timestamp','itemCode','brand','description','quantity','price'];
    const esc = v => `"${String(v??'').replace(/"/g,'""')}"`;
    const csv = [headers.join(','), ...records.map(r => headers.map(h=>esc(r[h])).join(','))].join('\n');
    res.setHeader('Content-Type','text/csv');
    res.setHeader('Content-Disposition',`attachment; filename="shrink_${req.listName.replace(/\s+/g,'_')}.csv"`);
    res.send(csv);
});

app.get('/api/shrink/export-all', (req,res) => {
    const store = readData();
    const headers = ['list','id','timestamp','itemCode','brand','description','quantity','price'];
    const esc = v => `"${String(v??'').replace(/"/g,'""')}"`;
    const rows = [];
    Object.keys(store).forEach(list => {
        store[list].forEach(r => rows.push([list, r.id, r.timestamp, r.itemCode, r.brand, r.description, r.quantity, r.price]
                                            .map(esc).join(',')));
    });
    res.setHeader('Content-Type','text/csv');
    res.setHeader('Content-Disposition','attachment; filename="shrink_all_lists.csv"');
    res.send([headers.join(','), ...rows].join('\n'));
});

app.listen(PORT, () => console.log('Shrink app listening on port ' + PORT));
