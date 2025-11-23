const tbody = document.querySelector('#today-table tbody');
const msg = document.getElementById('msg');

function flash(text){
  msg.textContent = text;
  msg.classList.remove('hidden');
  setTimeout(()=>msg.classList.add('hidden'), 1800);
}

function ensureEmptyMessage(){
  const hasRows = tbody.querySelectorAll('tr[data-id]').length > 0;
  const placeholder = tbody.querySelector('tr[data-empty]');

  if (!hasRows && !placeholder){
    const tr = document.createElement('tr');
    tr.dataset.empty = "1";
    tr.innerHTML =
      '<td colspan="9" style="text-align:center;">No entries today</td>';
    tbody.appendChild(tr);
  }

  if (hasRows && placeholder){
    placeholder.remove();
  }
}

async function loadToday(){
  const res = await fetch('/api/shrink/today');
  const data = await res.json();

  tbody.innerHTML = '';

  data.slice().reverse().forEach(r=>{
    const tr = document.createElement('tr');
    tr.dataset.id = r.id;
    tr.dataset.list = r.list; // <-- IMPORTANT for save/delete

    tr.innerHTML = `
      <td>${new Date(r.timestamp).toLocaleString()}</td>
      <td>${r.list}</td>
      <td>${r.itemCode}</td>
      <td>${r.brand || ''}</td>
      <td>${r.description || ''}</td>
      <td><input class="qty tiny" type="number" step="0.01" value="${r.quantity ?? ''}"></td>
      <td><input class="price tiny" type="number" step="0.01" value="${r.price ?? ''}"></td>
      <td style="text-align:center;">
        <input class="contrib" type="checkbox" ${r.contribute ? 'checked':''}>
      </td>
      <td>
        <div class="actions">
          <button class="save">Save</button>
          <button class="del">🗑️</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // ✅ use the new helper for empty-state
  ensureEmptyMessage();
}

tbody.addEventListener('click', async (ev)=>{
  const tr = ev.target.closest('tr[data-id][data-list]');
  if (!tr) return;

  const id   = tr.dataset.id;
  const list = tr.dataset.list;  // <-- per-row list

  if (ev.target.classList.contains('del')){
    if (!confirm('Delete this record?')) return;
    const resp = await fetch(`/api/shrink/${encodeURIComponent(list)}/${id}`, { method:'DELETE' });
    if (resp.ok){
      flash('Deleted');
      tr.remove();          // ✅ instant UI update
      ensureEmptyMessage();
    }
    else alert('Delete failed');
    return;
  }

  if (ev.target.classList.contains('save')){
  const qtyField = tr.querySelector('.qty');
  const priceField = tr.querySelector('.price');
  const contribField = tr.querySelector('.contrib');

  const quantity = parseFloat(qtyField.value);
  const price = priceField.value==='' ? null : parseFloat(priceField.value);

  if (Number.isNaN(quantity)){
    qtyField.focus();
    return;
  }

  const payload = {
    quantity,
    price,
    contribute: contribField.checked
  };

  // ⭐ ADD THESE LINES HERE
  const saveBtn = tr.querySelector('button.save');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

    let resp;
  try {
    resp = await fetch(`/api/shrink/${encodeURIComponent(list)}/${id}`, {
      method:'PATCH',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });
  } finally {
    // ⭐ ALWAYS restore, even on error
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save';
  }
    // ✅ NEW: if fetch failed entirely
      if (!resp) {
        alert('Save failed (network error). Please try again.');
        return;
      }

    if (resp.ok){
      flash('Saved');

      // ✅ optional: subtle visual feedback
      tr.style.outline = '2px solid #000';
      setTimeout(()=>tr.style.outline='none', 400);

      // no reload needed
    } else {
      const err = await resp.json().catch(()=>({error:'save-failed'}));
      alert(err.error || 'Save failed (today-only enforced).');
    }
  }
});

loadToday();
