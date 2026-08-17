// 探查 HMC BI 单品分析页：登录 + 找图片接口/DOM
const puppeteer = require('puppeteer-core');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ACCOUNT = '13450481627';
const PASSWORD = 'Lhl318951924';
const TARGET = 'https://bi.hmcloud.com.cn/goods/productReorderAnalysis';
const TEST_STYLE = '8613041';

const fs = require('fs');
const out = (m) => { console.log(m); fs.appendFileSync('scripts/discover.log', m + '\n'); };

(async () => {
  fs.writeFileSync('scripts/discover.log', '');
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  const reqs = [];
  page.on('request', (r) => {
    const u = r.url();
    if (/goods|product|image|img|pic|photo|file|upload|oss|cdn/i.test(u)) reqs.push(u);
  });
  page.on('response', (r) => {
    const u = r.url();
    if (/goods|product|image|img|pic|photo/i.test(u)) {
      out(`RESP ${r.status()} ${u}`);
    }
  });
  page.on('console', (msg) => out('PAGE-LOG: ' + msg.text()));

  out('== goto target ==');
  await page.goto(TARGET, { waitUntil: 'networkidle2', timeout: 30000 }).catch(e => out('goto err: ' + e.message));
  await new Promise(r => setTimeout(r, 1500));
  const url1 = page.url();
  out('URL after goto: ' + url1);
  const html1 = await page.content();
  out('--- login page snippet (first 1500 chars) ---');
  out(html1.slice(0, 1500));
  // 在登录页找表单
  const loginInfo = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('input')].map(i => ({ type: i.type, name: i.name, id: i.id, placeholder: i.placeholder, autocomplete: i.autocomplete }));
    const btns = [...document.querySelectorAll('button, a.btn, .login-btn, [class*="login"]')].slice(0, 10).map(b => ({ tag: b.tagName, text: b.textContent.trim().slice(0, 30), cls: b.className }));
    return { title: document.title, inputs, btns, bodyText: document.body.innerText.slice(0, 300) };
  });
  out('LOGIN inputs: ' + JSON.stringify(loginInfo.inputs));
  out('LOGIN btns: ' + JSON.stringify(loginInfo.btns));
  out('LOGIN bodyText: ' + loginInfo.bodyText);

  fs.writeFileSync('scripts/login_page.html', html1);
  await browser.close();
  out('== done discovery (login page) ==');
  out('Candidate API/asset URLs captured: ' + reqs.length);
  reqs.slice(0, 40).forEach(u => out('  REQ ' + u));
})().catch(e => { out('FATAL ' + e.stack); process.exit(1); });
