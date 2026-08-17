/* 选品台后台 - 管理员视图（仅本人凭口令可见） */
(function () {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);
  let TOKEN = sessionStorage.getItem('dps_admin_token') || '';
  let currentId = null;

  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 1800);
  }
  function authHeader() { return { 'Authorization': 'Bearer ' + TOKEN }; }

  async function api(url, opts) {
    opts = opts || {};
    opts.headers = Object.assign({}, opts.headers, authHeader());
    const r = await fetch(url, opts);
    if (r.status === 401) { toast('登录已失效，请重新登录'); logout(); throw new Error('unauthorized'); }
    return r;
  }

  function show(box) { box.style.display = ''; }
  function hide(box) { box.style.display = 'none'; }

  function logout() { TOKEN = ''; sessionStorage.removeItem('dps_admin_token'); show($('#loginBox')); hide($('#adminBox')); }

  async function doLogin() {
    const pwd = $('#passInput').value;
    if (!pwd) { $('#loginErr').textContent = '请输入口令'; return; }
    try {
      const r = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pwd }) });
      const d = await r.json();
      if (d.ok && d.token) {
        TOKEN = d.token; sessionStorage.setItem('dps_admin_token', TOKEN);
        hide($('#loginBox')); show($('#adminBox')); loadList();
      } else {
        $('#loginErr').textContent = d.error || '登录失败';
      }
    } catch (e) { $('#loginErr').textContent = '网络错误'; }
  }

  async function loadList() {
    try {
      const r = await api('/api/admin/submissions');
      const d = await r.json();
      $('#totalTxt').textContent = '共 ' + (d.total || 0) + ' 次提交';
      const box = $('#subList'); box.innerHTML = '';
      if (!d.items || !d.items.length) { show($('#emptyTip')); return; }
      hide($('#emptyTip'));
      d.items.forEach(it => {
        const row = document.createElement('div'); row.className = 'sub-row';
        row.innerHTML = `
          <div class="meta">
            <div class="t">${esc(it.submitter)} · ${it.count} 款</div>
            <div class="s">选品时间：${esc(it.time)}${it.remark ? ' ｜ 备注：' + esc(it.remark) : ''}</div>
          </div>
          <div class="acts">
            <button class="btn-sm" data-act="view" data-id="${it.id}">查看</button>
            <button class="btn-sm danger" data-act="del" data-id="${it.id}">删除</button>
          </div>`;
        box.appendChild(row);
      });
    } catch (e) { /* 已处理 401 */ }
  }

  async function viewDetail(id) {
    currentId = id;
    const r = await api('/api/admin/submissions/' + id);
    const d = await r.json();
    if (!d.ok) return;
    const rec = d.record;
    $('#detailInfo').innerHTML = `选品人：<b>${esc(rec.submitter)}</b> ｜ 选品时间：${esc(rec.time)} ｜ 共 ${rec.count} 款${rec.remark ? ' ｜ 备注：' + esc(rec.remark) : ''}`;
    const rows = rec.items.map(it => `<tr>
      <td>${esc(it.brand || '')}</td><td>${esc(it.styleNo)}</td>
      <td style="text-decoration:line-through;color:#999">¥${it.dailyPrice}</td>
      <td style="color:#e1251b;font-weight:bold">¥${it.influencerPrice}</td>
      <td>${it.commission ? (it.commission * 100).toFixed(0) + '%' : '-'}</td>
      <td>${esc(it.material)}</td><td>${esc(it.color)}</td>
      <td>${esc(it.sellingPoint)}</td>
      <td>${it.stock}</td><td>${esc(it.note || '-')}</td>
    </tr>`).join('');
    $('#detailTable').innerHTML = `<table class="detail-table">
      <thead><tr><th>品牌</th><th>款号</th><th>日常价</th><th>达人价</th><th>佣金</th><th>材质</th><th>颜色</th><th>精简卖点</th><th>库存</th><th>备注</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
    $('#detailModal').classList.add('open');
  }

  async function delItem(id) {
    if (!confirm('确认删除该提交记录？')) return;
    const r = await api('/api/admin/submissions/' + id, { method: 'DELETE' });
    const d = await r.json();
    if (d.ok) { toast('已删除'); loadList(); }
    else toast(d.error || '删除失败');
  }

  async function exportDetail() {
    if (!currentId) return;
    const r = await api('/api/admin/submissions/' + currentId + '/export', { method: 'POST' });
    if (!r.ok) { toast('导出失败'); return; }
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '选款清单_' + currentId + '.xlsx';
    a.click();
    toast('已导出 Excel');
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // 事件
  $('#loginBtn').onclick = doLogin;
  $('#passInput').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  $('#detailClose').onclick = () => $('#detailModal').classList.remove('open');
  $('#detailModal .modal__mask').onclick = () => $('#detailModal').classList.remove('open');
  $('#detailExport').onclick = exportDetail;
  $('#subList').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const id = b.dataset.id;
    if (b.dataset.act === 'view') viewDetail(id);
    else if (b.dataset.act === 'del') delItem(id);
  };

  // 已有 token 则直接进入
  if (TOKEN) { hide($('#loginBox')); show($('#adminBox')); loadList(); }
})();
