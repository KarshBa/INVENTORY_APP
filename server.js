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

// ---------- Resolve departments list ----------
let DEPARTMENTS = [];

// 1. CSV file takes precedence (easy editing in repo)
if (fs.existsSync(CSV_PATH)) {
    const raw = fs.readFileSync(CSV_PATH, 'utf-8').split(/\r?\n/).filter(Boolean);
    DEPARTMENTS = raw.map(line => {
        const parts = line.split(',');
        return (parts.length > 1 ? parts[1] : parts[0]).trim();
    });
}

// 2. Otherwise fallback to departments.json
if (DEPARTMENTS.length === 0 && fs.existsSync(JSON_PATH)) {
    DEPARTMENTS = JSON.parse(fs.readFileSync(JSON_PATH, 'utf-8'));
}

// 3. Otherwise read keys already in shrink_records.json
if (DEPARTMENTS.length === 0 && fs.existsSync(DATA_PATH)) {
    try {
        const keys = Object.keys(JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8')));
        if (keys.length) DEPARTMENTS = keys;
    } catch { /* ignore */ }
}

// 4. Final fallback
if (DEPARTMENTS.length === 0) DEPARTMENTS = ['General'];

// Sync to departments.json for client fetch
fs.mkdirSync(path.dirname(JSON_PATH), { recursive: true });
fs.writeFileSync(JSON_PATH, JSON.stringify(DEPARTMENTS, null, 2));

// ---------- Ensure shrink_records.json ----------
let dataObj = {};
if (fs.existsSync(DATA_PATH)) {
    try { dataObj = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8')); }
    catch { dataObj = {}; }
}
let changed = false;
DEPARTMENTS.forEach(d => {
    if (!dataObj[d]) { dataObj[d] = []; changed = true; }
});
if (changed || !fs.existsSync(DATA_PATH)) {
    fs.writeFileSync(DATA_PATH, JSON.stringify(dataObj, null, 2));
}

const readData = () => JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
const writeData = obj => fs.writeFileSync(DATA_PATH, JSON.stringify(obj, null, 2));

// ---------- Middleware ----------
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const validateList = (req, res, next) => {
    const name = decodeURIComponent(req.params.listName);
    if (!DEPARTMENTS.includes(name)) return res.status(400).json({ error: 'Invalid list' });
    req.listName = name;
    next();
};

// ---------- Routes ----------
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

// ---------- Start ----------
app.listen(PORT, () => console.log('Shrink app listening on ' + PORT));
