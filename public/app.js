const listSelect=document.getElementById('listSelect');
const codeForm=document.getElementById('code-form');
const detailForm=document.getElementById('detail-form');
const successMsg=document.getElementById('success-msg');
const notesField = document.getElementById('notes');

let currentItemCode='';
let currentPLU=null;
let entryMode='upc';

const itemCodeInput = document.getElementById('itemCode');
const modeNote = document.getElementById('mode-note');
const reductionCheckbox = document.getElementById('reduction');
const reductionWrapper = document.getElementById('reduction-wrapper');
const reductionAmountInput = document.getElementById('reductionAmount');

function updateReductionUI(){
  if (!reductionCheckbox) return;
  if (reductionCheckbox.checked){
    reductionWrapper.classList.remove('hidden');
  } else {
    reductionWrapper.classList.add('hidden');
    reductionAmountInput.value = '';
  }
}

if (reductionCheckbox) {
  reductionCheckbox.addEventListener('change', updateReductionUI);
}

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
  updateReductionUI();
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

  const priceField = document.getElementById('price');
  const priceRaw = priceField.value;
  let basePrice = priceRaw === '' ? null : parseFloat(priceRaw);

  const reductionOn = reductionCheckbox && reductionCheckbox.checked;
  let reductionVal = 0;

  if (reductionOn) {
    reductionVal = parseFloat(reductionAmountInput.value);
    if (Number.isNaN(reductionVal) || reductionVal < 0) {
      alert('Please enter a valid reduction amount (non-negative number).');
      reductionAmountInput.focus();
      return;
    }
    if (basePrice === null || Number.isNaN(basePrice)) {
      alert('Cannot apply a reduction when there is no base price.');
      return;
    }
    if (reductionVal >= basePrice) {
      alert('Reduction amount must be less than the current price.');
      reductionAmountInput.focus();
      return;
    }
  }

  // Effective price for the main shrink line
  let effectivePrice = basePrice;
  if (reductionOn && basePrice !== null && !Number.isNaN(basePrice)) {
    effectivePrice = basePrice - reductionVal;
  }

  const brandVal = document.getElementById('brand').value.trim();
  const descVal  = document.getElementById('description').value.trim();
  const contrib  = document.getElementById('contribute').checked;
  const listName = listSelect.value;
  const notesVal = notesField ? notesField.value.trim() : '';

  // Main shrink entry payload (possibly reduced price)
  const mainPayload = {
    itemCode: currentItemCode,
    plu: currentPLU,
    entryMode,
    brand: brandVal,
    description: descVal,
    quantity: qtyVal,
    price: effectivePrice,
    contribute: contrib,
    notes: notesVal
  };

  // 1️⃣ Create the main shrink record
  const res = await fetch('/api/shrink/' + encodeURIComponent(listName), {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(mainPayload)
  });

  if (!res.ok){
    alert('Error saving record');
    return;
  }

  // 2️⃣ If reduction is checked, create the “REDUCTIONS” companion line
  if (reductionOn) {
    const reductionPayload = {
      itemCode: currentItemCode,
      plu: currentPLU,
      entryMode,
      brand: brandVal,
      description: `${descVal} REDUCTIONS`,
      quantity: qtyVal,
      price: reductionVal,
      contribute: contrib,
      notes: notesVal
    };

    const res2 = await fetch('/api/shrink/' + encodeURIComponent(listName), {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(reductionPayload)
    });

    if (!res2.ok) {
      alert('Base entry saved, but the reduction line failed to save.');
    }
  }

  // 3️⃣ Success UI / reset
  successMsg.textContent=`Shrink recorded to "${listName}" successfully!`;
  successMsg.classList.remove('hidden');

  detailForm.reset();
  detailForm.classList.add('hidden');
  codeForm.reset();
  codeForm.classList.remove('hidden');

  // keep things visually reset
  updateModeUI();
  updateReductionUI();
});
