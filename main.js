/* =========================================================
   ÓRBITA — catálogo con fondo cósmico + pedidos por Discord
   Sin modo admin ni contraseñas en la página (para que sea
   segura al pegarla en Google Sites u otro sitio público).
   Para agregar, editar o quitar productos: edita el arreglo
   PRODUCTS de abajo directamente y vuelve a subir el archivo.
   ========================================================= */

// URL de tu Worker de Cloudflare (público, seguro de mostrar: no contiene
// el webhook real). Se ve algo así: https://pedidos-orbita.tu-usuario.workers.dev
// Instrucciones completas de cómo crearlo: ver el archivo worker-pedidos.js.
const ORDER_ENDPOINT = "PON_AQUI_LA_URL_DE_TU_WORKER";

// Catálogo. Copia un bloque { } y edítalo para agregar un producto nuevo.
// image: pega la URL de una foto (puede ser de tu celular subida a algún
// hosting de imágenes, o cualquier link directo a una imagen).
const PRODUCTS = [
  {
    id: 'p1',
    name: 'Pan amasado',
    price: 1200,
    stock: 20,
    image: '',
    desc: 'Pan casero recién horneado.'
  },
  {
    id: 'p2',
    name: 'Café de grano 250g',
    price: 4990,
    stock: 8,
    image: '',
    desc: 'Tueste medio, molienda al gusto.'
  }
];

const CLP = new Intl.NumberFormat('es-CL', { style:'currency', currency:'CLP', maximumFractionDigits:0 });
let cart = {}; // { productId: qty }, solo vive mientras la pestaña está abierta

/* ---------- fotos reales del espacio, con respaldo ---------- */
/* Cada escena trae 1-2 URLs candidatas (fuentes públicas: NASA/ESA/Wikimedia).
   Si una falla o el hotlink deja de funcionar, se prueba la siguiente.
   Si ninguna carga, simplemente no se muestra y queda el fondo procedural
   (estrellas + agujero negro en CSS) que nunca depende de internet. */
const SPACE_SCENES = [
  { name:'anillos de Saturno', candidates:[
    'https://photojournal.jpl.nasa.gov/jpeg/PIA21046.jpg',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c7/Saturn_during_Equinox.jpg/1280px-Saturn_during_Equinox.jpg'
  ]},
  { name:'agujero negro M87', candidates:[
    'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4e/Black_hole_-_Messier_87_crop_max_res.jpg/1280px-Black_hole_-_Messier_87_crop_max_res.jpg'
  ]},
  { name:'nebulosa', candidates:[
    'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f0/Pillars_of_Creation_%28NIRCam_Image%29.jpg/1280px-Pillars_of_Creation_%28NIRCam_Image%29.jpg',
    'https://photojournal.jpl.nasa.gov/jpeg/PIA17563.jpg'
  ]},
  { name:'vía láctea', candidates:[
    'https://upload.wikimedia.org/wikipedia/commons/thumb/9/99/ESO_-_Milky_Way.jpg/1280px-ESO_-_Milky_Way.jpg'
  ]}
];

function tryLoadScene(scene, onReady){
  let i = 0;
  function attempt(){
    if(i >= scene.candidates.length){ return; } // sin suerte, se omite esta escena
    const url = scene.candidates[i];
    const img = new Image();
    img.onload = ()=> onReady(url);
    img.onerror = ()=>{ i++; attempt(); };
    img.src = url;
  }
  attempt();
}

(function loadSpacePhotos(){
  const container = document.getElementById('bgPhotos');
  const loaded = [];
  let current = 0;
  let cycleTimer = null;

  function showIndex(idx){
    container.querySelectorAll('img').forEach((im,n)=> im.classList.toggle('show', n===idx));
  }
  function startCycle(){
    if(cycleTimer || loaded.length < 2) return;
    cycleTimer = setInterval(()=>{
      current = (current+1) % loaded.length;
      showIndex(current);
    }, 10000);
  }

  SPACE_SCENES.forEach(scene=>{
    tryLoadScene(scene, (url)=>{
      const el = document.createElement('img');
      el.src = url;
      el.alt = scene.name;
      container.appendChild(el);
      loaded.push(el);
      if(loaded.length === 1) el.classList.add('show');
      startCycle();
    });
  });
})();

/* ---------- estrellas de fondo ---------- */
(function stars(){
  const canvas = document.getElementById('starfield');
  const ctx = canvas.getContext('2d');
  let w,h,pts=[];
  function resize(){
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
    const count = Math.floor((w*h)/9000);
    pts = Array.from({length:count}, ()=>({
      x:Math.random()*w, y:Math.random()*h, r:Math.random()*1.3+0.2,
      phase:Math.random()*Math.PI*2, speed:0.4+Math.random()*0.8
    }));
  }
  function draw(t){
    ctx.clearRect(0,0,w,h);
    for(const p of pts){
      const a = 0.35 + 0.65*Math.abs(Math.sin(p.phase + t*0.0006*p.speed));
      ctx.beginPath();
      ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
      ctx.fillStyle = `rgba(237,235,255,${a})`;
      ctx.fill();
    }
    requestAnimationFrame(draw);
  }
  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(draw);
})();

