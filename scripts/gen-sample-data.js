/**
 * 生成 WPS 兼容的示例数据（与真实双品牌表结构一致，可直接替换为真实数据）：
 *  - data/商品资料表.xlsx  两个工作表：初语货表 / 茵曼货表（款号/类目/日常价/达播价/佣金/颜色/材质）
 *  - data/库存.xlsx        两个工作表：初语库存 / 茵曼库存（款号/总库存 或 合计库存）
 *  - data/images.json      款号 -> 第三方图片 URL 数组
 *
 * 演示要点：
 *  - 部分商品“材质”填 "0"（缺失），用于演示卖点自动补全。
 *  - 佣金同时演示 "20%" 与 0.2 两种写法，加载层统一归一为小数。
 *  - 库存演示 0 与低位库存，用于库存标注。
 */
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

// 初语：[款号, 类目, 日常价, 达播价, 佣金, 颜色, 材质(可"0")]
const CHUYU = [
  ['8613041', '针织衫', 179, 159, '20%', '黑色,灰色', '50.8%粘纤 29.8%聚酯纤维 19.4%锦纶'],
  ['8633052', '针织衫', 169, 149, '20%', '深灰色', 0],
  ['8633013', '针织衫', 229, 209, '20%', '薄荷绿,灰色,蓝色', '40.8%粘纤 34.1%锦纶 25.1%聚酯纤维'],
  ['8613049', '针织衫', 169, 149, '20%', '藏青间条,橄榄绿,灰色', '面料：29.2%聚酯纤维 25.9%腈纶 23.3%粘纤 21.6%锦纶'],
  ['8633040', '针织衫', 199, 179, '20%', '灰色,克莱因蓝', '44.8%锦纶 34.7%粘纤 20.5%聚酯纤维'],
  ['8623029', '针织衫', 179, 149, '20%', '天蓝色', '天蓝色：83.0%粘纤 17.0%聚酯纤维'],
  ['8001001', 'T恤', 99, 49, '15%', '白色', '100%棉'],
  ['8001002', '连衣裙', 259, 129, '20%', '杏色', 0],
  ['8001003', '阔腿裤', 199, 99, '20%', '黑色', '100%聚酯纤维'],
  ['8001004', '衬衫', 219, 119, '20%', '雾霾蓝', '70%粘纤 30%聚酯纤维'],
  ['8001005', '针织衫', 289, 159, '20%', '焦糖棕', 0],
  ['8001006', '半身裙', 169, 89, '20%', '酒红', '65%粘纤 35%聚酯纤维']
];
const YINMAN = [
  ['28628324', '配件', 59, 39, 0.2, '天蓝色、浅咖色、米白色、绿色、黄色', '100%粘纤 规格：100cm*42cm'],
  ['18625120', '针织衫', 229, 129, 0.2, '咖色、宝蓝色', '面料：62.5%粘纤 37.5%锦纶'],
  ['18525140H1', '针织衫', 179, 129, 0.2, '多色', 0],
  ['F18627944', '针织衫', 199, 129, 0.2, '米杏色', '面料：66.6%粘纤 33.4%聚酯纤维'],
  ['W18618743', '针织衫', 259, 149, 0.2, '天空蓝、浅米黄', '面料：41.4%聚酯纤维 29.6%锦纶 29.0%粘纤'],
  ['18528632', '针织衫', 239, 169, 0.2, '杏色', '面料：100%腈纶'],
  ['W18525322', '针织衫', 299, 169, 0.2, '星空蓝', '面料：75.0%聚酯纤维 18.5%粘纤 6.5%锦纶'],
  ['9002001', 'T恤', 89, 49, 0.2, '白色、黑色', '100%棉'],
  ['9002002', '连衣裙', 269, 139, 0.2, '浅粉', 0],
  ['9002003', '衬衫', 199, 109, 0.2, '克莱因蓝', '面料：55%粘纤 45%聚酯纤维'],
  ['9002004', '阔腿裤', 189, 99, 0.2, '米白', '100%聚酯纤维'],
  ['9002005', '针织衫', 319, 179, 0.2, '薄荷绿', 0]
];

function writeProducts() {
  const wb = new ExcelJS.Workbook();
  const make = (name, rows) => {
    const ws = wb.addWorksheet(name);
    ws.columns = [
      { header: '款号', key: '款号', width: 14 },
      { header: '类目', key: '类目', width: 10 },
      { header: '日常价', key: '日常价', width: 10 },
      { header: '达播价', key: '达播价', width: 10 },
      { header: '佣金', key: '佣金', width: 8 },
      { header: '颜色', key: '颜色', width: 22 },
      { header: '材质', key: '材质', width: 30 }
    ];
    rows.forEach(r => ws.addRow({ 款号: r[0], 类目: r[1], 日常价: r[2], 达播价: r[3], 佣金: r[4], 颜色: r[5], 材质: r[6] }));
    ws.getRow(1).font = { bold: true };
  };
  make('初语货表', CHUYU);
  make('茵曼货表', YINMAN);
  return wb.xlsx.writeFile(path.join(DATA_DIR, '商品资料表.xlsx'));
}

function writeInventory() {
  const wb = new ExcelJS.Workbook();
  const make = (name, colName, rows) => {
    const ws = wb.addWorksheet(name);
    ws.columns = [{ header: '款号', key: '款号', width: 14 }, { header: colName, key: colName, width: 10 }];
    rows.forEach(r => ws.addRow({ 款号: r[0], [colName]: stockFor(r[0]) }));
    ws.getRow(1).font = { bold: true };
  };
  make('初语库存', '总库存', CHUYU);
  make('茵曼库存', '合计库存', YINMAN);
  return wb.xlsx.writeFile(path.join(DATA_DIR, '库存.xlsx'));
}
// 演示库存：部分 0 / 低位
function stockFor(sn) {
  const low = ['8633052', '8001005', '18525140H1', '9002002'];
  if (sn === '8001002') return 0;
  if (low.includes(sn)) return 6;
  return 100 + (sn.length * 7) % 400;
}

function writeImages() {
  const map = {};
  [...CHUYU, ...YINMAN].forEach(r => {
    const sn = r[0];
    map[sn] = [
      `https://picsum.photos/seed/${sn}-1/600/600`,
      `https://picsum.photos/seed/${sn}-2/600/600`
    ];
  });
  fs.writeFileSync(path.join(DATA_DIR, 'images.json'), JSON.stringify(map, null, 2), 'utf8');
}

(async () => {
  await writeProducts();
  await writeInventory();
  writeImages();
  console.log('示例数据已生成：商品资料表.xlsx / 库存.xlsx（初语 + 茵曼 两个品牌）/ images.json');
})();
