const listSelect=document.getElementById('listSelect');
const codeForm=document.getElementById('code-form');
const detailForm=document.getElementById('detail-form');
const successMsg=document.getElementById('success-msg');

let currentItemCode='';

/* ──────────────────────────────
   📷 Barcode Scanning (native)
   Uses BarcodeDetector if available.
   Fallback = manual entry.
────────────────────────────── */
const openCameraBtn   = document.getElementById('openCameraBtn');
const scannerModal    = document.getElementById('scannerModal');
const scannerVideo    = document.getElementById('scannerVideo');
const closeScannerBtn = document.getElementById('closeScannerBtn');
const scannerStatus   = document.getElementById('scannerStatus');

let scannerStream = null;
let scanTimer = null;

// normalize scanned code: keep digits; optionally strip UPC-A check digit
function normalizeScannedCode(raw){
  const digits = String(raw || '').replace(/\D/g,'');
  if (digits.length === 12) {
    // Treat as UPC-A and strip check digit → 11 digits
    return digits.slice(0, 11);
  }
  return digits; // EAN-13 / PLU / others unchanged
}

async function openScanner(){
  // Feature detect
  if (!('BarcodeDetector' in window)) {
    alert("Barcode scanning isn't supported on this browser. Please type the UPC.");
    return;
  }

  try {
    scannerStatus.textContent = 'Requesting camera…';
    scannerModal.classList.remove('hidden');

    scannerStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' } // rear camera on phones
      },
      audio: false
    });

    scannerVideo.srcObject = scannerStream;

    const detector = new BarcodeDetector({
      formats: ['upc_a','upc_e','ean_13','ean_8','code_128','code_39']
    });

    // Polling loop (fast + simple)
    scanTimer = setInterval(async () => {
      if (!scannerVideo || scannerVideo.readyState < 2) return;

      try {
        const barcodes = await detector.detect(scannerVideo);
        if (barcodes && barcodes.length) {
          const raw = barcodes[0].rawValue || '';
          const cleaned = normalizeScannedCode(raw);

          if (cleaned) {
            // Fill input and close scanner
            document.getElementById('itemCode').value = cleaned;
            stopScanner();

            // Optional: auto-advance to detail form
            codeForm.requestSubmit();
          }
        }
      } catch (err) {
        // ignore per-frame errors
      }
    }, 200);

    scannerStatus.textContent = 'Point your camera at a barcode…';

  } catch (err) {
    stopScanner();
    alert('Could not access camera. Please allow camera permissions and try again.');
    console.error(err);
  }
}

function stopScanner(){
  if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
  if (scannerStream) {
    scannerStream.getTracks().forEach(t => t.stop());
    scannerStream = null;
  }
  if (scannerVideo) scannerVideo.srcObject = null;
  scannerModal.classList.add('hidden');
}

openCameraBtn?.addEventListener('click', openScanner);
closeScannerBtn?.addEventListener('click', stopScanner);

// Also close if user taps outside the card
scannerModal?.addEventListener('click', (e) => {
  if (e.target === scannerModal) stopScanner();
});

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
