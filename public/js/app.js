/* 达人选品台 - 前端逻辑（移动端优先）
 * 双模式：
 *  - 有后端(API)时走 /api/*（桌面本地预览，支持邮件自动发送）
 *  - 无后端(静态托管/公网)时自动切换到前端模式：数据来自 build/data.json，
 *    筛选/排序/选款/导出 Excel 全部在浏览器完成（localStorage 存选款）
 */
(function () {
  'use strict';

  // ---- 会话隔离（多人选品互不干扰） ----
  let SID = localStorage.getItem('dps_session');
  if (!SID) { SID = 's_' + Math.random().toString(36).slice(2, 10); localStorage.setItem('dps_session', SID); }

  // 价格段（与后端保持一致）
  const PRICE_SEGMENTS = [
    { id: 'u100', label: '100元以下', min: 0, max: 100 },
    { id: '100-200', label: '100-200元', min: 100, max: 200 },
    { id: '200-300', label: '200-300元', min: 200, max: 300 },
    { id: 'o300', label: '300元以上', min: 300, max: Infinity }
  ];

  const BRAND_COLORS = { '初语': '#ff7a45', '茵曼': 'rgb(71,188,180)' };
  function brandColor(b) { return BRAND_COLORS[b] || '#888'; }

  let MODE = 'api';   // 'api' | 'static'
  let DATA = [];      // 静态模式下的全量商品

  const state = { filters: { brand: '', category: [], price: [] }, sort: '', keyword: '', products: [], brands: [], categories: [], priceSegments: PRICE_SEGMENTS };
  const SEL_KEY = 'dps_sel_' + SID;
  const DEFAULT_EMAIL = 'w2974766446@outlook.com';   // 选款表格固定接收邮箱（由系统自动发送）
  // 静态公网版若要“提交即自动发邮件”，需指向一个可被公网访问的后端地址；留空则降级为前端下载。
  // 优先级：URL 参数 ?backend= > 页面内置 window.__BACKEND_URL__ > 空（前端下载）
  const BACKEND_URL = (() => {
    try {
      const p = new URLSearchParams(location.search).get('backend');
      if (p) return String(p).replace(/\/$/, '');
    } catch (e) {}
    if (typeof window !== 'undefined' && window.__BACKEND_URL__) return String(window.__BACKEND_URL__).replace(/\/$/, '');
    return '';
  })();

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 1800);
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function brandBadge(b, lg) {
    return `<span class="brand-badge ${lg ? 'brand-badge--lg' : ''}" style="background:${brandColor(b)}">${esc(b)}</span>`;
  }
  function imgFallback(sn) {
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='600' height='600'><rect width='100%' height='100%' fill='#e9eaec'/><text x='50%' y='50%' font-size='42' fill='#9aa0a6' text-anchor='middle' dominant-baseline='middle'>${esc(sn)}</text></svg>`;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }

  // ---- 模式探测 ----
  // 仅当 /api/filters 返回真正的 JSON 时才走 API 模式；
  // 静态托管（如 CloudStudio）对未知路径会返回 HTML 兜底页(也是 200)，必须排除，否则解析失败白屏。
  async function detectMode() {
    try {
      const r = await fetch('/api/filters', { headers: { 'Accept': 'application/json' } });
      const ct = r.headers.get('content-type') || '';
      if (r.ok && ct.includes('json')) { MODE = 'api'; return true; }
      // 即便返回 200，若不是 JSON，也当无后端处理
      if (r.ok) { try { await r.json(); MODE = 'api'; return true; } catch (e) { /* 非 JSON，走静态 */ } }
    } catch (e) { /* 无后端 */ }
    MODE = 'static'; return false;
  }

  // ---- 数据获取 ----
  async function loadFilters() {
    const r = await fetch('/api/filters'); const d = await r.json();
    state.brands = d.brands || [];
    renderMultiChips('#fCategory', d.categories.map(c => ({ id: c, label: c })), 'category');
    renderMultiChips('#fPrice', d.priceSegments, 'price');
    renderBrandTabs(state.brands);
    state._priceRange = d.priceRange;
  }
  async function loadStaticData() {
    const r = await fetch('build/data.json'); DATA = await r.json();
    state.brands = [...new Set(DATA.map(p => p.brand))].filter(Boolean);
    state.categories = [...new Set(DATA.map(p => p.categoryGroup))].filter(Boolean).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
    renderMultiChips('#fCategory', state.categories.map(c => ({ id: c, label: c })), 'category');
    renderMultiChips('#fPrice', PRICE_SEGMENTS, 'price');
    renderBrandTabs(state.brands);
  }

  function renderBrandTabs(brands) {
    const bar = $('#brandBar'); bar.innerHTML = '';
    const mk = (label, val) => {
      const b = document.createElement('button');
      // 「全部」始终作为默认高亮项（未选具体品牌时高亮）；其余品牌点击切换
      const active = val === '' ? (state.filters.brand === '' || state.filters.brand === undefined) : (state.filters.brand === val);
      b.className = 'brand-tab' + (active ? ' active' : '');
      const color = val ? brandColor(val) : '#2b2b2b';
      if (val) b.innerHTML = `<span class="dot" style="background:#fff"></span>${esc(label)}`;
      else b.textContent = label;
      b.style.background = active ? color : '';
      if (active) b.style.color = '#fff';
      b.onclick = () => {
        if (val === '') state.filters.brand = '';           // 全部：清除品牌过滤，保持高亮
        else if (state.filters.brand === val) delete state.filters.brand;
        else state.filters.brand = val;
        renderBrandTabs(brands); loadProducts();
      };
      bar.appendChild(b);
    };
    mk('全部', '');
    brands.forEach(b => mk(b, b));
  }
  function renderMultiChips(sel, arr, key) {
    const box = $(sel); box.innerHTML = '';
    arr.forEach(v => {
      const b = document.createElement('button');
      b.className = 'chip'; b.textContent = v.label !== undefined ? v.label : v;
      b.dataset.val = v.id !== undefined ? v.id : v;
      b.onclick = () => {
        b.classList.toggle('active');
        const set = state.filters[key] || [];
        const val = b.dataset.val;
        const i = set.indexOf(val);
        if (b.classList.contains('active')) { if (i < 0) set.push(val); }
        else if (i >= 0) set.splice(i, 1);
        state.filters[key] = set;
      };
      box.appendChild(b);
    });
  }

  async function loadProducts() {
    let list;
    if (MODE === 'api') {
      const q = new URLSearchParams(); q.set('sessionId', SID);
      const f = state.filters;
      if (f.brand) q.set('brand', f.brand);
      if (Array.isArray(f.category) && f.category.length) q.set('category', f.category.join(','));
      if (Array.isArray(f.price) && f.price.length) q.set('price', f.price.join(','));
      if (state.keyword) q.set('keyword', state.keyword);
      if (state.sort) q.set('sort', state.sort);
      const r = await fetch('/api/products?' + q.toString()); const d = await r.json();
      list = d.products;
    } else {
      list = clientFilter();
    }
    const sel = await getSelectedSet();
    list = list.map(p => ({ ...p, selected: sel.has(p.styleNo) }));
    state.products = list;
    renderProducts();
    renderActiveFilters();
    $('#resultCount').textContent = '共 ' + list.length + ' 款';
  }

  // 展示已选筛选（类目 / 价格段），可单独移除或全部清除
  function renderActiveFilters() {
    const bar = $('#activeFilters');
    const cats = state.filters.category || [];
    const prices = state.filters.price || [];
    if (!cats.length && !prices.length) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
    bar.style.display = 'flex';
    let html = '';
    cats.forEach(c => { html += `<button class="af-chip" data-type="category" data-val="${esc(c)}">${esc(c)} ✕</button>`; });
    prices.forEach(pid => {
      const seg = PRICE_SEGMENTS.find(x => x.id === pid);
      html += `<button class="af-chip" data-type="price" data-val="${esc(pid)}">${esc(seg ? seg.label : pid)} ✕</button>`;
    });
    html += `<button class="af-clear">清除全部</button>`;
    bar.innerHTML = html;
    bar.querySelectorAll('.af-chip').forEach(b => b.onclick = () => {
      const type = b.dataset.type, val = b.dataset.val;
      const set = state.filters[type];
      const i = set.indexOf(val);
      if (i >= 0) set.splice(i, 1);
      syncDrawerChips();
      renderActiveFilters(); loadProducts();
    });
    bar.querySelector('.af-clear').onclick = () => {
      state.filters.category = []; state.filters.price = [];
      syncDrawerChips();
      renderActiveFilters(); loadProducts();
    };
  }
  // 同步筛选抽屉里 chip 的高亮态（不重建，仅切换 active 类）
  function syncDrawerChips() {
    $$('#fCategory .chip').forEach(c => c.classList.toggle('active', (state.filters.category || []).includes(c.dataset.val)));
    $$('#fPrice .chip').forEach(c => c.classList.toggle('active', (state.filters.price || []).includes(c.dataset.val)));
  }

  // 前端筛选/排序（静态模式）
  function clientFilter() {
    let list = DATA.slice();
    const f = state.filters;
    if (f.brand) list = list.filter(p => p.brand === f.brand);
    if (Array.isArray(f.category) && f.category.length) list = list.filter(p => f.category.includes(p.categoryGroup));
    if (Array.isArray(f.price) && f.price.length) list = list.filter(p => f.price.some(sid => {
      const s = PRICE_SEGMENTS.find(x => x.id === sid);
      return s && p.influencerPrice >= s.min && p.influencerPrice < s.max;
    }));
    if (state.keyword) {
      const k = state.keyword.toLowerCase();
      list = list.filter(p => [p.styleNo, p.material, p.color, p.sellingPoint].some(v => String(v).toLowerCase().includes(k)));
    }
    if (state.sort === 'price_asc') list.sort((a, b) => a.influencerPrice - b.influencerPrice);
    else if (state.sort === 'price_desc') list.sort((a, b) => b.influencerPrice - a.influencerPrice);
    else if (state.sort === 'stock_desc' || state.sort === 'stock_asc') list.sort((a, b) => b.stock - a.stock);
    else list.sort((a, b) => {
      const c = a.categoryGroup.localeCompare(b.categoryGroup, 'zh-Hans-CN');
      if (c !== 0) return c;
      return b.stock - a.stock;
    });
    return list;
  }

  function renderProducts() {
    const box = $('#productList'); box.innerHTML = '';
    if (!state.products.length) { box.innerHTML = '<div class="empty">没有匹配的商品</div>'; return; }
    state.products.forEach(p => {
      const card = document.createElement('div'); card.className = 'card';
      const sp = p.sellingPointEnriched
        ? `<span class="enriched">AI补</span>${esc(p.sellingPoint)}`
        : esc(p.sellingPoint);
      // 库存：直接展示具体数量（缺货=0）
      const stockBadge = `<span class="badge ${p.stockStatus === '缺货' ? 'badge--out' : (p.stockStatus === '紧张' ? 'badge--warn' : 'badge--ok')}">库存 ${p.stock}</span>`;
      const commissionTxt = p.commission ? (p.commission * 100).toFixed(0) + '%' : '-';
      // 图片轮播容器（多图自动切换）
      const imgs = (p.images && p.images.length) ? p.images : [imgFallback(p.styleNo)];
      const carouselImgs = imgs.map((u, i) =>
        `<img class="card__img ${i === 0 ? 'active' : ''}" src="${esc(u)}" alt="${esc(p.styleNo)}" onerror="this.src='${imgFallback(p.styleNo)}'">`
      ).join('');
      const nav = imgs.length > 1 ? `<span class="card__carousel-nav">${imgs.length}张</span>` : '';
      const arrows = imgs.length > 1 ? `<button class="card__arrow prev" aria-label="上一张">‹</button><button class="card__arrow next" aria-label="下一张">›</button>` : '';
      card.innerHTML = `
        <div class="card__carousel" data-idx="0">${carouselImgs}${nav}${arrows}</div>
        <div class="card__body">
          <div class="card__sp">${sp}</div>
          <div class="card__price">
            <span class="inf"><small>¥</small>${p.influencerPrice}</span>
            <span class="daily">¥${p.dailyPrice}</span>
            <span class="card__comm">佣 ${commissionTxt}</span>
          </div>
          <div class="card__meta">${brandBadge(p.brand)}<span class="card__style">${esc(p.styleNo)}</span>${stockBadge}</div>
          <button class="card__add ${p.selected ? 'added' : ''}">${p.selected ? '已选 ✓' : '加入选款'}</button>
        </div>`;
      // 图片区：滑动/箭头切图；轻点打开详情（滑动后短暂屏蔽，避免误触）
      const car = card.querySelector('.card__carousel');
      car.addEventListener('click', () => { if (car.dataset.swiped === '1') return; openDetail(p.styleNo); });
      if (imgs.length > 1) {
        car.querySelector('.card__arrow.prev').onclick = (e) => { e.stopPropagation(); switchCardImage(car, -1); };
        car.querySelector('.card__arrow.next').onclick = (e) => { e.stopPropagation(); switchCardImage(car, 1); };
        let sx = 0, sy = 0;
        car.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
        car.addEventListener('touchend', (e) => {
          const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
          if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
            switchCardImage(car, dx < 0 ? 1 : -1);   // 左滑下一张，右滑上一张
            car.dataset.swiped = '1';
            setTimeout(() => { car.dataset.swiped = ''; }, 350);
          }
        }, { passive: true });
      }
      card.querySelector('.card__price').onclick = () => openDetail(p.styleNo);
      card.querySelector('.card__meta').onclick = () => openDetail(p.styleNo);
      card.querySelector('.card__add').onclick = (e) => { e.stopPropagation(); toggleSelect(p); };
      box.appendChild(card);
    });
    startCardCarousel();   // 卡片图片自动轮播（1秒/张）
  }

  // ---- 卡片图片自动轮播（柔和淡入 + 错峰切换） ----
  const CAROUSEL_INTERVAL = 7500;   // 每张卡片每 7.5 秒切换一张
  let cardTimer = null;
  function startCardCarousel() {
    stopCardCarousel();
    const now = Date.now();
    const GOLDEN = 0.6180339887498949;   // 黄金比例，用于低差异相位打散
    $$('.card__carousel').forEach((c, i) => {
      const imgs = c.querySelectorAll('img');
      c.dataset.idx = 0;
      // 相邻卡片相位差约 0.618 个周期（≈4.6s@7.5s），错峰更均匀、避免成片同步；
      // 单屏同一时刻通常只有 0~2 张卡片在翻页
      c.dataset.next = imgs.length > 1 ? (now + ((i * GOLDEN) % 1) * CAROUSEL_INTERVAL) : (now + 1e12);
    });
    // 时间轴 ticker：每 250ms 检查哪些卡片到达切换时刻，各自独立推进
    cardTimer = setInterval(() => {
      const t = Date.now();
      $$('.card__carousel').forEach(c => {
        const imgs = c.querySelectorAll('img');
        if (imgs.length < 2) return;
        const next = +c.dataset.next || 0;
        if (t < next) return;
        let idx = +c.dataset.idx || 0;
        imgs[idx].classList.remove('active');
        idx = (idx + 1) % imgs.length;
        imgs[idx].classList.add('active');
        c.dataset.idx = idx;
        c.dataset.next = t + CAROUSEL_INTERVAL;
      });
    }, 250);
  }
  function stopCardCarousel() { if (cardTimer) { clearInterval(cardTimer); cardTimer = null; } }
  // 单张卡片手动切换（箭头点击 / 触摸滑动共用），并重置该卡的自动计时
  function switchCardImage(car, dir) {
    const imgs = car.querySelectorAll('img');
    if (imgs.length < 2) return;
    let idx = +car.dataset.idx || 0;
    imgs[idx].classList.remove('active');
    idx = (idx + dir + imgs.length) % imgs.length;
    imgs[idx].classList.add('active');
    car.dataset.idx = idx;
    car.dataset.next = Date.now() + CAROUSEL_INTERVAL;
  }

  // ---- 选款（本地/服务端） ----
  function localSel() { try { return JSON.parse(localStorage.getItem(SEL_KEY)) || {}; } catch (e) { return {}; } }
  function saveLocalSel(o) { localStorage.setItem(SEL_KEY, JSON.stringify(o)); }
  async function getSelectedSet() {
    if (MODE === 'api') { const d = await (await fetch('/api/selection?sessionId=' + SID)).json(); return new Set(d.items.map(i => i.styleNo)); }
    return new Set(Object.keys(localSel()));
  }
  async function buildSelectionItems() {
    if (MODE === 'api') { const d = await (await fetch('/api/selection?sessionId=' + SID)).json(); return d.items; }
    return Object.entries(localSel()).map(([styleNo, v]) => {
      const p = DATA.find(x => x.styleNo === styleNo);
      return p ? { ...p, note: (v && v.note) || '' } : null;
    }).filter(Boolean);
  }
  async function updateSelCount() {
    const n = MODE === 'api' ? (await (await fetch('/api/selection?sessionId=' + SID)).json()).count : Object.keys(localSel()).length;
    $('#selCount').textContent = n;
  }

  async function toggleSelect(p) {
    if (p.selected) {
      if (MODE === 'api') await fetch('/api/selection/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: SID, styleNo: p.styleNo }) });
      else { const o = localSel(); delete o[p.styleNo]; saveLocalSel(o); }
      p.selected = false; toast('已移出选款清单');
    } else {
      if (MODE === 'api') await fetch('/api/selection/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: SID, styleNo: p.styleNo }) });
      else { const o = localSel(); o[p.styleNo] = { note: '' }; saveLocalSel(o); }
      p.selected = true; toast('已加入选款清单');
    }
    updateSelCount(); renderProducts();
  }

  // ---- 详情 ----
  let carouselIdx = 0;
  let detailTimer = null;
  function startDetailCarousel() { stopDetailCarousel(); detailTimer = setInterval(() => moveCar(1), 7500); }
  function stopDetailCarousel() { if (detailTimer) { clearInterval(detailTimer); detailTimer = null; } }
  async function openDetail(sn) {
    let p;
    if (MODE === 'api') { const r = await fetch('/api/product/' + encodeURIComponent(sn)); p = await r.json(); }
    else p = DATA.find(x => x.styleNo === sn);
    if (!p) return;
    const carouselImgs = p.images.length ? p.images : [imgFallback(sn)];
    carouselIdx = 0;
    const car = $('#detailCarousel');
    car.innerHTML = carouselImgs.map((u, i) => `<img class="${i === 0 ? 'active' : ''}" src="${esc(u)}" onerror="this.src='${imgFallback(sn)}'">`).join('')
      + (carouselImgs.length > 1 ? `<button class="carousel__btn prev">‹</button><button class="carousel__btn next">›</button>` : '')
      + `<div class="carousel__nav">${carouselImgs.length} 张</div>`;
    // 详情：箭头点击 + 移动端触摸滑动切换
    if (carouselImgs.length > 1) {
      car.querySelector('.prev').onclick = () => switchDetail(-1);
      car.querySelector('.next').onclick = () => switchDetail(1);
      let dsx = 0, dsy = 0, dH = false;
      car.addEventListener('touchstart', (e) => { dsx = e.touches[0].clientX; dsy = e.touches[0].clientY; dH = false; }, { passive: true });
      car.addEventListener('touchmove', (e) => {
        if (!dH) { const dx = e.touches[0].clientX - dsx, dy = e.touches[0].clientY - dsy; if (Math.abs(dx) > 10) dH = Math.abs(dx) > Math.abs(dy); }
        if (dH) e.preventDefault();   // 横向滑动时阻止弹窗内容滚动
      }, { passive: false });
      car.addEventListener('touchend', (e) => {
        const dx = e.changedTouches[0].clientX - dsx, dy = e.changedTouches[0].clientY - dsy;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) switchDetail(dx < 0 ? 1 : -1);
      }, { passive: true });
    }
    startDetailCarousel();   // 详情图片自动轮播（7.5秒/张）

    const sp = p.sellingPointEnriched ? `<span class="enriched">[AI 自动补全]</span> ${esc(p.sellingPoint)}` : esc(p.sellingPoint);
    const stockTxt = p.stockStatus === '缺货' ? '<span style="color:var(--primary)">缺货</span>' : (p.stockStatus === '紧张' ? `<span style="color:var(--warn)">紧张（剩 ${p.stock}）</span>` : `充足（${p.stock}）`);
    const commissionTxt = p.commission ? (p.commission * 100).toFixed(0) + '%' : '-';
    $('#detailBody').innerHTML = `
      <div style="margin-bottom:6px">${brandBadge(p.brand, true)}</div>
      <div class="detail-price"><span class="inf"><small>¥</small>${p.influencerPrice}</span><span class="daily">日常价 ¥${p.dailyPrice}</span></div>
      <div class="detail-row"><span class="k">款号</span><span>${esc(p.styleNo)}</span></div>
      <div class="detail-row"><span class="k">类目</span><span>${esc(p.categoryGroup)}</span></div>
      <div class="detail-row"><span class="k">佣金</span><span>${commissionTxt}</span></div>
      <div class="detail-row"><span class="k">材质</span><span>${esc(p.material)}</span></div>
      <div class="detail-row"><span class="k">颜色</span><span>${esc(p.color)}</span></div>
      <div class="detail-row"><span class="k">库存</span><span>${stockTxt}</span></div>
      <div class="detail-sp"><b>精简卖点：</b>${sp}</div>`;
    const btn = $('#detailToggle');
    btn.textContent = p.selected ? '移出选款清单' : '加入选款清单';
    btn.classList.toggle('added', p.selected);
    btn.onclick = async () => {
      await toggleSelect(p);
      btn.textContent = p.selected ? '移出选款清单' : '加入选款清单';
      btn.classList.toggle('added', p.selected);
    };
    openModal('#detailModal');
  }
  function moveCar(dir) {
    const imgs = $$('#detailCarousel img');
    if (!imgs.length) return;
    imgs[carouselIdx].classList.remove('active');
    carouselIdx = (carouselIdx + dir + imgs.length) % imgs.length;
    imgs[carouselIdx].classList.add('active');
  }
  // 详情手动切换（箭头/滑动共用）：切图后重置自动轮播计时，避免立刻又跳
  function switchDetail(dir) { moveCar(dir); startDetailCarousel(); }

  // ---- 选款清单 ----
  async function openList() {
    const items = await buildSelectionItems();
    const body = $('#listBody'); body.innerHTML = '';
    if (!items.length) { body.innerHTML = '<div class="empty">选款清单还是空的，去挑选商品吧～</div>'; }
    else items.forEach(it => {
      const row = document.createElement('div'); row.className = 'sel-item';
      const img = it.images ? it.images[0] : '';
      row.innerHTML = `
        <img src="${esc(img || imgFallback(it.styleNo))}" onerror="this.src='${imgFallback(it.styleNo)}'">
        <div class="info">
          <div class="s">${brandBadge(it.brand)}${esc(it.styleNo)} · ${esc(it.material)}/${esc(it.color)}</div>
          <div class="p">达人价 ¥${it.influencerPrice} <span style="color:#999;text-decoration:line-through;font-weight:400;font-size:12px">¥${it.dailyPrice}</span></div>
          <input class="note-edit" placeholder="选款备注" value="${esc(it.note || '')}">
        </div>
        <div class="ops"><button class="link-btn" data-act="note">存备注</button><button class="link-btn" data-act="del">删除</button></div>`;
      row.querySelector('[data-act="del"]').onclick = async () => {
        if (MODE === 'api') await fetch('/api/selection/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: SID, styleNo: it.styleNo }) });
        else { const o = localSel(); delete o[it.styleNo]; saveLocalSel(o); }
        toast('已删除'); openList(); updateSelCount(); loadProducts();
      };
      row.querySelector('[data-act="note"]').onclick = async () => {
        const note = row.querySelector('.note-edit').value;
        if (MODE === 'api') await fetch('/api/selection/note', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: SID, styleNo: it.styleNo, note }) });
        else { const o = localSel(); o[it.styleNo] = { note }; saveLocalSel(o); }
        toast('备注已保存');
      };
      body.appendChild(row);
    });
    openModal('#listModal');
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
  }
  function buildExcelBlob(items) {
    const headers = ['品牌', '款号', '类目', '日常价', '达人价', '佣金', '材质', '颜色', '精简卖点', '库存', '选款备注', '图片链接'];
    const rows = items.map(it => [
      it.brand, it.styleNo, it.categoryGroup, it.dailyPrice, it.influencerPrice,
      it.commission ? (it.commission * 100).toFixed(0) + '%' : '-',
      it.material, it.color, it.sellingPoint, it.stock, it.note || '',
      (it.images && it.images[0]) ? it.images[0] : ''
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = [{ wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 16 }, { wch: 14 }, { wch: 34 }, { wch: 8 }, { wch: 20 }, { wch: 50 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '选款清单');
    const arr = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    return new Blob([arr], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  function exportExcelClient(items) {
    downloadBlob(buildExcelBlob(items), '选款清单.xlsx');
  }
  async function exportExcel() {
    const items = await buildSelectionItems();
    if (!items.length) { toast('选款清单为空'); return; }
    if (MODE === 'api') {
      const r = await fetch('/api/selection/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: SID }) });
      if (!r.ok) { const e = await r.json().catch(() => ({})); toast(e.error || '导出失败'); return; }
      downloadBlob(await r.blob(), '选款清单.xlsx'); toast('Excel 已导出');
    } else {
      exportExcelClient(items); toast('Excel 已导出');
    }
  }

  async function submitSelection() {
    const items = await buildSelectionItems();
    if (!items.length) { toast('选款清单为空，无法提交'); return; }
    const nickname = $('#submitterInput').value.trim();
    if (!nickname) { toast('请填写达人昵称'); $('#submitterInput').focus(); return; }
    const payload = { submitter: nickname, remark: $('#remarkInput').value.trim() };
    const btn = $('#submitConfirm');
    const oldText = btn.textContent;
    btn.disabled = true; btn.textContent = '发送中…';
    try {
      if (MODE === 'api') {
        // 提交至选品台后台（持久化汇总，仅管理员可见），无需提交人邮箱
        const res = await fetch('/api/selection/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, sessionId: SID }) });
        const d = await res.json().catch(() => ({}));
        if (d.ok) { toast(d.message || '已提交至选品台后台'); closeModal('#submitModal'); closeModal('#listModal'); updateSelCount(); loadProducts(); }
        else toast(d.error || '提交失败');
      } else if (BACKEND_URL) {
        // 静态站点 + 已配置公共后端：把选款明细发给后端，由后端用自有 SMTP 发信到管理员邮箱
        const apiUrl = BACKEND_URL.endsWith('/send-selection') ? BACKEND_URL : BACKEND_URL + '/api/selection/submit';
        let res;
        try {
          res = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, items }) });
        } catch (e) {
          toast('无法连接邮件服务器（' + (e.name || '网络错误') + '），请重试或导出 Excel');
          return;
        }
        const d = await res.json().catch(() => ({}));
        if (d.ok) { toast(d.message || '已提交，选品表已发往管理员邮箱'); closeModal('#submitModal'); closeModal('#listModal'); updateSelCount(); loadProducts(); }
        else toast((d.error || '提交失败') + '（后端返回 ' + res.status + '）');
      } else {
        // 未配置公网邮件后端：兜底下载 Excel，避免选款丢失（需部署后端并配置 __BACKEND_URL__ 才能自动发邮件）
        exportExcelClient(items);
        toast('已生成选款 Excel（当前站点未配置邮件后端，请手动发送）');
        closeModal('#submitModal'); closeModal('#listModal'); updateSelCount(); loadProducts();
      }
    } catch (e) {
      toast('提交出错：' + (e && e.message ? e.message : e));
    } finally {
      btn.disabled = false; btn.textContent = oldText;
    }
  }

  // ---- 弹窗工具 ----
  function openModal(sel) { $(sel).classList.add('open'); }
  function closeModal(sel) { $(sel).classList.remove('open'); }

  function bindEvents() {
    $('#filterBtn').onclick = () => $('#filterDrawer').classList.add('open');
    $('#filterClose').onclick = () => $('#filterDrawer').classList.remove('open');
    $('.drawer__mask').onclick = () => $('#filterDrawer').classList.remove('open');
    $('#filterReset').onclick = () => {
      state.filters = { brand: '', category: [], price: [] };
      state.keyword = '';
      $$('#fCategory .chip, #fPrice .chip').forEach(c => c.classList.remove('active'));
      $('#searchInput').value = '';
      if (state.brands) renderBrandTabs(state.brands);
      $('#filterDrawer').classList.remove('open');
      loadProducts();
    };
    $('#filterApply').onclick = () => { $('#filterDrawer').classList.remove('open'); loadProducts(); };
    $$('.sortbar__item').forEach(b => b.onclick = () => {
      $$('.sortbar__item').forEach(x => x.classList.remove('active'));
      state.sort = b.dataset.sort; b.classList.add('active'); loadProducts();
    });
    let st; $('#searchInput').oninput = (e) => { clearTimeout(st); st = setTimeout(() => { state.keyword = e.target.value.trim(); loadProducts(); }, 300); };

    $('#detailClose').onclick = () => { stopDetailCarousel(); closeModal('#detailModal'); };
    $('#detailModal .modal__mask').onclick = () => { stopDetailCarousel(); closeModal('#detailModal'); };

    $('#openListBtn').onclick = openList;
    $('#listClose').onclick = () => closeModal('#listModal');
    $('#listModal .modal__mask').onclick = () => closeModal('#listModal');
    $('#listExport').onclick = exportExcel;
    $('#listSubmit').onclick = () => { closeModal('#listModal'); openSubmit(); };

    $('#submitBtn').onclick = openSubmit;
    $('#submitClose').onclick = () => closeModal('#submitModal');
    $('#submitModal .modal__mask').onclick = () => closeModal('#submitModal');
    $('#submitConfirm').onclick = submitSelection;
  }
  function openSubmit() {
    const hint = $('#submitHint');
    hint.textContent = (MODE === 'api' || BACKEND_URL)
      ? '提交后选款表格将由系统用自有 SMTP 自动发送至管理员邮箱（含 Excel 附件），无需填写邮箱。'
      : '当前站点未配置邮件后端，提交将仅生成 Excel 供手动发送（需在部署时配置后端地址）。';
    openModal('#submitModal');
  }

  // ---- 启动 ----
  (async function init() {
    bindEvents();
    const api = await detectMode();
    if (api) await loadFilters(); else await loadStaticData();
    await loadProducts();
    await updateSelCount();
  })();
})();
