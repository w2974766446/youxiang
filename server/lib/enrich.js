/**
 * 卖点自动补全引擎
 * 规则（按优先级）：
 *  1) 源表「卖点精简」列有内容 → 直接采用（enriched=false）。
 *  2) 源表缺失 → 按「面料优点 + 版型概括 + 设计特点」三段式生成，
 *     基于 材质 / 颜色 / 品类 推理，不单独描述材质成分。
 * 说明：当前为规则启发式实现；接入图像理解(Vision)模型后可真正“看”商品图。
 */

// 面料优点（由材质成分推导，描述面料手感/功能，而非成分本身）
const MATERIAL_BENEFIT = {
  '纯棉': '纯棉亲肤透气',
  '棉': '棉质亲肤舒适',
  '涤纶': '涤纶挺括不易皱',
  '聚酯纤维': '聚酯纤维挺括耐穿',
  '雪纺': '雪纺轻盈飘逸',
  '真丝': '真丝柔滑清凉',
  '羊毛': '羊毛保暖亲肤',
  '绵羊毛': '羊毛保暖亲肤',
  '牛仔': '牛仔耐磨硬朗',
  '亚麻': '亚麻清爽透气',
  '莱卡': '莱卡弹力贴身',
  '莫代尔': '莫代尔柔软顺滑',
  '粘纤': '粘纤垂顺亲肤',
  '锦纶': '锦纶耐磨有弹力',
  '腈纶': '腈纶蓬松保暖',
  '再生纤维素纤维': '再生纤维素纤维柔滑透气',
  '粘胶': '粘胶垂顺亲肤'
};

// 颜色 / 设计特点
const COLOR_BENEFIT = {
  '白': '白色清爽百搭',
  '黑': '黑色显瘦百搭',
  '灰': '灰色高级耐看',
  '杏': '杏色温柔气质',
  '蓝': '蓝色干净显白',
  '绿': '绿色清新活力',
  '红': '红色复古显气色',
  '粉': '粉色甜美减龄',
  '咖': '咖色复古温暖',
  '米': '米色温柔气质',
  '黄': '黄色明亮活泼',
  '紫': '紫色浪漫高级',
  '克莱因蓝': '克莱因蓝高级显白',
  '薄荷绿': '薄荷绿清新减龄',
  '藏青': '藏青沉稳百搭'
};

// 版型概括（由品类推导，描述廓形/穿着效果）
const SILHOUETTE_BENEFIT = {
  '连衣裙': '收腰显瘦版型',
  '裙': '高腰显比例版型',
  'T恤': '基础修身版型',
  '背心': '简约无袖版型',
  '吊带': '简约无袖版型',
  '衬衫': '利落通勤版型',
  '针织': '柔软慵懒版型',
  '毛衣': '柔软慵懒版型',
  '风衣': '挺括有型版型',
  '外套': '挺括有型版型',
  '裤': '修饰腿型版型',
  '阔腿': '阔腿遮肉版型'
};

function matchBenefit(dict, key) {
  if (!key) return '';
  if (dict[key]) return dict[key];
  // 模糊匹配：材质/颜色/类目可能带前缀或同义写法
  for (const k of Object.keys(dict)) {
    if (key.includes(k)) return dict[k];
  }
  return '';
}

/**
 * 返回 { text, enriched }
 *  - enriched=true 表示由系统补全（原表缺失）
 */
function enrichSellingPoint(p) {
  // 1) 源表卖点优先
  if (p.sellingPoint) return { text: p.sellingPoint, enriched: false };

  // 2) 兜底：面料优点 + 版型概括 + 设计特点（不单独描述材质成分）
  const parts = [];
  const mb = matchBenefit(MATERIAL_BENEFIT, p.material);      // 面料优点
  const sb = matchBenefit(SILHOUETTE_BENEFIT, p.categoryGroup || p.category); // 版型概括
  const cb = matchBenefit(COLOR_BENEFIT, p.color);            // 设计特点

  if (mb) parts.push(mb);
  if (sb) parts.push(sb);
  if (cb) parts.push(cb);
  if (parts.length === 0) parts.push('优质面料做工精细，版型利落好搭配');

  let text = parts.join('，');
  if (!text.endsWith('。')) text += '。';
  return { text, enriched: true };
}

module.exports = { enrichSellingPoint };
