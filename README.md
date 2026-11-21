# 🔥 每日热搜早报

早报跟踪海外机构公告、论文、开源项目和正式软件版本。网页与 Electron 桌面端共用搜索、排序、聚类和导出逻辑。机构或作者所属地区不影响其成果入选。

## 阅读早报

- 今日要闻覆盖近 48 小时有原文、日期可核实的事件，每个主题最多四条，每个渠道最多三条。原文链接、arXiv ID、DOI 或仓库和版本号用于合并同一事件，标题相似度作为补充。同一公告被多个渠道收录时保留各链接。
- 来源分为一手、专业收录、二手解读、社区线索。信号分显示出处、时间、主题、关注词和热度的贡献。社区动态、客户案例和只有版本号变化的论文修订可在分类页查看。论文和机构自行披露的评测保留发布方归属。
- 打开条目可分别查看原始发布时间、修订时间、入榜时间和首次发现时间。关注词及搜索支持常用中英文术语，例如“推理模型”“开放权重”。支持按来源、主题和要素过滤，以及导出 TXT 和 JSON。
- 保留游戏与动漫分类、BO3.gg Tier 1 已结束赛事、深浅色模式和应用内原文阅读。

## 🖥 桌面版

桌面版下载：[GitHub Releases 最新版本](https://github.com/shurenzZ/Search-Engine/releases/latest)。

桌面版使用 Electron，保留全部分类、CS2 Tier 1 赛果、要素与信号分、搜索、筛选、关注、排序、合并、全文展开、来源状态、重试、自动刷新和导出功能。安装后无需另外安装 Node.js。

“展开全文”继续在卡片内提取正文；点击“原文 ↗”、今日要闻或论文链接时，会在应用内的独立原文阅读窗口打开完整网页。阅读工具栏提供后退、前进、刷新与“在浏览器打开”。远程网页使用独立沙盒视图，不开放应用原生桥接；网站的登录、验证和访问限制仍由原站决定，加载失败时可用工具栏重试或交给系统浏览器。

| 平台 | 产物 | 使用方式 |
| --- | --- | --- |
| Windows x64 | `DailyBrief-4.0.0-win-x64.exe`、`.zip` | EXE 选择安装位置；或解压 ZIP 后运行 `每日热搜早报.exe` |
| macOS Apple Silicon | `DailyBrief-4.0.0-mac-arm64.dmg`、`.zip` | DMG 中将应用拖到 Applications；适用于 M 系列芯片 |
| macOS Intel | `DailyBrief-4.0.0-mac-x64.dmg`、`.zip` | 同上，适用于 Intel 芯片 |

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

桌面版使用独立的本地配置和缓存，与浏览器存储隔离。默认先取 GitHub 最新快照，断网或远端不可用时使用安装包附带的真实快照，保留原始生成时间，标记为「离线快照 / 上次结果」。代理与快照地址仍可在设置中配置。

应用以沙盒和上下文隔离运行，不向页面开放 Node.js。桌面页面使用受限 `brief://app/` 协议，脚本通过 CSP 哈希授权；主页面桥接仅提供文本保存、复制和主题选择，阅读工具栏使用独立的导航桥接，均校验来源与参数。远程原文网页没有应用桥接。参考 [Electron 安全说明](https://www.electronjs.org/docs/latest/tutorial/security)。

当前安装包没有商业代码签名证书：macOS 使用 ad-hoc 签名，未做 Apple 公证；Windows 未做 Authenticode 签名。首次在其他电脑安装可能出现系统安全提示，正式公开分发前需配置对应签名证书。Windows 安装和 Intel Mac 运行需在对应设备复验。

## 🚀 使用方式

- 直接双击打开 `每日热搜早报.html`，同目录保留 `data/file-snapshot.js` 即可读取本地快照
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

| 入口 | 数据与用途 |
| --- | --- |
| 浏览器直连 | GitHub REST 检索近期新仓库，HN Search 读取 Hacker News 讨论。 |
| 机构原文 | OpenAI、Google AI、DeepMind、Microsoft Research、Meta AI 和 Meta 机器学习工程博客。Anthropic 合并监控新闻、研究、工程和 Claude API 更新日志，各日期使用独立原文锚点。机构原文检索以搜索结果定位网页，回读原站标题与日期。 |
| 检索提供方 | 默认使用免密钥的 HN Search 检索指定机构 URL，覆盖其已收录网页。采集环境显式配置 `BRAVE_SEARCH_API_KEY` 后使用 Brave Web Search。密钥只在服务端读取。 |
| 论文 | arXiv 按分类轮流收录首发与修订，保留 DOI。HF Papers 记录入榜日期并链接 arXiv 原文。Crossref 按 DOI 或出版社登记的预印本关系轮查正式发表、更正与撤稿；未登记或尚未检查的关系可能遗漏。 |
| 数学 | arXiv 数学新稿公告与《Annals of Mathematics》期刊原文。 |
| 物理 | Physical Review Letters 出版社订阅，及 arXiv 的普通物理、量子、凝聚态、广义相对论和天体物理公告。 |
| 计算机科学 | arXiv 的算法与数据结构、计算复杂性、操作系统、分布式计算、编程语言、数据库；Journal of the ACM 通过 Crossref 获取出版社登记的论文日期和 DOI。 |
| 开源 | PyTorch、Transformers、vLLM 的 GitHub Releases 仅采正式版本。GitHub Trending 供发现项目。 |
| 赛事 | BO3.gg 最近七天的 Tier 1 已结束 CS2 比赛。空赛程和无新正式版本均可正常返回零条。 |

arXiv 学科 RSS 只取新稿，按小类轮流抽样，公告日期与作者投稿时间分开显示。AI 的 Atom 检索临时失效时使用官方 RSS 的新稿公告作为备用。

服务端每半小时刷新。公开源支持 ETag 或 Last-Modified 时复用响应，原始条目的首次发现时间跨轮保存 90 天。HTTP 快取保存在 `data/.http-cache/`。付费 X 接口未接入。网页仅识别新版信源和新版快照，升级恢复用户偏好时清除旧条目。

## 七天验收

`node tools/trial.mjs watch` 在本机运行一个有截止时间的七天观测，每半小时刷新快照，从启动时刻起每 24 小时分组，按该时段开始的北京时间日期保存独立目录、首次首页样本、源错误和事件发现时间。试运行期间保持本机联网，暂停、休眠或源故障会造成采样间隔。中断后再次运行沿用 `trial/window.json` 的原始截止时间。日样本保留对应时段的首次抽样；启动前已冻结的首日基线在报告中单独标出。用 `node tools/trial.mjs report` 查看已人工核对的有效率计数、独立清单覆盖及延迟中位数和 P90。

独立事件清单存于每日的 `reference.json`，记录来源目录、选取理由和原文。`review.json` 逐条记录相关性、实质新增、原文出处、重复和旧闻。如果首日已经留有启动前的首页样本，保留这份样本和评阅，再用 `windowHomepage` 冻结下一次定时采集的首页，用 `window-review.json` 评阅。七天首页指标只汇总窗口内冻结的样本。启动前已发布的存量内容不参与发现延迟统计。验收参考线为有效率 80%、重点事件覆盖率 90%、指定机构与正式版本的发现延迟中位数 45 分钟，以及每天首页重复不超过一条。没有观测值的指标显示空值。

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
- HLTV 多次间隔重试仍返回 403 或连接中断，已改用 BO3.gg。CS2 内容仅保留其 Tier 1 顶级赛事最近 7 天的已结束赛果，展示队伍、大比分、赛事名称、北京时间和 BO 赛制；不抓取赛程、进行中比赛、小型赛事或 Steam 公告。接口查询与本地归一化均检查赛事等级和状态，缺失等级的比赛不展示。这里的“大赛”按来源分级，不仅限于 Valve Major。
- 大赛赛果每 30 分钟由服务端抓取为快照；“只看 24h”仍按实际开赛时间过滤，没有符合条件的比赛时记为正常空结果，不伪造条目。可运行 `node tools/build-brief.mjs --only cs2matches --dry` 诊断。

## ⚖️ License

MIT
