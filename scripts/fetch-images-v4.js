/**
 * BI 图片抓取 v4 - 轮播版
 * 登录 -> 单品分析 -> 输入款号 -> 点查看单款 ->
 *   点击主图区域/缩略图/箭头 切换轮播 -> 每次切换后抓取新图
 * 目标：每款抓满 5 张商品图
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

// 需要补图的 31 个茵曼款号
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
  console.log('\n=== 登录 ===');
  await page.goto('https://bi.hmcloud.com.cn', { waitUntil: 'networkidle2', timeout: TIMEOUT });
  await sleep(2000);
  const inputs = await page.$$('input');
  if (inputs.length >= 1) { await inputs[0].click({ clickCount: 3 }); await inputs[0].type(BI_USER, { delay: 50 }); }
  await sleep(400);
  if (inputs.length >= 2) { await inputs[1].click({ clickCount: 3 }); await inputs[1].type(BI_PASS, { delay: 30 }); }
  await sleep(400);
  await page.keyboard.press('Enter');
  await sleep(6000);
  const ok = !/账号登录|立即登录|密码错误|验证码/.test(
    await page.evaluate(() => document.body.innerText.substring(0, 200))
  );
  console.log(ok ? '登录成功' : '登录失败');
  return ok;
}

/**
 * 从当前页面提取所有商品图片 URL（去重）
 * 排除：logo、icon、avatar、data URI、太小的图
 */
async function extractProductImages(page) {
  return await page.evaluate(() => {
    const seen = new Set();
    const imgs = [];

    // 1. 所有 img 标签
    document.querySelectorAll('img[src]').forEach(img => {
      const src = img.src || '';
      if (!src || seen.has(src)) return;
      if (src.startsWith('data:') || src.startsWith('blob:')) return;
      if (/logo|icon|avatar|loading|empty|placeholder|spinner/i.test(src)) return;
      if (img.naturalWidth < 80) return; // 太小不是商品图
      seen.add(src);
      imgs.push({ src, w: img.naturalWidth, h: img.naturalHeight });
    });

    // 2. background-image（排除 data URI）
    document.querySelectorAll('*').forEach(el => {
      const bg = getComputedStyle(el).backgroundImage;
      if (!bg || bg === 'none') return;
      const m = bg.match(/url\(["']?(.*?)["']?\)/);
      if (!m || !m[1]) return;
      const url = m[1];
      if (seen.has(url) || url.startsWith('data:') || /^[\w-]+:/i.test(url) === false) return;
      // 检查是否是图片 URL
      if (/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(url) || /\/media\//i.test(url) || /\/image\//i.test(url)) {
        seen.add(url);
        imgs.push({ src: url, w: el.clientWidth, h: el.clientHeight, isBg: true });
      }
    });

    return imgs;
  });
}

/**
 * 尝试在详情弹窗中通过多种方式切换到下一张图
 * 返回是否成功切换（图片 URL 是否变化）
 */
async function trySwitchImage(page, prevSrcSet) {
  const strategies = [
    // 策略1: 点击主商品图（可能打开灯箱或切换轮播）
    async () => {
      const clicked = await page.evaluate(() => {
        const imgs = [...document.querySelectorAll('img[src]')]
          .filter(i => i.naturalWidth > 100 && i.offsetParent !== null)
          .filter(i => !/logo/i.test(i.alt || '') && !/logo/i.test(i.src))
          .sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight));
        if (imgs[0]) { imgs[0].click(); return true; }
        return false;
      });
      return clicked;
    },
    // 策略2: 点击弹窗内任何可能的"下一张"箭头/按钮
    async () => {
      const clicked = await page.evaluate(() => {
        // 找 next/arrow-right/chevron-right 类的元素
        const els = [...document.querySelectorAll('*')].filter(el =>
          el.offsetParent !== null &&
          /next|arrow|chevron|right|forward|>|›|»/i.test(el.className || '') &&
          el.children.length <= 2
        );
        if (els.length) { els[0].click(); return true; }
        return false;
      });
      return clicked;
    },
    // 策略3: 点击弹窗内的缩略图（第2、3、4、5个可见的小图）
    async () => {
      const clicked = await page.evaluate(() => {
        // 在弹窗范围内找所有较小的 img（可能是缩略图）
        const modals = document.querySelectorAll('[class*="Modal"], [class*="modal"], [role="dialog"]');
        let thumbs = [];
        modals.forEach(m => {
          m.querySelectorAll('img[src]').forEach(img => {
            if (img.naturalWidth > 50 && img.naturalWidth < 200 && img.offsetParent !== null) {
              thumbs.push(img);
            }
          });
        });
        // 如果没找到弹窗内的，就找全页面的小图
        if (!thumbs.length) {
          thumbs = [...document.querySelectorAll('img[src]')]
            .filter(i => i.naturalWidth > 50 && i.naturalWidth < 200 && i.offsetParent !== null)
            .slice(1, 6); // 跳过第一张（主图），取后面的作为缩略图
        }
        if (thumbs.length) { thumbs[0].click(); return true; }
        return false;
      });
      return clicked;
    },
    // 策略4: 按 → 键
    async () => {
      await page.keyboard.press('ArrowRight');
      return true;
    },
    // 策略5: 点击主图右侧区域（可能有隐藏的下一张按钮）
    async () => {
      const clicked = await page.evaluate(() => {
        const mainImg = [...document.querySelectorAll('img[src]')]
          .filter(i => i.naturalWidth > 100 && i.offsetParent !== null)
          .filter(i => !/logo/i.test(i.alt || ''))
          .sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))[0];
        if (!mainImg) return false;
        const rect = mainImg.getBoundingClientRect();
        // 点击主图右半边
        const evt = new MouseEvent('click', {
          clientX: rect.right - 10,
          clientY: rect.top + rect.height / 2,
          bubbles: true
        });
        mainImg.dispatchEvent(evt);
        // 也尝试在主图位置右半边做 elementFromPoint
        const el = document.elementFromPoint(rect.right - 10, rect.top + rect.height / 2);
        if (el && el !== mainImg) { el.click(); return true; }
        return false;
      });
      return clicked;
    },
  ];

  for (let i = 0; i < strategies.length; i++) {
    try {
      await strategies[i]();
      await sleep(1500);
      const currentImgs = await extractProductImages(page);
      const currentSrcs = new Set(currentImgs.map(x => x.src));
      // 检查是否有新的图片 URL 出现
      const hasNew = currentImgs.some(img => !prevSrcSet.has(img.src));
      if (hasNew) {
        return { switched: true, images: currentImgs, strategy: i };
      }
    } catch(e) {}
  }

  return { switched: false, images: await extractProductImages(page), strategy: -1 };
}

