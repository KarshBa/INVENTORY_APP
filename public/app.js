
const listSelect=document.getElementById('listSelect');
const codeForm=document.getElementById('code-form');
const detailForm=document.getElementById('detail-form');
const successMsg=document.getElementById('success-msg');
let currentItemCode='';

// Focus the “Enter Item Code” field on page load
window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('itemCode').focus();
});

// load lists
fetch('/api/departments').then(r=>r.json()).then(lists=>{
  lists.forEach(l=>{
    const opt=document.createElement('option');
    opt.value=l; opt.textContent=l;
    listSelect.appendChild(opt);
  });
});

codeForm.addEventListener('submit',e=>{
  e.preventDefault();
  currentItemCode=document.getElementById('itemCode').value.trim();
  if(!currentItemCode) return;
  codeForm.classList.add('hidden');
  detailForm.classList.remove('hidden');
  document.getElementById('brand').focus();
});

detailForm.addEventListener('submit',async e=>{
  e.preventDefault();
  const payload={
    itemCode:currentItemCode,
    brand:document.getElementById('brand').value.trim(),
    description:document.getElementById('description').value.trim(),
    quantity:parseFloat(document.getElementById('quantity').value),
    price:document.getElementById('price').value===''?null:parseFloat(document.getElementById('price').value)
  };
  const listName=listSelect.value;
  const res=await fetch('/api/shrink/'+encodeURIComponent(listName),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  if(res.ok){
    successMsg.textContent=`Shrink recorded to "${listName}" successfully!`;
    successMsg.classList.remove('hidden');
    detailForm.reset(); detailForm.classList.add('hidden');
    codeForm.reset(); codeForm.classList.remove('hidden');
      // Move cursor back to the Item Code field:
  document.getElementById('itemCode').focus();
  }else{
    alert('Error saving record');
  }
});
