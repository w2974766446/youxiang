// 批量抓取全部商品图片：登录取 token -> Node 调 getGoodImgList -> 写 images.json
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ACCOUNT = '13450481627';
const PASSWORD = 'Lhl318951924';
const TARGET = 'https://bi.hmcloud.com.cn/goods/productReorderAnalysis';
const API = 'https://bi.hmcloud.com.cn/api/v1/hmc-bi/common/getGoodImgList';
const LIMIT = process.argv[2] ? parseInt(process.argv[2]) : 99999;

const log = (m) => { console.log(m); fs.appendFileSync('scripts/batch.log', m + '\n'); };

function getTokenFromPage(page) {
  return new Promise((resolve) => {
    const handler = (req) => {
      const u = req.url();
      if (u.includes('getGoodImgList')) {
        const h = req.headers();
        const t = h['authorization'] || h['Authorization'];
        if (t) { page.off('request', handler); resolve(t); }
      }
    };
    page.on('request', handler);
    setTimeout(() => resolve(null), 15000);
  });
}

(async () => {
  fs.writeFileSync('scripts/batch.log', '');
  const data = require('../public/build/data.json');
  const styles = [...new Set(data.map(p => p.styleNo))].filter(Boolean);
  log('total unique styles: ' + styles.length + ' | limit: ' + LIMIT);
  const stylesToDo = styles.slice(0, LIMIT);

  // 1) 登录并取 token
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const tokenP = getTokenFromPage(page);
  await page.goto(TARGET, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('#form_item_username', { timeout: 15000 });
  await page.type('#form_item_username', ACCOUNT);
  await page.type('#form_item_password', PASSWORD);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('立即登录')); if (b) b.click(); });
  await page.waitForFunction(() => location.hostname === 'bi.hmcloud.com.cn', { timeout: 20000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 1500));
  // 触发一次搜索以拿到 token
  await page.evaluate((style) => {
    const inp = [...document.querySelectorAll('input')].find(i => (i.placeholder || '').includes('款号'));
    if (inp) { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; s.call(inp, style); inp.dispatchEvent(new Event('input', { bubbles: true })); }
  }, stylesToDo[0]);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '查看单款'); if (b) b.click(); });
  const token = await tokenP;
  log('TOKEN: ' + (token ? token.slice(0, 20) + '...' : '(null)'));
  await browser.close();
  if (!token) { log('FATAL: no token'); process.exit(1); }

  // 2) Node 批量调接口
  const map = {};
  let ok = 0, empty = 0, fail = 0;
  for (let i = 0; i < stylesToDo.length; i++) {
    const sn = stylesToDo[i];
    try {
      const r = await fetch(API + '?productSn=' + encodeURIComponent(sn), {
        headers: { authorization: token, 'system-code': 'BI', Accept: 'application/json' }
      });
      const j = await r.json();
      if (j.success && Array.isArray(j.data) && j.data.length) {
        map[sn] = j.data;
        ok++;
      } else if (j.data && j.data.length === 0) { empty++; }
      else { fail++; log('  no-data ' + sn + ' ' + (j.message || '')); }
    } catch (e) { fail++; if (i < 10) log('  err ' + sn + ' ' + e.message); }
    if ((i + 1) % 20 === 0) log('progress ' + (i + 1) + '/' + stylesToDo.length + ' ok=' + ok + ' empty=' + empty + ' fail=' + fail);
    await new Promise(r => setTimeout(r, 120)); // 轻量限速，避免被封
  }
  log('DONE ok=' + ok + ' empty=' + empty + ' fail=' + fail + ' totalMapped=' + Object.keys(map).length);
  fs.writeFileSync('data/images.json', JSON.stringify(map, null, 2));
  log('written data/images.json');
})().catch(e => { log('FATAL ' + e.stack); process.exit(1); });
