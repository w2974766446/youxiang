/**
 * 从汇美云 BI 单品分析批量抓取商品图片 v3
 * 流程：登录 -> 单品分析页 -> 输入款号 -> 点"查看单款" -> 提取左上角 5 张图
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const DATA_DIR = path.join(__dirname, '..', 'data');
const IMAGES_FILE = path.join(DATA_DIR, 'images.json');
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const USER_DATA_DIR = path.join(__dirname, '..', '.browser_profile_bi2');
const TARGET_URL = 'https://bi.hmcloud.com.cn/goods/productReorderAnalysis';
const TIMEOUT = 45000;
const BI_USER = '13450481627';
const BI_PASS = 'Lhl318951924';

// 需要补图的款号（31个茵曼新上架但缺图的）
const MISSING_STYLES = [
  '1863001','18637120','18424160','18637636','18637052','18637538',
  '18637466','18637053','K18637810','W18637136','18637010','K18637369',
  '18637184','18637068','18637470','18637254','18637359','18637241',
  '18637350','18637126','18637605','18637208','18637183','18637091',
  'W18637334','F18637789','18637537','18637637','18637021','18637539',
  '18637344'
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function downloadImage(url, dest) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { timeout: TIMEOUT }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadImage(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(dest); });
    }).on('error', reject);
    req.setTimeout(TIMEOUT, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function login(page) {
  console.log('\n=== 登录汇美云BI ===');
  await page.goto('https://bi.hmcloud.com.cn', { waitUntil: 'networkidle2', timeout: TIMEOUT });
  await sleep(2000);
  const inputs = await page.$$('input');
  if (inputs.length >= 1) { await inputs[0].click({ clickCount: 3 }); await inputs[0].type(BI_USER, { delay: 50 }); }
  await sleep(400);
  if (inputs.length >= 2) { await inputs[1].click({ clickCount: 3 }); await inputs[1].type(BI_PASS, { delay: 30 }); }
  await sleep(400);
  await page.keyboard.press('Enter');
  await sleep(6000);
  const text = await page.evaluate(() => document.body.innerText.substring(0, 200));
  if (/账号登录|立即登录|密码错误|验证码/.test(text)) {
    console.log('登录失败，页面仍在登录态:', text.substring(0, 100));
    return false;
  }
  console.log('登录成功');
  return true;
}

async function main() {
  console.log(`=== BI 图片抓取 v3 ===`);
  console.log(`目标: ${MISSING_STYLES.length} 个款号`);

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: false,
    userDataDir: USER_DATA_DIR,
    defaultViewport: null,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setDefaultTimeout(TIMEOUT);

  // 登录
  if (!await login(page)) { await browser.close(); return; }

  // 进入单品分析页面
  console.log('\n进入单品分析...');
  await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: TIMEOUT });
  await sleep(4000);

  // 点击"单品分析"标签（确保在正确 tab 上）
  await page.evaluate(() => {
    const els = [...document.querySelectorAll('*')];
    for (const el of els) {
      if (/单品分析/.test(el.textContent || '') && el.offsetParent !== null && el.children.length <= 3) {
        el.click(); return;
      }
    }
  });
  await sleep(2000);

  // 图片保存目录
  const imgDir = path.join(DATA_DIR, 'images');
  fs.mkdirSync(imgDir, { recursive: true });

  const results = {};

  for (let i = 0; i < MISSING_STYLES.length; i++) {
    const sn = MISSING_STYLES[i];
    console.log(`\n[${i + 1}/${MISSING_STYLES.length}] ${sn}`);

    try {
      // 步骤1: 找到 placeholder="请输入款号" 的输入框并填入款号
      const filled = await page.evaluate((s) => {
        const inp = [...document.querySelectorAll('input')].find(i =>
          i.offsetParent !== null && /请输入款号/.test(i.placeholder || '')
        );
        if (!inp) return false;
        inp.focus();
        inp.value = '';
        inp.value = s;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }, sn);

      if (!filled) {
        results[sn] = { error: '找不到搜索框' };
        console.log('  ✗ 找不到搜索框');
        continue;
      }
      await sleep(800);

      // 步骤2: 点击"查看单款"按钮（蓝色按钮）
      const clicked = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('button, [role=button], .ant-btn')];
        for (const b of btns) {
          if ((b.textContent || '').trim() === '查看单款' && b.offsetParent !== null) {
            b.click(); return true;
          }
        }
        return false;
      });
      if (!clicked) {
        results[sn] = { error: '找不到查看单款按钮' };
        console.log('  ✗ 找不到查看单款按钮');
        continue;
      }
      console.log('  已点击查看单款...');

      // 步骤3: 等待详情加载
      await sleep(6000);

      // 截图用于调试（仅保留最后一张）
      await page.screenshot({ path: path.join(DATA_DIR, `_detail_${sn}.png`) });

      // 步骤4: 提取图片 URL（最多 5 张产品图）
      const images = await page.evaluate(() => {
        const seen = new Set();
        const imgs = [];
        // 收集所有可见的 img 标签
        document.querySelectorAll('img[src]').forEach(img => {
          const src = img.src || '';
          if (!src || seen.has(src)) return;
          if (src.startsWith('data:') || src.startsWith('blob:')) return;
          if (img.naturalWidth < 80) return; // 太小的不是商品图
          if (/logo|icon|avatar|loading|empty|placeholder|spinner/i.test(src)) return;
          seen.add(src);
          imgs.push(src);
        });
        // 也收集 background-image
        document.querySelectorAll('[style*="background"]').forEach(el => {
          const m = el.style.backgroundImage.match(/url\(["']?(.*?)["']?\)/);
          if (!m || !m[1]) return;
          const url = m[1];
          if (seen.has(url) || url.startsWith('data:')) return;
          seen.add(url);
          imgs.push(url);
        });
        return imgs.slice(0, 8); // 多取几张备用
      });

      if (!images.length) {
        results[sn] = { error: '无图片' };
        console.log('  ✗ 无图片');
        continue;
      }
      console.log(`  发现 ${images.length} 个候选图`);

      // 步骤5: 下载前 5 张
      const files = [];
      for (let j = 0; j < Math.min(images.length, 5); j++) {
        const ext = (images[j].match(/\.(jpg|jpeg|png|webp)(\?|$)/i) || ['', '.jpg'])[1]
          .replace('jpeg', 'jpg').replace(/^$/, '.jpg');
        const f = path.join(imgDir, `${sn}_${j + 1}${ext}`);
        try {
          await downloadImage(images[j], f);
          files.push(f);
          console.log(`    ✓ ${path.basename(f)} (${fs.statSync(f).size}B)`);
        } catch (e) {
          console.log(`    ✗ ${e.message.substring(0, 60)}`);
        }
      }

      results[sn] = { count: files.length, urls: images.slice(0, files.length), files };

      // 回到单品分析主页（准备下一个款号）
      await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: TIMEOUT });
      await sleep(2500);
      // 重新点单品分析标签
      await page.evaluate(() => {
        const els = [...document.querySelectorAll('*')];
        for (const el of els) {
          if (/单品分析/.test(el.textContent || '') && el.offsetParent !== null && el.children.length <= 3) {
            el.click(); return;
          }
        }
      });
      await sleep(1500);

    } catch (e) {
      results[sn] = { error: e.message.substring(0, 120) };
      console.log(`  ✗ ${results[sn].error}`);
    }
  }

  // 汇总
  console.log('\n\n========== 抓取结果 ==========');
  let succ = 0, fail = 0;
  Object.entries(results).forEach(([sn, r]) => {
    if (r.error) { fail++; console.log(`  ${sn}: ✗ ${r.error}`); }
    else { succ++; console.log(`  ${sn}: ✓ ${r.count}张`); }
  });
  console.log(`成功:${succ} 失败:${fail}`);

  fs.writeFileSync(path.join(DATA_DIR, '_fetch_results.json'), JSON.stringify(results, null, 2));

  // 更新 images.json
  let imgs = {};
  try { imgs = JSON.parse(fs.readFileSync(IMAGES_FILE, 'utf8')); } catch (e) {}
  let u = 0;
  Object.entries(results).forEach(([sn, r]) => {
    if (!r.error && r.urls && r.urls.length) {
      imgs[sn] = r.urls;
      u++;
    }
  });
  fs.writeFileSync(IMAGES_FILE, JSON.stringify(imgs, null, 2));
  console.log(`\nimages.json 已更新 ${u} 个款号`);

  await browser.close();
}
main().catch(e => { console.error('致命:', e); process.exit(1); });
