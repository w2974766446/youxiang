/**
 * 选品表格 HTML 预览生成（用于本地文件夹落盘，便于直接打开查看）。
 * 与 Excel 内容保持一致的字段顺序与样式。
 */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
  }[c]));
}

function fmtCommission(v) {
  if (v == null || v === '') return '-';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return (n > 1 ? n : n * 100).toFixed(0) + '%';
}

function fmtPrice(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(0) : String(v);
}

/**
 * @param {Object} rec  { id, time, submitter, remark, items:[{brand,styleNo,category,dailyPrice,influencerPrice,commission,material,color,sellingPoint,stock,note}] }
 */
const { loadImages } = require('./loader');
function buildSelectionHtml(rec) {
  const items = rec.items || [];
  const imagesMap = loadImages();
  const rows = items.map(it => {
    const imgUrl = (imagesMap[it.styleNo] && imagesMap[it.styleNo][0]) || '';
    const thumb = imgUrl ? `<img src="${esc(imgUrl)}" style="width:56px;height:56px;object-fit:cover;border-radius:4px" onerror="this.style.display='none'">` : '';
    return `<tr>
    <td>${esc(it.brand)}</td>
    <td>${thumb}</td>
    <td>${esc(it.styleNo)}</td>
    <td>${esc(it.category)}</td>
    <td style="text-decoration:line-through;color:#999">¥${esc(fmtPrice(it.dailyPrice))}</td>
    <td style="color:#e1251b;font-weight:bold">¥${esc(fmtPrice(it.influencerPrice))}</td>
    <td>${esc(fmtCommission(it.commission))}</td>
    <td>${esc(it.material)}</td>
    <td>${esc(it.color)}</td>
    <td>${esc(it.sellingPoint)}</td>
    <td>${esc(it.stock)}</td>
    <td>${esc(it.note)}</td>
  </tr>`;
  }).join('');

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>达人选款清单 ${esc(rec.id)}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:1080px;margin:24px auto;padding:0 16px;color:#2b2b2b}
h2{margin-bottom:4px}table{border-collapse:collapse;width:100%;font-size:13px;margin-top:12px}
th,td{border:1px solid #ddd;padding:8px;text-align:left;vertical-align:top}
thead{background:#2b2b2b;color:#fff}</style></head>
<body>
<h2>达人选款清单</h2>
<p>提交人：${esc(rec.submitter)} ｜ 提交时间：${esc(rec.time)} ｜ 共 <b>${items.length}</b> 款</p>
<table>
  <thead><tr><th>品牌</th><th>图片</th><th>款号</th><th>类目</th><th>日常价</th><th>达人价</th><th>佣金</th><th>材质</th><th>颜色</th><th>精简卖点</th><th>库存</th><th>备注</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<p style="color:#999;font-size:12px">本页对应 Excel 文件：选款清单_${esc(rec.id)}.xlsx，可直接导入 WPS / Excel。</p>
</body></html>`;
}

module.exports = { buildSelectionHtml };
