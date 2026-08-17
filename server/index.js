/**
 * 达人商品选品系统 - 后端服务
 * 移动端优先选品界面 + 选款清单 + 一键提交(生成 Excel 并发送邮件)
 */
// 轻量 .env 加载（不依赖 dotenv）
(function loadEnv() {
  const fs = require('fs');
  const path = require('path');
  const f = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(f)) return;
  try {
    fs.readFileSync(f, 'utf8').split('\n').forEach(line => {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    });
  } catch (e) { /* 忽略 */ }
})();

const express = require('express');
const path = require('path');
const fs = require('fs');
const { loadProducts, loadInventory, loadImages } = require('./lib/loader');
const { enrichSellingPoint } = require('./lib/enrich');
const { buildSelectionWorkbook } = require('./lib/excel');
const { sendSelectionEmail } = require('./lib/mailer');
const store = require('./lib/store');
const submissions = require('./lib/submissions');
const { buildSelectionHtml } = require('./lib/render');

// 选品表格本地输出目录：达人每次提交后，Excel 与 HTML 预览自动写入此处
// 可通过 .env 的 OUTPUT_DIR 配置（相对项目根目录）
const OUTPUT_DIR = path.resolve(__dirname, '..', process.env.OUTPUT_DIR || 'data/exports');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
console.log(`选品表格本地输出目录： ${OUTPUT_DIR}`);

// 选款提交后自动发送到的“指定接收邮箱”（由服务端 SMTP 账号代发，无需提交人邮箱）
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'wujiangluo@hmbpo.cn';
console.log(`选款提交后自动发送邮箱： ${NOTIFY_EMAIL}`);

/**
 * 将一次提交的选品表格落盘到本地文件夹（Excel + 可读 HTML 预览）。
 * 可传入已生成的 buf 复用，避免重复生成；返回保存路径，失败返回 null。
 */
async function saveSubmissionFiles(rec, buf) {
  try {
    if (!buf) buf = await buildSelectionWorkbook(rec.items, { submitter: rec.submitter, remark: rec.remark, time: rec.time });
    const base = `选款清单_${rec.id}`;
    const xlsxPath = path.join(OUTPUT_DIR, base + '.xlsx');
    const htmlPath = path.join(OUTPUT_DIR, base + '.html');
    fs.writeFileSync(xlsxPath, Buffer.from(buf));
    fs.writeFileSync(htmlPath, buildSelectionHtml(rec), 'utf8');
    console.log(`已保存选品表格：${xlsxPath}`);
    return { xlsx: xlsxPath, html: htmlPath };
  } catch (e) {
    console.error('保存选品表格到本地文件夹失败：', e.message);
    return null;
  }
}

const LOW_STOCK = Number(process.env.LOW_STOCK_THRESHOLD || 10);
const PORT = Number(process.env.PORT || 3000);

// 价格段（多选筛选用，半开区间避免重叠）
const PRICE_SEGMENTS = [
  { id: 'u100', label: '100元以下', min: 0, max: 100 },
  { id: '100-200', label: '100-200元', min: 100, max: 200 },
  { id: '200-300', label: '200-300元', min: 200, max: 300 },
  { id: 'o300', label: '300元以上', min: 300, max: Infinity }
];

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---- 数据装配 ----
let PRODUCTS = [];      // 合并后的商品列表
let STYLE_INDEX = {};   // 款号 -> 商品

function stockStatus(qty) {
  if (qty <= 0) return '缺货';
  if (qty < LOW_STOCK) return '紧张';
  return '充足';
}

function assemble() {
  const inventory = loadInventory();
  const images = loadImages();
  PRODUCTS = loadProducts().map(p => {
    const stock = inventory[p.styleNo] ?? 0;
    const sp = enrichSellingPoint(p);
    let imgs = images[p.styleNo];
    if (!imgs || !imgs.length) imgs = [`https://picsum.photos/seed/${encodeURIComponent(p.styleNo)}/600/600`];
    return {
      ...p,
      sellingPoint: sp.text,
      sellingPointEnriched: sp.enriched,
      stock,
      stockStatus: stockStatus(stock),
      images: imgs
    };
  });
  STYLE_INDEX = Object.fromEntries(PRODUCTS.map(p => [p.styleNo, p]));
  const brands = [...new Set(PRODUCTS.map(p => p.brand))];
  console.log(`已加载 ${PRODUCTS.length} 款商品，品牌：${brands.join(' / ')}（库存阈值<${LOW_STOCK} 标注“紧张”）`);
}

assemble();

// ---- 业务辅助 ----
function buildSelectionItems(sessionId) {
  return store.list(sessionId)
    .map(s => {
      const p = STYLE_INDEX[s.styleNo];
      if (!p) return null;
      return {
        brand: p.brand,
        styleNo: p.styleNo,
        category: p.categoryGroup,
        dailyPrice: p.dailyPrice,
        influencerPrice: p.influencerPrice,
        commission: p.commission,
        material: p.material,
        color: p.color,
        sellingPoint: p.sellingPoint,
        stock: p.stock,
        note: s.note
      };
    })
    .filter(Boolean);
}

