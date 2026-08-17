// 拦截 getGoodImgList 的请求头与响应体，找出鉴权方式
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ACCOUNT = '13450481627';
const PASSWORD = 'Lhl318951924';
const TARGET = 'https://bi.hmcloud.com.cn/goods/productReorderAnalysis';
const TEST_STYLE = process.argv[2] || '8613041';
const log = (m) => { console.log(m); fs.appendFileSync('scripts/capture.log', m + '\n'); };

(async () => {
  fs.writeFileSync('scripts/capture.log', '');
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  let captured = null;
  page.on('request', async (req) => {
    const u = req.url();
    if (u.includes('getGoodImgList')) {
      const h = req.headers();
      log('=== getGoodImgList REQUEST HEADERS ===');
      log('authorization: ' + (h['authorization'] || h['Authorization'] || '(none)'));
      log('cookie: ' + (h['cookie'] ? h['cookie'].slice(0, 200) : '(none)'));
      log('x-token: ' + (h['x-token'] || '(none)'));
      log('all header keys: ' + Object.keys(h).join(', '));
      captured = h;
    }
  });
  page.on('response', async (res) => {
    const u = res.url();
    if (u.includes('getGoodImgList')) {
      try { const t = await res.text(); log('=== getGoodImgList RESPONSE BODY ==='); log(t.slice(0, 2500)); }
      catch (e) { log('resp read err ' + e.message); }
    }
  });

  await page.goto(TARGET, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('#form_item_username', { timeout: 15000 });
  await page.type('#form_item_username', ACCOUNT);
  await page.type('#form_item_password', PASSWORD);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('立即登录')); if (b) b.click(); });
  await page.waitForFunction(() => location.hostname === 'bi.hmcloud.com.cn', { timeout: 20000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 2000));

  // 触发搜索
  await page.evaluate((style) => {
    const inp = [...document.querySelectorAll('input')].find(i => (i.placeholder || '').includes('款号'));
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inp, style); inp.dispatchEvent(new Event('input', { bubbles: true }));
  }, TEST_STYLE);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '查看单款'); if (b) b.click(); });
  await new Promise(r => setTimeout(r, 4000));

  // 保存 token 供后续批量使用
  if (captured) {
    const auth = captured['authorization'] || captured['Authorization'];
    const cookie = captured['cookie'];
    fs.writeFileSync('scripts/auth.json', JSON.stringify({ authorization: auth || '', cookie: cookie || '', xToken: captured['x-token'] || '' }, null, 2));
    log('auth saved. authorization=' + (auth ? auth.slice(0, 30) + '...' : '(none)'));
  }
  await browser.close();
  log('== done ==');
})().catch(e => { log('FATAL ' + e.stack); process.exit(1); });
