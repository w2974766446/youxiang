/**
 * 达人选品提交 API (Vercel Serverless)
 * 接收前端 POST { items, submitter, remark }，生成 Excel 附件并通过 SMTP 发到管理员邮箱。
 * CORS 已开放，支持跨域调用（公网静态站点 → Vercel API）。
 */
const nodemailer = require('nodemailer');
const ExcelJS = require('exceljs');

// ---- CORS ----
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ---- 邮件 HTML 正文 ----
function buildHtml(items, meta) {
  const rows = items.map(it => {
    const img = (it.images && it.images[0]) ? `<img src="${it.images[0]}" style="width:48px;height:48px;object-fit:cover;border-radius:4px" onerror="this.style.display='none'">` : '';
    return `<tr>
      <td>${esc(it.brand)}</td>
      <td>${img}</td>
      <td>${esc(it.styleNo)}</td>
      <td>${esc(it.category || it.categoryGroup)}</td>
      <td style="text-decoration:line-through;color:#999">¥${fmtPrice(it.dailyPrice)}</td>
      <td style="color:#e1251b;font-weight:bold">¥${fmtPrice(it.influencerPrice)}</td>
      <td>${fmtCommission(it.commission)}</td>
      <td>${esc(it.material)}</td>
      <td>${esc(it.color)}</td>
      <td>${esc(it.sellingPoint)}</td>
      <td style="${it.stock === 0 ? 'color:#e1251b;font-weight:bold' : ''}">${it.stock}</td>
      <td>${esc(it.note)}</td>
    </tr>`;
  }).join('');

  return `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,sans-serif;max-width:680px;margin:auto">
<h2 style="color:#2b2b2b">达人选款清单</h2>
<p>提交人：${esc(meta.submitter)} ｜ 提交时间：${esc(meta.time)} ｜ 共 <b>${items.length}</b> 款</p>
${meta.remark ? `<p>备注：${esc(meta.remark)}</p>` : ''}
<table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;width:100%;font-size:13px">
  <thead style="background:#2b2b2b;color:#fff">
    <tr><th>品牌</th><th>图片</th><th>款号</th><th>类目</th><th>日常价</th><th>达人价</th><th>佣金</th><th>材质</th><th>颜色</th><th>精简卖点</th><th>库存</th><th>备注</th></tr>
  </thead>
  <tbody>${rows}</tbody>
</table>
<p style="color:#999;font-size:12px;margin-top:12px">附件为 Excel 版选款清单，可直接导入 WPS / Excel。</p>
</body></html>`;
}

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function fmtPrice(v) { const n = Number(v); return Number.isFinite(n) ? n.toFixed(0) : String(v); }
function fmtCommission(v) {
  if (v == null || v === '') return '-';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return (n > 1 ? n : n * 100).toFixed(0) + '%';
}

// ---- Excel 生成 ----
async function buildExcel(items, meta) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('选款清单');

  ws.columns = [
    { header: '品牌', key: 'brand', width: 10 },
    { header: '款号', key: 'styleNo', width: 12 },
    { header: '类目', key: 'category', width: 14 },
    { header: '日常价', key: 'dailyPrice', width: 10 },
    { header: '达人价', key: 'influencerPrice', width: 10 },
    { header: '佣金', key: 'commission', width: 8 },
    { header: '材质', key: 'material', width: 16 },
    { header: '颜色', key: 'color', width: 14 },
    { header: '精简卖点', key: 'sellingPoint', width: 34 },
    { header: '库存', key: 'stock', width: 8 },
    { header: '选款备注', key: 'note', width: 20 },
    { header: '图片链接', key: 'image', width: 50 }
  ];

  // 表头样式
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2B2B2B' } };
  header.alignment = { horizontal: 'center', vertical: 'center' };

  for (const it of items) {
    const row = ws.addRow({
      brand: it.brand,
      styleNo: it.styleNo,
      category: it.category || it.categoryGroup,
      dailyPrice: it.dailyPrice,
      influencerPrice: it.influencerPrice,
      commission: it.commission ? (it.commission * 100).toFixed(0) + '%' : '-',
      material: it.material,
      color: it.color,
      sellingPoint: it.sellingPoint,
      stock: it.stock,
      note: it.note || '',
      image: (it.images && it.images[0]) ? it.images[0] : ''
    });
    // 达人价标红
    row.getCell('influencerPrice').font = { color: { argb: 'FFE1251B' }, bold: true };
    if (it.stock === 0) row.getCell('stock').font = { color: { argb: 'FFE1251B' }, bold: true };
  }

  // 汇总信息
  const totalRow = items.length + 3;
  ws.getCell(`A${totalRow}`).value = '合计款数';
  ws.getCell(`C${totalRow}`).value = items.length;
  ws.getCell(`A${totalRow + 1}`).value = '提交人';
  ws.getCell(`C${totalRow + 1}`).value = meta.submitter;
  ws.getCell(`A${totalRow + 2}`).value = '备注';
  ws.getCell(`C${totalRow + 2}`).value = meta.remark || '-';
  ws.getCell(`A${totalRow + 3}`).value = '提交时间';
  ws.getCell(`C${totalRow + 3}`).value = meta.time;

  return await wb.xlsx.writeBuffer();
}

// ---- Serverless 入口 ----
module.exports = async (req, res) => {
  // CORS 预检
  if (req.method === 'OPTIONS') {
    Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(200).end();
  }
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const { items, submitter, remark } = req.body || {};

    if (!items || !Array.isArray(items) || !items.length) {
      return res.status(400).json({ ok: false, error: '选款清单为空，无法提交' });
    }
    if (!submitter || !submitter.trim()) {
      return res.status(400).json({ ok: false, error: '请填写达人昵称' });
    }

    const time = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const meta = { submitter: submitter.trim(), remark: (remark || '').trim(), time };

    // 生成 Excel
    const excelBuffer = await buildExcel(items, meta);

    // 邮件 HTML
    const html = buildHtml(items, meta);

    // SMTP 发信
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
      return res.status(500).json({ ok: false, error: 'SMTP 环境变量未配置' });
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 465),
      secure: (process.env.SMTP_SECURE || 'true') === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });

    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: process.env.NOTIFY_EMAIL,
      subject: `达人选款清单（${items.length}款）- ${meta.submitter} - ${time}`,
      html,
      attachments: [{
        filename: `选款清单_${meta.submitter}.xlsx`,
        content: Buffer.from(excelBuffer)
      }]
    });

    return res.json({ ok: true, sent: true, message: '选品表格已发送至管理员邮箱' });
  } catch (e) {
    console.error('[submit] error:', e.message);
    return res.status(500).json({ ok: false, sent: false, error: e.message });
  }
};