// ---- API ----
app.get('/api/filters', (req, res) => {
  const brands = [...new Set(PRODUCTS.map(p => p.brand))].filter(Boolean);
  // 合并后的类目（拼音排序，保证顶端到末端稳定有序）
  const cats = [...new Set(PRODUCTS.map(p => p.categoryGroup))].filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  const prices = PRODUCTS.map(p => p.influencerPrice).filter(n => Number.isFinite(n));
  res.json({
    brands,
    categories: cats,
    priceSegments: PRICE_SEGMENTS,
    priceRange: prices.length ? [Math.min(...prices), Math.max(...prices)] : [0, 0],
    lowStockThreshold: LOW_STOCK
  });
});

app.get('/api/products', (req, res) => {
  const { brand, category, price, keyword, sort, onlySelected, sessionId } = req.query;
  let list = PRODUCTS.slice();

  if (brand) list = list.filter(p => p.brand === brand);
  // 类目筛选（多选，合并类目）
  if (category) {
    const set = String(category).split(',').filter(Boolean);
    list = list.filter(p => set.includes(p.categoryGroup));
  }
  // 价格段筛选（多选，按达人价落入区间）
  if (price) {
    const set = String(price).split(',').filter(Boolean);
    list = list.filter(p => set.some(sid => {
      const s = PRICE_SEGMENTS.find(x => x.id === sid);
      return s && p.influencerPrice >= s.min && p.influencerPrice < s.max;
    }));
  }
  if (keyword) {
    const k = String(keyword).toLowerCase();
    list = list.filter(p =>
      p.styleNo.toLowerCase().includes(k) ||
      p.material.toLowerCase().includes(k) ||
      p.color.toLowerCase().includes(k) ||
      p.sellingPoint.toLowerCase().includes(k)
    );
  }
  if (onlySelected === '1' && sessionId) {
    const sel = new Set(store.list(sessionId).map(s => s.styleNo));
    list = list.filter(p => sel.has(p.styleNo));
  }

  // 排序：默认 类目（拼音）> 库存（多→少）；可手动覆盖
  if (sort === 'price_asc') list.sort((a, b) => a.influencerPrice - b.influencerPrice);
  else if (sort === 'price_desc') list.sort((a, b) => b.influencerPrice - a.influencerPrice);
  else if (sort === 'stock_desc' || sort === 'stock_asc') list.sort((a, b) => b.stock - a.stock);
  else list.sort((a, b) => {
    const c = a.categoryGroup.localeCompare(b.categoryGroup, 'zh-Hans-CN');
    if (c !== 0) return c;
    return b.stock - a.stock; // 同类目下库存多者优先
  });

  const selectedSet = sessionId ? new Set(store.list(sessionId).map(s => s.styleNo)) : new Set();
  list = list.map(p => ({ ...p, selected: selectedSet.has(p.styleNo) }));
  res.json({ total: list.length, products: list });
});

app.get('/api/product/:styleNo', (req, res) => {
  const p = STYLE_INDEX[req.params.styleNo];
  if (!p) return res.status(404).json({ error: '未找到该款号' });
  res.json(p);
});

// ---- 选款清单 增删改查 ----
app.post('/api/selection/add', (req, res) => {
  const { sessionId, styleNo, note } = req.body || {};
  if (!sessionId || !styleNo) return res.status(400).json({ error: '缺少参数' });
  store.add(sessionId, styleNo, note);
  res.json({ ok: true, count: store.count(sessionId) });
});

app.post('/api/selection/remove', (req, res) => {
  const { sessionId, styleNo } = req.body || {};
  if (!sessionId || !styleNo) return res.status(400).json({ error: '缺少参数' });
  store.remove(sessionId, styleNo);
  res.json({ ok: true, count: store.count(sessionId) });
});

app.post('/api/selection/note', (req, res) => {
  const { sessionId, styleNo, note } = req.body || {};
  if (!sessionId || !styleNo) return res.status(400).json({ error: '缺少参数' });
  store.setNote(sessionId, styleNo, note);
  res.json({ ok: true });
});

app.get('/api/selection', (req, res) => {
  const { sessionId } = req.query;
  if (!sessionId) return res.status(400).json({ error: '缺少 sessionId' });
  const items = buildSelectionItems(sessionId);
  res.json({ count: items.length, items });
});

// 导出 Excel（当前选款，供前端下载）
app.post('/api/selection/export', async (req, res) => {
  try {
    const { sessionId } = req.body || {};
    if (!sessionId) return res.status(400).json({ error: '缺少 sessionId' });
    const items = buildSelectionItems(sessionId);
    if (!items.length) return res.status(400).json({ error: '选款清单为空' });
    const buf = await buildSelectionWorkbook(items, { time: new Date().toLocaleString('zh-CN') });
    res.attachment('选款清单.xlsx');
    res.send(Buffer.from(buf));
  } catch (e) {
    res.status(500).json({ error: '导出失败：' + e.message });
  }
});