/* ---------- búsqueda por similitud (embeddings ligeros, sin backend) ----------
   No hay un modelo de embeddings real corriendo aquí (esto es un archivo
   estático, no tiene a dónde llamar); en su lugar se arma un vector simple
   por producto a partir de sus palabras y se compara contra la búsqueda con
   superposición de tokens + distancia de edición, para tolerar errores de
   tipeo y sinónimos parciales. Así "miel casera" encuentra "miel" si no hay
   una "miel casera" exacta en el catálogo, en vez de mostrar "sin resultados". */
function normalizeText(s){
  return (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
}
function levenshtein(a, b){
  const m = a.length, n = b.length;
  if(m===0) return n;
  if(n===0) return m;
  const dp = Array.from({length:m+1}, (_,i)=> [i, ...Array(n).fill(0)]);
  for(let j=0;j<=n;j++) dp[0][j]=j;
  for(let i=1;i<=m;i++){
    for(let j=1;j<=n;j++){
      dp[i][j] = a[i-1]===b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j-1], dp[i-1][j], dp[i][j-1]);
    }
  }
  return dp[m][n];
}
function productVector(p){
  // "vector" simple: bolsa de palabras únicas del nombre + descripción
  return normalizeText(`${p.name} ${p.desc||''}`).split(/\s+/).filter(Boolean);
}
function scoreProduct(queryTokens, p){
  const words = productVector(p);
  const text = words.join(' ');
  let score = 0;
  queryTokens.forEach(tok=>{
    if(!tok) return;
    if(text.includes(tok)) { score += 3; return; } // coincidencia directa o parcial (substring)
    let best = Infinity;
    words.forEach(w=>{
      const d = levenshtein(tok, w);
      if(d < best) best = d;
    });
    const tolerance = tok.length <= 4 ? 1 : 2;
    if(best <= tolerance) score += 2 - (best/(tolerance+1)); // parecido por tipeo
  });
  return score;
}
function searchProducts(query){
  const q = normalizeText(query);
  if(!q) return { results: PRODUCTS, fallback:false };
  const tokens = q.split(/\s+/).filter(Boolean);
  const scored = PRODUCTS.map(p => ({ p, score: scoreProduct(tokens, p) }))
    .sort((a,b)=> b.score - a.score);
  const exact = scored.filter(s => s.score > 0);
  if(exact.length > 0){
    return { results: exact.map(s=>s.p), fallback:false };
  }
  // nada superó el umbral: se ofrece el más cercano como alternativa
  const closest = scored.slice(0, 3).filter(s => s.p);
  return { results: closest.map(s=>s.p), fallback: true };
}

/* ---------- render ---------- */
function renderGrid(filter=''){
  const grid = document.getElementById('grid');
  const empty = document.getElementById('emptyState');
  const { results: list, fallback } = searchProducts(filter);
  grid.innerHTML = '';
  empty.style.display = (PRODUCTS.length===0) ? 'block' : 'none';
  if (PRODUCTS.length>0 && list.length===0){
    empty.style.display='block';
    empty.textContent = 'No encontramos nada parecido a eso.';
  } else if (PRODUCTS.length>0){
    empty.textContent = 'Aún no hay productos publicados.';
  }

  if(fallback && list.length>0){
    const note = document.createElement('div');
    note.className = 'search-fallback-note';
    note.textContent = `No encontramos exactamente eso, pero esto es lo más parecido:`;
    grid.appendChild(note);
  }

  list.forEach(p=>{
    const card = document.createElement('div');
    card.className = 'card';
    const noStock = Number(p.stock) <= 0;
    card.innerHTML = `
      <img class="card-img" src="${escapeAttr(p.image || '')}" alt="${escapeAttr(p.name)}" onerror="this.style.opacity=0">
      <div class="card-body">
        <div class="card-name">${escapeHtml(p.name)}</div>
        <div class="card-desc">${escapeHtml(p.desc || '')}</div>
        <div class="card-foot">
          <span class="card-price">${CLP.format(p.price||0)}</span>
          <span class="card-stock">${noStock ? 'sin stock' : 'stock: '+p.stock}</span>
        </div>
        <button class="add-cart" data-id="${p.id}" ${noStock?'disabled':''}>Agregar al pedido</button>
      </div>`;
    grid.appendChild(card);
  });

  grid.querySelectorAll('.add-cart').forEach(btn=>{
    btn.addEventListener('click', ()=> addToCart(btn.dataset.id));
  });
}
function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escapeAttr(s){ return escapeHtml(s); }

