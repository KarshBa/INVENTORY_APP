
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_PATH = path.join(__dirname, 'shrink_records.json');

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ensure shrink_records.json exists
if (!fs.existsSync(DATA_PATH)) {
    fs.writeFileSync(DATA_PATH, JSON.stringify([]));
}

// Utility: read records
const readRecords = () => JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));

// POST /api/shrink -> add shrink record
app.post('/api/shrink', (req, res) => {
    const { itemCode, brand, description, quantity, price } = req.body;
    if (!itemCode || !quantity) {
        return res.status(400).json({ error: 'itemCode and quantity are required' });
    }
    const record = {
        id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2),
        timestamp: new Date().toISOString(),
        itemCode,
        brand,
        description,
        quantity,
        price
    };
    const data = readRecords();
    data.push(record);
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
    res.json({ success: true, record });
});

// GET /api/shrink -> list all records
app.get('/api/shrink', (req, res) => {
    res.json(readRecords());
});

// GET /api/shrink/export -> download CSV
app.get('/api/shrink/export', (req, res) => {
    const records = readRecords();
    const headers = ['id', 'timestamp', 'itemCode', 'brand', 'description', 'quantity', 'price'];
    const escape = (v='') => (`"${String(v).replace(/"/g, '""')}"`);
    const csv = [
        headers.join(','),
        ...records.map(r => headers.map(h => escape(r[h])).join(','))
    ].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="shrink_records.csv"');
    res.send(csv);
});

// DELETE /api/shrink -> clear all records
app.delete('/api/shrink', (req, res) => {
    fs.writeFileSync(DATA_PATH, '[]');
    res.json({ success: true });
});

app.listen(PORT, () => {
    console.log(`Inventory Shrink app listening on http://localhost:${PORT}`);
});
