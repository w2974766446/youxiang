/**
 * 数据加载层：读取 WPS 格式的 xlsx 多品牌表格。
 *  - 商品资料表.xlsx：每个工作表 = 一个品牌（如「初语货表」「茵曼货表」）
 *  - 库存.xlsx：每个工作表 = 一个品牌（如「初语库存」「茵曼库存」），按款号关联
 * 字段兼容：日常价/达播价、佣金(支持 "20%" 与 0.2 两种写法)、材质(支持「面料：」前缀与缺失)
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');

function readAllSheets(file) {
  const p = path.join(DATA_DIR, file);
  if (!fs.existsSync(p)) throw new Error(`缺少数据文件: ${file}（请放入 ${file}）`);
  const wb = XLSX.readFile(p);
  return wb.SheetNames.map(name => {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    return { name, rows };
  });
}

function findCol(headerRow, keywords) {
  for (let i = 0; i < headerRow.length; i++) {
    const h = String(headerRow[i] || '').trim();
    if (keywords.some(k => h.includes(k))) return i;
  }
  return -1;
}

function brandOf(sheetName) {
  return sheetName.replace(/(货表|库存)$/, '').trim() || sheetName;
}

function normCommission(v) {
  if (v === '' || v == null) return 0;
  const s = String(v).replace('%', '').trim();
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return 0;
  return n > 1 ? n / 100 : n; // "20%" -> 0.2 ; 0.2 -> 0.2
}

// 类目合并（用于筛选与排列）：毛衣↔针织衫、风衣↔外套、T恤↔背心
// 同时收纳真实数据中的同义变体写法，贴合“同一品类合并展示”的本意
const CATEGORY_MERGE = {
  // 毛衣 / 针织 一类
  '毛衣': '毛衣/针织衫',
  '(仿)毛衣': '毛衣/针织衫',
  '针织衫': '毛衣/针织衫',
  '羊毛衫': '毛衣/针织衫',
  // 风衣 / 外套 一类
  '风衣': '风衣/外套',
  '外套': '风衣/外套',
  '外套 上衣': '风衣/外套',
  // T恤 / 背心 一类
  'T恤': 'T恤/背心',
  '背心': 'T恤/背心',
  '吊带 背心': 'T恤/背心'
};
function normCategory(c) {
  const key = String(c == null ? '' : c).trim();
  return CATEGORY_MERGE[key] || (key || '未分类');
}

function loadProducts() {
  const out = [];
  readAllSheets('商品资料表.xlsx').forEach(({ name, rows }) => {
    if (!rows.length) return;
    const brand = brandOf(name);
    const h = rows[0];
    const ci = {
      styleNo: findCol(h, ['款号']),
      category: findCol(h, ['类目', '品类']),
      daily: findCol(h, ['日常价']),
      influencer: findCol(h, ['达播价', '达人价']),
      commission: findCol(h, ['佣金']),
      color: findCol(h, ['颜色']),
      material: findCol(h, ['材质']),
      sellingPoint: findCol(h, ['卖点精简', '精简卖点', '卖点', '亮点'])
    };
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const styleNoRaw = String(row[ci.styleNo] ?? '').trim();
      if (!styleNoRaw) continue; // 跳过空行
      // 一个单元格可能合并多个款号（如 "18424160/18424137" 或 "A款、B款"），拆分后各自成行
      const styleNos = styleNoRaw.split(/[\/、,，]/).map(s => s.trim()).filter(Boolean);
      let material = String(row[ci.material] ?? '').trim();
      if (material === '0' || material === '0.0') material = ''; // “0”表示缺失
      const daily = Number(row[ci.daily]);
      const influencer = Number(row[ci.influencer]);
      const category = String(row[ci.category] ?? '').trim();
      const color = String(row[ci.color] ?? '').trim();
      const commission = normCommission(row[ci.commission]);
      const sellingPoint = String(row[ci.sellingPoint] ?? '').trim();
      for (const styleNo of styleNos) {
        out.push({
          brand,
          styleNo,
          category,
          categoryGroup: normCategory(category),
          dailyPrice: Number.isFinite(daily) ? daily : 0,
          influencerPrice: Number.isFinite(influencer) ? influencer : 0,
          commission,
          color,
          material,
          // 源表里的「卖点精简」列（若存在且有内容）优先采用；为空则交由补全引擎生成
          sellingPoint
        });
      }
    }
  });
  return out;
}

function loadInventory() {
  const map = {};
  readAllSheets('库存.xlsx').forEach(({ name, rows }) => {
    // 跳过 ERP 导出的仓库明细表（如「初语库存数据源」，其 B 列是仓库名称而非库存）
    if (name.includes('数据源')) return;
    if (!rows.length) return;
    // 按用户要求：仅以 B 列（索引 1）作为库存数据源，A 列（索引 0）为款号
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const sn = String(row[0] ?? '').trim();
      if (!sn) continue;
      const qty = Number(row[1]);
      if (Number.isFinite(qty)) map[sn] = qty;
    }
  });
  return map;
}

function loadImages() {
  const p = path.join(DATA_DIR, 'images.json');
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return {}; }
}

module.exports = { DATA_DIR, loadProducts, loadInventory, loadImages };
