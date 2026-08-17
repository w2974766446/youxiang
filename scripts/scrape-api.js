// 登录后直接调图片列表 API，看清返回结构并取出 cookie
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ACCOUNT = '13450481627';
const PASSWORD = 'Lhl318951924';
const TARGET = 'https://bi.hmcloud.com.cn/goods/productReorderAnalysis';
const TEST_STYLE = process.argv[2] || '8613041';
const log = (m) => { console.log(m); fs.appendFileSync('scripts/api.log', m + '\n'); };

(async () => {
  fs.writeFileSync('scripts/api.log', '');
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.goto(TARGET, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('#form_item_username', { timeout: 15000 });
  await page.type('#form_item_username', ACCOUNT);
  await page.type('#form_item_password', PASSWORD);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('立即登录')); if (b) b.click(); });
  await page.waitForFunction(() => location.hostname === 'bi.hmcloud.com.cn', { timeout: 20000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 2000));

  // 取 cookie 字符串
  const cookies = await page.cookies();
  const cookieStr = cookies.map(c => c.name + '=' + c.value).join('; ');
  fs.writeFileSync('scripts/cookies.txt', cookieStr);
  log('cookies saved, count=' + cookies.length);

  // 在页面上下文调用图片列表 API
  const apiRes = await page.evaluate(async (style) => {
    const r = await fetch('/api/v1/hmc-bi/common/getGoodImgList?productSn=' + style, { credentials: 'include' });
    const txt = await r.text();
    return { status: r.status, body: txt };
  }, TEST_STYLE);
  log('getGoodImgList status=' + apiRes.status);
  log('getGoodImgList body: ' + apiRes.body.slice(0, 2000));

  // 也看看 productInfo 是否含图
  const infoRes = await page.evaluate(async (style) => {
    const r = await fetch('/api/v1/hmc-bi/goods/productAnalysis/productInfo?productSn=' + style, { credentials: 'include' });
    return { status: r.status, body: await r.text() };
  }, TEST_STYLE);
  log('productInfo status=' + infoRes.status);
  log('productInfo body: ' + infoRes.body.slice(0, 1200));

  await browser.close();
  log('== done ==');
})().catch(e => { log('FATAL ' + e.stack); process.exit(1); });
