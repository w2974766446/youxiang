/**
 * 静态构建：把 xlsx 数据源预烘焙成 public/build/data.json，
 * 使前端可在“无后端”的静态托管环境（如 CloudStudio 公网）下运行，
 * 手机直接打开即可浏览/筛选/选款/导出 Excel。
 */
const fs = require('fs');
const path = require('path');
const { loadProducts, loadInventory, loadImages } = require('../server/lib/loader');
const { enrichSellingPoint } = require('../server/lib/enrich');

const LOW = Number(process.env.LOW_STOCK_THRESHOLD || 10);
function stockStatus(q) {
  if (q <= 0) return '缺货';
  if (q < LOW) return '紧张';
  return '充足';
}

const inv = loadInventory();
const imgs = loadImages();
// 淘宝图加 OSS 处理参数：宽 800 / jpg / 质量 85，兼顾清晰度与体积
function normImg(u) {
  if (/img\.alicdn\.com/.test(u) && !/x-oss-process/.test(u)) {
    return u + '?x-oss-process=image/resize,w_800/format,jpg/quality,q_85';
  }
  return u;
}
const products = loadProducts().map(p => {
  const stock = inv[p.styleNo] ?? 0;
  const sp = enrichSellingPoint(p);
  let im = imgs[p.styleNo];
  if (im && im.length) im = im.map(normImg);
  else im = [`https://picsum.photos/seed/${encodeURIComponent(p.styleNo)}/600/600`];
  return {
    brand: p.brand,
    styleNo: p.styleNo,
    category: p.category,
    categoryGroup: p.categoryGroup,
    dailyPrice: p.dailyPrice,
    influencerPrice: p.influencerPrice,
    commission: p.commission,
    color: p.color,
    material: p.material,
    sellingPoint: sp.text,
    sellingPointEnriched: sp.enriched,
    stock,
    stockStatus: stockStatus(stock),
    images: im
  };
}).filter(p => p.stock >= 80); // 库存小于 80 的商品不上架到网页

const out = path.join(__dirname, '..', 'public', 'build');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'data.json'), JSON.stringify(products));
console.log(`已烘焙 ${products.length} 款商品 -> public/build/data.json`);
