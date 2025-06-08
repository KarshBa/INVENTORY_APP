
const listSelect = document.getElementById('listSelect');
const codeForm = document.getElementById('code-form');
const detailForm = document.getElementById('detail-form');
const successMsg = document.getElementById('success-msg');
let currentItemCode = '';

// Populate list selector
fetch('/api/departments')
  .then(r => r.json())
  .then(depts => {
    depts.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = d;
      listSelect.appendChild(opt);
    });
  });

codeForm.addEventListener('submit', (e) => {
  e.preventDefault();
  currentItemCode = document.getElementById('itemCode').value.trim();
  if (currentItemCode === '') return;
  codeForm.classList.add('hidden');
  detailForm.classList.remove('hidden');
  document.getElementById('brand').focus();
});

detailForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const brand = document.getElementById('brand').value.trim();
  const description = document.getElementById('description').value.trim();
  const quantity = parseFloat(document.getElementById('quantity').value);
  const priceVal = document.getElementById('price').value;
  const price = priceVal === '' ? null : parseFloat(priceVal);
  const listName = listSelect.value;

  const payload = { itemCode: currentItemCode, brand, description, quantity, price };
  try {
    const res = await fetch('/api/shrink/' + encodeURIComponent(listName), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const msg = await res.text();
      alert('Server error: ' + msg);
      return;
    }

    const data = await res.json();
    if (data.success) {
      successMsg.textContent = `Shrink recorded to "\${listName}" successfully!`;
      successMsg.classList.remove('hidden');
      detailForm.reset();
      detailForm.classList.add('hidden');
      codeForm.reset();
      codeForm.classList.remove('hidden');
      document.getElementById('itemCode').focus();
    } else {
      alert(data.error || 'Unknown error.');
    }
  } catch (err) {
    alert('Network error. See console.');
    console.error(err);
  }
});
