# 🔥 每日热搜早报

把微博、百度、知乎、抖音、今日头条等平台的实时热榜，加上 HuggingFace 论文、各家 AI 官方博客、GitHub Trending、掘金 / V2EX 等「发布类」信息，汇总成一份按**要素**而非只按热度展示的今日早报。

提供 **Windows / macOS 桌面应用**，也保留单文件 HTML 浏览器版。两者共用界面与数据处理逻辑；浏览器跨域拿不到的源由 GitHub Actions 定时抓好，产出静态 JSON 供页面读取。

## ✨ 功能特性

- 🧩 **要素化展示**：每条本地抽取「要素」（新模型 / 发布上线 / 开源项目 / 论文研究 / 融资并购 / 政策监管 / 事故风险 / 价格成本 / 人事组织 / 评测跑分 …）与「主体」（公司 / 模型 / 产品 / 人物 / 机构），并抽出标题里的金额、涨跌幅、版本号。纯关键词词典，**不调用任何模型、不需要 Key、完全离线可跑**
- 📌 **不看热度看价值**：每个分类卡片内固定分三档 —— 🆕 发布 · 开源 · 论文（按时间倒序）→ 📌 热度不高但值得关注 → 🔥 按当前排序。新模型、新产品的官方发布即使没人蹭，也会出现在最上面
- 📊 **信号分（0-100）**：源内热度百分位 × 绝对量级 + 新鲜度 + 要素权重 + 主体命中 + 跨平台同现 + 关注词命中；鼠标悬浮可看每一项得分，避免「排序变了但不知道为什么」
- 🔀 **三种排序**：信号优先 / 热度优先 / 时间优先，屏幕、TXT、JSON 三处同序
- 🕐 **条目级新鲜度**：尽量解析真实发布时间并显示「18 分钟前」，可「只看 24h 内」；不提供发布时间的「当日榜」（掘金、Trending）不会被误删
- 🔗 **跨平台同事件合并**：按同分类内的标题二元组相似度聚簇，显示「N 平台在热」并累加热度，替代原先只在今日要闻里生效的「前 26 字精确去重」（跨平台标题措辞不同，那种去重实际命中率接近 0）
- ⭐ **关注词订阅**：填公司 / 模型 / 关键词，命中条目加 24 分并在分类内置顶，无视热度门槛
- 🏷 **11 个内容分类**：AI 前沿、科技数码、互联网与商业、财经宏观、学术科研、国际时事、社会民生、健康生活、文化体育、游戏、动漫。游戏与动漫独立筛选；CS2 只展示 BO3.gg Tier 1 大赛的已结束赛果，固定归入游戏。其他条目按关键词与实体分类。
- 🗂 **按平台分区**：每个源一张卡片，保留原始榜序；快照源标 📸，失败源写明原因并可「重试此源」
- ⛔ **不再有示例数据**：抓取中显示骨架行，失败显示失败态，**不会用任何旧闻或示例条目冒充实时数据**
- 🔍 **搜索与筛选**：关键词搜索标题 / 摘要 / 实体 / 标签，可按平台、分类、要素三个维度叠加筛选；兼容中文输入法
- 📋 **复制与导出**：复制单条、复制整份早报、导出 TXT（含要素分节与信号分）、导出 JSON（含 `facets / entities / ts / signal / signalParts / clusterSize`）
- ⚙️ **设置**：API 基地址、代理模式、每平台条数、缓存时长、默认排序、关注词、只看 24h、同事件合并、自动刷新、快照开关与快照地址、数据源开关、清空缓存
- ⌨️ **快捷键**：`R` 刷新，`/` 聚焦搜索，`Esc` 关闭弹窗或清空搜索
- 📱 **移动端适配**：卡片式布局，桌面多列自适应到手机单列
- 🎨 **三种外观**：浅色 / 深色 / 跟随系统，侧边栏与设置均可切换，立即生效并保存在本机；桌面窗口外观同步变化
- 🖥 **原生桌面体验**：系统另存为、系统剪贴板、应用内完整原文阅读、应用菜单、窗口缩放、单实例；内置真实离线快照并明确标记时间

