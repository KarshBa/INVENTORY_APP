
const tbody = document.querySelector('#shrink-table tbody');
const refreshBtn = document.getElementById('refresh');
const downloadBtn = document.getElementById('download');
const clearBtn = document.getElementById('clear');

async function loadData() {
  const res = await fetch('/api/shrink');
  const data = await res.json();
  tbody.innerHTML = '';
  data.reverse().forEach(r => {
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
downloadBtn.addEventListener('click', () => {
  window.location = '/api/shrink/export';
});
clearBtn.addEventListener('click', async () => {
  if (!confirm('Are you sure you want to delete all shrink records?')) return;
  await fetch('/api/shrink', { method: 'DELETE' });
  loadData();
});

loadData();
