const http = require('http');
const nodemailer = require('nodemailer');
const ExcelJS = require('exceljs');

const PORT = process.env.PORT || 9000;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function fmtPrice(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(0) : String(v == null ? '' : v);
}
function fmtCommission(v) {
  if (v == null || v === '') return '-';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return (n > 1 ? n : n * 100).toFixed(0) + '%';
}

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
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2B2B2B' } };
  header.alignment = { horizontal: 'center', vertical: 'center' };
  for (const it of items) {
    const row = ws.addRow({
      brand: it.brand, styleNo: it.styleNo, category: it.category || it.categoryGroup,
      dailyPrice: it.dailyPrice, influencerPrice: it.influencerPrice,
      commission: it.commission ? fmtCommission(it.commission) : '-',
      material: it.material, color: it.color, sellingPoint: it.sellingPoint,
      stock: it.stock, note: it.note || '',
      image: (it.images && it.images[0]) ? it.images[0] : ''
    });
    row.getCell('influencerPrice').font = { color: { argb: 'FFE1251B' }, bold: true };
    if (it.stock === 0) row.getCell('stock').font = { color: { argb: 'FFE1251B' }, bold: true };
  }
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

async function handleRequest(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
    return;
  }

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      let payload = body;
      try { payload = JSON.parse(body); } catch(e) {}

      const { items, submitter, remark } = payload || {};
      if (!items || !Array.isArray(items) || !items.length) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: '选款清单为空，无法提交' }));
        return;
      }
      if (!submitter || !submitter.trim()) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: '请填写达人昵称' }));
        return;
      }

      const time = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
      const meta = { submitter: submitter.trim(), remark: (remark || '').trim(), time };

      const excelBuffer = await buildExcel(items, meta);
      const html = buildHtml(items, meta);

      const SMTP_HOST = process.env.SMTP_HOST;
      const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
      const SMTP_SECURE = (process.env.SMTP_SECURE || 'true') === 'true';
      const SMTP_USER = process.env.SMTP_USER;
      const SMTP_PASS = process.env.SMTP_PASS;
      const SMTP_FROM = process.env.SMTP_FROM || process.env.SMTP_USER;
      const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL;

      if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'SMTP 环境变量未配置' }));
        return;
      }

      const transporter = nodemailer.createTransport({
        host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_SECURE,
        auth: { user: SMTP_USER, pass: SMTP_PASS }
      });

      await transporter.sendMail({
        from: SMTP_FROM,
        to: NOTIFY_EMAIL,
        subject: `达人选款清单（${items.length}款）- ${meta.submitter} - ${time}`,
        html,
        attachments: [{ filename: `选款清单_${meta.submitter}.xlsx`, content: Buffer.from(excelBuffer) }]
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, sent: true, message: '选品表格已发送至管理员邮箱' }));
    } catch (e) {
      console.error('[send-selection] error:', e.message);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, sent: false, error: e.message }));
    }
  });
}

const server = http.createServer(handleRequest);
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
