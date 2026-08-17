/**
 * 选款结果 Excel 生成（用于邮件附件 + 本地落盘 + 后台导出）。
 * 第 2 列（B 列）为「图片」：插入选中款轮播的第一张图（来自 images.json，按款号取首图）。
 */
const ExcelJS = require('exceljs');
const { loadImages } = require('./loader');

async function fetchImageBuffer(url) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch (e) {
    return null;
  }
}

function extOf(url) {
  const m = String(url).match(/\.(jpe?g|png|gif|webp|bmp)(?:\?|$)/i);
  if (!m) return 'jpeg';
  const e = m[1].toLowerCase();
  return e === 'jpg' ? 'jpeg' : e;
}

/**
 * @param {Array} items  选款条目：{ styleNo, dailyPrice, influencerPrice, material, color, sellingPoint, stock, note, brand, category }
 * @param {Object} meta  元信息：{ submitter, remark, time }
 */
async function buildSelectionWorkbook(items, meta = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('选款清单');

  // 图片列放在 B（第 2 列）
  ws.columns = [
    { header: '品牌', key: 'brand', width: 10 },
    { header: '图片', key: 'image', width: 12 },
    { header: '款号', key: 'styleNo', width: 12 },
    { header: '类目', key: 'category', width: 14 },
    { header: '日常价', key: 'dailyPrice', width: 10 },
    { header: '达人价', key: 'influencerPrice', width: 10 },
    { header: '佣金', key: 'commission', width: 8 },
    { header: '材质', key: 'material', width: 16 },
    { header: '颜色', key: 'color', width: 14 },
    { header: '精简卖点', key: 'sellingPoint', width: 34 },
    { header: '库存', key: 'stock', width: 8 },
    { header: '选款备注', key: 'note', width: 20 }
  ];

  // 表头样式
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2B2B2B' } };
  header.alignment = { horizontal: 'center', vertical: 'center' };

  const imagesMap = loadImages();
  const IMG_W = 60, IMG_H = 60;

  for (const it of items) {
    const row = ws.addRow({
      brand: it.brand,
      image: '',
      styleNo: it.styleNo,
      category: it.category,
      dailyPrice: it.dailyPrice,
      influencerPrice: it.influencerPrice,
      commission: it.commission ? (it.commission * 100).toFixed(0) + '%' : '-',
      material: it.material,
      color: it.color,
      sellingPoint: it.sellingPoint,
      stock: it.stock,
      note: it.note || ''
    });
    // 达人价标红，突出价格优势
    row.getCell('influencerPrice').font = { color: { argb: 'FFE1251B' }, bold: true };
    if (it.stock === 0) row.getCell('stock').font = { color: { argb: 'FFE1251B' }, bold: true };

    // B 列插入轮播首图
    const imgUrl = (imagesMap[it.styleNo] && imagesMap[it.styleNo][0]) || '';
    if (imgUrl) {
      const buf = await fetchImageBuffer(imgUrl);
      if (buf) {
        const imgId = wb.addImage({ buffer: buf, extension: extOf(imgUrl) });
        ws.addImage(imgId, { tl: { col: 1, row: row.number - 1 }, ext: { width: IMG_W, height: IMG_H }, editAs: 'oneCell' });
        row.height = 46; // 适配图片高度
      } else {
        row.getCell('image').value = '图片获取失败';
      }
    }
  }

  // 汇总信息（标签在 A 列，值在 C 列，因为 B 列已用作图片）
  const totalRow = items.length + 3;
  ws.getCell(`A${totalRow}`).value = '合计款数';
  ws.getCell(`C${totalRow}`).value = items.length;
  ws.getCell(`A${totalRow + 1}`).value = '提交人';
  ws.getCell(`C${totalRow + 1}`).value = meta.submitter || '-';
  ws.getCell(`A${totalRow + 2}`).value = '备注';
  ws.getCell(`C${totalRow + 2}`).value = meta.remark || '-';
  ws.getCell(`A${totalRow + 3}`).value = '提交时间';
  ws.getCell(`C${totalRow + 3}`).value = meta.time || new Date().toLocaleString('zh-CN');

  const buf = await wb.xlsx.writeBuffer();
  return buf;
}

module.exports = { buildSelectionWorkbook };
