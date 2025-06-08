
const tbody = document.querySelector('#shrink-table tbody');
const refreshBtn = document.getElementById('refresh');
const downloadBtn = document.getElementById('download');
const clearBtn = document.getElementById('clear');
const downloadAllBtn = document.getElementById('downloadAll');
const listSelect = document.getElementById('listSelect');

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
  const list = listSelect.value;
  const res = await fetch('/api/shrink/' + encodeURIComponent(list));
  const data = await res.json();
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
}

refreshBtn.addEventListener('click', loadData);
listSelect.addEventListener('change', loadData);
downloadBtn.addEventListener('click', () => {
  const list = listSelect.value;
  window.location = '/api/shrink/' + encodeURIComponent(list) + '/export';
});
clearBtn.addEventListener('click', async () => {
  const list = listSelect.value;
  if (!confirm(`Delete all records in "${list}"?`)) return;
  await fetch('/api/shrink/' + encodeURIComponent(list), { method: 'DELETE' });
  loadData();
});
downloadAllBtn.addEventListener('click', () => {
  window.location = '/api/shrink/export-all';
});

populateLists();
