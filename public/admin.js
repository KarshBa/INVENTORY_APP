const tbody       = document.querySelector('#shrink-table tbody');
const refreshBtn  = document.getElementById('refresh');
const downloadBtn = document.getElementById('download');
const clearBtn    = document.getElementById('clear');
const downloadAll = document.getElementById('downloadAll');
const listSelect  = document.getElementById('listSelect');
const startInput  = document.getElementById('startDate');
const endInput    = document.getElementById('endDate');

// ───── replace your existing initWeek() IIFE with this ─────
(function initPrevWeek() {
  const today          = new Date();
  // find this week’s Sunday
  const thisSunday     = new Date(today);
  thisSunday.setDate(today.getDate() - today.getDay());
  // go back 7 days = last week’s Sunday
  const prevSunday     = new Date(thisSunday);
  prevSunday.setDate(thisSunday.getDate() - 7);
  // last week’s Saturday = 6 days after
  const prevSaturday   = new Date(prevSunday);
  prevSaturday.setDate(prevSunday.getDate() + 6);

  startInput.value = prevSunday.toISOString().slice(0,10);
  endInput.value   = prevSaturday.toISOString().slice(0,10);
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
