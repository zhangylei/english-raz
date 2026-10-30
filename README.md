# 小芽阅读

面向儿童的 RAZ AA、A 英语启蒙网站。原生 HTML、CSS、JavaScript，无需安装前端依赖，无需打包，兼容 Chrome 77 及以上。

## 开始使用

直接打开 `index.html` 即可阅读。推荐使用本地预览，以获得稳定的进度存储与音频播放：

```powershell
node server.cjs
```

访问 `http://127.0.0.1:8787/`。停止预览按 Ctrl+C；端口可通过 `SPROUT_PORT` 环境变量调整。

## 部署到 GitHub Pages

1. 新建 GitHub 仓库，将以下文件与目录上传到仓库根目录：
   - `index.html`、`styles.css`、`app.js`、`core.js`、`.nojekyll`。
   - 完整的 `assets/` 和 `data/`。
2. 在仓库 **Settings → Pages → Build and deployment** 中选择 **Deploy from a branch**。
3. 选择 `main` 分支及 `/ (root)`，保存并等待 Pages 发布。
4. 打开 GitHub 提供的网址。项目仓库形式的 `https://用户名.github.io/仓库名/` 也可直接使用。

资源全部使用相对路径，页面使用哈希路由，无需额外配置 404 回退或构建工作流。不要上传原始 `AA-书本/`、`A-书本/`、`A-测试卡/`、压缩包、`.tools/`、`.qa/`、`tmp/`。随附 `.gitignore` 已排除原始资料和开发产物。

GitHub 网页单次上传最多选择 100 个文件。本项目约有 4,370 个素材文件，可使用 GitHub Desktop 一次提交整个目录：

1. 安装并打开 GitHub Desktop，登录 GitHub。
2. 选择 **File → Clone repository**，选择已有的 GitHub 仓库并克隆到电脑上的一个新目录。
3. 打开克隆出的目录，将本项目中的 `assets/`、`data/`、`index.html`、`styles.css`、`app.js`、`core.js`、`.nojekyll` 复制进去。原始绘本目录、测试卡目录和 `.qa/` 不需要复制。
4. 回到 GitHub Desktop，检查左侧文件列表，填写提交说明，点击 **Commit to main**；分支名称不同则以界面显示为准。
5. 点击 **Push origin**，等待上传结束。文件较多，首次上传可能需要一些时间。
6. 在 GitHub 仓库的 **Settings → Pages** 中选择提交所用分支和 `/ (root)`，等待发布完成后访问页面显示的网址。

GitHub Pages 需要能直接访问绘本图片与音频，因此上传时保留 `assets/` 的目录结构，不要只上传一个压缩包。所有素材均已整理为普通静态文件，部署无需网盘登录、API Key 或第三方音频服务。

## 学习内容

- **AA、A 两级绘本**：各 99 本，分别有 794、800 个正文阅读页，可在书架切换级别。
- **原版音频**：每本均配对应 MP3，可播放、暂停、重播、调整速度和拖动播放位置。原音是整本播放，不与翻页自动同步。
- **大字阅读**：36、44、52 像素三档字号；支持左右方向键翻页，原图与英文原句分开显示。
- **中文辅助**：默认关闭，打开后显示中文关键词释义。中文标题和词义为辅助内容，并非原版中文译文。
- **单词点读**：使用浏览器与操作系统提供的英文语音，和原版 MP3 的来源不同。设备没有可用语音时仍可听整本原音。
- **看图选句练习**：选项取自同一本绘本的真实原句，答错可重试。A 级《My Face》和《Opposites》的插图标注直接包含答案，因此使用原版测试卡进行亲子交流。
- **家长测试卡**：97 本 A 级绘本配有原版测试卡，阅读页可直接打开；两本 Benchmark 绘本暂无对应测试卡。
- **本地进度**：阅读位置、已读状态、最好星级及阅读设置保存在当前浏览器。支持导出和导入 JSON 备份。

练习全部独立答对得三星，独立答对至少三分之二得两星，其他完成情况得一星。使用“听听这句话”提示的题目不计为独立答对。重复练习保留最好星级，阅读和奖励不会重复累计。