## 🖥 桌面版

安装包下载：[GitHub Releases 最新版本](https://github.com/shurenzZ/Search-Engine/releases/latest)。

桌面版使用 Electron，保留全部分类、CS2 Tier 1 赛果、要素与信号分、搜索、筛选、关注、排序、合并、全文展开、来源状态、重试、自动刷新和导出功能。安装后无需另外安装 Node.js。

“展开全文”继续在卡片内提取正文；点击“原文 ↗”、今日要闻或论文链接时，会在应用内的独立原文阅读窗口打开完整网页。阅读工具栏提供后退、前进、刷新与“在浏览器打开”。远程网页使用独立沙盒视图，不开放应用原生桥接；网站的登录、验证和访问限制仍由原站决定，加载失败时可用工具栏重试或交给系统浏览器。

| 平台 | 产物 | 使用方式 |
| --- | --- | --- |
| Windows x64 | `DailyBrief-3.0.0-win-x64.exe`、`.zip` | EXE 选择安装位置；或解压 ZIP 后运行 `每日热搜早报.exe` |
| macOS Apple Silicon | `DailyBrief-3.0.0-mac-arm64.dmg`、`.zip` | DMG 中将应用拖到 Applications；适用于 M 系列芯片 |
| macOS Intel | `DailyBrief-3.0.0-mac-x64.dmg`、`.zip` | 同上，适用于 Intel 芯片 |

本机构建产物位于 `dist/`，不提交到 Git。图标由本地矢量源 `desktop/assets/icon.svg` 生成，同时提供 PNG、ICO、ICNS，已接入应用、Dock 和 Windows 安装程序。

开发与打包需要 **Node.js 22.12+，建议 24**：

```bash
npm ci
npx install-electron --no     # 下载 Electron 运行时，首次启动也会自动下载
npm start                     # 运行桌面版
npm test                      # 离线回归
npm run test:desktop          # 真实窗口检查；临时用户目录，阻止测试联网
npm run icons                 # 从 SVG 自动生成 PNG / ICO / ICNS；打包前自动执行
npm run dist:mac              # macOS 上生成 Apple Silicon / Intel 的 DMG 和 ZIP
npm run dist:win              # 生成 Windows x64 安装程序和 ZIP
```

跨平台构建使用 [electron-builder](https://www.electron.build/)。已提供 `.github/workflows/desktop.yml`：手动运行，或推送 `desktop-v*` 标签，分别在 macOS、Windows 原生 runner 中测试并打包，产物可从 Actions 下载。不会自动发布 Release。

桌面版使用独立的本地配置和缓存，与浏览器存储隔离。默认先取 GitHub 最新快照，断网或远端不可用时使用安装包附带的真实快照，保留原始生成时间，标记为「离线快照 / 上次结果」。自定义 API、代理与快照地址仍可在设置中配置。

应用以沙盒和上下文隔离运行，不向页面开放 Node.js。桌面页面使用受限 `brief://app/` 协议，脚本通过 CSP 哈希授权；主页面桥接仅提供文本保存、复制和主题选择，阅读工具栏使用独立的导航桥接，均校验来源与参数。远程原文网页没有应用桥接。参考 [Electron 安全说明](https://www.electronjs.org/docs/latest/tutorial/security)。

当前安装包没有商业代码签名证书：macOS 使用 ad-hoc 签名，未做 Apple 公证；Windows 未做 Authenticode 签名。首次在其他电脑安装可能出现系统安全提示，正式公开分发前需配置对应签名证书。Windows 安装和 Intel Mac 运行需在对应设备复验。

## 🚀 使用方式

- 直接双击打开 `每日热搜早报.html`（`file://` 也能读快照，因为回读通道 `raw.githubusercontent.com` 的 CORS 是全开的）
- 或在仓库 Settings → Pages 里把 `main` 分支根目录设为站点后访问（当前尚未开启 Pages）

打开时先恢复本地缓存，同时读取服务端快照并按需串行抓取实时热榜。快照与实时抓取互不阻塞；每次刷新都会重新读取快照，10 秒超时。同一时刻的快照请求自动复用。

抓取结果缓存到 `localStorage`（键名 `hot_daily_brief_v1`，内部结构版本 `cv`，版本不一致只保留设置、丢弃条目）。

浏览器版仍可直接打开；单独运行快照工具与离线回归只需 Node.js 20+，无需安装 Electron。离线回归测试与联网自检分开运行：

```bash
node --test tests/*.test.mjs         # 离线回归，不访问外部接口
node tools/build-brief.mjs --dry      # 只看抓取结果，不写文件
node tools/build-brief.mjs            # 生成 data/latest.json 等
node tools/verify-sources.mjs         # 服务端源 + 直连源逐个契约断言
node tools/build-brief.mjs --only hf --dry  # 单源诊断
```

HTTP 部署默认读取页面同目录的 `data/latest.json`；GitHub Pages / raw 地址保留仓库推断，双击打开时保留远程仓库兜底。

生成器在所有源失败时以非零状态退出并保留现有快照；部分源失败会在快照内记录原因。`--only` 写入必须指定独立的 `--out` 目录，避免覆盖完整快照。归档日期按北京时间计算，每个 JSON 文件独立原子替换（跨文件不是事务）。

## 🌐 数据源

### 浏览器直连（实时）

60s API（[vikiboss/60s](https://github.com/vikiboss/60s)，`https://60s.viki.moe`，MIT，已开 CORS，无需 Key）+ GitHub REST。

| 源 | 接口 | 默认 |
| --- | --- | --- |
| 微博热搜 | `/v2/weibo` | ✅ |
| 百度热搜榜 | `/v2/baidu/hot` | ✅ |
| 知乎热榜 | `/v2/zhihu` | ✅ |
| 抖音热点榜 | `/v2/douyin` | ✅ |
| 今日头条热榜 | `/v2/toutiao` | ✅ |
| IT之家 · 科技快讯 | `/v2/it-news` | ✅ |
| IT之家 · 热榜 | `/v2/it-news/rank` | ✅ |
| AI 新闻 | `/v2/ai-news` | ✅ |
| 夸克热点 | `/v2/quark` | ✅ |
| Hacker News 首页 / 最新 | `/v2/hacker-news/top`、`/v2/hacker-news/new` | ✅ |
| 60秒读懂世界 | `/v2/60s` | ✅ |
| GitHub 近 7 天新建高星仓库 | `api.github.com/search/repositories` | ✅ |
| B站热门 | `/v2/bili` | ❌ 上游 500 |
| 小红书 / 贴吧 / 豆瓣电影 / 豆瓣综艺 / 百度剧集 / HN 历史最佳 / 历史上的今天 | 见 `SOURCES` | ❌ 按需开启 |

### Actions 服务端快照（📸）

这些接口**不对浏览器开放 CORS**，只能服务端抓取。由 `.github/workflows/refresh-brief.yml` 每 30 分钟运行 `tools/build-brief.mjs`，把结果提交成 `data/latest.json` + `data/archive/YYYY-MM-DD.json`（留 14 天）+ `data/manifest.json`，页面再直读。

| 源 | 地址 |
| --- | --- |
| HuggingFace 每日论文 | `huggingface.co/api/daily_papers` |
| arXiv 最新投稿（cs.AI/CL/LG/CV） | `export.arxiv.org/api/query` |
| OpenAI 官方发布 | `openai.com/news/rss.xml` |
| Google AI 博客 | `blog.google/technology/ai/rss/` |
| DeepMind 博客 | `deepmind.google/blog/rss.xml` |
| 新智元 | `aiera.com.cn/feed` |
| 量子位 | `qbitai.com/feed` |
| 雷锋网 | `leiphone.com/feed` |
| InfoQ 中文 / 少数派 | 各自 RSS |
| 掘金热榜 / V2EX 今日热议 | 各自 API |
| CS2 大赛赛果 · BO3.gg | [CS2 赛果](https://bo3.gg/matches/finished)，公开 `api.bo3.gg/api/v1/matches`（最近 7 天、Tier 1、已结束，默认启用） |
| GitHub Trending | `github.com/trending`（服务端解 HTML，不受 REST 配额限制） |

> **机器之心接不进来**（2026-10-09 全部实测过，结论写在 `tools/sources-server.mjs` 顶部）：
> `/rss`、`/articles`、`/library`、文章页乃至 `gmis` 子站对数据中心 IP 一律返回「机器之心·数据服务」闸门页，换 Googlebot UA 一样；
> `/api/v1/articles.json` 是废弃缓存（`page=1` 与 `page=2` 内容相同、条目里没有链接和发布时间、正文停在 2022-2023、还混着 `title-1507881175` 占位数据）；
> `robots.txt` 声明的 `/shared/sitemap.xml.gz` 能拿到 30136 条 URL 与发布日期，但 sitemap 里没有标题（`<image:title>` 出现 0 次），按 URL 回抓文章页又落回闸门页；
> Google News RSS 品牌词查询能返回 18 条含「机器之心」的条目，但**最新一条是 2026-04-10** —— 只能喂半年前的旧闻，与「早报」定位冲突；
> 公共 RSSHub 镜像的 `/jiqizhixin` 路由 404/503，Bing 的 RSS 会忽略 `site:` 限定只返回官网与百科。
> 要接它只能自建 RSSHub 或接入它的付费数据服务。同类内容目前由新智元、量子位、雷锋网、InfoQ 与各家官方博客覆盖。

> 为什么不用公共 CORS 代理：2026-10 实测 `api.allorigins.win`、`api.codetabs.com` 返回 Cloudflare 522，`cors.isomorphic-git.org` 403，`api.cors.lol` 429，`thingproxy` 已停，**`corsproxy.io` 已改为必须自带 API Key**，`rsshub.app` 按策略封禁。所以「发布类」源全部走服务端，公共代理只留作页面里的尽力兜底。

## 🛠 技术说明

- 页面仍是单文件 HTML + CSS + JavaScript，零外部依赖（无图片、无字体、无第三方库、无构建步骤）；使用现代浏览器原生 API（Fetch、Promise、AbortController、Unicode 正则）
- **要素词典只有一份**：`tools/build-brief.mjs` 只做数据搬运并归一字段，语义抽取（要素 / 主体 / 信号分）只在页面里算一次，避免两套规则漂移
- **限流处理**：60s 公共实例约每 2 秒 1 次请求。实时榜单请求走串行闸门，间隔不小于 `REQ_GAP`（初始 2000ms，被限流自动放慢、恢复自动提速）；`429` 按 `Retry-After` 等待后重试同一通道；整轮结束后对限流 / 超时类失败源补抓一轮
- **配额型接口**：GitHub 搜索匿名限流 10 次/分、按 IP 计。页面每轮只请求一次并按 30 分钟 TTL 复用，`403` 时读取 `X-RateLimit-Reset` 直接告诉用户几点恢复，且不进入补抓轮、不外发给第三方代理
- **多通道降级**：直连（含重试）→ 公共 / 自定义代理；上游 5xx / 401 / 403 直接降级（换代理撞的是同一个上游，只会白耗时间）
- **源可扩展字段**：`path` 支持数组、`altPaths`、完整地址与 `{today-minus-7}` 相对日期；`pick`（点分路径取数组）、`titleField` / `summaryField`、`hotField` / `hotLabel` / `timeField`、`noProxy` + `cacheKey` + `cacheTtl`、`dayList`（当日榜，无发布时间也不算过期）
- **离线回归**：`tests/regression.test.mjs` 直接执行页面中的实际脚本，覆盖快照替换与恢复、筛选合并、关闭来源、时间热度解析、超时重试、存储降级、JSON 导出和快照写入保护。推送和 PR 自动运行；定时刷新先运行测试再抓取，避免再次全量抓取服务端源。
- **契约自检**：`tools/verify-sources.mjs` 会直接从 HTML 里解析出 `SOURCES` 数组逐个请求，断言「取到数组、标题非空、声明过的热度/时间字段真的还在」——第三方接口悄悄改字段名时，这是唯一能在浏览器之外发现回归的手段

## 📁 目录

```
每日热搜早报.html              共用界面（浏览器可直接打开）
package.json / package-lock.json  桌面运行、测试、双端打包配置
desktop/main.cjs              桌面窗口、应用协议、系统剪贴板与保存对话框
desktop/preload.cjs           最小原生桥接
desktop/security.cjs          外链、导出校验与 CSP
desktop/assets/               图标 SVG / PNG / ICO / ICNS
tools/smoke-desktop.cjs        真实 Electron 窗口验证与预览截图
tests/desktop.test.mjs         桌面边界检查
tools/build-brief.mjs          服务端快照生成器（Node ESM，零依赖）
tools/sources-server.mjs       快照源注册表与字段映射
tools/verify-sources.mjs       源契约自检
tools/lib.mjs                  抓取 / 解析共用工具
tests/regression.test.mjs      零依赖离线回归测试
.github/workflows/check.yml    推送与 PR 的回归检查
.github/workflows/desktop.yml  Windows / macOS 原生构建与产物上传
.github/workflows/refresh-brief.yml  每 30 分钟抓取并提交快照
data/                          latest.json + archive/ + manifest.json（由机器人提交）
```

## v2.1 优化记录

- 快照刷新替换上轮数据，拒绝旧响应回滚，缓存同时保存来源信息；关闭来源后不再参与排序与合并。
- 筛选先于折叠：即使主条目被筛掉，匹配的同事件条目仍可见；同平台不重复计入跨平台数量。
- 限流 / 网络失败正确进入补抓队列；单源重试与全局刷新互斥。实时抓取失败可保留上次结果，并在页面、TXT、JSON 中明确标记。
- 缓存写入失败时正确回退内存；只看 24h 按当前时间判断，普通快照的未知发布时间不再默认当作当天。
- 复用标题分词与相似度集合，去掉派生计算中的重复排序。使用仓库 171 条快照、预热 10 次后测量 100 次，当前机器中位耗时由 6.785ms 降至 1.827ms（约 73%）；这是离线数据处理测试，不代表网络或整页加载速度。
- 限制外部元数据、链接协议和异常字段；Atom 优先正文链接，修复单引号链接与长 URL 截断；JSON 导出不带 BOM。
- 搜索计数同步，清空筛选同时清空搜索；设置弹窗支持焦点循环与返回、控件标签、状态播报和减少动画偏好。

## ⚠️ 已知限制

- Actions 的 cron 有调度延迟（高峰期可能晚几分钟到几十分钟）；仓库长期不活跃时 cron 会被暂停。页面会显示快照生成时间，超过 24h 可自行判断是否手动 dispatch
- 掘金热榜接口返回的 `ctime` 恒为 0，V2EX 与部分 RSS 时间字段偶有缺失；这类条目显示「时间未知」，不参与时间排序
- 微博、抖音、头条等榜单接口只给标题与热度值，其原文页多为脚本渲染或需登录，「展开全文」能否抓到正文取决于源站
- HLTV 多次间隔重试仍返回 403 或连接中断，已改用 BO3.gg。CS2 内容仅保留其 Tier 1 顶级赛事最近 7 天的已结束赛果，展示队伍、大比分、赛事名称、北京时间和 BO 赛制；不抓取赛程、进行中比赛、小型赛事或 Steam 公告。接口查询与本地归一化均检查赛事等级和状态，缺失等级的比赛不展示。这里的“大赛”按来源分级，不仅限于 Valve Major。
- 大赛赛果每 30 分钟由服务端抓取为快照；“只看 24h”仍按实际开赛时间过滤，没有符合条件的比赛时记为正常空结果，不伪造条目。可运行 `node tools/build-brief.mjs --only cs2matches --dry` 诊断。

## 📚 相关

- [vikiboss/60s](https://github.com/vikiboss/60s) — 免费开源的聚合数据 API（MIT）

## ⚖️ License

MIT