// 一键提交：选品表格保存到本地文件夹，并自动发送到指定接收邮箱（需配置 SMTP）
// 兼容两种来源：
//  - API 模式：传 sessionId，由服务端 store 取出选款明细
//  - 静态模式：前端直接传 items 数组（静态站点无服务端会话）
app.post('/api/selection/submit', async (req, res) => {
  try {
    const { sessionId, items: clientItems, submitter, remark } = req.body || {};
    let items = Array.isArray(clientItems) && clientItems.length ? clientItems : null;
    if (!items) {
      if (!sessionId) return res.status(400).json({ error: '缺少选款数据（sessionId 或 items）' });
      items = buildSelectionItems(sessionId);
    }
    if (!items.length) return res.status(400).json({ error: '选款清单为空，无法提交' });
    if (!submitter || !submitter.trim()) return res.status(400).json({ error: '请填写达人昵称' });

    const rec = submissions.add({ submitter: submitter.trim(), remark: remark || '', items });
    // 生成一份 Excel 缓冲，落盘与发邮件复用
    const buf = await buildSelectionWorkbook(rec.items, { submitter: rec.submitter, remark: rec.remark, time: rec.time });
    const saved = await saveSubmissionFiles(rec, buf); // 同步落盘到本地文件夹

    // 自动发邮件到指定接收邮箱（需配置 SMTP；未配置则跳过，仅落盘）
    let email = { sent: false };
    if (process.env.SMTP_HOST && NOTIFY_EMAIL) {
      email = await sendSelectionEmail({
        to: NOTIFY_EMAIL,
        items: rec.items,
        meta: { submitter: rec.submitter, remark: rec.remark, time: rec.time },
        excelBuffer: buf
      });
    }

    if (sessionId) store.clear(sessionId); // 提交后清空当前会话选款
    const msg = email.sent
      ? '已提交：选品表格已保存到本地并自动发送到指定邮箱'
      : '已提交：表格已保存到本地（未配置 SMTP，邮件未发送）';
    res.json({ ok: true, id: rec.id, file: saved, email, message: msg });
  } catch (e) {
    res.status(500).json({ ok: false, sent: false, error: '提交失败：' + e.message });
  }
});

app.listen(PORT, () => {
  console.log(`达人商品选品系统已启动： http://localhost:${PORT}`);
  if (!process.env.SMTP_HOST) console.log('提示：未配置 SMTP_HOST，提交将进入“预览模式”（生成文件 + 前端下载）。');
});

// ============ 选品台后台（仅管理员可见，需密码） ============
const crypto = require('crypto');
// 管理员口令：环境变量 ADMIN_PASS，缺省提供一个初始口令（请尽快在 .env 中修改）
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin888';
const ADMIN_TOKEN = crypto.createHmac('sha256', 'dps-admin').update(ADMIN_PASS).digest('hex');

function adminAuth(req, res) {
  const auth = req.headers['authorization'] || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const token = m ? m[1] : (req.query.token || '');
  if (token !== ADMIN_TOKEN) { res.status(401).json({ error: '未授权' }); return false; }
  return true;
}

// 登录：口令正确返回管理 token
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (!password || password !== ADMIN_PASS) return res.status(401).json({ error: '口令错误' });
  res.json({ ok: true, token: ADMIN_TOKEN });
});

// 提交汇总列表
app.get('/api/admin/submissions', (req, res) => {
  if (!adminAuth(req, res)) return;
  res.json({ total: submissions.total(), items: submissions.list() });
});

// 单条详情
app.get('/api/admin/submissions/:id', (req, res) => {
  if (!adminAuth(req, res)) return;
  const rec = submissions.get(req.params.id);
  if (!rec) return res.status(404).json({ error: '未找到该提交' });
  res.json({ ok: true, record: rec });
});

// 单条导出 Excel
app.post('/api/admin/submissions/:id/export', async (req, res) => {
  if (!adminAuth(req, res)) return;
  const rec = submissions.get(req.params.id);
  if (!rec) return res.status(404).json({ error: '未找到该提交' });
  try {
    const buf = await buildSelectionWorkbook(rec.items, { submitter: rec.submitter, remark: rec.remark, time: rec.time });
    // 导出时同步保存到本地文件夹，保证后台汇总与本地文件一致
    try { fs.writeFileSync(path.join(OUTPUT_DIR, `选款清单_${rec.id}.xlsx`), Buffer.from(buf)); } catch (e) { /* 忽略 */ }
    res.attachment(`选款清单_${rec.id}.xlsx`);
    res.send(Buffer.from(buf));
  } catch (e) {
    res.status(500).json({ error: '导出失败：' + e.message });
  }
});

// 删除一条
app.delete('/api/admin/submissions/:id', (req, res) => {
  if (!adminAuth(req, res)) return;
  const ok = submissions.remove(req.params.id);
  res.json({ ok, message: ok ? '已删除' : '未找到' });
});