async function main() {
  console.log(`=== BI 图片抓取 v4 (轮播版) ===`);
  console.log(`目标: ${MISSING_STYLES.length} 个款号，每款最多 5 张`);

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: false,
    userDataDir: USER_DATA_DIR,
    defaultViewport: null,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setDefaultTimeout(TIMEOUT);

  if (!await login(page)) { await browser.close(); return; }

  // 进入单品分析
  console.log('\n进入单品分析...');
  await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: TIMEOUT });
  await sleep(4000);
  await page.evaluate(() => {
    for (const el of [...document.querySelectorAll('*')]) {
      if (/单品分析/.test(el.textContent || '') && el.offsetParent !== null && el.children.length <= 3) { el.click(); return; }
    }
  });
  await sleep(2000);

  const imgDir = path.join(DATA_DIR, 'images');
  fs.mkdirSync(imgDir, { recursive: true });

  const results = {};

  for (let i = 0; i < MISSING_STYLES.length; i++) {
    const sn = MISSING_STYLES[i];
    console.log(`\n[${i + 1}/${MISSING_STYLES.length}] ${sn}`);

    try {
      // 输入款号
      await page.evaluate((s) => {
        const inp = [...document.querySelectorAll('input')].find(i =>
          i.offsetParent !== null && /请输入款号/.test(i.placeholder || '')
        );
        if (inp) {
          inp.focus(); inp.value = '';
          inp.value = s;
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, sn);
      await sleep(800);

      // 点击查看单款
      await page.evaluate(() => {
        for (const b of [...document.querySelectorAll('button, [role=button], .ant-btn')]) {
          if ((b.textContent || '').trim() === '查看单款' && b.offsetParent !== null) { b.click(); return; }
        }
      });
      await sleep(6000); // 等详情加载

      // 收集所有图片（尝试多次切换轮播）
      const allUrls = new Set();
      const allFiles = [];
      let attempts = 0;
      const maxAttempts = 8; // 最多尝试切换 8 次

      while (attempts < maxAttempts) {
        const currentImgs = await extractProductImages(page);
        let newCount = 0;
        currentImgs.forEach(img => {
          if (!allUrls.has(img.src)) {
            allUrls.add(img.src);
            newCount++;
          }
        });

        if (newCount > 0 || attempts === 0) {
          console.log(`  第${attempts + 1}次扫描: 发现 ${currentImgs.length} 个img标签, 累计唯一URL: ${allUrls.size}`);
        }

        if (allUrls.size >= 5) break; // 已凑够 5 张

        // 尝试切换
        const { switched } = await trySwitchImage(page, allUrls);
        if (!switched && attempts > 2) break; // 连续几次切不动就放弃
        attempts++;
        await sleep(1200);
      }

      const urls = [...allUrls].slice(0, 5);
      if (!urls.length) {
        results[sn] = { error: '无图片' };
        console.log('  ✗ 无图片');
      } else {
        console.log(`  共获取 ${urls.length} 个唯一图片URL`);
        // 下载
        for (let j = 0; j < urls.length; j++) {
          const ext = (urls[j].match(/\.(jpg|jpeg|png|webp)(\?|$)/i) || ['', '.jpg'])[1]
            .replace('jpeg', 'jpg').replace(/^$/, '.jpg');
          const f = path.join(imgDir, `${sn}_${j + 1}${ext}`);
          try {
            await downloadImage(urls[j], f);
            allFiles.push(f);
            console.log(`    ✓ ${path.basename(f)} (${fs.statSync(f).size}B)`);
          } catch(e) {
            console.log(`    ✗ ${e.message.substring(0, 60)}`);
          }
        }
        results[sn] = { count: allFiles.length, urls, files: allFiles };
      }

      // 回到单品分析主页
      await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: TIMEOUT });
      await sleep(2500);
      await page.evaluate(() => {
        for (const el of [...document.querySelectorAll('*')]) {
          if (/单品分析/.test(el.textContent || '') && el.offsetParent !== null && el.children.length <= 3) { el.click(); return; }
        }
      });
      await sleep(1500);

    } catch(e) {
      results[sn] = { error: e.message.substring(0, 120) };
      console.log(`  ✗ ${results[sn].error}`);
    }
  }

  // 汇总
  console.log('\n\n========== 抓取结果 ==========');
  let succ = 0, fail = 0, totalImages = 0;
  Object.entries(results).forEach(([sn, r]) => {
    if (r.error) { fail++; console.log(`  ${sn}: ✗ ${r.error}`); }
    else { succ++; totalImages += r.count; console.log(`  ${sn}: ✓ ${r.count}张`); }
  });
  console.log(`成功:${succ} 失败:${fail} 总图片:${totalImages}`);

  fs.writeFileSync(path.join(DATA_DIR, '_fetch_v4_results.json'), JSON.stringify(results, null, 2));

  // 更新 images.json（只保留真商品图，过滤 logo）
  let imgs = {};
  try { imgs = JSON.parse(fs.readFileSync(IMAGES_FILE, 'utf8')); } catch(e) {}
  let u = 0;
  Object.entries(results).forEach(([sn, r]) => {
    if (!r.error && r.urls && r.urls.length) {
      // 过滤掉 logo 图（通常很小或包含 logo 关键字）
      const cleanUrls = r.urls.filter(u => !/logo\.png$/i.test(u.split('?')[0]));
      if (cleanUrls.length) { imgs[sn] = cleanUrls; u++; }
    }
  });
  fs.writeFileSync(IMAGES_FILE, JSON.stringify(imgs, null, 2));
  console.log(`\nimages.json 已更新 ${u} 个款号`);

  await browser.close();
}
main().catch(e => { console.error('致命:', e); process.exit(1); });
