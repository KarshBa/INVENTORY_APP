const listSelect=document.getElementById('listSelect');
const codeForm=document.getElementById('code-form');
const detailForm=document.getElementById('detail-form');
const successMsg=document.getElementById('success-msg');

let currentItemCode='';
let currentPLU=null;
let entryMode='upc';

const itemCodeInput = document.getElementById('itemCode');
const modeNote = document.getElementById('mode-note');

function getMode(){
  const checked = document.querySelector('input[name="entryMode"]:checked');
  return checked ? checked.value : 'upc';
}
function updateModeUI(){
  entryMode = getMode();
  modeNote.textContent = entryMode === 'plu'
    ? 'Scale PLU mode: enter the item Scale PLU.'
    : 'UPC mode: scan or type the UPC.';
  itemCodeInput.value = '';
  itemCodeInput.focus();
}
document.querySelectorAll('input[name="entryMode"]').forEach(r=>{
  r.addEventListener('change', updateModeUI);
});

// Focus the “Enter Item Code” field on page load
window.addEventListener('DOMContentLoaded', () => {
  updateModeUI();
});

// load lists
fetch('/api/departments').then(r=>r.json()).then(lists=>{
  lists.forEach(l=>{
    const opt=document.createElement('option');
    opt.value=l; opt.textContent=l;
    listSelect.appendChild(opt);
  });
  if (lists.includes('OTHER')) listSelect.value = 'OTHER';
});

// ── code-form submit ─────────────────────────────────────────────
codeForm.addEventListener('submit',  async e => {
  e.preventDefault();

  entryMode = getMode();
  const raw = itemCodeInput.value.trim();
  if (!raw) return;

  let hit = null;
  currentPLU = null;

  try {
    const url = entryMode === 'plu'
      ? '/api/item-plu/' + encodeURIComponent(raw)
      : '/api/item/' + encodeURIComponent(raw);

    const r = await fetch(url);
    if (r.ok) hit = await r.json();
  } catch { /* network error */ }

  // ✅ Requirement #1: block if not found / not validated
  if (!hit || !hit.code) {
    alert(entryMode === 'plu'
      ? 'PLU not found in item list. Cannot record shrink.'
      : 'Item code not found in item list. Cannot record shrink.'
    );
    itemCodeInput.focus();
    itemCodeInput.select();
    return;
  }

  currentItemCode = hit.code;       // canonical main catalogue code
  currentPLU      = hit.plu || null;

  // prefill read-only fields
  document.getElementById('brand').value       = hit.brand       || '';
  document.getElementById('description').value = hit.description || '';
  document.getElementById('price').value       = hit.price       || '';
  document.getElementById('subdept').value     = hit.subdept     || '';

  if (hit.list) listSelect.value = hit.list;

  codeForm.classList.add('hidden');
  detailForm.classList.remove('hidden');
  document.getElementById('quantity').focus();
});

detailForm.addEventListener('submit',async e=>{
  e.preventDefault();

  const qtyField = document.getElementById('quantity');
  const qtyVal = parseFloat(qtyField.value);
  if (Number.isNaN(qtyVal)) {
    qtyField.focus();
    return;
  }

  // ✅ Requirement #5: confirm large qty
  if (qtyVal > 50) {
    const ok = confirm(`Are you sure you want to enter ${qtyVal} qty?`);
    if (!ok) {
      qtyField.focus();
      qtyField.select();
      return;
    }
  }

  const payload={
    itemCode:currentItemCode,
    plu: currentPLU,
    entryMode,
    brand:document.getElementById('brand').value.trim(),
    description:document.getElementById('description').value.trim(),
    quantity:qtyVal,
    price:document.getElementById('price').value===''?null:parseFloat(document.getElementById('price').value),
    contribute: document.getElementById('contribute').checked
  };

  const listName=listSelect.value;
  const res = await fetch('/api/shrink/' + encodeURIComponent(listName), {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(payload)
  });

  if(res.ok){
    successMsg.textContent=`Shrink recorded to "${listName}" successfully!`;
    successMsg.classList.remove('hidden');
    detailForm.reset(); detailForm.classList.add('hidden');
    codeForm.reset(); codeForm.classList.remove('hidden');
    updateModeUI();
  }else{
    alert('Error saving record');
  }
});
