// 登录 HMC BI -> 单品分析 -> 搜索测试款号 -> 提取5张图（修正版）
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ACCOUNT = '13450481627';
const PASSWORD = 'Lhl318951924';
const TARGET = 'https://bi.hmcloud.com.cn/goods/productReorderAnalysis';
const TEST_STYLE = process.argv[2] || '8613041';
const log = (m) => { console.log(m); fs.appendFileSync('scripts/detail.log', m + '\n'); };

(async () => {
  fs.writeFileSync('scripts/detail.log', '');
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.on('response', (r) => { const u = r.url(); if (/goods|product|single|analysis|img|pic|image|style/i.test(u)) log('RESP ' + r.status() + ' ' + u.slice(0, 160)); });

  await page.goto(TARGET, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('#form_item_username', { timeout: 15000 });
  await page.type('#form_item_username', ACCOUNT);
  await page.type('#form_item_password', PASSWORD);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('立即登录')); if (b) b.click(); });
  await page.waitForFunction(() => location.hostname === 'bi.hmcloud.com.cn', { timeout: 20000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 2500));
  log('URL after login: ' + page.url());

  // 填款号（用 placeholder 定位，无 id/name）
  const filled = await page.evaluate((style) => {
    const inp = [...document.querySelectorAll('input')].find(i => (i.placeholder || '').includes('款号'));
    if (!inp) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inp, style);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, TEST_STYLE);
  log('filled style input: ' + filled + ' value=' + TEST_STYLE);

  // 点“查看单款”
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '查看单款'); if (b) b.click(); });
  log('clicked 查看单款');
  await new Promise(r => setTimeout(r, 4000));

  // 提取图片：含详情容器上下文
  const result = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('img')].map(img => ({
      src: img.src, alt: img.alt, w: img.naturalWidth, h: img.naturalHeight,
      cls: img.className.toString().slice(0, 100),
      parentCls: (img.parentElement ? img.parentElement.className.toString().slice(0, 80) : '')
    }));
    // 商品图：来自 img.hmcloud / oss / 或非 base64 且尺寸较大
    const productImgs = imgs.filter(i => i.src && i.src.startsWith('http') && /img\.hmcloud|oss|pic|goods|product|upload|aliyuncs/i.test(i.src) && i.w > 60);
    const dataImgs = imgs.filter(i => i.src && i.src.startsWith('data:image'));
    return { totalImgs: imgs.length, productImgs, dataImgsCount: dataImgs.length, allSrcs: imgs.map(i => i.src).slice(0, 20) };
  });
  log('TOTAL imgs: ' + result.totalImgs);
  log('PRODUCT imgs (' + result.productImgs.length + '):');
  result.productImgs.forEach((i, n) => log('  [' + n + '] ' + i.w + 'x' + i.h + ' ' + i.src.slice(0, 140)));
  log('data:image count: ' + result.dataImgsCount);
  log('ALL srcs sample: ' + JSON.stringify(result.allSrcs));
  fs.writeFileSync('scripts/detail_page.html', await page.content());
  await browser.close();
  log('== done ==');
})().catch(e => { log('FATAL ' + e.stack); process.exit(1); });
