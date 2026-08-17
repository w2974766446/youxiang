// 把图片 URL 作为「商品图1..商品图5」文本列追加到真实货盘表末尾（先备份）
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const DATA_DIR = path.join(__dirname, '..', 'data');
const SRC = path.join(DATA_DIR, '商品资料表.xlsx');
const BAK = path.join(DATA_DIR, '商品资料表.bak.xlsx');
const IMG = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'images.json'), 'utf8'));

if (!fs.existsSync(BAK)) fs.copyFileSync(SRC, BAK); // 仅首次备份
const wb = XLSX.readFile(SRC);
let totalFilled = 0, totalRows = 0;
wb.SheetNames.forEach(name => {
  const ws = wb.Sheets[name];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (!rows.length) return;
  const header = rows[0];
  let styleCol = header.findIndex(h => String(h).includes('款号'));
  if (styleCol < 0) styleCol = 0;
  const maxCol = header.length; // 追加列从 maxCol 开始
  // 写表头
  for (let i = 0; i < 5; i++) ws[XLSX.utils.encode_cell({ r: 0, c: maxCol + i })] = { t: 's', v: '商品图' + (i + 1) };
  // 写数据
  for (let r = 1; r < rows.length; r++) {
    const sn = String(rows[r][styleCol] || '').trim();
    if (!sn) continue;
    totalRows++;
    const imgs = IMG[sn] || [];
    for (let i = 0; i < 5; i++) {
      const v = imgs[i] ? imgs[i] : '';
      ws[XLSX.utils.encode_cell({ r, c: maxCol + i })] = v ? { t: 's', v } : { t: 's', v: '' };
    }
    if (imgs.length) totalFilled++;
  }
  // 更新列范围
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  range.e.c = Math.max(range.e.c, maxCol + 4);
  ws['!ref'] = XLSX.utils.encode_range(range);
});
XLSX.writeFile(wb, SRC);
console.log('已写入商品图列。匹配到图片的款号行:', totalFilled, '/ 总行:', totalRows);
console.log('备份文件:', BAK);
