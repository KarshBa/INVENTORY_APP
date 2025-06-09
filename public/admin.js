const tbody       = document.querySelector('#shrink-table tbody');
const refreshBtn  = document.getElementById('refresh');
const downloadBtn = document.getElementById('download');
const clearBtn    = document.getElementById('clear');
const downloadAll = document.getElementById('downloadAll');
const listSelect  = document.getElementById('listSelect');
const startInput  = document.getElementById('startDate');
const endInput    = document.getElementById('endDate');

/* --- helper: set default Sun-Sat range --- */
(function initWeek () {
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - today.getDay());      // Sunday
  const end   = new Date(start);
  end.setDate(start.getDate() + 6);                     // Saturday
  startInput.value = start.toISOString().slice(0,10);
  endInput.value   = end.toISOString().slice(0,10);
})();

async function populateLists () {
  const res   = await fetch('/api/departments');
  const lists = await res.json();
  lists.forEach(l => {
    const opt   = document.createElement('option');
    opt.value   = l;
    opt.textContent = l;
    listSelect.appendChild(opt);
  });
  loadData();
}

function query () {
  const qs = new URLSearchParams({
    from: startInput.value,
    to:   endInput.value
  });
  return qs.toString();
}

async function loadData () {
  const url  = `/api/shrink/${encodeURIComponent(listSelect.value)}?${query()}`;
  const res  = await fetch(url);
  const data = await res.json();

  tbody.innerHTML = '';
  data.slice().reverse().forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td>${new Date(r.timestamp).toLocaleString()}</td>
       <td>${r.itemCode}</td><td>${r.brand||''}</td>
       <td>${r.description||''}</td><td>${r.quantity}</td>
       <td>${r.price??''}</td>`;
    tbody.appendChild(tr);
  });
  if (data.length===0) tbody.innerHTML =
      '<tr><td colspan="6" style="text-align:center;">No records</td></tr>';
}

/* ----------------- event wiring ----------------- */
[listSelect, startInput, endInput].forEach(el => el.addEventListener('change', loadData));
refreshBtn.addEventListener('click', loadData);

downloadBtn.addEventListener('click', () => {
  const url = `/api/shrink/${encodeURIComponent(listSelect.value)}/export?${query()}`;
  window.location = url;
});
downloadAll.addEventListener('click', () => {
  window.location = `/api/shrink/export-all?${query()}`;
});
clearBtn.addEventListener('click', async () => {
  if (!confirm(`Delete all records in "${listSelect.value}" for this date range?`)) return;
  await fetch(`/api/shrink/${encodeURIComponent(listSelect.value)}?${query()}`, { method:'DELETE' });
  loadData();
});

populateLists();
