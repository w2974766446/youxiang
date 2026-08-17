# 达人商品选品系统

移动端优先的达人选品工具：像逛淘宝一样浏览商品，按材质/颜色/价格筛选，逐款加入选款清单，一键提交后自动整理成 Excel 表格并发送至指定邮箱。

## 一、功能总览

| 模块 | 能力 |
|------|------|
| 商品浏览 | 双列卡片流，缩略图 + 品牌标识 + 款号 + 日常价/达人价对比 + 库存状态 + 卖点摘要 |
| 品牌区分 | 选品端**顶端品牌切换条**（全部 / 初语 / 茵曼），按品牌重点筛选；卡片/详情/选款清单均带品牌色标识 |
| 排列逻辑 | 列表默认按 **类目（拼音）→ 库存（多→少）** 从顶端到末端排列；排序条可手动切换「综合 / 达人价↑↓ / 库存↑」 |
| 筛选 | 仅两个**可多选**字段：①**类目**（已合并：毛衣/针织衫、风衣/外套、T恤/背心，其余按原类目）；②**价格段**（100元以下 / 100-200元 / 200-300元 / 300元以上）；另支持品牌切换与关键词搜索 |
| 商品详情 | 图片轮播（第三方图源）、规格、双价对比、佣金、库存标注、一键加入/移出选款 |
| 卖点补全 | 原表“精简卖点”缺失的商品，按材质/颜色/品类规则自动生成（前端标“AI补”角标） |
| 选款清单 | 实时增删改查，可为每款填写选款备注；底部栏实时显示已选数量 |
| 一键提交 | 自动汇总为 Excel（含品牌/款号/类目/日常价/达人价/佣金/材质/颜色/卖点/库存/备注），并**同步落盘到本地文件夹**（Excel + HTML 预览），同时进入「选品台后台」汇总（口令可见） |

## 二、目录结构

```
product-selection-system/
├─ server/
│  ├─ index.js            # Express 服务 + REST API
│  └─ lib/
│     ├─ loader.js        # 读取 WPS(xlsx) 基本资料/库存表 + 图片映射
│     ├─ enrich.js        # 卖点自动补全引擎（材质/颜色/品类规则）
│     ├─ excel.js         # 选款 Excel 生成（邮件附件 + 下载）
│     ├─ mailer.js        # 邮件发送（nodemailer + 预览兜底）
│     └─ store.js         # 选款清单内存存储（按会话隔离）
├─ public/                # 移动端前端（原生 HTML/CSS/JS，零构建、加载快）
│  ├─ index.html
│  ├─ css/style.css
│  └─ js/app.js
├─ data/                  # 数据目录（WPS 表格 + 图片映射）
│  ├─ 商品资料表.xlsx       # 商品基本资料（每个工作表=一个品牌，如「初语货表」「茵曼货表」）
│  ├─ 库存.xlsx            # 商品库存（每个工作表=一个品牌，如「初语库存」「茵曼库存」）
│  ├─ images.json         # 款号 -> 图片URL数组
│  ├─ submissions.json    # 选品台后台提交汇总（JSON，重启不丢）
│  └─ exports/            # 每次提交自动生成的选品表格（Excel + HTML 预览）
├─ scripts/gen-sample-data.js  # 生成示例数据（可改为你的真实数据）
├─ .env.example
└─ package.json
```

## 三、快速开始

```bash
cd product-selection-system
npm install                 # 安装 express / exceljs / nodemailer / xlsx
npm run gen-data           # 生成示例数据表与图片映射（首次必需）
npm start                  # 启动服务，默认 http://localhost:3000
```

手机访问：将电脑与手机连同一 WiFi，手机浏览器打开 `http://<电脑内网IP>:3000`。

## 四、数据接入（替换为真实数据）

### 1. 商品基本资料表（商品资料表.xlsx，WPS 直接打开/另存为 .xlsx）
文件中**每个工作表对应一个品牌**（如 `初语货表`、`茵曼货表`）。每个工作表首行表头为：

| 款号 | 类目 | 日常价 | 达播价 | 佣金 | 颜色 | 材质 |
|------|------|--------|--------|------|------|------|

- 工作表名即品牌名（系统自动去掉「货表」后缀识别品牌）；多品牌只需新增工作表。
- 款号为唯一关联键；若没有「精简卖点」列，系统会按材质/颜色/品类自动补全并在前端标注“AI补”。
- 佣金支持 `"20%"` 或 `0.2` 两种写法，加载时统一归一为小数。
- 材质列填 `0` 或为空表示缺失，同样触发自动补全。

### 2. 商品库存表（库存.xlsx）
每个工作表对应一个品牌（如 `初语库存`、`茵曼库存`），首行表头为 `款号` + 库存列（列名可为「总库存」「合计库存」等，系统按“库存”关键词识别）。与基本资料表按款号关联，库存 0 标“缺货”，低于阈值（默认 10）标“紧张”。

### 3. 图片映射（data/images.json）
结构：`{ "8613041": ["https://第三方站点/图1.jpg", "https://.../图2.jpg"] }`。
可直接把第三方商品图 URL 按款号填入；替换后重启服务即可在轮播中展示。未配置时系统用占位图（离线显示款号）。

> 替换真实表格后，用你的文件覆盖 `data/商品资料表.xlsx`、`data/库存.xlsx`、`data/images.json` 并重启服务即可（无需改动其他代码）。

## 五、邮件发送配置

复制 `.env.example` 为 `.env` 并填写 SMTP：

```
SMTP_HOST=smtp.example.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your@mail.com
SMTP_PASS=******
SMTP_FROM=your@mail.com
```

未配置 SMTP 时提交仍会正常进入「选品台后台」并落盘到本地文件夹。

> 若使用企业邮箱（如腾讯/网易），注意开启 SMTP 服务并使用授权码作为 SMTP_PASS。

## 五（续）、选品表格本地文件夹输出

每次达人提交选款后，系统会**自动**将选品表格保存为两份文件到本地目录（无需手动导出）：

- `选款清单_<提交ID>.xlsx` —— 可直接导入 WPS / Excel 的选款明细表
- `选款清单_<提交ID>.html` —— 同名可读网页预览，双击即可查看

默认目录为项目下的 `data/exports/`，可通过 `.env` 的 `OUTPUT_DIR` 修改为任意本地路径（相对项目根目录，或写绝对路径）：

```
# .env
OUTPUT_DIR=data/exports            # 默认：项目内 data/exports
# 也可指定独立目录，例如：
# OUTPUT_DIR=D:/xuankuan/选品导出
```

服务启动时会在日志中打印实际输出目录。后台「导出」操作也会同步把文件写入该目录。

## 六、卖点补全的升级方向

当前为**规则化启发式**（材质/颜色/品类知识库），可在接入图像理解（Vision）模型后升级为“看图补全”：
在 `server/lib/enrich.js` 中把 `enrichSellingPoint` 改为调用视觉模型，对 `images.json` 中的商品图做理解并返回卖点文本即可，接口与返回结构保持不变。

## 七、API 速览

- `GET /api/products?brand=&category=&price=&keyword=&sort=&sessionId=` 商品列表（category/price 为逗号分隔的多选；sort 为空时按 类目→库存 排列）
- `GET /api/filters` 可筛选项（brands / categories 合并类目 / priceSegments 四段价格）
- `GET /api/product/:styleNo` 商品详情（含图片）
- `POST /api/selection/add|remove|note` 选款增删改
- `GET /api/selection?sessionId=` 当前选款清单
- `POST /api/selection/export` 导出 Excel
- `POST /api/selection/submit` 提交并发送邮件
