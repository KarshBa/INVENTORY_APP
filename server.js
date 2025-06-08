
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_PATH = path.join(__dirname, 'shrink_records.json');
const DEPT_PATH = path.join(__dirname, 'public', 'departments.json');

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Utility: load departments list
const DEPARTMENTS = JSON.parse(fs.readFileSync(DEPT_PATH, 'utf-8'));

// Ensure shrink_records.json exists
if (!fs.existsSync(DATA_PATH)) {
    const obj = {};
    DEPARTMENTS.forEach(d => { obj[d] = []; });
    fs.writeFileSync(DATA_PATH, JSON.stringify(obj, null, 2));
}

const readData = () => JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
const writeData = (data) => fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));

// Validate list middleware
const validateList = (req, res, next) => {
    const listName = decodeURIComponent(req.params.listName);
    if (!DEPARTMENTS.includes(listName)) {
        return res.status(400).json({ error: 'Invalid list name' });
    }
    req.listName = listName;
    next();
};

// POST /api/shrink/:listName
app.post('/api/shrink/:listName', validateList, (req, res) => {
    const { itemCode, brand, description, quantity, price } = req.body;
    if (!itemCode || !quantity) {
        return res.status(400).json({ error: 'itemCode and quantity are required' });
    }
    const record = {
        id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2),
        timestamp: new Date().toISOString(),
        itemCode, brand, description, quantity, price
    };
    const data = readData();
    data[req.listName].push(record);
    writeData(data);
    res.json({ success: true, record });
});

// GET /api/shrink/:listName
app.get('/api/shrink/:listName', validateList, (req, res) => {
    const data = readData();
    res.json(data[req.listName]);
});

// DELETE /api/shrink/:listName
app.delete('/api/shrink/:listName', validateList, (req, res) => {
    const data = readData();
    data[req.listName] = [];
    writeData(data);
    res.json({ success: true });
});

// GET /api/shrink/:listName/export
app.get('/api/shrink/:listName/export', validateList, (req, res) => {
    const records = readData()[req.listName];
    const headers = ['id','timestamp','itemCode','brand','description','quantity','price'];
    const escape = (v='') => (`"${String(v).replace(/"/g, '""')}"`);
    const csv = [headers.join(','), ...records.map(r => headers.map(h => escape(r[h])).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="shrink_${req.listName.replace(/\s+/g,'_')}.csv"`);
    res.send(csv);
});

// GET /api/shrink/export-all
app.get('/api/shrink/export-all', (req, res) => {
    const data = readData();
    const headers = ['list','id','timestamp','itemCode','brand','description','quantity','price'];
    const escape = (v='') => (`"${String(v).replace(/"/g, '""')}"`);
    const rows = [];
    Object.keys(data).forEach(list => {
        data[list].forEach(r => {
            const row = [list, r.id, r.timestamp, r.itemCode, r.brand, r.description, r.quantity, r.price];
            rows.push(row.map(escape).join(','));
        });
    });
    const csv = [headers.join(','), ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="shrink_all_lists.csv"');
    res.send(csv);
});

// GET /api/departments
app.get('/api/departments', (req, res) => {
    res.json(DEPARTMENTS);
});

// Fallback: create missing list keys
app.post('/api/refresh-lists', (req, res) => {
    const data = readData();
    let changed = false;
    DEPARTMENTS.forEach(d => {
        if (!data[d]) {
            data[d] = [];
            changed = true;
        }
    });
    if (changed) writeData(data);
    res.json({ added: changed });
});

app.listen(PORT, () => {
    console.log('Inventory Shrink app running on http://localhost:' + PORT);
});
