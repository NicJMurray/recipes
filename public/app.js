(() => {
  const search = document.getElementById('recipe-search');
  if (search) {
    const cards = [...document.querySelectorAll('[data-recipe]')];
    const buttons = [...document.querySelectorAll('[data-filter]')];
    const clearSearch = document.getElementById('clear-search');
    const normalize = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    let active = 'all';
    function update() {
      const words = normalize(search.value).trim().split(/\s+/).filter(Boolean);
      let count = 0;
      for (const card of cards) {
        const matchesCategory = active === 'all' || (active === 'quick' ? card.dataset.quick === 'true' : card.dataset.category === active);
        const matchesText = words.every(word => normalize(card.dataset.search).includes(word));
        card.hidden = !(matchesCategory && matchesText);
        if (!card.hidden) count++;
      }
      buttons.forEach(button => {const pressed=button.dataset.filter===active;button.classList.toggle('active',pressed);button.setAttribute('aria-pressed',String(pressed));});
      document.getElementById('result-count').textContent = `${count} recipe${count===1?'':'s'}`;
      document.getElementById('empty-state').hidden = count !== 0;
      clearSearch.hidden = !search.value;
    }
    search.addEventListener('input',update);
    buttons.forEach(button=>button.addEventListener('click',()=>{active=button.dataset.filter;update();}));
    clearSearch.addEventListener('click',()=>{search.value='';update();search.focus();});
    document.getElementById('reset-filters').addEventListener('click',()=>{active='all';search.value='';update();search.focus();});
  }
  const page = document.querySelector('[data-slug]');
  if (page) {
    const boxes = [...page.querySelectorAll('[data-ingredient]')];
    const key = `njmurray-recipes:ingredients:${page.dataset.slug}:v1`;
    let saved=[];
    try { const raw=JSON.parse(localStorage.getItem(key)||'[]'); if(Array.isArray(raw)) saved=raw; } catch {}
    boxes.forEach(box=>box.checked=saved.includes(box.dataset.ingredient));
    const feedback = page.querySelector('.checklist-feedback');
    const store = () => {
      const checked=boxes.filter(box=>box.checked).map(box=>box.dataset.ingredient);
      try {localStorage.setItem(key,JSON.stringify(checked));} catch {}
      feedback.textContent=`${checked.length} of ${boxes.length} ingredients ticked.`;
    };
    boxes.forEach(box=>box.addEventListener('change',store));
    document.getElementById('reset-ingredients').addEventListener('click',()=>{boxes.forEach(box=>box.checked=false);store();});
    document.getElementById('print-recipe').addEventListener('click',()=>window.print());
  }
  document.querySelectorAll('img').forEach(img=>img.addEventListener('error',()=>{img.classList.add('image-unavailable');}));
})();