## 素材核验

所提供目录共有 100 份 PDF。编号 `AA-100-书本-Theseareopposites.pdf` 实际内容是 **H 级《Cinderella》**，并非 AA 级《These Are Opposites》。该文件没有混入 AA 书架。完整核验结果见 `data/source-report.json`。

编号 1—99 均从 PDF 内容核实为 AA 级，包含两本 Benchmark Book。99 本绘本均保留原版封面、出版信息和完整原页面供查阅；其中八本竖版拼版的倒置半页已转正。编号 72 原书正文为十页，其余正文为八页。

A 级目录有 99 份经核验的绘本。音频编号 28、53 的《Fruits》《I Go》在绘本目录中分别以 98、99 号 Benchmark 绘本保存；音频编号 100 的《I Push》缺少对应绘本。98 和 99 各含一本普通绘本和一本 Benchmark 绘本，网站使用独立 ID 避免覆盖。97 份本地测试卡均按正文标题与绘本核对；两本 Benchmark 绘本无对应测试卡。A 级核验结果见 `data/source-a-report.json`。

AA 音频目录包含 100 个编号文件，网站使用与当前 99 本正确绘本对应的原音。第 100 个音频已保存，但正确绘本补齐前不在书架中展示。A 级音频按书名核对，四处文件名错拼有明确的匹配规则，避免编号错位导致错配。

英文原文、插图和原音来自用户提供的学习资料，来源标注为 **© Learning A–Z · www.readinga-z.com**。网站未改写原句。后续拿到正确的第 100 本 PDF 后，用正确文件替换原文件并重新运行预处理即可加入书架。

## 保存进度

无需账号和后台。清除浏览器数据、使用隐私模式、切换浏览器、设备或网址都会影响本地进度。GitHub Pages 不提供账号或跨设备同步。

在“家长设置”或“我的足迹”中导出备份；新设备导入时会先校验并显示确认窗口，确认后才替换当前记录。浏览器不允许存储时会显示提示，仍可学习并导出本次记录。

## 重新整理素材

已生成的站点可直接使用，只有更新素材时才需运行以下脚本。

```powershell
python -m pip install -r requirements.txt
python -X utf8 scripts/download-audio.py
python -X utf8 scripts/prepare-books.py --source "AA-书本"
python -X utf8 scripts/download-audio-a.py
python -X utf8 scripts/prepare-a.py
```

下载脚本读取原分享的公开目录，复用游客会话下载音频；文件已存在且大小正确时会跳过。网盘链接失效或游客策略改变时，可自行下载并按 `assets/audio/aa-001.mp3` 至 `aa-100.mp3` 放置，再运行绘本预处理。浏览器运行网站不会调用网盘接口。

PDF 预处理使用 PDFium。Windows 使用系统 GDI+ 输出 JPEG，其他系统使用 Pillow。脚本按原文识别阅读级别、拆分双页、旋转倒置半页，生成原图、大字原文数据及去掉文字的练习插图。生成目录为 `assets/books/`，书目清单为 `data/catalog.js`。

A 级数据由 `scripts/prepare-a.py` 整理到 `data/catalog-a.js`，并保留对应的原版测试卡。已生成图片无需重做时，可运行 `python -X utf8 scripts/prepare-a.py --metadata-only` 更新 A 级元数据。

更新素材后应检查 `data/source-report.json`、`data/source-a-report.json`、原文抽取和图像效果，再发布。手动改动生成的书目文件会在下次生成时被覆盖。

## 验证

```powershell
node --test tests/core.test.cjs tests/catalog.test.cjs tests/catalog-a.test.cjs
node tests/browser-smoke.cjs
```

浏览器验收使用本机 Edge 的独立无头档案，不访问个人浏览器数据。可用 `SPROUT_BROWSER` 指定其他 Chromium 可执行文件。验收会模拟 `/raz/` 仓库子路径，并生成 `.qa/` 截图。没有运行构建命令或全局 TypeScript 检查。
