/**
 * 邮件发送：将选款结果（HTML 表格 + Excel 附件）发送至指定邮箱。
 * 使用 nodemailer + SMTP。凭据通过环境变量 / .env 配置。
 * 若未配置 SMTP，则降级为“预览模式”：生成文件并返回内容，由前端提供下载。
 */
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { DATA_DIR } = require('./loader');

function getTransport() {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  return nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 465),
    secure: (process.env.SMTP_SECURE || 'true') === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
  });
}

function buildHtml(items, meta) {
  const rows = items.map(it => `
    <tr>
      <td>${it.brand || ''}</td>
      <td>${it.styleNo}</td>
      <td style="text-decoration:line-through;color:#999">¥${it.dailyPrice}</td>
      <td style="color:#e1251b;font-weight:bold">¥${it.influencerPrice}</td>
      <td>${it.commission ? (it.commission * 100).toFixed(0) + '%' : '-'}</td>
      <td>${it.material}</td>
      <td>${it.color}</td>
      <td>${it.sellingPoint}</td>
      <td style="${it.stock === 0 ? 'color:#e1251b;font-weight:bold' : ''}">${it.stock}</td>
      <td>${it.note || '-'}</td>
    </tr>`).join('');

  return `
  <div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:680px;margin:auto">
    <h2 style="color:#2b2b2b">达人选款清单</h2>
    <p>提交人：${meta.submitter || '-'} ｜ 提交时间：${meta.time} ｜ 共 <b>${items.length}</b> 款</p>
    ${meta.remark ? `<p>备注：${meta.remark}</p>` : ''}
    <table border="1" cellspacing="0" cellpadding="8" style="border-collapse:collapse;width:100%;font-size:13px">
      <thead style="background:#2b2b2b;color:#fff">
        <tr><th>品牌</th><th>款号</th><th>日常价</th><th>达人价</th><th>佣金</th><th>材质</th><th>颜色</th><th>精简卖点</th><th>库存</th><th>备注</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="color:#999;font-size:12px">附件为 Excel 版选款清单，可直接导入 WPS / Excel。</p>
  </div>`;
}

/**
 * 发送选款邮件。
 * @returns {Promise<{sent:boolean, preview?:string, fallbackFile?:string, error?:string}>}
 */
async function sendSelectionEmail({ to, items, meta, excelBuffer }) {
  const html = buildHtml(items, meta);
  const transport = getTransport();

  if (!transport) {
    // 预览模式：落盘保存，便于核对与手动发送
    const stamp = Date.now();
    const htmlPath = path.join(DATA_DIR, `selection-${stamp}.html`);
    const xlsxPath = path.join(DATA_DIR, `selection-${stamp}.xlsx`);
    fs.writeFileSync(htmlPath, html, 'utf8');
    fs.writeFileSync(xlsxPath, excelBuffer);
    return { sent: false, preview: html, fallbackFile: xlsxPath, fallbackName: `selection-${stamp}.xlsx` };
  }

  try {
    await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject: `达人选款清单（${items.length}款）- ${meta.time}`,
      html,
      attachments: [{ filename: '选款清单.xlsx', content: excelBuffer }]
    });
    return { sent: true };
  } catch (e) {
    return { sent: false, error: e.message, preview: html };
  }
}

module.exports = { sendSelectionEmail, buildHtml };
