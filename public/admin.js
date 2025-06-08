
const tbody = document.querySelector('#shrink-table tbody');
const refreshBtn = document.getElementById('refresh');
const downloadBtn = document.getElementById('download');
const clearBtn = document.getElementById('clear');
const downloadAllBtn = document.getElementById('downloadAll');
const listSelect = document.getElementById('listSelect');

const slug = s => s.trim().toUpperCase();

async function populateLists() {
  const res = await fetch('/api/departments');
  const lists = await res.json();
  lists.forEach(l => {
    const opt = document.createElement('option');
    opt.value = l;
    opt.textContent = l;
    listSelect.appendChild(opt);
  });
  loadData();
}

async function loadData() {
  const raw = listSelect.value;
  try {
    const res = await fetch('/api/shrink/' + encodeURIComponent(raw));
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
      console.log('Records for', raw, data);
    tbody.innerHTML = '';
    data.slice().reverse().forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${new Date(r.timestamp).toLocaleString()}</td>
        <td>${r.itemCode}</td>
        <td>${r.brand || ''}</td>
        <td>${r.description || ''}</td>
        <td>${r.quantity}</td>
        <td>${r.price ?? ''}</td>
      `;
      tbody.appendChild(tr);
    });
    if (data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">No records</td></tr>';
    }
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:red;">Error loading data</td></tr>';
    console.error(err);
  }
}

refreshBtn.addEventListener('click', loadData);
listSelect.addEventListener('change', loadData);
downloadBtn.addEventListener('click', () => {
  const raw = listSelect.value;
  window.location = '/api/shrink/' + encodeURIComponent(raw) + '/export';
});
clearBtn.addEventListener('click', async () => {
  const raw = listSelect.value;
  if (!confirm(`Delete all records in "${raw}"?`)) return;
  await fetch('/api/shrink/' + encodeURIComponent(raw), { method: 'DELETE' });
  loadData();
});
downloadAllBtn.addEventListener('click', () => {
  window.location = '/api/shrink/export-all';
});

populateLists();