/* ---------- búsqueda ---------- */
document.getElementById('searchInput').addEventListener('input', e=> renderGrid(e.target.value));

/* ---------- carrito ---------- */
function addToCart(id){
  cart[id] = (cart[id]||0) + 1;
  updateCartCount();
  showToast('Agregado al pedido');
}
function updateCartCount(){
  const total = Object.values(cart).reduce((a,b)=>a+b,0);
  document.getElementById('cartCount').textContent = total;
}
function renderCart(){
  const list = document.getElementById('cartList');
  const ids = Object.keys(cart).filter(id=>cart[id]>0);
  if(ids.length===0){
    list.innerHTML = '<p style="color:var(--star-dim);font-size:0.85rem;">Tu pedido está vacío.</p>';
    document.getElementById('cartTotal').textContent = CLP.format(0);
    return;
  }
  let total = 0;
  list.innerHTML = ids.map(id=>{
    const p = PRODUCTS.find(x=>x.id===id);
    if(!p) return '';
    const sub = (p.price||0) * cart[id];
    total += sub;
    return `<div class="cart-item">
      <img src="${escapeAttr(p.image||'')}" onerror="this.style.opacity=0">
      <div class="ci-body">
        <div class="ci-name">${escapeHtml(p.name)}</div>
        <div class="ci-price">${CLP.format(p.price||0)} c/u</div>
      </div>
      <div class="qty">
        <button data-minus="${id}">–</button>
        <span>${cart[id]}</span>
        <button data-plus="${id}">+</button>
      </div>
    </div>`;
  }).join('');
  document.getElementById('cartTotal').textContent = CLP.format(total);
  list.querySelectorAll('[data-plus]').forEach(b=>b.addEventListener('click',()=>{cart[b.dataset.plus]++; renderCart(); updateCartCount();}));
  list.querySelectorAll('[data-minus]').forEach(b=>b.addEventListener('click',()=>{
    const id=b.dataset.minus; cart[id]--; if(cart[id]<=0) delete cart[id];
    renderCart(); updateCartCount();
  }));
}
document.getElementById('cartFab').addEventListener('click', ()=>{ renderCart(); openOverlay('overlayCart'); });

document.getElementById('sendOrder').addEventListener('click', async ()=>{
  const msg = document.getElementById('cartMsg');
  const ids = Object.keys(cart).filter(id=>cart[id]>0);
  if(ids.length===0){ msg.className='msg err'; msg.textContent='Agrega al menos un producto.'; return; }
  if(!ORDER_ENDPOINT || ORDER_ENDPOINT.includes('PON_AQUI')){
    msg.className='msg err'; msg.textContent='Falta configurar ORDER_ENDPOINT en el código.'; return;
  }

  let total = 0;
  const fields = ids.map(id=>{
    const p = PRODUCTS.find(x=>x.id===id);
    const qty = cart[id];
    const sub = (p?.price||0)*qty;
    total += sub;
    return { name: p ? p.name : id, value: `x${qty} — ${CLP.format(sub)}` };
  });

  const btn = document.getElementById('sendOrder');
  btn.disabled = true; btn.textContent = 'Enviando…';
  try{
    const res = await fetch(ORDER_ENDPOINT, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ fields, total: CLP.format(total) })
    });
    if(!res.ok){
      const data = await res.json().catch(()=>({}));
      throw new Error(data.error || 'No se pudo enviar');
    }
    cart = {};
    updateCartCount();
    renderCart();
    msg.className='msg ok'; msg.textContent='Pedido enviado a la tienda.';
    showToast('Pedido enviado ✨');
    setTimeout(()=>closeOverlay('overlayCart'), 900);
  }catch(err){
    msg.className='msg err'; msg.textContent = err.message || 'No se pudo enviar. Revisa tu conexión.';
  }finally{
    btn.disabled = false; btn.textContent = 'Enviar pedido';
  }
});

/* ---------- overlays genéricos ---------- */
function openOverlay(id){ document.getElementById(id).classList.add('open'); }
function closeOverlay(id){ document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('[data-close]').forEach(el=>{
  el.addEventListener('click', e=>{
    const sheet = e.target.closest('.overlay');
    if(sheet) closeOverlay(sheet.id);
  });
});
document.querySelectorAll('.overlay').forEach(ov=>{
  ov.addEventListener('click', e=>{ if(e.target===ov) closeOverlay(ov.id); });
});

/* ---------- toast ---------- */
let toastTimer;
function showToast(text){
  const t = document.getElementById('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> t.classList.remove('show'), 2200);
}

/* ---------- init ---------- */
renderGrid();
