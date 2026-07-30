# 工作日志

## 2026-07-28 — Phase 1：建立并验证 MarkText fork 开发底座

- 用户目标：从 MarkText `develop` 分支开始，建立个人 fork 和本地开发环境，并在不修改产品代码的前提下验证原始工程可用。
- 实际完成：
  - 确认 `/Users/apple/dev/github/marktext` 原先不存在，未覆盖用户文件。
  - 确认 GitHub 账号 `Jacquesxu666` 已认证，创建 `Jacquesxu666/marktext` fork。
  - 克隆到 `/Users/apple/dev/github/marktext`，配置 `origin` 为个人 fork、`upstream` 为 `marktext/marktext`，使用 `develop` 分支。
  - 按上游构建文档核验 Node.js、pnpm、Python、Xcode/Clang，并执行依赖安装、类型检查、单元测试与构建。
- 修改或创建的文件：
  - 新建 `WORKLOG.md`。
  - 未修改产品代码；依赖与构建输出位于 Git 忽略目录。
- 测试及结果：
  - `pnpm install --frozen-lockfile`：通过。
  - `pnpm typecheck`：通过。
  - `pnpm test:unit`：通过，50 个测试文件、734 项测试全部通过。
  - `pnpm build`：通过；存在 CodeMirror 模块同时被静态和动态导入的 Vite 提示，不影响构建成功。
- 关键决策：
  - 严格停在 Phase 1，不进行品牌改名或产品功能修改。
  - 保持 `origin`/`upstream` 双远端布局，便于后续同步上游。
  - 安装时 `native-keymap` 针对 Node.js 24 的首次本机编译出现 C++ 标准错误；项目 `postinstall` 随后应用补丁并按 Electron 42 ABI 重建成功，因此未修改源码或锁文件。
- 尚未解决的问题：无阻塞问题；GUI 冒烟测试已在下方补充完成。
- Git commit：无（按用户要求未提交）。

## 2026-07-28 — Phase 1 补充：lint 与真实 GUI 冒烟门禁

- 用户目标：补齐 Phase 1 基线门禁，确认 lint 结果，并实际启动 Electron 验证 Markdown 打开、阅读、编辑、保存、侧栏、TOC 与键盘映射。
- 实际完成：
  - 开始前检查 Git 状态：`develop...origin/develop`，仅有未跟踪的 `WORKLOG.md`，没有产品代码改动。
  - 执行完整 `pnpm lint`。
  - 使用 `pnpm dev` 成功构建 main/preload、启动 renderer 开发服务器并打开真实 Electron 窗口。
  - 在 `/tmp/marktext-phase1-gui-smoke.md` 创建临时 Markdown，通过开发版应用打开；AX 窗口与正文均确认加载成功。
  - 通过原生快捷键验证 `⌘J` 打开侧栏、`⌘K` 打开 TOC，TOC 正确列出 `Phase 1 GUI Smoke`、`Sidebar and TOC`、`Save verification`。
  - 通过 `⌘⌥S` 进入源码模式，完成临时文档编辑，并通过 `⌘S` 将 `GUI source-mode edit verified.` 真实写入 `/tmp` 文件。
  - 检查开发终端：除一条 macOS TSM Caps Lock 系统日志外，无 `native-keymap`、renderer 或 main process 运行错误。
  - 使用 `⌘Q` 安全退出，确认 Electron 窗口、`electron-vite dev` 与相关 pnpm 开发进程均无残留。
- 修改或创建的文件：
  - 更新 `WORKLOG.md`。
  - 临时测试文件与截图仅位于 `/tmp`，未放入仓库。
  - 未修改产品代码。
- 测试及结果：
  - `pnpm lint`：通过（退出码 0）；0 errors、135 warnings。另有 Node.js `MODULE_TYPELESS_PACKAGE_JSON` 提示，建议未来在 `package.json` 明确模块类型。
  - `pnpm dev`：通过；main process、preload 与 renderer 均成功启动。
  - GUI 打开/读取：通过。
  - GUI 编辑/保存：通过（源码模式，落盘内容经 `rg` 验证）。
  - 侧栏与 TOC：通过。
  - `native-keymap` 快捷键路径：通过，未观察到运行错误。
- 关键决策：
  - 不修改产品代码，仅补充基线验证和日志。
  - 直接写入 Muya 根 `AXTextArea` 只能改变可访问性/画面状态，不能可靠代表编辑器模型更新；因此切换到源码模式完成并验证真实落盘，避免误报保存成功。
- 尚未解决的问题：
  - lint 保留 135 条现有 warning 与一个模块类型提示，不阻塞 Phase 1。
  - 自动化未将 Muya 所见即所得区的 AX 写值视为有效编辑门禁；真实编辑/保存已由源码模式覆盖。
- Git commit：无（按要求未提交）。

## 2026-07-28 — Phase 2：建立 LeafBook 独立品牌与安装基础

- 用户目标：在 MarkText fork 上建立可安装、可与 MarkText 共存的独立产品 LeafBook，版本从 `0.1.0` 开始，并隔离应用标识、配置、更新渠道和公开品牌。
- 实际完成：
  - 从与 `origin/develop`、`upstream/develop` 同步的基线创建本地分支 `feature/leafbook-brand-foundation`。
  - 建立统一品牌常量：产品名 `LeafBook`、slug/命令名 `leafbook`、Bundle ID `com.jacquesxu.leafbook`、版本 `0.1.0`。
  - 将 macOS/Windows/Linux 的产品名、可执行文件名、安装包制品名、Linux desktop/appdata 元数据和 Windows 文件关联切换为 LeafBook。
  - 显式将生产用户数据目录设为平台应用数据根下的 `leafbook`；开发目录使用 `leafbook-dev`，便携目录使用 `leafbook-user-data`；Keychain service 和临时键盘信息文件也改用 LeafBook 命名。
  - 界面标题、macOS 应用菜单、About、崩溃提示、CLI 版本输出以及运行时翻译中的公开产品名改为 LeafBook；帮助、源码、Issue、Discussion 和 License 链接指向当前 fork。
  - 移除 `electron-updater` 依赖和所有实际检查、下载、安装调用；隐藏菜单和命令面板中的更新入口。打包产生的更新元数据仅指向 `Jacquesxu666/marktext`，缓存目录为 `leafbook-updater`，但运行时更新代码保持禁用，等待自有签名发布渠道。
  - 保留上游 MIT `LICENSE`，新增 `NOTICE`，明确 MarkText 来源、版权和独立衍生关系。
  - 新增可维护的原创 `leafbook.svg` 图标源（书本与叶片），确定性生成 PNG、ICNS、ICO 及界面所需尺寸，替换应用和 About 图标。
  - 重写根 `README.md`，说明 LeafBook 定位、身份、更新策略、构建入口和 MarkText attribution。
- 修改或创建的文件：
  - 品牌与运行时：`packages/desktop/src/shared/brand.ts`、`packages/desktop/src/main/index.ts`、`packages/desktop/src/main/cli/index.ts`、`packages/desktop/src/common/i18n.ts`、`packages/desktop/src/renderer/src/i18n/index.ts` 等。
  - 打包与平台：`package.json`、`packages/desktop/package.json`、`packages/desktop/electron-builder.yml`、`packages/desktop/build/windows/installer.nsh`、`packages/desktop/build/linux/leafbook.desktop`、`packages/desktop/build/linux/leafbook.appdata.xml`、`pnpm-lock.yaml`。
  - 图标：`packages/desktop/build/icons/leafbook.svg`、`scripts/generate-leafbook-icons.sh` 及应用 PNG/ICNS/ICO、About 图标派生文件。
  - 文档与测试：`README.md`、`NOTICE`、`packages/desktop/test/unit/specs/leafbook-brand-foundation.spec.ts`、`WORKLOG.md`。
- 测试及结果：
  - LeafBook 品牌定向测试：通过，6 项全部通过。
  - `pnpm test:unit`：通过，51 个测试文件、740 项测试全部通过。
  - `pnpm typecheck`：通过。
  - `pnpm lint`：通过（退出码 0）；0 errors、135 条上游既有 warnings。
  - `pnpm build`：通过。
  - `pnpm generate-leafbook-icons`：通过；连续生成前后 PNG/ICNS/ICO SHA-256 完全一致。
  - `pnpm build:mac:arm64`：通过，生成 `leafbook-mac-arm64-0.1.0.dmg` 与 `.zip`；因本机没有 Developer ID，按配置未签名、未公证。
  - 打包检查：`Info.plist` 中 `CFBundleDisplayName/Name/Executable=LeafBook`、`CFBundleIdentifier=com.jacquesxu.leafbook`、版本 `0.1.0`；CLI 输出 `LeafBook: v0.1.0`。
  - GUI 冒烟：通过；打包版打开临时 Markdown，窗口正常渲染，macOS 菜单栏显示 `LeafBook`，独立临时 user-data 中生成偏好、日志和 editor state。
- 关键决策：
  - 保留 `window.marktext`、`@marktext/*`、翻译 key 和 Muya 内部命名，避免对上游同步无价值的大规模改名；会影响安装、配置或用户认知的外部身份全部隔离。
  - 在没有 LeafBook 自有签名发布渠道前安全禁用自动更新，不复用 MarkText updater。
  - 使用仓库内 SVG 作为图标单一源文件；平台二进制图标是确定性派生物，不再沿用上游应用图标。
- 尚未解决的问题：
  - macOS 安装包尚未签名和公证；正式发布前需要 Apple Developer ID 和发布流水线。
  - GitHub 仓库仍按用户要求保留名称 `Jacquesxu666/marktext`；后续若重命名，需要同步 `REPOSITORY_URL` 和包元数据。
  - Windows/Linux 安装包配置与元数据已更新，但本轮仅在 macOS arm64 上进行了真实打包和 GUI 冒烟。
- Git commit：无（按用户要求未提交、未推送）。

## 2026-07-28 — Phase 2 返修：发行安全、帮助入口与真实产物审计

- 用户目标：修复 Phase 2 审查发现的发行、许可证、链接、Windows
  卸载、工作流、元数据、图标复现和产物验证问题，保持仓库名不变且
  不提交、不推送。
- 实际完成：
  - 在 GitHub 个人 fork `Jacquesxu666/marktext` 启用 Issues 和
    Discussions，并确认两个入口及当前文档 URL 均返回 HTTP 200。
  - 让 electron-builder 将根 `LICENSE`、`NOTICE` 放入应用
    `Resources/licenses`；新增 macOS 真实 `.app`、ZIP、DMG 审计，
    并在 PR build 与 release workflow 的每个 macOS 架构构建后执行。
  - 审计覆盖 Info.plist 产品名、Bundle ID、版本和可执行文件，
    LICENSE/NOTICE 内容，ASAR 依赖与作者元数据，以及
    `electron-updater` 缺失。
  - 将应用内残留 `marktext.me` 帮助链接统一为共享 LeafBook 品牌
    常量，指向当前 fork 中现有文档；README 明确这些文档继承自
    MarkText，等待 LeafBook 专用文档替换。
  - Windows NSIS 卸载仅在扩展默认 ProgID 仍为
    `LeafBook.Document` 时删除映射，避免破坏后续由其他应用接管的
    文件关联，并增加文本级回归测试。
  - PR build/release workflow 的 artifact 名、发行显示名和 macOS
    应用路径全部切换为 LeafBook；launch E2E 改为验证 LeafBook 标题。
  - desktop package 的 author/maintainer 改为当前发行者
    `Jacquesxu666`（仅使用可验证 GitHub profile，不编造邮箱）；
    LICENSE/NOTICE 继续保留上游版权归属。
  - Issue、Discussion、贡献模板和版本字段改为 LeafBook 与当前 fork；
    移除继承的 MarkText funding 配置。
  - 移除根 package 与共享常量中的重复版本，desktop package 成为
    构建版本单一来源；共享常量集中仓库、Issue、Discussion、Release、
    License 与文档 URL。
  - 重新生成第三方许可证，标题改为 LeafBook，确认不包含
    `electron-updater`。
  - 明确 macOS/Windows/Linux 分别使用 ICNS/ICO/PNG 构建输入；新增
    macOS 图标双次生成哈希、格式和尺寸验证，README 明确脚本仅支持
    macOS。
- 修改或创建的文件：
  - 发行与审计：`packages/desktop/electron-builder.yml`、
    `.github/workflows/build.yml`、`.github/workflows/release.yml`、
    `scripts/audit-mac-artifact.sh`。
  - 品牌与帮助：`packages/desktop/src/shared/brand.ts`、主进程帮助菜单、
    renderer 命令与偏好/导出界面、`README.md`。
  - Windows 与平台元数据：`packages/desktop/build/windows/installer.nsh`、
    `packages/desktop/package.json`、根 `package.json`。
  - 社区模板：`.github/ISSUE_TEMPLATE/*`、
    `.github/DISCUSSION_TEMPLATE/q-and-a.yml`、`.github/CONTRIBUTING.md`；
    删除 `.github/FUNDING.yml`。
  - 许可证与图标：`packages/desktop/build/THIRD-PARTY-LICENSES.txt`、
    `scripts/generateThirdPartyLicense.ts`、
    `scripts/verify-leafbook-icons.sh` 及图标派生文件。
  - 测试：`packages/desktop/test/unit/specs/leafbook-brand-foundation.spec.ts`、
    `packages/desktop/test/e2e/launch.spec.ts`。
- 测试及结果：
  - LeafBook 品牌定向测试：通过，9 项。
  - 完整单元测试：通过，51 个测试文件、743 项测试。
  - 类型检查：通过。
  - Lint：通过（退出码 0，0 errors、135 条上游既有 warnings）。
  - launch E2E：通过，1 项，窗口标题为 LeafBook。
  - `pnpm validate-licenses`：通过；重新生成清单不含
    `electron-updater`。
  - `pnpm verify-leafbook-icons`：通过；连续两次生成哈希一致，PNG
    尺寸和 ICNS/ICO 格式符合预期。
  - 清理旧 `dist` 与 `packages/desktop/out` 后执行
    `pnpm build:mac:arm64`：通过，生成新的 app、DMG、ZIP。
  - `pnpm audit:mac-artifact`：通过；app、ZIP、DMG 均包含
    LICENSE/NOTICE，Info.plist 和 package 元数据正确，ASAR 不含
    `electron-updater`。
  - Shell 语法检查、帮助 URL HTTP 检查和 `git diff --check`：通过。
- 关键决策：
  - macOS 产物审计脚本同时支持 `arm64` 和 `x64`，CI 对两个架构都
    执行；本机实际验证为 arm64。
  - 版本只由 `packages/desktop/package.json` 管理，Vite 与
    electron-builder 均从该文件派生，避免三处手工同步。
  - 当前 fork 仓库名继续为 `marktext`，所有公开 LeafBook URL 集中在
    共享品牌模块，未来重命名时只需集中调整。
- 尚未解决的问题：
  - macOS 包仍未签名和公证。
  - Windows/Linux 配置与回归测试已更新，但本轮没有在对应操作系统
    进行真实打包；Windows NSIS 仍需 CI 或 Windows 主机验证。
  - 继承的 MarkText website 与历史翻译文档仍保留内部上游名称；
    它们不是本轮桌面应用帮助入口，后续独立网站阶段应整体重做。
- Git commit：无（按要求未提交、未推送）。

## 2026-07-28 — Phase 2 第二轮返修：安装同意、许可证正文与发布集合闭环

- 用户目标：修复第二轮审查指出的 Windows 文件关联提前注册、第三方许可证正文缺失、旧网站部署、更新元数据发布、版本漂移、品牌常量和图标验证顺序等问题；不提交、不推送。
- 对先前记录的更正：
  - 上一条所称“Windows NSIS 卸载安全”不完整：顶层
    electron-builder `fileAssociations` 仍会绕过自定义询问提前注册；本轮
    已移除顶层配置，并由 NSIS 在用户明确选择 Yes 后独占注册。
  - 上一条所称“重新生成第三方许可证”不代表正文有效：原生成器读取
    `licenseText`，而 license-checker 实际返回的是 `licenseFile`，导致
    清单可能包含字面量 `undefined`；本轮已读取真实文件正文并验证。
  - 上一条提到构建产生更新元数据但运行时禁用；本轮进一步明确：
    `.blockmap`/`latest*.yml` 可以是构建中间产物，但不得上传为
    LeafBook 0.1.0 的 Actions artifact 或 GitHub Release asset。
- 实际完成：
  - 移除 electron-builder 顶层 Windows 文件关联；自定义 NSIS 在
    默认 No 的询问后才写入 `.md/.markdown/.mmd/.mdown/.mdtxt/.mdtext/.mdx`、
    `LeafBook.Document`、图标和打开命令，并刷新 Shell。
  - Windows 卸载逐个检查扩展当前 ProgID，仅在仍属于 LeafBook 时删除；
    ProgID 也仅在打开命令仍指向当前安装目录时清理。
  - 修复第三方许可证生成器，优先读取 `licenseFile` 真实正文，回退
    `licenseText`，最后生成明确的 declared-license 提示；拒绝空正文，
    清理行尾空白并重新生成清单。
  - 将 `THIRD-PARTY-LICENSES.txt` 与 `LICENSE`、`NOTICE` 一同打入 app，
    并在 `.app`、ZIP、DMG 产物审计中验证存在、非空且无字面量
    `undefined`。
  - 根与 desktop `package.json` 均显式声明 `license: MIT`。
  - 将继承的网站 workflow 改为只读 lint/typecheck/build，明确禁用
    Cloudflare push/preview 部署，避免触碰旧 MarkText 生产目标。
  - release workflow 不再上传 `.blockmap`/`latest*.yml`，下载发布集合后
    运行拒绝更新元数据的审计；runtime updater 继续禁用。
  - release validate job 先 checkout，再用 SemVer 2.0.0 规则严格验证
    tag 必须等于 `v${packages/desktop/package.json.version}`。
  - About、标题栏和 editor crash 提示改为使用 `APP_NAME`；静态 HTML
    标题由一致性测试与共享常量锁定。
  - 图标验证先记录 checked-in hashes，再生成并比较，随后进行第二次
    生成复现检查；PR build 与 release macOS matrix 均接入门禁。
  - 新增 Linux AppStream 与 Issue/Discussion 版本一致性验证，desktop
    package 继续作为唯一版本源，并接入 build/release。
  - 更新 `CLAUDE.md`，明确当前 LeafBook fork、上游仓库以及
    `marktext.me` 仅为继承的上游文档来源。
  - 在远端 `Jacquesxu666/marktext` 创建并验证 `triage` label，确保 Issue
    模板引用的 label 存在。
  - 清理仓库内 Playwright `test-results` 生成目录。
- 修改或创建的文件：
  - 打包/安装：`packages/desktop/electron-builder.yml`、
    `packages/desktop/build/windows/installer.nsh`。
  - 许可证：`scripts/generateThirdPartyLicense.ts`、
    `packages/desktop/build/THIRD-PARTY-LICENSES.txt`、
    `scripts/audit-mac-artifact.sh`、根与 desktop `package.json`。
  - 发布与 CI：`.github/workflows/build.yml`、
    `.github/workflows/release.yml`、
    `.github/workflows/website-deploy.yml`、
    `scripts/audit-release-files.sh`、`scripts/validate-release-tag.mjs`。
  - 一致性门禁：`scripts/verify-windows-associations.ts`、
    `scripts/verifyLeafBookMetadata.ts`、
    `scripts/verify-leafbook-icons.sh`、LeafBook 品牌单元测试。
  - 运行时品牌与文档：About、title bar、editor window、`CLAUDE.md`。
- 测试及结果：
  - LeafBook 定向单元测试：11 项通过。
  - 完整单元测试：51 个文件、745 项全部通过。
  - `pnpm typecheck`：通过。
  - `pnpm lint`：通过（0 errors；135 条上游既有 warnings）。
  - launch E2E：1 项通过，验证 LeafBook 窗口标题。
  - `pnpm validate-licenses`：通过；52 MIT、4 Apache-2.0、3 ISC、
    3 BSD-3-Clause 及允许的复合许可证。
  - 元数据、Windows 关联、release tag 正反例、图标复现与
    `git diff --check`：通过。
  - 从移走旧 `dist/out` 后的干净目录执行 `pnpm build:mac:arm64`：通过；
    生成 LeafBook app、ZIP、DMG。
  - macOS 产物审计：通过；app、ZIP、DMG 均含三份许可证文件。
  - 模拟 release 上传集合（ZIP/DMG）无更新元数据：通过；直接审计原始
    `dist` 会按预期拒绝 `.blockmap` 与 `latest-mac.yml`。
  - GitHub `triage` label：已验证，颜色 `#D4C5F9`，描述为
    “Needs initial review and categorization”。
- 关键决策：
  - Windows 文件关联完全交由 consent-gated NSIS 管理，不让
    electron-builder 自动注册。
  - 构建中间更新元数据无需强删，但任何分发集合必须通过拒绝门禁。
  - 在 LeafBook 自有网站上线前保留继承网站源码供验证，但不进行任何
    自动部署。
- 尚未解决的问题：
  - Windows NSIS 的脚本组合已自动审计，但仍需 Windows CI/主机完成真实
    installer 安装、选择 No/Yes、卸载与接管关联的端到端验证。
  - macOS 包仍未签名、公证；本机只验证 arm64。
- Git commit：无（按要求未提交、未推送）。

## 2026-07-28 — Phase 2 第三轮返修：卸载共享键、文档类型与跨平台产物门禁

- 用户目标：完成 Phase 2 最后一轮小范围返修，确保许可证生成失败可见、
  Windows 卸载不破坏共享扩展键、macOS/Linux 文档类型完整、发行集合和
  各平台产物可审计，并补齐多尺寸 Windows 图标与回归门禁。
- 对先前记录的更正：
  - 第二轮记录所称“Windows 卸载逐个检查扩展当前 ProgID，仅在仍属于
    LeafBook 时删除”仍不够安全：当时使用 `DeleteRegKey` 会递归删除
    扩展键下其他应用共享的子项。本轮改为仅删除默认值，再以
    `DeleteRegKey /ifempty` 清理真正的空键；LeafBook 自有 ProgID 才允许
    条件递归删除。
  - 第二轮的 release 审计只证明未上传 updater 元数据，不能证明五个
    CI matrix job 的期望产物全部到齐；本轮增加完整的 13 个发行文件集合
    校验和每个平台构建 job 的本地产物审计。
- 实际完成：
  - 重构第三方许可证生成器：checker 返回错误、未返回 package map 或
    返回空 map 时均抛错；CLI 捕获后设置非零退出码，且失败时不写清单。
    新增 checker 错误和空 package map 的负向单元测试。
  - Windows NSIS 卸载在扩展默认值仍为 `LeafBook.Document` 时，仅删除
    默认值并尝试 `/ifempty` 删除空键，保留任意共享子项；继续仅条件删除
    LeafBook 自有 ProgID。关联 verifier 改为检查整个 YAML 是否存在顶层
    `fileAssociations`，并锁定安全删除序列。
  - 在 `mac.extendInfo` 单独声明 `CFBundleDocumentTypes`，支持
    `md/markdown/mkd/mdwn/mdown/mdx`，不恢复顶层文件关联；真实 macOS
    产物审计读取生成的 `Info.plist` 校验扩展、角色和 handler rank。
    Linux 文件关联补充 `mdx` 并纳入元数据验证。
  - 新增 Linux/Windows 构建产物审计：检查各平台期望文件集合、归档内
    LeafBook 可执行文件、三份许可证、打包 package 身份，以及 ASAR 和
    package metadata 均不含 `electron-updater`。PR build 和 release 的
    对应 matrix job 均在上传前执行；macOS 继续使用专用真实产物审计。
  - release 审计现在拒绝不存在或空的目录、updater metadata/blockmap、
    缺失或额外文件，并要求 Linux 5 个、Windows 两架构各 2 个、macOS
    两架构各 2 个，共 13 个发布产物。
  - ICO 改为包含 `16/24/32/48/64/128/256` 七个 PNG 图层；新增 ICO
    目录解析器，验证图层数量和尺寸，并继续执行双次生成哈希复现检查。
  - 将 `CLAUDE.md` 中 desktop 代理命令和包名改为
    `pnpm --filter leafbook`；ESLint 全局安全忽略任意层级 Playwright
    `test-results` 与 `playwright-report`。
- 修改或创建的文件：
  - 许可证与测试：`scripts/generateThirdPartyLicense.ts`、
    `packages/desktop/test/unit/specs/leafbook-brand-foundation.spec.ts`。
  - Windows/macOS/Linux 打包：`packages/desktop/build/windows/installer.nsh`、
    `packages/desktop/electron-builder.yml`、
    `scripts/verify-windows-associations.ts`、
    `scripts/verifyLeafBookMetadata.ts`。
  - 产物/发行审计：`scripts/audit-platform-artifacts.sh`、
    `scripts/audit-mac-artifact.sh`、`scripts/audit-release-files.sh`、
    `.github/workflows/build.yml`、`.github/workflows/release.yml`。
  - 图标：`scripts/generateLeafBookIco.ts`、
    `scripts/verifyLeafBookIco.ts`、图标生成/验证 shell 脚本和两个 ICO
    派生文件。
  - 工具与文档：根 `package.json`、`eslint.config.js`、`CLAUDE.md`、
    `WORKLOG.md`。
- 测试及结果：
  - LeafBook 品牌专项：13 项通过，含许可证 checker 错误与空 package
    map 两条负向路径。
  - 完整单元测试：51 个文件、747 项全部通过。
  - `pnpm typecheck`：通过。
  - `pnpm lint`：通过（0 errors；135 条上游既有 warnings），嵌套
    `packages/desktop/test-results` 不再进入 lint。
  - 完整 Playwright E2E：215 项通过、4 项按上游定义跳过，共 219 项。
  - 许可证生成与 allowlist 验证、LeafBook 元数据、Windows 关联、
    release tag 正反例、workflow YAML 解析、shell 语法均通过。
  - ICO 验证：七个期望尺寸全部存在；连续两次生成哈希一致。
  - release 审计：空目录、缺产物和 updater metadata 负向用例按预期
    失败；模拟完整 13 产物集合通过。
  - 移走旧 `dist/out` 后执行干净 `pnpm build:mac:arm64`：通过；
    `pnpm audit:mac-artifact -- arm64` 通过，真实 `Info.plist` 包含六种
    Markdown 扩展，app/ZIP/DMG 身份、许可证和 updater absence 正确。
  - `git diff --check`：通过。
- 关键决策：
  - 扩展键属于 Windows 共享命名空间，LeafBook 只能删除自己写入的默认
    值；扩展键非空时必须保留。
  - macOS 文档类型仅放在 `mac.extendInfo`，避免 electron-builder 顶层
    文件关联再次绕过 Windows 的用户同意流程。
  - Windows/Linux 的真实安装包不在 macOS 本机伪验证；由各自 CI runner
    在构建后、上传前执行平台产物审计。本机只验证脚本、配置和负向路径。
- 尚未解决的问题：
  - Windows NSIS 的真实安装、选择 No/Yes、其他应用子项共存及卸载仍需
    Windows CI/主机完成端到端验证。
  - Linux 五种包格式需由 Linux CI runner 完成真实构建与新增审计。
  - macOS 包仍未签名、公证；本机只验证 arm64。
- Git commit：无（按要求未提交、未推送）。

## 2026-07-28 — Phase 2 收尾：发布文档、标题断言与许可证漂移验证

- 用户目标：完成 LeafBook 品牌基础阶段的纯收尾，使开发与发布文档和
  当前 CI/运行时行为一致，收紧启动标题测试，修复贡献指南链接，并确认
  第三方许可证可复现；不改其他功能，不提交、不推送。
- 实际完成：
  - 更新 `CLAUDE.md`，明确 `packages/desktop/package.json` 是版本唯一
    来源、desktop 根脚本使用 `pnpm --filter leafbook`，自动更新运行时
    禁用且没有 `electron-updater` 依赖，继承网站 workflow 只做只读
    validation。
  - 将继承的发布说明重写为 LeafBook 0.1.0 当前流程：严格 tag/version
    门禁、五个 CI 平台 job、13 个跨平台产物加校验和、禁止上传
    `latest*.yml` 和 `.blockmap`，并准确记录 macOS 未签名/未公证、
    Windows 未签名及各平台产物审计范围。
  - 记录 desktop 版本与 AppStream、Issue/Discussion 示例等派生镜像的
    同步要求，避免发布前元数据验证失败。
  - 将 launch E2E 的窗口标题正则改为严格的完整分组锚定，避免只匹配
    字符串前缀或后缀。
  - 修复 `.github/CONTRIBUTING.md` 从 `.github/` 目录出发时指向
    `ISSUE_TEMPLATE/` 的相对链接。
  - 重新生成 `THIRD-PARTY-LICENSES.txt`；生成前后 SHA-256 完全一致，
    保持 LeafBook 品牌，且不含 `electron-updater` 或独立
    `undefined` 正文。
- 修改或创建的文件：
  - `CLAUDE.md`
  - `packages/website/content/docs/dev/RELEASE.md`
  - `packages/desktop/test/e2e/launch.spec.ts`
  - `.github/CONTRIBUTING.md`
  - `WORKLOG.md`
- 测试及结果：
  - launch 定向 Playwright E2E：1 项通过。
  - LeafBook 品牌基础定向 Vitest：13 项通过。
  - `pnpm typecheck`：通过。
  - `pnpm lint`：通过（0 errors、135 条上游既有 warnings）。
  - 正确 `v0.1.0` tag 验证通过，错误 `v0.1.1` 按预期失败。
  - 发布文档本地链接、版本来源、13 产物、禁用 updater metadata、
    网站只读 validation 的 `rg` 审计通过。
  - 第三方许可证生成前后 SHA-256 一致，品牌/updater/undefined 审计
    通过。
  - `git diff --check`：通过。
- 关键决策：
  - GitHub Release 的准确资产数为 14：13 个安装包/归档加
    `SHA256SUMS.txt`；构建产生的 updater 中间文件不进入发布集合。
  - `packages/desktop/package.json` 是版本权威来源；AppStream 和社区
    模板中的版本值只是由门禁校验的派生镜像。
  - 当前下载仅有 SHA-256 完整性校验，不把它描述为平台签名或公证。
- 尚未解决的问题：
  - macOS 签名/公证、Windows 代码签名和项目自有安全更新渠道尚未建立。
  - Windows/Linux 的真实安装与包格式验证仍由相应 CI runner 执行。
- Git commit：无（按要求未提交、未推送）。

## 2026-07-28 — Phase 2 文档收尾：继承网站与 hotfix 流程

- 用户目标：修正继承网站 README 与 hotfix 发布说明，使其准确反映
  LeafBook 当前技术栈、只读网站验证策略和统一发布门禁；不改其他文件，
  不提交、不推送。
- 实际完成：
  - 将网站 README 从过期的 MarkText React 18/Vite/GitHub Pages 说明改为
    LeafBook 继承文档站点说明，并按 package manifest 记录 Next.js 15、
    React 19、TypeScript 5 和 Tailwind CSS 4。
  - 补充从 monorepo 根目录执行的网站安装、开发、索引、lint、类型检查、
    构建和本地 production server 命令，说明 Next.js `.next/` 输出。
  - 明确 `website-deploy.yml` 只有只读 validation 权限和步骤；LeafBook
    自有站点审核前，不自动或手工部署到旧 MarkText GitHub Pages。
  - 将 hotfix 文档改为 LeafBook 补丁分支流程，并引用 `RELEASE.md` 作为
    完整发布流程唯一文档，避免复制内容漂移。
  - 明确 hotfix 仍以 desktop package 版本为唯一来源、tag 必须完全一致，
    并遵循五个构建 job、13 个安装包/归档加 checksum、禁用 updater
    metadata/blockmap 和 `electron-updater` 的门禁。
- 修改或创建的文件：
  - `packages/website/README.md`
  - `packages/website/content/docs/dev/RELEASE_HOTFIX.md`
  - `WORKLOG.md`
- 测试及结果：
  - 本地 Markdown 链接目标检查通过。
  - README 中依赖版本、Node/pnpm 下限和 package scripts 与
    `package.json` 一致；三个 validation 命令与
    `website-deploy.yml` 一致。
  - release workflow 五个 matrix job 与 hotfix 文档中的版本 SSOT、
    tag、13 个产物加 checksum、updater 禁用策略一致。
  - 旧 React 18/Vite、5173 端口、GitHub Pages 部署、旧 MarkText
    release、24 资产和四平台描述的矛盾文本扫描通过。
  - 网站 lint、TypeScript 类型检查和 Next.js production build 通过；
    build 生成的 `public/docs-index.json` 已恢复，未扩大本次修改范围。
  - `git diff --check`：通过。
- 关键决策：
  - website package 名仍按真实 manifest 使用 `marktext-website`，这是
    当前命令过滤器，不代表允许发布到上游站点。
  - hotfix 文档只描述分支差异；所有可漂移的发布细节以 `RELEASE.md` 和
    workflow 为准。
- 尚未解决的问题：
  - LeafBook 自有网站目标、凭据和公开身份尚未建立。
- Git commit：无（按要求未提交、未推送）。

## 2026-07-28 — Phase 2 网站部署安全收尾

- 用户目标：关闭继承网站中仍可触达旧 MarkText Cloudflare 目标的部署
  路径，校正 LeafBook 安装/发布文档与网站开发说明，刷新搜索索引并补充
  自动化防回归验证；不提交、不推送。
- 实际完成：
  - 从 website package 移除 `cf:build`、`cf:preview`、`cf:deploy`，
    删除 OpenNext Cloudflare 和 Wrangler 依赖，并同步清理 lockfile 与
    workspace 中遗留的 `workerd` 构建许可。
  - 删除仅用于旧站部署的 `wrangler.toml` 和 `open-next.config.ts`，
    同时移除 Next.js 开发配置中的 Cloudflare 初始化；网站保留为本地与
    CI 可构建、不可直接部署的 Next.js 应用。
  - 将活动安装说明改为 LeafBook 当前事实：尚无公开签名版本或自动更新，
    当前从源码构建；未来发布为 13 个平台包/归档加
    `SHA256SUMS.txt`，禁止 `latest*.yml`、`.blockmap` 和 updater
    metadata，且未提供不存在的下载链接。
  - 将 README 和发布指南中的硬编码当前版本改为 desktop package 单一
    来源或通用 `${VERSION}` 流程；发布文档末尾改为当前 LeafBook
    hotfix 指引。
  - 修正 `CLAUDE.md` 的网站技术栈、包过滤命令、3000 端口和 `.next/`
    输出说明。
  - 重生成 `public/docs-index.json`，清除旧 24 assets、自动更新和
    MarkText 发布流程的索引残留。
  - 扩展既有 13 项品牌测试，覆盖危险部署脚本/依赖/配置缺失、活动安装
    文档的发布事实与禁词，以及 README/RELEASE 的版本漂移防护。
- 修改或创建的文件：
  - `README.md`
  - `CLAUDE.md`
  - `pnpm-workspace.yaml`
  - `pnpm-lock.yaml`
  - `packages/website/package.json`
  - `packages/website/next.config.ts`
  - `packages/website/eslint.config.mjs`
  - `packages/website/content/docs/end-user/INSTALLATION.md`
  - `packages/website/content/docs/dev/RELEASE.md`
  - `packages/website/public/docs-index.json`
  - `packages/desktop/test/unit/specs/leafbook-brand-foundation.spec.ts`
  - 删除 `packages/website/wrangler.toml`
  - 删除 `packages/website/open-next.config.ts`
  - `WORKLOG.md`
- 测试及结果：
  - `pnpm install --frozen-lockfile`：通过，锁文件一致。
  - website lint、TypeScript 类型检查和 Next.js production build：
    全部通过。
  - docs index 重生成前后 SHA-256 一致；35 页索引内容审计通过。
  - LeafBook 品牌基础定向 Vitest：13 项通过。
  - `pnpm typecheck`：通过。
  - `pnpm lint`：通过（0 errors、135 条上游既有 warnings）。
  - 危险部署命令、旧配置、安装文档禁词、旧 release 叙述和 CLAUDE
    过期技术栈的 `rg` 审计通过。
  - `git diff --check`：通过。
- 关键决策：
  - 仅删除旧 Cloudflare 部署专用路径，不把继承网站扩展为新的 LeafBook
    发布目标；未来启用部署必须另行评审域名、凭据和公开身份。
  - 应用版本继续只从 `packages/desktop/package.json` 读取，文档示例不
    复制未经校验的当前版本。
  - 保留现有 13 项品牌测试数量，在已有品牌/发布测试内增加网站部署安全
    断言。
- 尚未解决的问题：
  - LeafBook 自有网站目标、域名、凭据和公开下载发布仍未建立。
  - 平台签名、公证与安全自动更新渠道仍未建立。
- Git commit：无（按要求未提交、未推送）。

## 2026-07-28 — Phase 2 继承网站最终隔离与 Linux 文档修正

- 用户目标：将继承的 MarkText 网站明确收敛为不可发布的文档验证工程，
  清除旧域名、下载和部署运行时入口，修正活动 Linux 文档，并补充
  自动化防回归门禁；不全面重写历史上游文档，不提交、不推送。
- 实际完成：
  - 将 website package 从 `marktext-website` 改名为
    `leafbook-docs-validation`，同步更新 CI、README 与 `CLAUDE.md`
    中的 package filter；移除 production `start` 入口，保留 `dev` 和
    `build` 仅供短时本地检查与 CI validation，并关闭 Next.js
    `standalone` server 输出。
  - 删除旧 `middleware.ts` 的 `marktext.me` 主机重定向和 sitemap
    生成入口；将 robots 改为全站 `Disallow`，metadata 设置为
    LeafBook 继承文档 validation 并明确 `noindex`/`nofollow`。
  - 清理 `.gitignore` 与 `tsconfig.json` 中的 `.open-next`、`.wrangler`
    遗留，并在校验真实绝对路径后删除 ignored 的
    `packages/website/.wrangler` 缓存与旧 `.next/standalone` server
    输出。
  - 将网站运行时仓库链接切到当前 LeafBook fork；下载入口改为源码入口，
    明确当前没有公开 LeafBook release 或包管理器安装方式，不再链接旧
    MarkText latest release、赞助或社交入口。
  - 重写活动 `LINUX.md`：记录当前只能从源码构建、未来五种 Linux
    artifact 命名、`SHA256SUMS.txt` 校验边界、LeafBook desktop entry
    位置，以及 `leafbook`、`leafbook-dev`、`leafbook-user-data`
    配置目录约定；不提供不存在的下载。
  - 重生成 35 页 `public/docs-index.json`，并在既有 13 项品牌测试中增加
    package 启动/部署脚本、旧中间件/sitemap、noindex、旧域名/latest
    下载和 Linux 活动文档防回归断言。
- 修改或创建的文件：
  - `.github/workflows/website-deploy.yml`
  - `CLAUDE.md`
  - `packages/website/.gitignore`
  - `packages/website/README.md`
  - `packages/website/package.json`
  - `packages/website/tsconfig.json`
  - `packages/website/content/docs/end-user/LINUX.md`
  - `packages/website/public/docs-index.json`
  - `packages/website/src/app/layout.tsx`
  - `packages/website/src/app/robots.ts`
  - `packages/website/src/components/Download.tsx`
  - `packages/website/src/components/Footer.tsx`
  - `packages/website/src/components/Hero.tsx`
  - `packages/website/src/components/Nav.tsx`
  - `packages/website/src/components/Support.tsx`
  - `packages/website/src/lib/downloads.ts`
  - `packages/desktop/test/unit/specs/leafbook-brand-foundation.spec.ts`
  - 删除 `packages/website/src/middleware.ts`
  - 删除 `packages/website/src/app/sitemap.ts`
  - `WORKLOG.md`
- 测试及结果：
  - `pnpm install --frozen-lockfile`：通过。
  - website lint、TypeScript 类型检查和 Next.js validation build：
    全部通过；构建只生成 `/robots.txt`，不再生成 sitemap。
  - 文档索引生成通过，共 35 页。
  - LeafBook 品牌基础定向 Vitest：13 项全部通过。
  - `pnpm typecheck`：通过。
  - `pnpm lint`：通过，0 errors；保留 135 条本次未引入的既有 warnings。
  - website runtime 与活动安装页中的 `marktext.me`、旧 MarkText latest
    release、OpenNext/Wrangler、旧 package 名和危险 script 的 `rg`
    审计通过。
  - `git diff --check`：通过。
- 关键决策：
  - 不把继承展示层继续改造成 LeafBook 产品网站；保留它只为文档解析、
    搜索索引和静态构建校验，任何 `.next/` 输出均禁止发布。
  - `dev` 仅用于短时本地检查，不提供可启动 production server 的
    `start` script；未来产品站需作为独立、另行评审的工作引入。
  - 仅修正当前导航中的 Linux 安装页，不批量改写 changelog、翻译和其他
    明确属于上游历史的文档。
- 尚未解决的问题：
  - LeafBook 自有网站、公开下载、签名/公证和自动更新渠道尚未建立。
- Git commit：将随本次提交入库，最终 SHA 见 Git 历史（不推送）。

## 2026-07-28 — Phase 4 第二轮刷新一致性与阅读器语义返修

- 用户目标：收紧书籍刷新并发、稳定节点身份、迟到异步响应、响应式面板和阅读器
  键盘/目录可访问性；不增加功能或依赖，不提交、不推送。
- 实际完成：
  - 主进程刷新改为同一 `sessionId` 的离线构建与原子替换；刷新失败保留旧
    session，仅 root identity 致命变化会使其失效；同 session 并发刷新合并，
    close/remove 期间完成的刷新不会复活 session。
  - opaque node ID 改按 Phase 3 领域 `node.id` / occurrence 稳定复用；完全重复
    path + fragment 的节点仍拥有唯一 target，group 与 landing ID 同样可跨刷新
    保持稳定。
  - renderer 将 `openNode` 串行在进行中的 refresh 之后，并继续用 generation、
    session 和 mode 快照拒绝迟到结果；remove 后的异步 list 完成时再次复核状态。
  - 701–980px 隐藏不可见 outline 对应的 toggle；无 landing 的 group 标题只
    提供 disclosure 行为和 `aria-expanded`，不会触发章节打开。
  - 全局 Left/Right 翻章只接受无 modifier 且来源非链接、按钮、表单控件或
    editable content 的事件。
  - 只读 Markdown 渲染为重复 heading ID 生成确定性唯一后缀，outline 与正文
    一一对应并可精确跳转。
  - 更新 Phase 4 阅读器契约与测试覆盖说明。
- 修改或创建的文件：
  - `docs/BOOK_READER.md`
  - `packages/desktop/src/main/book/sessionManager.ts`
  - `packages/desktop/src/renderer/src/book/renderMarkdown.ts`
  - `packages/desktop/src/renderer/src/components/bookWorkspace/index.vue`
  - `packages/desktop/src/renderer/src/components/bookWorkspace/BookTreeNode.vue`
  - `packages/desktop/src/renderer/src/store/books.ts`
  - `packages/desktop/test/unit/specs/book-reader.spec.ts`
  - `WORKLOG.md`
- 测试及结果：
  - Phase 4 定向单元测试：20 项通过。
  - desktop 全量单元测试：53 个测试文件、827 项通过。
  - `pnpm --filter leafbook typecheck`：通过。
  - `pnpm lint`：通过，0 errors；保留 135 条上游既有 warnings。
  - `pnpm build`：Electron main、preload、renderer production build 通过；
    仅有既有 CodeMirror 动静态导入提示。
  - `pnpm test:e2e`：LeafBook `book-reader.spec.ts` 通过；全套 215 项通过、
    4 项跳过，另有 1 项既有 `editor-input.spec.ts` 键盘输入时序失败（预期
    `typed-token`，仅输入到 `typed-toke`）。单文件复跑仍在不同位置提前停止，
    与本轮 reader/session 改动无调用路径重叠。
  - 本轮文件 Prettier check：通过。
  - `git diff --check`：通过。
- 关键决策：
  - refresh 不再创建新授权能力；成功只替换同一个 session 的内部快照，因此
    renderer 迟到响应无需关闭未知新 session，也不会泄漏授权。
  - DTO 仍只暴露随机 opaque ID；领域稳定 ID 仅作为主进程复用映射的内部 key。
  - 中等宽度不提供 overlay outline，本阶段选择同步隐藏 toggle，保持界面能力
    与 ARIA 状态一致。
- 尚未解决的问题：无本轮返修阻塞；搜索、进度、本地资源传输等仍不属于 Phase 4。
- Git commit：无（按要求未提交、未推送）。

## 2026-07-28 — Phase 4 书架与沉浸阅读工作区

- 用户目标：在 Phase 3 领域层之上实现书架、书籍目录和沉浸只读阅读；
  不扩展到全文搜索、阅读进度、编辑器桥接或发布，不提交、不推送。
- 实际完成：
  - 新建 main-owned `BookSessionManager`，使用随机 opaque
    library/session/node ID；绝对书根和 node→relative chapter 映射仅保留在
    main，renderer 不能提交任意章节路径。
  - 章节读取复用 Phase 3 descriptor、realpath containment、identity、
    symlink 和 byte-limit 边界；refresh/close/remove 会失效旧会话并返回稳定
    structured errors，会话数量有界。
  - 使用 main-process `electron-store` 持久化书架，运行时校验、根目录去重、
    最多 50 本；renderer DTO 不含绝对路径。移除仅删除书架记录和会话，绝不
    删除原文件夹。
  - 增加 typed invoke IPC 和窄 preload `window.electron.books` API；picker、
    reopen、remove、refresh、close、read、follow-link 全部经过 runtime
    validation。
  - 新增 File → Open Book 菜单、编辑器空态入口与 Book Workspace；实现书架、
    可折叠多级目录、group/root landing、当前节点高亮、上一章/下一章、返回
    书架、刷新、诊断摘要、当前文档 outline、响应式侧栏及暗色变量兼容。
  - 普通编辑器在 reader overlay 下继续挂载，退出书籍模式后原编辑流程可用。
  - 使用 Muya 同步 `renderToStaticHTML` 后执行 HTML-only DOMPurify；图表
    fence 只保留 inert code，不执行 Mermaid/PlantUML/Vega；禁 SVG/MathML、
    active HTML/事件/资源属性，移除原生 href，本地图片变为安全占位。内部链接
    只能跳到当前模型已知章节；外链在 main 打开前按 Phase 3 allowlist 再验证。
  - 增加语义 nav/main/aside、aria-current/expanded/label、原生按钮键盘行为、
    focus-visible、方向键翻章及 loading/empty/error 状态。
- 修改或创建的文件：
  - `docs/BOOK_READER.md`
  - `packages/desktop/src/shared/types/bookReader.ts`
  - `packages/desktop/src/shared/types/ipc.ts`
  - `packages/desktop/src/main/book/filesystem.ts`
  - `packages/desktop/src/main/book/sessionManager.ts`
  - `packages/desktop/src/main/ipc/books.ts`
  - `packages/desktop/src/main/menu/templates/file.ts`
  - `packages/desktop/src/preload/index.ts`
  - `packages/desktop/src/renderer/src/book/*`
  - `packages/desktop/src/renderer/src/store/books.ts`
  - `packages/desktop/src/renderer/src/components/bookWorkspace/*`
  - `packages/desktop/src/renderer/src/components/recent/index.vue`
  - `packages/desktop/src/renderer/src/pages/app.vue`
  - `packages/desktop/test/unit/specs/book-reader.spec.ts`
  - `packages/desktop/test/e2e/book-reader.spec.ts`
  - `WORKLOG.md`
- 测试及结果：
  - Phase 4 定向单元测试：5 项全部通过。
  - Electron vertical slice：1 项通过；覆盖打开书→目录→章节→下一章→
    书架→普通编辑器，且无 renderer error。
  - `pnpm --filter leafbook typecheck`：通过。
  - `pnpm --filter leafbook build`：main、preload、renderer production build
    通过；仅有既有 CodeMirror 动静态导入提示。
  - desktop 全量单元测试：53 个测试文件、812 项全部通过。
  - desktop 全量 E2E：216 项通过、4 项既有 skip、0 项失败。
  - `pnpm lint`：通过，0 errors；新增 warning 已清零，保留 135 条既有
    warnings。
  - Prettier check 与 `git diff --check`：通过。
  - 真实 Electron GUI smoke 截图已检查；发现并修复递归目录按钮未继承父
    scoped reset 导致的原生边框，三栏布局、当前章节、outline 与翻章状态正常。
- 关键决策：
  - Phase 4 不建立任意 path 或 `file://` bridge；本地资源先显示占位，后续
    必须设计 session-scoped resource transport 才可加载。
  - 书籍 UI 是现有 editor shell 上的模式层，不替换 Muya 编辑器或修改
    Markdown 数据结构，降低与上游同步风险。
  - serialized external URL 不代表授权；main 必须根据当前 session node 或
    当前章节 link 重新解析后才能调用 Electron shell。
- 尚未解决的问题：
  - 本地图片/附件、Mermaid/KaTeX 专用只读增强、全文搜索、阅读进度、批注、
    编辑器桥接和发布均留待后续 phase。
- Git commit：无（按要求未提交、未推送）。

## 2026-07-28 — Phase 4 安全、并发与窗口完整性返修

- 用户目标：修复 Phase 4 审查发现的活动图表渲染、根目录替换、跨窗口会话、
  书架并发写、renderer 异步竞态、frameless 窗口控制和无障碍问题；不扩展
  Phase 5，不提交、不推送。
- 实际完成：
  - 阅读渲染切换到 Muya 静态 API；DOMPurify 固定 HTML-only profile，禁止
    SVG/MathML、样式、表单、媒体和嵌入内容，并在序列化前再次移除所有资源
    属性及非 anchor href；anchor 仅保留 main 复核用 `data-book-href`。
  - main 会话钉住 canonical realpath 与 bigint dev/ino，在 read/refresh/
    follow 前后复核；同路径 rename/replace/symlink 会稳定失效且不返回替代
    根内容。
  - 会话绑定创建它的 `webContents.id`，跨窗口操作失败，renderer destroyed
    自动清理；容量改为 per-owner，避免一个窗口淘汰另一个窗口。
  - 书架 open/remove 的 read-modify-write 进入串行 mutation queue，避免并发
    丢更新；refresh 复用仍存在章节的 opaque node ID，并去除 README 已在目录
    时重复的 Book home。
  - Pinia IPC action 统一 try/catch/finally、pending 计数和 generation token；
    旧 picker/library/chapter/refresh/mode 响应不再覆盖新状态。章节渲染 watch
    使用 cleanup token 与 session/node snapshot。
  - 书籍模式复用既有 TitleBar，保留 Windows/Linux frameless controls 与
    macOS 顶部 inset；补充 delegated link Enter/Space、书封 label、面板
    expanded/controls、移动端选择后收起及 Escape 关闭并恢复焦点。
- 修改或创建的文件：
  - `docs/BOOK_READER.md`
  - `packages/desktop/src/main/book/sessionManager.ts`
  - `packages/desktop/src/main/ipc/books.ts`
  - `packages/desktop/src/renderer/src/book/renderMarkdown.ts`
  - `packages/desktop/src/renderer/src/store/books.ts`
  - `packages/desktop/src/renderer/src/components/bookWorkspace/index.vue`
  - `packages/desktop/src/renderer/src/pages/app.vue`
  - `packages/desktop/test/unit/specs/book-reader.spec.ts`
  - `WORKLOG.md`
- 测试及结果：
  - Phase 4 定向单元测试：14 项通过。
  - desktop 全量单元测试：53 个测试文件、821 项通过。
  - desktop 全量 E2E：216 项通过、4 项既有 skip、0 项失败。
  - desktop Typecheck 与 production build：通过；build 仅有既有
    CodeMirror 动静态导入提示。
  - 全量 lint：通过，0 error、135 条既有 warning；返修文件没有新增 warning。
  - Prettier 写入和 `git diff --check`：通过。
  - targeted Electron GUI smoke 通过；截图复核三栏阅读、共享 titlebar 顶部
    inset、当前章节/outline、disabled Next 和上下章布局正常。
- 关键决策：
  - 书籍阅读器不复用会执行 diagram 的异步 HTML renderer；本地资源继续只显示
    占位，不新增 `file://` 或任意路径 bridge。
  - renderer 声称的 owner 不可信；owner 只从主进程 IPC event sender 推导。
  - refresh 只在目标仍属于新模型时保留当前节点，否则回到 entry。
- 尚未解决的问题：无 Phase 4 阻塞；本地资源加载、搜索、进度等继续留待后续
  phase。
- Git commit：无（按要求未提交、未推送）。

## 2026-07-28 — Phase 3 书籍领域模型与 GitBook 导航解析

- 用户目标：在 LeafBook 品牌基础提交上继续 Phase 3，只实现可供后续 UI
  使用的书籍领域模型、`SUMMARY.md` 解析、无 SUMMARY 推断和安全文件系统
  扫描；不实现 UI、IPC，不提交、不推送。
- 实际完成：
  - 从 `6f62c95b26162b9644bc55ba76b92a2970855950` 创建本地分支
    `feature/leafbook-book-domain`，确认开始时工作树干净。
  - 新增可序列化的 `Book`、metadata、navigation、chapter/group/external
    node、source/order 与结构化 diagnostic 模型；领域层只保存 POSIX
    书根相对路径，不保存绝对书根或 Electron/文件句柄状态。
  - 实现纯 TypeScript 的 SUMMARY 解析器，支持标题/分组 heading、嵌套
    无序列表、中文标题、`.md`/`.markdown`、URL 编码空格、独立 fragment、
    安全外链、顺序保持及同文件去重。
  - 实现纯构建器：SUMMARY 存在时严格以其顺序为准并报告缺失和孤儿文档；
    无 SUMMARY 时确定性推断目录树，目录 landing page 不重复显示；入口
    优先 SUMMARY 首个存在的本地页面，再回退根 README/index。
  - 明确 README/index 选择策略：优先精确
    `README.md`、`README.markdown`、`index.md`、`index.markdown`，再按相同
    次序选择大小写不敏感匹配；标题优先正文首个 H1，再回退文件名/目录名。
  - 新增 main-process 文件系统适配器：realpath 书根边界、symlink 逃逸和
    环路防护、隐藏目录/`.git`/`node_modules` 忽略、可配置 exclude、
    深度/文件数上限及非崩溃式诊断。
  - 拒绝绝对路径、Windows 绝对路径、`file://`、NUL、`../`/编码目录
    逃逸、查询串、畸形 URL 编码和非 Markdown 本地目标；未增加依赖或
    修改 lockfile。
  - 增加 Phase 4 可直接遵循的领域契约与安全边界文档。
- 修改或创建的文件：
  - `docs/BOOK_DOMAIN.md`
  - `packages/desktop/src/common/book/model.ts`
  - `packages/desktop/src/common/book/path.ts`
  - `packages/desktop/src/common/book/summary.ts`
  - `packages/desktop/src/common/book/builder.ts`
  - `packages/desktop/src/common/book/index.ts`
  - `packages/desktop/src/main/book/filesystem.ts`
  - `packages/desktop/src/main/book/index.ts`
  - `packages/desktop/test/unit/specs/book-domain.spec.ts`
  - `WORKLOG.md`
- 测试及结果：
  - Phase 3 定向 Vitest：20 项全部通过。
  - desktop 全量单元测试：52 个测试文件、767 项全部通过。
  - `pnpm --filter leafbook typecheck`：通过。
  - Phase 3 新增路径定向 ESLint：通过。
  - `pnpm lint`：通过，0 errors；保留 135 条本次未引入的既有 warnings。
  - `pnpm build`：Electron main、preload、renderer production build
    全部通过；仅有既有 CodeMirror 动静态导入提示。
  - `git diff --check`：通过。
- 关键决策：
  - pure parse/build 与 Node fs adapter 分离，后续 renderer 只消费可序列化
    模型；绝对根路径必须留在 main-process I/O 边界。
  - 导航身份为 `path + fragment`；同一 Markdown 文件可以在不同锚点出现，
    完全相同的目标保留稳定 occurrence ID 并仅产生一条重复诊断。文件存在性
    与孤儿检查仍按物理 path。
  - SUMMARY 是权威编排，不自动追加未列出的 Markdown；只通过
    `orphaned-chapters` diagnostic 告知数量。
  - 目录 README/index 通过 group/root `landingPath` 表达，不再创建重复
    chapter node。
- 尚未解决的问题：
  - Phase 4 尚需设计窄 IPC、书籍状态管理和导航 UI，并确保外链打开仍走
    Electron 的受控外部链接策略。
  - `book.yaml` 等扩展元数据、全文索引、阅读进度和发布能力不属于 Phase 3。
- Git commit：无（按要求未提交、未推送）。

## 2026-07-28 — Phase 3 安全与边界返修

- 用户目标：继续 Phase 3，按审查清单返修书籍领域层与文件系统扫描器；
  不扩大到 UI/IPC，不增加依赖，不提交、不推送。
- 实际完成：
  - 将物理文件路径与 SUMMARY URL 目标彻底分离：物理路径不再 URL decode，
    SUMMARY 目标仅 decode 一次，保留 `a%20b.md` 与 `a b.md` 的独立身份。
  - 对 common 输入增加 runtime 约束，收口 `rootName`、SUMMARY 路径、文件
    路径与外部 diagnostic；绝对路径及 Node 原始错误不会进入可序列化模型。
  - 外链改用 WHATWG URL，仅接受显式 HTTP/HTTPS/mailto，拒绝协议相对、
    credentials、file、控制字符、畸形 URL 和其他 scheme，并保存 canonical
    URL。
  - SUMMARY 解析器增加正确 fence 处理与无效 list sentinel；重复身份改为
    path+fragment，不同锚点合法，完全相同目标只报一次并使用 occurrence ID。
  - builder 使用目录 trie，增加 files/nodes/depth/content/diagnostics 硬上限、
    NFC+casefold 冲突诊断、SUMMARY 行号透传、特殊根文件孤儿排除及正确长度
    fence H1 提取。
  - scanner 增加 finite integer 默认/钳制和 files/directories/entries/
    diagnostics/per-file/total/SUMMARY bytes 独立预算；SUMMARY 在普通遍历前
    优先安全加载且不消耗 maxFiles。
  - 禁止遍历任何目录 symlink；文件使用可用时的 `O_NOFOLLOW`、handle
    `fstat`、当前 realpath/identity/containment 复核后从句柄读取，并提供
    可测试的替换竞态 seam；文档明确无 openat 时残留的父目录竞态。
  - 补充所有审查反例测试并重写 Phase 3 领域契约。
- 修改或创建的文件：
  - `docs/BOOK_DOMAIN.md`
  - `packages/desktop/src/common/book/model.ts`
  - `packages/desktop/src/common/book/path.ts`
  - `packages/desktop/src/common/book/summary.ts`
  - `packages/desktop/src/common/book/builder.ts`
  - `packages/desktop/src/main/book/filesystem.ts`
  - `packages/desktop/test/unit/specs/book-domain.spec.ts`
  - `WORKLOG.md`
- 测试及结果：
  - Phase 3 定向 Vitest：39 项通过。
  - `pnpm --filter leafbook typecheck`：通过。
  - desktop 全量单元测试：52 个测试文件、786 项通过。
  - `pnpm lint`：通过，0 errors；保留 135 条既有 warnings。
  - `pnpm build`：Electron main、preload、renderer production build 通过；
    仅有既有 CodeMirror 动静态导入提示。
  - `git diff --check`：通过。
- 关键决策：
  - SUMMARY 选择固定为精确 `SUMMARY.md` 优先、精确
    `SUMMARY.markdown` 备选；未选择候选既不参与导航也不计孤儿。
  - root README/index 是 landing/标题/入口回退语义，不因未列入 SUMMARY
    被报告为孤儿。
  - Phase 4 在主进程真正打开外链前必须再次验证，serialized URL 不是授权。
- 尚未解决的问题：
  - UI、IPC、书架状态、阅读页面和主进程外链打开属于 Phase 4。
- Git commit：无（按要求未提交、未推送）。

## 2026-07-28 — Phase 3 第二轮边界收口

- 用户目标：按复审清单进一步收紧 Phase 3 的不可信输入、解析/扫描工作量、
  文件描述符读取与竞态说明；保持无 UI、IPC、依赖、提交和推送。
- 实际完成：
  - 外部 diagnostic 改为按 code 重建稳定 severity/message，绝不透传任意
    Node/raw message；空或非法 source/related path 被丢弃。
  - SUMMARY parser 增加 characters/lines/nodes/depth/diagnostics/list items/
    link destination/fragment 独立硬上限，并在继续循环或创建节点前生效。
  - pure builder 对候选 files 和 incoming diagnostics 按迭代次数早停，对原始
    content characters 先预算再编码；非法和重复候选同样消耗候选预算。
  - scanner 改用 `opendir` 有界异步迭代；单目录读取到上限加一后关闭并整目录
    跳过，同时保留全局 entry 早停；exclude 增加数量、单项和总字符预算并只
    预编译一次。
  - 文件与 SUMMARY 改为 descriptor 循环读取至 byte limit + 1，不再使用
    `readFile`；使用 `TextDecoder`，读取前后复核 fstat identity/size，并区分
    identity replacement、same-inode change 和 byte growth。
  - chapter identity/ID 改用无歧义 JSON tuple，消除 path/fragment 内 `#`
    导致的串联碰撞。
  - filesystem 入口拒绝 relative、empty、null root 并返回结构化结果，不
    调用 `path.resolve`；所有扫描 options 均 runtime 校验和钳制。
  - 更新 Phase 4 picker 授权要求、主进程重验和父目录并发 namespace 残余
    race 的精确契约说明。
- 修改或创建的文件：
  - `docs/BOOK_DOMAIN.md`
  - `packages/desktop/src/common/book/model.ts`
  - `packages/desktop/src/common/book/summary.ts`
  - `packages/desktop/src/common/book/builder.ts`
  - `packages/desktop/src/main/book/filesystem.ts`
  - `packages/desktop/test/unit/specs/book-domain.spec.ts`
  - `WORKLOG.md`
- 测试及结果：
  - Phase 3 定向 Vitest：51 项通过。
  - 定向 ESLint：通过。
  - desktop 全量单元测试：52 个测试文件、798 项通过。
  - `pnpm --filter leafbook typecheck`：通过。
  - `pnpm lint`：通过，0 errors；保留 135 条既有 warnings。
  - `pnpm build`：Electron main、preload、renderer production build 通过；
    仅有既有 CodeMirror 动静态导入提示。
  - `git diff --check`：通过。
- 关键决策：
  - SUMMARY 即使位于超大根目录仍先以独立预算直接探测；普通目录超限时不接受
    依赖底层枚举顺序的部分结果。
  - 诊断文本属于领域协议的一部分，只能由受控 code 映射生成；调用方文本不
    是可序列化边界内的可信数据。
  - Node 缺少 openat 风格能力，故只承诺静态 symlink 拒绝与内容 descriptor
    containment，不宣称并发父目录命名空间不可变。
- 尚未解决的问题：
  - UI、IPC、书架状态、阅读页面和受控外链打开仍属于 Phase 4。
- Git commit：无（按要求未提交、未推送）。

## 2026-07-28 — Phase 3 最终边界与容量语义返修

- 用户目标：完成 Phase 3 最后一轮小范围返修，修复稳定文件身份、运行时输入、
  根目录错误码和容量诊断误报；不扩展到 UI/IPC，不增加依赖，不提交、不推送。
- 实际完成：
  - 文件读取前后统一使用 bigint stat，比较 `dev`、`ino`、`size`、`mtimeNs`
    和 `ctimeNs`；同 inode、同长度且恢复 mtime 的覆写仍会产生
    `scan-file-changed`，内容不会进入书籍模型。
  - `buildBook` 对顶层运行时输入做归一化；`undefined`、`null`、数组及其他
    非对象输入返回安全空结果和受控诊断，不抛异常。
  - 新增稳定错误码 `scan-root-error`（error），用于非法、缺失、不可读或
    非目录 root；单个目录项/文件读取失败继续映射为 `scan-read-error`
    （warning）。
  - 修正容量诊断语义：`maxFiles`、`maxNodes`、SUMMARY `maxLines` 仅在观察到
    真实额外候选并发生截断时报告；末尾换行不再产生虚假行溢出。额外文件探测
    仍受 entry/directory/depth/per-directory 上限约束。
  - 仅对 Phase 3 TypeScript、测试、领域文档和工作日志执行 Prettier 写入，
    并补充精确上限与真实溢出的成对回归测试。
- 修改或创建的文件：
  - `docs/BOOK_DOMAIN.md`
  - `packages/desktop/src/common/book/model.ts`
  - `packages/desktop/src/common/book/path.ts`
  - `packages/desktop/src/common/book/summary.ts`
  - `packages/desktop/src/common/book/builder.ts`
  - `packages/desktop/src/main/book/filesystem.ts`
  - `packages/desktop/test/unit/specs/book-domain.spec.ts`
  - `WORKLOG.md`
- 测试及结果：
  - Phase 3 定向 Vitest：60 项通过。
  - `pnpm --filter leafbook typecheck`：通过。
  - Phase 3 定向 ESLint：通过。
  - Phase 3 文件 Prettier check：通过。
  - desktop 全量单元测试：52 个测试文件、807 项通过。
  - `pnpm lint`：通过，0 errors；保留 135 条既有 warnings。
  - `pnpm build`：Electron main、preload、renderer production build 通过；
    仅有既有 CodeMirror 动静态导入提示。
  - `git diff --check`：通过。
- 关键决策：
  - 文件“未变化”要求身份、长度及纳秒级 mtime/ctime 全部稳定；ctime 用于覆盖
    攻击者恢复 mtime 的同 inode 覆写场景。
  - 达到容量上限本身不是错误；只有确认存在无法接纳的下一个合格对象时才报告
    overflow/truncation。
  - root 级失败与项目内局部读取失败使用不同稳定 code/severity，便于 Phase 4
    UI 做明确状态展示。
- 尚未解决的问题：
  - UI、IPC、书架状态、阅读页面和受控外链打开仍属于 Phase 4。
- Git commit：将随本次提交入库，最终 SHA 见 Git 历史（不推送）。

## 2026-07-28 — Phase 4 最终授权撤销与链接路径安全收口

- 用户目标：修复本地链接绝对路径 fallback 与 session 异步撤销竞态，确保
  renderer cleanup 后未完成的打开、读取、刷新或外链操作不能恢复授权或产生
  shell side effect；不提交、不推送。
- 实际完成：
  - `localHrefTarget` 在任何相对 fallback 前解码 path，并拒绝 `/`、反斜杠/
    UNC、Windows drive 等绝对或根路径；编码后的根路径不能经 normalize 降级
    成相对路径。
  - session root 校验改为区分 `valid`、`invalid` 和 `revoked`，每次异步
    filesystem/shell 边界后都比较 owner 与原 session 对象身份。
  - deferred chapter read 遇到 close、remove 或 cleanup 时统一丢弃迟到结果并
    返回 `session-not-found`。
  - external link 在 `shell.openExternal` 前再次验证原 session，完成或失败后
    也复核；cleanup 在 root validation 期间发生时不会触发 shell。
  - picker/open lifecycle 引入 owner generation；dialog、root identity、scan
    和 shelf mutation queue 每次 await 后复核，cleanup 先完成时既不写书架也
    不注册 session。
  - 补充 refresh single-flight、绝对路径和完整撤销竞态回归测试，并更新阅读器
    安全契约。
- 修改或创建的文件：
  - `docs/BOOK_READER.md`
  - `packages/desktop/src/main/book/sessionManager.ts`
  - `packages/desktop/test/unit/specs/book-reader.spec.ts`
  - `WORKLOG.md`
- 测试及结果：
  - Phase 4 定向单元测试：26 项通过。
  - `pnpm --filter leafbook typecheck`：通过。
  - desktop 全量单元测试：53 个测试文件、833 项通过。
  - `pnpm lint`：通过，0 errors；保留 135 条上游既有 warnings。
  - `pnpm build`：Electron main、preload、renderer production build 通过；
    仅有既有 CodeMirror 动静态导入提示。
  - LeafBook reader E2E：1 项通过。
  - 本轮文件 Prettier check：通过。
  - `git diff --check`：通过。
- 关键决策：
  - session 撤销以对象身份而非仅 opaque ID 判断，避免同 ID 原子 refresh 或
    迟到操作混淆旧、新授权快照。
  - owner generation 单调递增且不复用；同一 Electron owner ID 后续新 open
    可使用新 generation，旧异步链永久失效。
  - 外链协议 allowlist 与 session lifecycle 是两道独立门禁，两者都必须在
    side effect 前保持有效。
- 尚未解决的问题：无本轮授权安全 blocker。
- Git commit：无（按要求未提交、未推送）。

## 2026-07-28 — Phase 4 最终 P2：移动目录 Escape 与绝对链接空白绕过

- 用户目标：修复移动端目录焦点位于交互元素时 Escape 无法关闭，以及本地链接
  decoded path 可借前导空白绕过绝对路径预检的问题；增加真实 Electron 回归，
  不修改 `ownerGenerations`，不提交、不推送。
- 实际完成：
  - 将 reader 全局键盘处理中的 Escape/目录关闭逻辑移到交互元素 early-return
    之前；交互元素现在只短路左右章节导航。目录关闭后等待 DOM 更新并将焦点
    返回 `Contents` 按钮。
  - 新增 650×800 真实 Electron E2E，显式关闭再打开移动目录、聚焦
    `.tree-label` 按钮并按 Escape，验证目录移除、`aria-expanded=false` 且焦点
    回到目录开关。
  - `localHrefTarget` 在 URL decode 后按 `resolveBookTarget` 一致的 `trim()`
    语义规范化 path，再进行 POSIX root、反斜杠/UNC 和 Windows drive 绝对路径
    检查；document-relative fallback 复用同一规范化 decoded path。
  - 扩展安全回归，覆盖前导和尾随 ASCII whitespace、编码斜杠、drive 与 UNC
    绝对路径。
- 修改或创建的文件：
  - `packages/desktop/src/renderer/src/components/bookWorkspace/index.vue`
  - `packages/desktop/src/main/book/sessionManager.ts`
  - `packages/desktop/test/unit/specs/book-reader.spec.ts`
  - `packages/desktop/test/e2e/book-reader.spec.ts`
  - `WORKLOG.md`
- 测试及结果：
  - Phase 4 定向单元测试：26 项通过。
  - `pnpm typecheck`：通过。
  - `pnpm lint`：通过，0 errors；保留 135 条上游既有 warnings。
  - `pnpm build`：Electron main、preload、renderer production build 通过；
    仅有既有 CodeMirror 动静态导入提示。
  - LeafBook reader E2E：2 项通过，含新增移动目录焦点回归。
  - 本轮四个代码/测试文件 Prettier check：通过。
  - `git diff --check`：通过。
- 关键决策：
  - Escape 是 drawer 级关闭操作，不应被 drawer 内部按钮、链接或表单控件吞掉；
    左右方向键仍不会在交互元素上触发章节导航。
  - 绝对路径判定和 fallback 必须共享 resolver 的 whitespace 规范化语义，避免
    预检与最终解析看到不同 path。
- 尚未解决的问题：
  - `ownerGenerations` 的 P3 审查项按范围要求暂不修改。
- Git commit：将随本次提交入库，最终 SHA 见 Git 历史（不推送）。

## 2026-07-28 — Phase 5 阅读进度与章节位置记忆

- 用户目标：在 Phase 4 只读书籍工作区之上实现 main-owned 阅读进度与每章
  位置记忆，支持书架进度展示、最后章节恢复和跨进程重启恢复；不扩展到搜索、
  编辑、批注、本地资源桥、同步或发布，不提交、不推送。
- 实际完成：
  - 扩展 `bookshelf.json` 的兼容 schema：每本书可保存最后 main-only stable
    target、最多 500 个章节位置比例、最后章节标题、整体进度和更新时间；旧
    bookshelf 记录继续可读，非法 reading 子记录会被清理而不会丢弃整本书。
  - 复用 Phase 3 稳定 navigation identity 与 occurrence，在 main session 内
    建立 stable key 到随机 opaque node ID 的映射；从不持久化 opaque ID，也不向
    renderer 暴露绝对/相对路径或 stable key。
  - 新增 typed invoke-only `saveReadingPosition(sessionId, nodeId, ratio)` IPC 与
    preload API；main 在书架 mutation queue 内复核 exact session object、owner
    和 pinned root identity，close/remove/cleanup/root replacement 可阻止迟到
    写入。
  - 整体进度严格按 Previous/Next 相同的 readable order 计算：
    `(chapter index + chapter ratio) / chapter count`；重复目标 occurrence 独立，
    refresh 后目标删除则安全回退 entry 和 0 session progress。
  - renderer 使用 400ms throttle 加 trailing flush 保存滚动比例，章节导航、
    返回书架和卸载前尽力 flush；独立请求序号及 session/node guard 防止迟到
    结果覆盖新阅读状态。
  - Markdown 渲染后按 `fragment > saved ratio > top` 恢复位置，并抑制程序化
    恢复产生的 scroll 回写。移除 `.book-content` 全局 smooth scrolling，避免
    异步动画在恢复抑制结束后写入中间比例；用户点击 outline 仍显式平滑滚动。
  - 书架卡片和 reader header 增加带可访问名称的原生 progress 元素、百分比和
    “Continue from”章节提示。
  - 更新阅读器契约，补充持久化边界、容量、授权撤销、进度公式与恢复优先级。
- 修改或创建的文件：
  - `docs/BOOK_READER.md`
  - `packages/desktop/src/main/book/sessionManager.ts`
  - `packages/desktop/src/main/ipc/books.ts`
  - `packages/desktop/src/preload/index.ts`
  - `packages/desktop/src/shared/types/bookReader.ts`
  - `packages/desktop/src/shared/types/ipc.ts`
  - `packages/desktop/src/types/global.d.ts`
  - `packages/desktop/src/renderer/src/store/books.ts`
  - `packages/desktop/src/renderer/src/components/bookWorkspace/index.vue`
  - `packages/desktop/test/unit/specs/book-reader.spec.ts`
  - `packages/desktop/test/e2e/book-reader.spec.ts`
  - `WORKLOG.md`
- 测试及结果：
  - Phase 5 定向单元测试：33 项通过。
  - desktop 全量单元测试：53 个测试文件、840 项通过。
  - `pnpm --filter leafbook typecheck`：通过。
  - `pnpm lint`：通过，0 errors；保留 135 条上游既有 warnings。
  - `pnpm --filter leafbook build`：main、preload、renderer production build
    通过；仅有既有 CodeMirror 动静态导入提示。
  - LeafBook reader E2E：3 项通过；新增长书滚动、书架进度、重开恢复章节和
    近似滚动比例的纵向闭环。
  - Phase 5 文件定向 ESLint：通过，0 errors、0 warnings。
  - Phase 5 文件 Prettier check 与 `git diff --check`：通过。
- 关键决策：
  - 持久化 stable target 而非 session opaque ID；stable target 只存在 main
    用户数据和 session 内部，renderer 继续只能操作随机 ID。
  - 每章保存相对 scroll ratio 而非像素，降低窗口尺寸和内容布局变化导致的漂移。
  - 滚动写入进入既有书架串行队列；save 先完成再 remove 时最终记录仍被删除，
    remove/cleanup/close 先完成时 save 返回 session expired。
  - Refresh 不强制先保存：若书根已被替换，Refresh 自己负责返回
    `book-unavailable`，避免前置 save 先撤销 session 而改变既有错误语义。
- 尚未解决的问题：
  - 全书搜索属于下一 phase；编辑桥、批注、本地图片/附件与图表增强、发布/
    同步/协作仍不在本阶段范围。
  - Phase 4 已记录的 `ownerGenerations` P3 留项未在本阶段扩围。
- Git commit：无（按要求未提交、未推送）。

## 2026-07-28 — Phase 5 审查返修：可靠 flush 与导航意图

- 用户目标：修复 Phase 5 审查发现的刷新竞态、显式导航与恢复冲突、写放大、
  长标题持久化和跨工作区切换漏 flush；保持 main 授权边界，不进入 Phase 6，
  不提交、不推送。
- 实际完成：
  - 将滚动位置调度统一上移到 Pinia store：可见进度即时更新，持久化使用 2 秒
    trailing debounce；全局最多一个 in-flight 和一个合并后的 latest ratio，
    小于阈值的重复位置不再写盘。
  - `flushReadingPosition` 会等待 timer、in-flight 和 latest 全部完成；刷新、
    章节/链接导航、打开或切换书籍、返回书架/编辑器和卸载统一经过该边界。
    已报告的 scroll pending 优先于 DOM provider，避免迟到 fragment/layout
    滚动覆盖更新的用户滚动。
  - 明确区分 explicit 与 restore intent：目录、前后章和链接使用显式 fragment
    或章节顶部；重开、resume、refresh 在确有保存位置时使用 ratio 并忽略章节
    默认 fragment。章节标题 fragment 还支持按规范化标题 slug 匹配。
  - explicit 切换章节时立即更新 header overall progress 并安全排队保存；恢复
    已有位置不会无意义地先覆盖为 0。
  - main 保存根校验失败不再抢先销毁 session，因此随后 Refresh 仍返回既有
    `book-unavailable` 语义；持久化标题在写入前 NFC、trim 并安全限长 512，
    微小重复保存由 main 再次 no-op。
  - `BookChapterDto` 增加 `hasReadingPosition`，从协议层区分“保存过 0”与“没有
    保存记录”。
- 修改或创建的文件：
  - `docs/BOOK_READER.md`
  - `packages/desktop/src/main/book/sessionManager.ts`
  - `packages/desktop/src/shared/types/bookReader.ts`
  - `packages/desktop/src/renderer/src/store/books.ts`
  - `packages/desktop/src/renderer/src/components/bookWorkspace/index.vue`
  - `packages/desktop/test/unit/specs/book-reader.spec.ts`
  - `packages/desktop/test/e2e/book-reader.spec.ts`
  - `WORKLOG.md`
- 测试及结果：
  - Phase 5 定向单元测试：37 项通过。
  - desktop 全量单元测试：53 个测试文件、844 项通过。
  - `pnpm --filter leafbook typecheck`：通过。
  - `pnpm lint`：通过，0 errors；保留 135 条上游既有 warnings。
  - `pnpm --filter leafbook build`：main、preload、renderer production build
    通过；仅有既有 CodeMirror 动静态导入提示。
  - LeafBook reader E2E：3 项通过，覆盖显式深链接、立即 overall progress、
    重开按 ratio 而非 fragment 恢复，以及防抖窗口内快速滚动后立即刷新。
  - Phase 5 文件 Prettier check 与 `git diff --check`：通过。
- 关键决策：
  - scroll 事件报告的 pending 是最新用户意图；DOM provider 仅在没有 pending
    时补采样，避免布局或 fragment 的迟到滚动反向覆盖用户位置。
  - renderer 负责降低写频率和单航班合并，main 仍独立校验 owner/session/root
    并对微小重复写做最终 no-op，性能优化不削弱安全边界。
  - refresh 必须先等待最新位置落盘；保存遇到 root replacement 只拒绝写入，
    session 的最终失效仍由 refresh/read 的既有路径执行。
- 尚未解决的问题：
  - 全书搜索、编辑桥、批注、本地资源、发布/同步/协作仍属于后续阶段。
  - Phase 4 已记录的 `ownerGenerations` P3 留项未在本次返修扩围。
- Git commit：无（按要求未提交、未推送）。

## 2026-07-28 — Phase 5 第二轮审查返修：恢复隔离与统一阅读顺序

- 用户目标：解决 loading/programmatic restore 产生的迟到位置写入、root landing
  与 tree 阅读顺序不一致、显式 fragment 预写 0，以及卸载 flush 保证描述过强；
  不扩大 Phase 5，不提交、不推送。
- 实际完成：
  - renderer scroll handler、位置 provider 和 store report 在 loading、非 reader、
    无有效 session/chapter 或 programmatic restore 时统一忽略。
  - chapter watcher 改为只跟踪 session/chapter/content/fragment 身份，live ratio
    更新不再触发 Markdown 重渲染和再次恢复；恢复使用同步 watcher 建立 promise，
    正常 transition flush 会等待定位完成。
  - HTML layout 稳定后才执行 ratio/fragment 定位；自动 fragment 使用容器内同步
    offset scroll，定位后再采样实际 ratio。显式 fragment 不再预排队 0，立即
    离开时也会等待并保存 anchor 附近的位置。
  - scroll pending 标记 user/programmatic 来源；新恢复只清理由程序化定位产生的
    pending，不丢用户已报告的最新位置。旧 in-flight 结果仍不能回退 live ratio。
  - main 与 renderer 统一 readable order：独立 root landing 始终位于 tree
    之前，参与 Book home、Previous/Next、保存授权、overall denominator/index
    和重启恢复；README 已在 tree 中时不重复。
  - 文档明确正常 File/recent/open/书架/editor 路径会 await flush，而 Vue
    `onBeforeUnmount` 只能启动 best-effort cleanup，不能宣称同步耐久。
- 修改或创建的文件：
  - `docs/BOOK_READER.md`
  - `packages/desktop/src/main/book/sessionManager.ts`
  - `packages/desktop/src/renderer/src/book/readerModel.ts`
  - `packages/desktop/src/renderer/src/store/books.ts`
  - `packages/desktop/src/renderer/src/components/bookWorkspace/index.vue`
  - `packages/desktop/test/unit/specs/book-reader.spec.ts`
  - `packages/desktop/test/e2e/book-reader.spec.ts`
  - `WORKLOG.md`
- 测试及结果：
  - Phase 5 定向单元测试：40 项通过。
  - desktop 全量单元测试：53 个测试文件、847 项通过。
  - `pnpm --filter leafbook typecheck`：通过。
  - `pnpm lint`：通过，0 errors；保留 135 条上游既有 warnings。
  - `pnpm --filter leafbook build`：main、preload、renderer production build
    通过；仅有既有 CodeMirror 动静态导入提示。
  - LeafBook reader E2E：3 项通过；增强进度用例覆盖 anchor 后不手动滚动立即
    离开/重开、防抖窗口内快速滚动立即 Refresh，以及恢复后超过 2 秒仍保持
    最新比例。
  - Phase 5 文件 Prettier check 与 `git diff --check`：通过。
- 关键决策：
  - root landing 的唯一顺序契约是“未在 tree 中时始终为第一项”，main 与
    renderer 不再分别补丁式处理。
  - programmatic restore 不是用户 scroll；只有定位完成后的明确采样可形成
    fragment 保存值，loading/恢复过程中的浏览器 scroll 事件不得进入队列。
  - component destruction 无法 await Promise；耐久边界由所有正常离开路径的
    store transition flush 提供，unmount 仅保留 best-effort。
- 尚未解决的问题：
  - 全书搜索、编辑桥、批注、本地资源、发布/同步/协作仍属于后续阶段。
  - Phase 4 已记录的 `ownerGenerations` P3 留项未在本次第二轮返修扩围。
- Git commit：无（按要求未提交、未推送）。

## 2026-07-28 — Phase 5 第三轮最终返修：generation-safe 恢复

- 用户目标：保证 Markdown render、DOM mount、layout frame、scroll 和 sample
  任一失败或 stale cleanup 都不会让 flush 永久等待；用产品可观察 ready 状态
  稳定真实 E2E，并以隔离基线判断 editor-input 波动是否由 Phase 5 引入。
- 实际完成：
  - 新增 `restoreReadingPosition` generation-scoped pipeline，以
    `try/catch/finally` 统一覆盖 render、mount、nextTick、双 layout frame、
    position 与 sample；当前 generation 的异常必定 fail 并 release。
  - store restoration API 返回单调 token；complete/cancel 必须携带匹配 token，
    stale generation 不能完成或释放新的 restoration promise。
  - 修复 sync watcher 重入根因：原 getter 每次返回新数组，chapter live update
    会被当成 source 变化而再次恢复；改为 Vue multi-source watch，逐个比较稳定
    sessionId/nodeId/markdown/fragment 标量。
  - 渲染失败清空 HTML/outline 并显示稳定的安全错误，不暴露底层异常；content
    surface 增加 `data-reading-ready` 和 `aria-busy`，真实 E2E 不再用任意 rAF
    数量猜测恢复是否完成。
  - 强化 Reader E2E：anchor 定位后立即离开/重开、0.2 保存/重开、0.82 快速
    scroll 后立即 Refresh、等待超过 2.2 秒、再次书架重开，均验证持久 ratio。
  - 当前 Phase 5 构建与隔离 `21b1eaa6` 基线分别独立运行 editor-input 两轮：
    两侧均为第一轮 8/8、第二轮相同的 typing 用例截断失败而其余 7/8 通过；
    证据表明该输入时序波动为基线 flake，并非 Phase 5 Reader 回归。未修改
    editor-input 产品路径或测试。
- 修改或创建的文件：
  - `docs/BOOK_READER.md`
  - `packages/desktop/src/renderer/src/book/restoreReadingPosition.ts`
  - `packages/desktop/src/renderer/src/store/books.ts`
  - `packages/desktop/src/renderer/src/components/bookWorkspace/index.vue`
  - `packages/desktop/test/unit/specs/book-reader.spec.ts`
  - `packages/desktop/test/e2e/book-reader.spec.ts`
  - `WORKLOG.md`
- 测试及结果：
  - Phase 5 定向单元测试：43 项通过；render/paint 受控失败后均验证
    flush 释放、后续保存成功且可继续导航到下一章节。
  - Reader E2E 完整 spec 连续独立 3 轮：每轮 3/3，共 9/9 通过；修复后另有
    完整单轮 3/3 通过。
  - editor-input 当前 Phase 5：第一轮 8/8；第二轮 7/8，typing 截断。
  - editor-input 隔离基线 `21b1eaa6`：第一轮 8/8；第二轮 7/8，同一 typing
    截断；临时 worktree 已移除。
  - desktop 全量单元测试：53 个文件、850 项全部通过。
  - desktop typecheck：通过。
  - 全量 lint：0 error、135 个既有 warning；Phase 5 文件定向 ESLint：
    0 error、0 warning（仅 Node 报告既有 eslint config module-type 提示）。
  - desktop build：通过；仅保留既有 CodeMirror 动态/静态 import 提示。
  - Phase 5 全部变更文件 Prettier check：通过。
  - `git diff --check`：通过。
- 关键决策：
  - 生命周期释放权由 store token 而不是组件布尔值决定；组件 generation 负责
    DOM 身份，store generation 负责 Promise 所有权，两层均匹配才可 complete。
  - UI ready 是产品状态，不包含路径、stable key 或其他授权数据，可供辅助技术
    与 E2E 判断恢复是否真正结束。
  - 对 editor-input 只做同环境隔离基线对照；两边相同的偶发截断记录为基线
    flake，不以放宽断言或修改非 Reader 产品代码掩盖。
- 尚未解决的问题：
  - editor-input typing 偶发截断属于既有基线 flake，后续应在独立编辑器测试
    稳定性任务中处理。
  - 全书搜索、编辑桥、批注、本地资源、发布/同步/协作仍属于后续阶段。
- Git commit：无（按要求未提交、未推送）。

## 2026-07-28 — Phase 5 最终极小返修：bounded paint wait

- 用户目标：防止隐藏或后台窗口停止派发 `requestAnimationFrame` 时，阅读位置
  恢复和导航 flush 永久等待；要求双帧成功路径、短超时 fallback、可取消清理
  和无 rAF 环境均安全。
- 实际完成：
  - 新增 180 ms 有界 `waitForPaint`：优先等待双 rAF，超时只继续布局流程，
    不作为渲染失败。
  - rAF、timeout 或 AbortSignal 任一路完成时，统一取消剩余 frame、清除 timer
    和 abort listener；第一帧已执行而第二帧停滞也不会遗留 callback。
  - chapter watcher 为每个恢复 generation 创建 AbortController，切章、stale
    cleanup 或组件卸载时立即终止旧 paint wait；旧 token 仍不能释放新恢复。
  - 无 `requestAnimationFrame` 的 SSR/test 环境自动使用同一有界 timer fallback。
  - fake timer 测试覆盖无 frame 回调、仅第一帧回调、无 rAF API、正常双帧和
    abort cleanup；完全停帧后验证 flush、保存与后续章节导航仍可用。
- 修改或创建的文件：
  - `docs/BOOK_READER.md`
  - `packages/desktop/src/renderer/src/book/restoreReadingPosition.ts`
  - `packages/desktop/src/renderer/src/components/bookWorkspace/index.vue`
  - `packages/desktop/test/unit/specs/book-reader.spec.ts`
  - `WORKLOG.md`
- 测试及结果：
  - Phase 5 定向单元测试：48 项通过。
  - desktop 全量单元测试单独重跑：53 个文件、855 项全部通过。
  - 首次将全量单测与 lint/build 并行时，PDF spec 出现两个 5 秒加载超时及
    一个连带初始化失败；单独按原命令重跑即全部通过，未修改 PDF 路径。
  - desktop typecheck：通过。
  - 全量 lint：0 error、135 个既有 warning。
  - desktop production build：通过；仅保留既有 CodeMirror 动静态 import
    提示。
  - Reader E2E 完整 spec：3/3 通过。
  - 变更文件 Prettier check 与 `git diff --check`：通过。
- 关键决策：
  - timeout 是浏览器调度缺失时的布局进度保证，不进入 `fail` 路径；后续仍执行
    position、第二次有界 paint wait 和 sample。
  - AbortSignal 只负责释放浏览器调度资源；恢复结果是否可写入仍由组件
    generation、session/node identity 与 store token 共同决定。
- 尚未解决的问题：
  - editor-input typing 的既有基线 flake 仍留给独立编辑器测试稳定性任务。
  - 全书搜索、编辑桥、批注、本地资源、发布/同步/协作仍属于后续阶段。
- Git commit：将随本次提交入库，最终 SHA 见 Git 历史（不推送）。

## 2026-07-29 — Phase 6：Reader 全书搜索

- 用户目标：为 LeafBook Reader 增加完整、可取消、不会突破 Phase 3/4
  授权边界的全书 Markdown 搜索，并提供可访问的桌面与移动端交互。
- 实际完成：
  - 新增纯搜索内核：NFKC/case-fold、1–8 token/256 字符 literal AND、
    filename/title/alias/heading/body/code/frontmatter tag 有界提取、稳定排名、
    每文档最多三段纯文本摘要及原文 UTF-16 高亮映射。
  - main 只从当前 session 可读顺序生成唯一 Markdown 源，并继续通过
    `safelyReadBookChapter` 读取；孤儿、外链、缺失和模型外路径不进入索引，
    DTO 不返回根路径或相对路径。
  - 实现 lazy session snapshot、32 MiB 单索引、64 MiB 全局 LRU、bounded
    yield/progress、partial/omitted 状态、共享 build waiter，以及 query/session/
    owner/root/refresh 生命周期取消。单个 waiter 取消不破坏其他或新查询，最后
    waiter 取消会终止 build。
  - 增加 typed search/cancel/progress IPC、最小 preload bridge 和 renderer
    global types；进度只发回发起的可信 editor webContents。
  - Pinia 增加 200 ms debounce、generation/stale response 防护、先启动新查询
    再取消旧查询，以及 refresh/离开/切书取消。结果跳转先 flush Phase 5 阅读
    位置，再用 opaque node 与显式 heading fragment 打开章节。
  - 新增无 `v-html` 的响应式搜索面板：Search 与 `/` 打开，Up/Down/Enter
    选择，Escape 只关闭搜索并把焦点归还 Search；包含 `aria-busy`、live 结果
    状态、listbox/option 语义和 partial index 提示。
  - 更新 Reader 架构、边界、生命周期、UI 和测试说明。
- 修改或创建的文件：
  - `docs/BOOK_READER.md`
  - `packages/desktop/src/common/book/search.ts`
  - `packages/desktop/src/main/book/sessionManager.ts`
  - `packages/desktop/src/main/ipc/books.ts`
  - `packages/desktop/src/preload/index.ts`
  - `packages/desktop/src/shared/types/bookReader.ts`
  - `packages/desktop/src/shared/types/ipc.ts`
  - `packages/desktop/src/types/global.d.ts`
  - `packages/desktop/src/renderer/src/store/books.ts`
  - `packages/desktop/src/renderer/src/components/bookWorkspace/index.vue`
  - `packages/desktop/src/renderer/src/components/bookWorkspace/BookSearchPanel.vue`
  - `packages/desktop/test/unit/specs/book-search.spec.ts`
  - `packages/desktop/test/unit/specs/book-reader.spec.ts`
  - `packages/desktop/test/e2e/book-reader.spec.ts`
  - `WORKLOG.md`
- 测试及结果：
  - 搜索算法/manager/store 定向测试：2 个文件、57 项全部通过。
  - desktop 全量单元测试单独执行：54 个文件、864 项全部通过。
  - desktop typecheck：通过。
  - 全量 lint：0 error、135 个既有 warning；Phase 6 文件定向 ESLint：
    0 error、0 warning。
  - desktop production build：通过；仅保留既有 CodeMirror 动静态 import
    提示。
  - Reader Electron E2E 完整 spec：4/4 通过；搜索切片覆盖移动端 `/` 打开、
    code 命中与 heading 跳转、Refresh 后新内容可搜，以及 Escape 焦点恢复。
  - 两次把全量单测与 build/E2E 并行时，PDF spec 出现 5 秒加载超时及 mock
    初始化连带失败；单独按标准全量命令重跑 864/864 通过，未修改 PDF 路径。
- 关键决策：
  - 搜索索引是 session 内存快照，不建立磁盘索引或 watcher；文件变化通过
    Refresh 创建新 session 模型并重建。
  - 索引身份使用实际 `BookSession` 对象而不是公开 ID，因此 refresh 同 ID
    replacement、close、owner cleanup 和根替换都能精确撤销旧工作。
  - Unicode 规范化匹配保留规范化到原始 UTF-16 的映射，renderer 只按范围
    创建文本/`mark` 节点，不把摘要解释成 HTML。
- 尚未解决的问题：
  - PDF 单测在与高负载门禁并行时仍可能触发既有 5 秒资源时序 flake；标准
    单独全量运行通过。
  - 编辑桥、批注、本地资源、发布/同步/协作仍属于后续阶段。
- Git commit：无（按要求未提交、未推送）。

## 2026-07-29 — Phase 6 评审加固：搜索资源边界与竞态

- 用户目标：根据评审意见收紧全书搜索的并发、内存、取消和可信 IPC
  边界，并补齐移动端、partial index、目录层级与 stale response 回归覆盖。
- 实际完成：
  - main 搜索改为每 owner 仅保留最新请求、最多 8 个活跃 owner；全局只允许
    1 个索引 build，竞争请求稳定返回 `search-busy`，不创建无界等待队列。
  - 在 build 前预留 32 MiB 并联动 LRU 驱逐，保证 cache 与 reservation
    合计不超过 64 MiB；单索引仍限制为 32 MiB。
  - 文档提取限制为前 256 KiB、20,000 行、8,000 个单元、每单元 4,096
    字符、128 个 alias/tag 和每文档 4 MiB 估算内存；所有截断都会标记
    `partial`。
  - 提取和匹配增加可取消的异步 checkpoint；每个 checkpoint 复核
    AbortSignal、精确 session 对象及真实根目录 dev/ino 身份。匹配过程只保留
    top 3，不积累无界候选数组。
  - 修复共享 build 的 latest-wins 注册顺序、refresh/close/revoke 清理，以及
    分组 landing page 的父级 breadcrumbs。
  - 所有 book IPC（包括 `lb::books::list`）统一校验可信 editor sender。
  - renderer 在 debounce 前立即递增 generation、清空旧结果和 Enter 目标并
    取消活动请求，避免旧响应在新请求定时器启动前重新出现。
  - 搜索面板区分“遗漏文档”和“仅内容被截断”的 partial 提示，并固定移动端
    全屏布局、42 px 输入框和至少 68 px 结果触控目标。
- 修改或创建的文件：
  - `docs/BOOK_READER.md`
  - `packages/desktop/src/common/book/search.ts`
  - `packages/desktop/src/main/book/sessionManager.ts`
  - `packages/desktop/src/main/ipc/books.ts`
  - `packages/desktop/src/renderer/src/store/books.ts`
  - `packages/desktop/src/renderer/src/components/bookWorkspace/BookSearchPanel.vue`
  - `packages/desktop/test/unit/specs/book-search.spec.ts`
  - `packages/desktop/test/unit/specs/book-reader.spec.ts`
  - `packages/desktop/test/e2e/book-reader.spec.ts`
  - `WORKLOG.md`
- 测试及结果：
  - 搜索算法/manager/store 定向测试：2 个文件、65 项全部通过。
  - desktop 全量单元测试：54 个文件、872 项全部通过。首次并行运行时 PDF
    基线测试出现加载超时及连带 mock 失败，单独按标准命令立即重跑通过。
  - desktop typecheck：通过。
  - 全量 lint：0 error、135 个既有 warning。
  - desktop production build：通过；仅保留既有 CodeMirror 动静态 import
    提示。
  - Reader Electron E2E：4/4 通过；覆盖 650 px 移动布局、键盘跳转、
    partial 且 omitted=0 的提示、Refresh 后旧结果失效和 Escape 焦点恢复。
  - 所有变更文件 Prettier check：通过。
- 关键决策：
  - build 等待队列上限选择为 0：已有 build 被共享复用；不同 session 的竞争
    build 立即以稳定 `search-busy` 失败，从结构上避免排队内存和取消泄漏。
  - 以 reservation 而非构建后的实际索引大小约束峰值，使构建期间也遵守
    64 MiB 全局预算。
  - 保留同步搜索 API 供纯算法测试，生产 main 路径只使用带 checkpoint 的
    异步构建与匹配 API。
- 尚未解决的问题：
  - PDF 单测在高负载并行门禁下仍可能触发既有 5 秒时序 flake；标准单独全量
    运行通过。
  - 编辑桥、批注、本地资源、发布/同步/协作仍属于后续阶段。
- Git commit：无（按要求未提交、未推送）。

## 2026-07-29 — Phase 6 第二轮加固：精确 NFKC 预算与真实异步搜索

- 用户目标：修复兼容字符高倍率展开造成的文档预算反例，把索引提取改为真实
  可取消的异步工作，隔离共享进度回调和 renderer 销毁竞态，并收紧移动端搜索
  结果及关闭按钮样式；不提交、不推送。
- 实际完成：
  - 将 NFKC 单元处理改为两遍精确核算：第一遍逐 code point 计算实际
    normalized UTF-16 长度、identity-map 状态及字符串/映射成本，只保留预算
    内前缀；第二遍才分配并填充 `starts`/`ends`。文档 `estimatedBytes` 不会超过
    `maxBytes`，截断会标记 `partial`，保留内容仍能映射回原文 UTF-16 范围。
  - `createBookSearchDocumentAsync` 不再预跑 checkpoint 后调用同步构建，而是
    在实际 frontmatter、tag、line、fence、unit、normalization preflight 和
    mapping 循环内，每 64 units 或约 64 KiB await checkpoint 并复核取消；
    async matching 也收紧为每 64 units checkpoint。
  - shared build 的 progress callback 改为逐 waiter 隔离；抛错 callback 会被
    禁用，不再 reject 其他 waiter 共用的 build。matching progress 同样为
    advisory，IPC send 捕获 webContents 在检查后销毁的 TOCTOU。
  - 移动搜索结果改为顶端排列、自动行至少 68 px、单项至多 160 px且摘要最多
    三行；Close 显式设置 `appearance: none`、1 px border、radius、background
    和 color。
- 修改或创建的文件：
  - `docs/BOOK_READER.md`
  - `packages/desktop/src/common/book/search.ts`
  - `packages/desktop/src/main/book/sessionManager.ts`
  - `packages/desktop/src/main/ipc/books.ts`
  - `packages/desktop/src/renderer/src/components/bookWorkspace/BookSearchPanel.vue`
  - `packages/desktop/test/unit/specs/book-search.spec.ts`
  - `packages/desktop/test/unit/specs/book-reader.spec.ts`
  - `packages/desktop/test/e2e/book-reader.spec.ts`
  - `WORKLOG.md`
- 测试及结果：
  - 搜索算法/manager/store 定向测试：2 个文件、69 项全部通过。
  - desktop 全量单元测试：54 个文件、876 项全部通过。
  - desktop typecheck：通过。
  - 全量 lint：0 error、135 个既有 warning；本轮文件定向 ESLint：
    0 error、0 warning。
  - desktop production build：通过；仅保留既有 CodeMirror 动静态 import
    提示。
  - Reader Electron E2E：4/4 通过；新增断言验证 650 px 视口下单结果高度
    68–160 px、Close native appearance 清除、1 px border 与非零 radius，
    并保留整页截图字节检查。
  - 测试曾发现空白 Markdown 行被新 helper 误标为 `partial`，修正空单元语义
    后相同定向用例及所有全量门禁通过。
- 关键决策：
  - 不为 NFKC 使用经验展开系数；预算以每个候选前缀的真实规范化长度和是否
    需要 UTF-16 映射数组为准，成本跳变时保留最后一个确实可容纳的前缀。
  - 同步 helper 仅保留给小型纯算法调用；生产 main 继续只调用真实分块的
    async API。
  - progress 是非关键通知通道，callback/send 失败不得改变搜索结果或共享
    索引缓存的生命周期。
- 尚未解决的问题：
  - 编辑桥、批注、本地资源、发布/同步/协作仍属于后续阶段。
- Git commit：无（按要求未提交、未推送）。

## 2026-07-29 — Phase 6 最终 Unicode 返修与 checkpoint I/O 优化

- 用户目标：修复 NFD 跨码点组合搜索，保证 query/index 使用同一 normalization
  primitive 和完整 UTF-16 cluster 高亮；减少长文档 checkpoint 的 root
  `realpath`/`stat` 次数，同时继续拒绝周期或最终检查发现的根替换。
- 实际完成：
  - 新增同步/异步共用的 grapheme-cluster 分段与 normalization primitive：
    优先 `Intl.Segmenter`，确定性 fallback 覆盖 combining mark、variation
    selector、emoji modifier、ZWJ、区域旗帜配对及 Hangul Jamo composition。
  - query 与 title、filename、alias、tag、heading、body、code 均按同一 cluster
    NFKC/case-fold 规则处理；NFC 与 NFD 可双向匹配。规范化 cluster 的每个输出
    UTF-16 unit 都映射到原 cluster 完整起止，因此 `e\u0301` 高亮包含 combining
    mark，Hangul/emoji 不会切 surrogate 或 ZWJ 序列。
  - 精确预算改为按实际 normalized cluster 长度核算，只有整个 cluster 可容纳
    才进入预算内前缀；预算通过后才 materialize 映射数组。U+FDFA/ﬃ 既有边界
    保持，sync 与 async 对同一输入生成完全一致的文档预算与索引。
  - main checkpoint 拆为轻量内存检查与周期 root I/O：每次 yield 后检查 exact
    session、controller 和 owner generation；每 8 次 checkpoint（byte-driven
    工作约 512 KiB）、每个 document 结束及搜索最终返回前复核 root identity。
  - Reader E2E 使用 NFC `Café`/`Résumé` 输入查找 NFD heading/body，验证完整
    NFD mark、键盘激活及 heading 顶部跳转，同时保留 fenced code、refresh、
    partial、移动端几何和焦点覆盖。
- 修改或创建的文件：
  - `docs/BOOK_READER.md`
  - `packages/desktop/src/common/book/search.ts`
  - `packages/desktop/src/main/book/sessionManager.ts`
  - `packages/desktop/test/unit/specs/book-search.spec.ts`
  - `packages/desktop/test/unit/specs/book-reader.spec.ts`
  - `packages/desktop/test/e2e/book-reader.spec.ts`
  - `WORKLOG.md`
- 测试及结果：
  - 搜索算法/manager/store 定向测试：2 个文件、74 项全部通过。
  - desktop 全量单元测试：54 个文件、881 项全部通过。首次运行时 PDF 基线
    再次出现一个 5 秒加载超时及一个连带 mock 初始化失败；未修改 PDF 路径，
    立即按相同标准全量命令重跑即 881/881 通过。
  - desktop typecheck：通过。
  - 全量 lint：0 error、135 个既有 warning；本轮文件定向 ESLint：
    0 error、0 warning。
  - desktop production build：通过；仅保留既有 CodeMirror 动静态 import
    提示。
  - Reader Electron E2E：4/4 通过，包含真实 NFC query → NFD heading/body
    搜索和跳转。
- 关键决策：
  - cluster 是 normalization、预算和高亮映射的最小单位；不会为了填满预算而
    截断 cluster。
  - 高频 checkpoint 只做可取消的内存身份检查；root identity I/O 分层执行，
    4,000 行完整 build/match 的测试上限为 32 次，而不是每次 yield 都调用。
  - 周期检查发现 identity 变化会拒绝 build，matching 后、最终返回前发生的
    identity 变化也会返回 `book-unavailable`，因此 I/O 降频不放宽授权边界。
- 尚未解决的问题：
  - 编辑桥、批注、本地资源、发布/同步/协作仍属于后续阶段。
- Git commit：无（按要求未提交、未推送）。

## 2026-07-29 — Phase 6 最终 case-fold 与 fallback segmentation 返修

- 用户目标：让 query、同步索引和异步索引共用 locale-independent Unicode
  case-fold 语义，覆盖 Greek sigma、sharp s 和默认非 Turkic dotted/dotless I；
  同时提供不修改全局即可强制测试的 segmentation fallback，并保留此前全部
  Unicode、预算、异步、root cadence、洪泛和 UI 边界。
- 实际完成：
  - cluster normalization 在 NFKC 后使用 ECMAScript locale-independent
    lowercase，并补充默认非 Turkic 搜索所需的 `ς → σ` 与 `ß/ẞ → ss`。
    `Σ/σ/ς` 和 `Straße/STRASSE` 可互搜，`İ` 与 `i\u0307` 一致，dotless `ı`
    仍与 `i` 区分。
  - fold 扩展继续发生在两遍精确预算的 preflight 中；`ss` 的 normalized
    长度和 mapping 数组成本计入预算，原 `ß`/`ẞ` cluster 的高亮覆盖完整原文。
    U+FDFA、ﬃ、NFC/NFD 的 sync/async 一致性不变。
  - 暴露只用于测试的纯 segmentation 入口，可显式传 `null` 强制 fallback，
    无需替换全局 `Intl.Segmenter`。fallback 增加 CRLF/control、Prepend、
    SpacingMark/combining、常见 Indic virama、Hangul、ZWJ、emoji modifier、
    variation selector 和 RI pair 的安全近似。
  - 文档明确现代 Electron 原生 `Intl.Segmenter` 是正式 grapheme 路径；
    fallback 是 surrogate-safe 的确定性近似，不宣称完整实现 UAX #29。
  - Reader E2E 以正常小写 final-sigma `ος` 搜索 uppercase `ΟΣ` heading/body，
    验证两项结果、完整 uppercase 高亮、Down/Up 键盘选择和 heading 跳转；
    NFC→NFD、code、refresh、partial 和移动 UI 覆盖继续保留。
- 修改或创建的文件：
  - `docs/BOOK_READER.md`
  - `packages/desktop/src/common/book/search.ts`
  - `packages/desktop/test/unit/specs/book-search.spec.ts`
  - `packages/desktop/test/e2e/book-reader.spec.ts`
  - `WORKLOG.md`
- 测试及结果：
  - 搜索算法/manager/store 定向测试：2 个文件、78 项全部通过。
  - desktop 全量单元测试：54 个文件、885 项全部通过。
  - desktop typecheck：通过。
  - 全量 lint：0 error、135 个既有 warning；本轮文件定向 ESLint：
    0 error、0 warning。
  - desktop production build：通过；仅保留既有 CodeMirror 动静态 import
    提示。
  - Reader Electron E2E：4/4 通过，包含 lowercase `ος` → uppercase `ΟΣ`
    heading/body 搜索、高亮和跳转。
  - 新增单测首次发现 Turkish 对照 fixture 的默认标题 `Introduction` 含 `i`；
    改为中性 metadata 后确认 `ı`/`i` 保持区分。Greek E2E 首次因正确新增第二
    个 body 结果而与旧单结果焦点断言不符，更新为 Down/Up 两结果断言后通过。
- 关键决策：
  - 仓库没有可复用的版本化 CaseFolding 数据，也不新增依赖；实现和文档只声明
    ECMAScript lower 加本轮必要 default-fold 差异，不夸大为完整
    `CaseFolding.txt`。
  - segmentation fallback 通过函数参数强制，避免修改 `Intl.Segmenter` 全局而
    污染并行测试。
  - case-fold 多字符扩展仍以原 grapheme cluster 作为预算和 UTF-16 mapping
    单位。
- 尚未解决的问题：
  - 若未来需要完整、版本锁定的所有 Unicode Default Case Folding 差异，应在
    独立变更中引入并审计生成数据；本轮未增加依赖或 lockfile。
  - 编辑桥、批注、本地资源、发布/同步/协作仍属于后续阶段。
- Git commit：将随本次提交入库，最终 SHA 见 Git 历史（不推送）。

## 2026-07-29 — Phase 7 current-chapter editing

- **用户目标**：在 LeafBook Reader 中用现有 Muya 编辑当前章节，同时保持
  opaque IPC、冲突保护、格式保真和 book session/search 一致性。
- **实际完成**：新增 main-owned edit lease、begin/save/reload/close typed
  IPC、strict UTF-8/BOM/EOL 检测、8 MiB 限制、SHA-256 revision、一次性
  overwrite token、同目录安全原子写、保存后 session refresh/stable-key
  重绑；Reader 的 Edit 接入现有 editor tab，Book tab 保存分流并禁用
  auto-save/Save As/Move/Rename/encoding/EOL 设置，增加 dirty close guard 和
  Back to Book。
- **修改或创建的文件**：见本条对应的 `git diff --name-only`；新增
  `docs/BOOK_EDITING.md`。
- **测试及结果**：Book manager 与 editor 保存/关闭定向测试 2 个文件、
  73 项通过；desktop 全量单测 54 个文件、892 项通过；typecheck 和 production
  build 通过；本轮文件定向 ESLint 0 error（5 个 non-null assertion warning，
  其中 editor 2 个为既有代码）；`git diff --check` 通过。首次将全量单测与
  build 并行运行时 `pdf.spec.ts` 出现 1 个超时和 1 个全局 window fixture
  污染失败，随后单独重跑全量单测全部通过。
- **关键决策**：renderer 永不持有 book 路径；lease 在 begin 后独立持有
  root/parent/target 快照；外部 revision 默认拒绝；保存成功由 main 直接
  refresh/invalidate search，不使用时间窗压制 watcher。
- **尚未解决的问题**：Phase 7 不含新建/重命名章节、`SUMMARY.md` 写入、
  附件、Save As 或非 UTF-8 转换；完整 scoped filesystem observer 留待后续。
- **Git commit**：未提交（按用户要求）。

### Phase 7 E2E and accessible conflict-dialog follow-up

- 新增真实 Electron 流程：Reader 滚动 → Edit → source 更新 H1/正文并在
  Muya 输入 token → Cmd/Ctrl+S → Back → Reader 立即显示新内容且恢复阅读比例。
- 同一 E2E 覆盖外部修改后的 Cancel 不覆盖、Reload 外部版本、显式 Overwrite
  三条路径；冲突 UI 改为可见、带 label 的三按钮 modal，Cancel 默认聚焦，
  Escape 等同 Cancel。
- 移动宽度 E2E 增加 Edit、现有 editor mount、Back 按钮与返回 ready reader
  覆盖。
- 完整 Book Reader Electron E2E：5/5 通过（含 Book Edit、冲突三路径与
  mobile Edit/Back）。普通
  `all-blocks-roundtrip` 5/5 通过；与 editor-input 并行运行时复现既有
  `typed-token` 截断 flake，随后独立运行 editor-input 8/8 通过。
- scoped filesystem watcher 仍明确留待后续；本轮继续依赖 revision-before-save
  冲突检测与成功写入后的同步 session refresh/search invalidation。
- 最终共享门禁复核：实现阶段 desktop 全量单测曾 892/892 通过；后续共享高负载
  下连续三次全量均只在 `pdf.spec.ts` 首个动态 import 出现 5 秒 timeout，并
  连带污染其后一项 window fixture，Phase 7 之外其余 889/890 通过；
  `pdf.spec.ts` 单独运行 16/16 通过，因此记录为并发负载 flake，不改 PDF
  产品或测试。全量 lint 为 0 error、135 个既有 warning。Phase 7 三个最终
  格式文件 Prettier check 通过，`git diff --check` 通过。

## 2026-07-29 — Phase 7 adversarial lease and editor-race hardening

- **用户目标**：对当前章节编辑进行最终安全返修，覆盖 lease 生命周期并发、
  路径祖先替换、overwrite 授权绑定、保存/重载期间的新输入、commit-point
  不确定语义、buffer 泄漏和 modal 键盘边界。
- **实际完成**：
  - Main lease 增加 generation、AbortController 和 exact-request
    single-flight；所有关键 await 后确认同一 lease 仍有效，session
    close/remove/eviction、root invalidation 和 owner teardown 会统一撤销。
  - begin/save/reload 重复校验 root 到 parent 的每一级物理 identity，并要求
    parent/target 具备写权限；IPC 与 manager 均限制 8 MiB UTF-8 bytes，
    拒绝 lone CR 和超长标识。
  - overwrite grant 绑定 owner、lease generation、root、target、base/external
    revision 和 candidate hash，并在写入 await 前一次性消费。
  - rename 明确定义为 commit point：目录 fsync 失败但 final bytes 可验证时
    成功并提示 durability uncertain；final verify 失败返回
    `edit-commit-uncertain`/`committed: true`、撤销 lease，renderer 保留 dirty
    candidate 并进入 read-only。
  - Renderer 为每个 book tab 增加 operation generation 和 save/reload
    single-flight；操作期间的新输入不会被 late result 覆盖或错误标 saved。
    guard 复用 in-flight save；buffer snapshot 完全过滤 book tabs/lease。
  - Modal 增加 capture Escape、Tab/Shift+Tab focus trap 和关闭后 focus restore。
    Electron E2E 新增真实键盘焦点、dirty Back Cancel/Discard、dirty window-close
    Cancel 分支。
- **修改或创建的文件**：继续保持 Phase 7 原文件范围；主要返修
  `packages/desktop/src/main/book/sessionManager.ts`、
  `packages/desktop/src/main/ipc/books.ts`、
  `packages/desktop/src/renderer/src/store/editor.ts`、
  `packages/desktop/src/renderer/src/components/bookEditDialog.vue`、
  `packages/desktop/src/shared/types/bookReader.ts`、Book Reader E2E/相关 unit、
  `docs/BOOK_EDITING.md` 和本日志。
- **测试及结果**：
  - Main/editor 定向单测：2 个文件、84 项通过。
  - Typecheck：通过；production build：通过，仅有既有 CodeMirror import
    提示。
  - Book Reader Electron E2E：编辑场景独立 1/1，通过；完整 spec 5/5 通过。
  - Desktop 全量 unit：54 个文件、903 项通过。
  - 全量 lint：0 error、135 个既有 warning；本轮定向 ESLint：0 error，仅
    editor 2 个既有 non-null assertion warning。
  - Typecheck、production build、最终 Prettier check 和 `git diff --check`
    均通过；build 仅有既有 CodeMirror import 提示。
- **关键决策**：不能把“rename 后无法验证”当作普通成功；只有 final bytes
  已确认时 directory fsync 失败才可报告 saved。无法确认时明确告诉 renderer
  文件可能已经提交，同时禁止在旧 lease 上盲重试。
- **尚未解决的问题**：scoped filesystem watcher 仍按 Phase 7 既定范围延期；
  新建/重命名章节、`SUMMARY.md` 写入、附件、Save As 和非 UTF-8 转换仍不包含。
- **Git commit**：未提交（按用户要求）。

## 2026-07-29 — Phase 7 linearization, refresh isolation, and dialog ownership

- **用户目标**：完成当前章节编辑第二轮安全返修，消除 guard/save、
  validate→rename、public refresh/save refresh、dialog ownership 与移动端焦点的
  最后竞态。
- **实际完成**：
  - Guard 统一先 flush Muya pending input、等待同一 tab 的既有 save promise，
    再重算 dirty；Back、tab close、window close 不提前弹窗或发第二次 save。
  - Main lease 绑定 exact session object/session generation/lease generation/op
    generation。每个临时文件异步 await 后重新断言；最终 realpath、逐级 lstat
    identity/mode、target revision 与权限在同步临界区重验并 `renameSync`，critical
    开始后的 close/session revoke 延迟到原子提交结束。
  - Public refresh 在开始时推进 session generation 并撤销 lease；save 使用不共享
    public single-flight 的 private refresh capability，只能消费自身 scan 并原子
    rebind。保存后再次 Edit 会把已有 tab 换绑到新授权 lease。
  - begin/reload 在 read await 后再次执行 exact session/lease/full ancestry/target
    验证。测试 hooks 仅存在于 manager 构造边界，不增加 production IPC。
  - Decision dialog 改为 FIFO requestId 队列，绑定 tab/op generation，可定向
    dispose；document capture 处理 Tab/Escape，unmount 清 listener/queue 并恢复焦点。
  - Reader→editor 在 rendered frames 用 Muya API 重试焦点，移动布局最终
    `activeElement` 保持在 editor content 内；普通 editor file-loaded 路径不变。
- **修改或创建的文件**：沿用 Phase 7 文件范围，另为移动焦点最小修改
  `packages/desktop/src/renderer/src/components/editorWithTabs/editor.vue`；主要文件为
  `packages/desktop/src/main/book/sessionManager.ts`、
  `packages/desktop/src/renderer/src/store/editor.ts`、
  `packages/desktop/src/renderer/src/services/bookEditDecision.ts`、
  `packages/desktop/src/renderer/src/components/bookEditDialog.vue`、
  `packages/desktop/src/renderer/src/pages/app.vue`、book unit/E2E 与
  `docs/BOOK_EDITING.md`。
- **测试及结果**：
  - Main/editor 定向单测：2 个文件、95 项通过。
  - Desktop 全量单测：54 个文件、914 项通过。
  - Reader E2E 最终连续 3 轮 15/15 通过；最终焦点实现后 mobile 独跑 1/1、
    full Reader 5/5。
  - 普通 `all-blocks-roundtrip` 5/5。`editor-input` 收窄焦点实现后首轮 8/8，
    第二轮只复现既有 typing 截断 flake 7/8；此前隔离 Phase 7 基线也有同型截断。
  - Typecheck、production build 通过；build 仅有既有 CodeMirror import 提示。
  - 全量 lint：0 error、135 个既有 warning。
  - 最终 scoped Prettier check 与 `git diff --check`：通过。
- **关键决策**：Node 无 `renameat`，因此文档明确这是本地桌面 threat model；
  LeafBook 保证 final component-wise validation 到 rename 之间没有 event-loop
  await，不宣称抵御另一个 native process 持续抢占式换路径。commit 后不能返回
  `edit-not-found`；无法继续授权时返回成功但 read-only。
- **尚未解决的问题**：scoped filesystem watcher、新建/重命名章节、
  `SUMMARY.md` 写入、附件、Save As 与非 UTF-8 转换仍不属于 Phase 7。
- **Git commit**：未提交（按用户要求）。

### Phase 7 final bounded-read and mobile-focus tail

- Final synchronous target descriptors now reject `size > 8 MiB` before
  `readFileSync`, both before rename and during committed-byte verification.
- A same-inode critical-boundary growth test expands the target past 8 MiB and
  proves no synchronous full read, no rename, no candidate commit, and preserved
  original inode/prefix.
- Removed the Phase 7 diff from `editorWithTabs/editor.vue`. Book-only mobile
  focus now lives in `app.vue`: on reader→editor mode transition it uses the
  existing instance-backed `editor-focus` command plus a visible Muya
  `contenteditable`, for a fixed maximum of four rendered frames.
- `BOOK_EDITING.md` now explicitly defers live/scoped external filesystem
  watching; current safety is revision-before-save plus return-to-reader refresh.
- Final validation for this tail: targeted unit 96/96; full unit 54 files and
  915/915; typecheck and production build pass; lint reports 0 errors and 135
  existing warnings; Reader E2E passes two complete runs (10/10), with an
  additional mobile-only 1/1; `all-blocks-roundtrip` passes 5/5 and
  `editor-input` passes 8/8. All 19 remaining changed paths pass Prettier,
  `git diff --check` passes, and `editorWithTabs/editor.vue` has no diff.
- Git commit：将随本次提交入库，最终 SHA 见 Git 历史（不推送）。

## 2026-07-29 — Phase 8A lossless SUMMARY arrangement core

- **用户目标**：实现“拖拽编排、导出、发布”路线中的安全第一步，只允许对既有
  SUMMARY 建立无损草稿和 main-owned 保存能力；不得创建 SUMMARY、移动或重命名
  章节文件，也不实现 HTML/UI/发布。
- **实际完成**：
  - 新增 strict UTF-8 lossless SUMMARY document，保留 BOM、逐行 LF/CRLF、
    无最终换行、comments、unsupported lines 和 fenced opaque regions；heading
    为固定容器，list subtree 使用稳定 opaque ID。
  - 新增纯 subtree reorder/indent/outdent、tabs/spaces reparent 限制、opaque/
    heading/parent barrier、2 MiB/line/node/depth/operation caps，以及 bounded undo
    和 DTO preview。
  - 新增 main-owned arrangement lease，固定 owner/session generation、root、
    directory/file identity/mode 和 SHA-256；existing SUMMARY only，renderer 不获得
    path、raw span 或 raw bytes。
  - 保存采用 exclusive no-follow temp、file fsync、同步 final authority/revision
    check、rename、directory fsync 和 final bytes verification。External conflict
    使用一次性 candidate-bound overwrite token；commit 后无法验证会返回
    `committed: true` 并撤销授权。
  - SessionManager、typed IPC、preload 和 runtime validators 已接入
    begin/apply/undo/save/close。Refresh、close、owner teardown 与保存后的 private
    reader refresh 会撤销旧草稿；inferred book 不会隐式创建 SUMMARY。
- **修改或创建的文件**：
  `packages/desktop/src/common/book/summaryDocument.ts`、
  `packages/desktop/src/main/book/arrangementManager.ts`、common/main exports、
  `sessionManager.ts`、book IPC/preload/shared types、3 个 book unit spec、
  `docs/BOOK_ARRANGEMENT.md` 和本日志。
- **测试及结果**：
  - Phase 8A 定向单测：3 个文件、121 项通过。
  - Desktop 全量 unit：56 个文件、956 项通过。
  - Typecheck：通过；本轮变更的 scoped ESLint：0 error、0 warning（仅工具既有
    module-type 提示）。
  - 本轮全部变更文件 Prettier check 和 `git diff --check`：通过。
- **关键决策**：不能从既有有损 navigation parser 重建 SUMMARY；writer 必须拥有
  独立 lossless source model。无 final newline 的 EOF 行若会离开末尾则拒绝移动，
  而不是发明 newline 或拼接逻辑行。Rename 是 commit point，commit-uncertain
  不得伪装成普通失败或自动重试。
- **尚未解决的问题**：拖拽/键盘/redo/diff UI、文件移动重命名、live watcher、
  HTML/PDF、资源复制和任何本地/云端发布均明确延期。
- **Git commit**：未提交（按用户要求），未推送。

### Phase 8A P1 arrangement hardening

- Trailing blank/comment trivia at EOF or before heading/opaque barriers is no
  longer included in the preceding movable subtree; mixed-EOL byte-exact
  fixtures cover all three boundaries.
- Malformed links and unsafe local targets are opaque sentinel parents,
  matching the navigation parser's child-boundary semantics. Operations now
  reject any candidate that reparses as ambiguous, truncated, or over the
  original depth/work limits; save repeats this validation.
- Save keeps the arrangement lease busy through its private reader reload and
  session replacement. A deferred-loader race proves a second apply/save cannot
  land between commit and refresh or produce a stale returned session.
- Active drafts are capped at 4 per owner and 32 globally with pre-await
  reservations. Undo history is capped at 50 snapshots and 8 MiB per lease.
  The 10,000-operation lifetime count is lease-owned and undo cannot refund it.
- Overwrite tests restore the exact same external/base/candidate hashes after a
  successful overwrite and prove the consumed token cannot authorize replay.
  Current raw byte spans are recalculated after reorder and indent.
- Final validation remains: targeted 121/121, full unit 956/956, typecheck
  passed, scoped ESLint has no errors or warnings apart from the repository's
  existing module-type tool notice. No commit or push was created.

### Phase 8A P1 resource and authorization hardening

- Undo history now stores serialized `Buffer` snapshots and reparses strict
  UTF-8 on undo. The 8 MiB history counter therefore measures retained bytes
  instead of estimating complete `SummaryDocument` object graphs.
- Active current documents have weighted raw-byte/line/public-node budgets per
  owner and globally. Pending begins reserve worst-case weight before any await;
  owner cleanup releases both leases and budget. Concurrent and cleanup stress
  tests cover the accounting.
- Heading and list nodes jointly consume `maxNodes`; the first valid H1 and
  empty-heading behavior now match `parseBookSummary`.
- Overwrite consumption is proven without a stale-base shortcut: an authorized
  temp write loses a same-inode pre-commit revision race, then the exact
  external/base/candidate hashes are restored and the old token receives a new
  conflict token.
- All five arrangement IPC handlers are individually invoked from an untrusted
  renderer fixture and none dispatches to `BookSessionManager`.
- The held-save cleanup `finally` begins before `save(..., true)`. A test swaps
  the session immediately after a successful commit and proves the early return
  revokes the held lease. Root-inode replacement and pre-commit temp cleanup are
  also covered.

### Phase 8A stable-history and retained-budget hardening

- **用户目标**：修复多步 undo 重新按物理位置分配 opaque node ID，以及
  owner/global 预算未计 undo history 的资源边界；同时校准 pending 转 active
  的预算转换和 first-H1 混合 heading 层级。
- **实际完成**：
  - undo snapshot 现在紧凑保存 serialized bytes 与对应 `Uint32Array` line ID
    序列；restore 以原 ID 重建 source model，非初始 snapshot 不再改变 heading/list
    opaque ID。bytes 和 ID metadata 均计入 8 MiB history cap。
  - owner/global retained budget 统一为 current weighted document 加全部 history
    bytes/metadata。Apply 在 push history 前检查 prospective retained total；
    close/revoke/undo/save 清 history 会同步释放预算。
  - pending-to-active conversion 仅扣当前 begin 自己的 reservation，并继续计入
    其他 in-flight reservation；实际 document weight 通过检查后才转为 active，
    避免 active weight 与自己的 reservation 双计。
  - lossless parser 的 first valid H1 行为与 `parseBookSummary` 对齐：若 H1 前已有
    H2，保留权威 parser 的 heading stack，后续 H3/H2/list 层级一致。
- **修改或创建的文件**：
  `packages/desktop/src/common/book/summaryDocument.ts`、
  `packages/desktop/src/main/book/arrangementManager.ts`、
  `packages/desktop/test/unit/specs/book-summary-document.spec.ts`、
  `packages/desktop/test/unit/specs/book-arrangement-manager.spec.ts`、
  `docs/BOOK_ARRANGEMENT.md` 和本日志。
- **测试及结果**：
  - Phase 8A 定向单测：3 个文件、125/125 通过。
  - Desktop 全量 unit：56 个文件、960/960 通过。
  - Typecheck 与 production build：通过；build 仅有既有 CodeMirror dynamic/static
    import 提示。
  - 本轮 scoped ESLint：0 error、0 warning，仅工具既有 module-type 提示。
  - 本轮相关文件 Prettier 与 `git diff --check`：通过。
- **关键决策**：history cap 和全局资源 cap 必须计算实际保留的 line-ID metadata，
  而不是只算当前 document 或 serialized Markdown；begin reservation 到 active
  weight 是原子预算转换，不能忽略其他 pending，也不能同时收取自己的两种权重。
- **尚未解决的问题**：拖拽/键盘/redo/diff UI、文件移动重命名、HTML/PDF、资源复制
  和任何本地/云端发布仍明确延期。
- **Git commit**：未提交（按用户要求），未推送。

## 2026-07-29 — Phase 8A3 SUMMARY arrangement UI

- **用户目标**：在既有 Phase 8A lossless/main-owned 边界上交付显式 Arrange
  模式，支持拖拽、键盘、移动端按钮、Undo、预览、Save/Cancel 和安全冲突处理；
  不实现 redo、文件移动重命名、导出或发布。
- **实际完成**：
  - Reader 仅为 existing SUMMARY session 显示 Arrange；开始前复用 chapter
    dirty guard，并 flush search/reading position。
  - 新增 main DTO 驱动的 roving tree，支持 pointer drag/drop、
    `Alt+↑/↓/←/→`、逐项 Move/Indent/Outdent 按钮、可见 focus、`aria-live`、
    fixed heading、dirty/canUndo 和 bounded preview。
  - Books store 新增独立 arrangement generation，关闭/离开/刷新/unmount 后
    丢弃 late begin/apply/undo/save；late successful begin 会显式 close。
  - Save conflict 复用 focus-trapped decision dialog 和一次性 overwrite token；
    成功后消费 main 返回的 refreshed session，清搜索并保留当前 stable chapter
    与 reading position。Cancel 只 close lease，不调用 save。
  - UI 使用 DTO 的 sibling hierarchy 与 `canIndent` section boundary 禁用
    heading、首尾、跨 parent 和跨 opaque barrier 的 move/drop；main 继续对
    mixed indentation 等不可由 DTO 完全表达的歧义做最终拒绝。
- **修改或创建的文件**：
  `packages/desktop/src/renderer/src/store/books.ts`、
  `packages/desktop/src/renderer/src/components/bookWorkspace/index.vue`、
  `BookArrangementPanel.vue`、`BookArrangementNode.vue`、
  `packages/desktop/src/types/global.d.ts`、
  `packages/desktop/test/unit/specs/book-arrangement-store.spec.ts`、
  `packages/desktop/test/e2e/book-reader.spec.ts`、
  `docs/BOOK_ARRANGEMENT.md` 和本日志。
- **测试及结果**：
  - Phase 8A renderer store unit：10/10；A1/A2/UI 三文件定向：48/48；
    加上 book-reader 的四文件相关门禁合计 135/135，book-reader + store 为 97/97。
  - Desktop 全量 unit：57 files、970/970。
  - Electron Arrange E2E：3/3，覆盖 keyboard、drag、button、Undo、save、
    stable focus/chapter、650px mobile controls、cancel zero-write、ARIA 单 tab stop
    与 main 拒绝时不误报成功。
  - Typecheck、production build、scoped ESLint、Prettier 与
    `git diff --check`：通过；build 仅有既有 CodeMirror chunk 提示，ESLint
    仅有工具既有 module-type 提示。
- **关键决策**：Renderer 只提交 opaque node ID 与既有四类 DTO 操作；不复制
  SUMMARY parser/writer 或持有 raw bytes。Arrange 使用独立 generation，不能与
  Reader 的普通 async generation 或 editor history 混用。
- **尚未解决的问题**：redo、filesystem watcher、章节文件移动/重命名、
  inferred-to-SUMMARY、HTML/PDF、资源复制、本地站点与云发布继续延期。
- **Git commit**：未提交（按用户要求），未推送。

### Phase 8A3 P2 transition, lease, ARIA, and announcement hardening

- Pending begin and active arrangement now form an exclusive Reader transition:
  conflicting header/chapter controls are disabled, store navigation/search is
  guarded, and Edit explicitly invalidates a pending begin. A dispatched begin
  that resolves after Edit is closed and cannot revive Arrange mode.
- Fatal save results dispose the shared decision owner and best-effort close the
  opaque main lease before renderer state drops the ID; repeated read-only
  failures are covered without accumulating leases.
- Roving focus now belongs to the actual `treeitem`. Each tree has one
  `tabindex="0"`; parent expansion and selection/grab state are on that element,
  while pointer action buttons are removed from the Tab sequence.
- Apply/undo return an explicit renderer success boolean. Keyboard, pointer
  buttons, drag/drop, and Undo wait for main plus changed DTO state before
  announcing success; rejection announces the main error and leaves the draft
  clean.
- P2 targeted store unit is 10/10; four related unit files are 135/135.
  Electron arrangement E2E includes single-tabstop ARIA and a real
  mixed-indentation main rejection that never emits a false success.
- Full unit is 57 files and 970/970; typecheck, production build, scoped lint,
  Prettier, and diff-check pass with only the previously documented tool/build
  notices.
- Recursive treeitem keyboard/drag events now stop at the current node, and
  drop placement uses the row rectangle rather than the full subtree `li`.
  A heading + nested-parent E2E proves one Alt operation, child drag source
  preservation, ancestor-safe child drop, and correct parent-row lower-half
  placement despite expanded children. Arrangement E2E is now 3/3.
- Treeitem keydown now uses self-only filtering instead of stopping propagation:
  nested ancestors still cannot repeat the command, while Escape reaches the
  workspace close handler. Regular and nested dirty drafts close with zero
  SUMMARY writes; five consecutive reopen/Escape cycles prove leases do not
  accumulate past the per-owner cap. The final selected Reader E2E gate is 4/4.
- Git commit: not created; nothing was pushed.

## 2026-07-29 — Phase 8D legacy navigation and OS-shell boundary closure

- User goal: close remaining renderer-reachable external navigation and
  filesystem shell paths before treating the release boundary as complete.
- Completed: centralized validated/confirmed HTTP, HTTPS, and mailto opening;
  required exact trusted Editor ownership for legacy format links; bound Reader
  external navigation to its live trusted owner and made cancellation/default
  behavior fail closed; rejected legacy file, UNC, absolute, and relative local
  links; disabled arbitrary renderer Trash and keyboard-debug `openPath`;
  added a static allowlist for every remaining direct main-process shell call.
- Files: `packages/desktop/src/main/security/confirmedExternalOpen.ts`,
  `packages/desktop/src/main/security/formatLinkClick.ts`, Shell/book/menu/app/
  keyboard main-process code, security/book unit tests, `docs/BUILD.md`,
  `docs/RELEASE_GATE.md`, and `WORKLOG.md`.
- Tests: focused Shell/format-link/direct-shell/book tests 142/142 passed;
  desktop typecheck passed. Full desktop suite subsequently passed 65 files,
  1095/1095 tests; Muya passed 212 files and 1449/1449 tests; production build
  passed with four inherited CodeMirror chunk warnings; the exact six-test
  source Electron smoke passed 6/6; full ESLint passed with 0 errors and 134
  inherited warnings; scoped Prettier and `git diff --check` passed.
- Key decisions: renderer-provided pathnames and dirname values are not
  capabilities; legacy Editor local-link opening and sidebar Trash stay
  disabled until main-owned owner-bound capabilities exist. Reader internal
  chapter links remain main-owned and functional.
- Unresolved: the compatibility reductions above are explicit; public release
  remains blocked, and packaged audit/smoke remain NOT RUN.
- Git commit: not created; nothing was pushed.

## 2026-07-29 — Phase 8D updater-name filesystem-type hardening

- User goal: close the updater audit bypass where a forbidden name could be a
  symlink or another non-regular filesystem object.
- Completed:
  - removed the regular-file predicate while retaining find's default
    no-follow traversal;
  - switched match transport to a temporary NUL-delimited stream so unusual
    legal pathnames cannot hide or split audit evidence;
  - reject forbidden updater names for regular files, symlinks, directories,
    FIFOs, devices, or other filesystem types.
- Files: `scripts/check-no-updater-files.sh`,
  `release-gate-static.spec.ts`, `docs/BUILD.md`, `WORKLOG.md`.
- Tests: release-gate static suite 6/6 passed with clean, regular-file,
  symlink, and directory fixtures; shell syntax passed; full lint completed
  with 0 errors/135 inherited warnings; scoped formatting and
  `git diff --check` passed.
- Unresolved: real packaged audit remains NOT RUN; stale `dist` remains
  non-evidence.
- Git commit: not created; nothing was pushed.

## 2026-07-29 — Phase 8D updater artifact audit correction

- User goal: ensure updater metadata cannot hide inside unpacked apps or
  extracted platform archives.
- Completed:
  - added a shared recursive packaged-tree rejection gate for
    `app-update.yml`, development/latest metadata, blockmaps, and pending
    updater config;
  - wired it into unpacked macOS and extracted Windows/Linux audits and widened
    the release-file scan beyond top-level files;
  - added clean-tree and malicious internal `app-update.yml` fixture coverage.
- Files: updater audit scripts, `release-gate-static.spec.ts`, `docs/BUILD.md`,
  `WORKLOG.md`.
- Tests: release-gate static suite 6/6 passed: the clean fixture passes and an
  app-internal updater config fails closed; shell syntax, lint, formatting and
  diff checks passed. No stale `dist` output is audited or claimed.
- Unresolved: the real unpacked audit and packaged smoke remain NOT RUN.
- Git commit: not created; nothing was pushed.

### Phase 8B late-success durability wording

- A successful commit that wins the race against cancellation now preserves
  `durabilityUncertain`: the status states both that export completed before
  cancellation and that storage durability could not be confirmed.
- The existing cancel-vs-commit store fixture already returns
  `durabilityUncertain: true` and now asserts both facts.
- Targeted gate passed 3 files and 127/127; full desktop unit passed 58 files
  and 1000/1000; typecheck, scoped ESLint, Prettier, and `git diff --check`
  passed with only the existing ESLint module-type notice.
- Git commit: not created; nothing was pushed.

### Phase 8B authoritative cancellation and unavailable-link hardening

- Body links now require an authorized generated document that is also
  available. Links to missing chapter bodies become inert broken-link text,
  matching disabled TOC/no-body semantics.
- Cancellation during the native Save dialog is honest about Electron's API:
  it records cancellation but keeps export pending/exclusive and tells the user
  to close the native dialog. Any late lease is cancelled before exclusivity is
  released.
- Commit cancellation waits for both authoritative commit and cancel
  settlement. A late `ok` is reported as completed before cancellation;
  `committed: true` becomes a may-have-committed warning; only ordinary stale
  failures are suppressed.
- Store fixtures cover begin cancellation remaining pending, late lease
  disposal, commit ordering, successful-before-cancel and committed-uncertain
  outcomes. Generator and Electron export fixtures cover links to unavailable
  bodies.
- Final targeted gate passed 3 files and 127/127; full desktop unit passed
  58 files and 1000/1000; typecheck and production build passed with only the
  four existing CodeMirror warnings; selected offline export Electron E2E
  passed 1/1; scoped ESLint, Prettier, and `git diff --check` passed with only
  the existing ESLint module-type notice.
- Git commit: not created; nothing was pushed.

### Phase 8B nonblocking namespace and product-semantics hardening

- Attacker-controlled source opens now pre-lstat regular files and use
  `O_NONBLOCK | O_NOFOLLOW` where Node exposes them before matching descriptor
  identity. Destination parent pinning likewise uses
  `O_DIRECTORY | O_NOFOLLOW | O_NONBLOCK`, then requires a directory descriptor
  with the expected inode. Deterministic FIFO source and parent swaps reject in
  under one second without output or main-thread blocking.
- Missing chapters now produce disabled TOC text and no body; unresolved
  fragments are disabled rather than falling back to chapter top. A root
  landing outside SUMMARY gets one semantic Book home item, group labels use
  authorized group landings, inferred books remain exportable, and SUMMARY
  orphans remain excluded.
- Export becomes explicitly cancellable during begin/generate/commit. The
  renderer increments its generation, cancels an admitted main lease, ignores
  late begin/commit results, closes search immediately, and cancels on
  unmount. Directory durability uncertainty is surfaced as a qualified
  warning.
- All three export IPC handlers are enumerated and proven not to dispatch for
  an untrusted sender.
- Targeted gate: 3 files, 126/126 passed; full desktop unit: 58 files,
  999/999 passed; typecheck and production build passed with only the four
  existing CodeMirror warnings; selected offline export Electron E2E passed
  1/1; scoped ESLint, Prettier, and `git diff --check` passed with only the
  existing ESLint module-type notice.
- Git commit: not created; nothing was pushed.

### Phase 8B bounded final-source and validator hardening

- Final synchronous source verification no longer uses `readFileSync`. Each
  no-follow descriptor is fstat-limited before allocation, contributes to the
  32 MiB aggregate, is hashed with a fixed buffer of at most 64 KiB, requires
  exact reads plus EOF, and repeats identity/size/mode/link/timestamp checks.
- Pass-two race fixtures replace a previously valid source with both a 33 MiB
  regular file and a 64 MiB sparse regular file. Both return
  `export-source-changed`, write no output, and an allocation spy proves no
  buffer larger than 64 KiB is requested by final verification.
- The output validator now uses O(1) body state and explicit limits of depth
  128, 200,000 tags, 32 attributes per tag, and a 64 KiB token. Adversarial
  depth/tag/attribute/token fixtures reject within the normal unit-test
  deadline. UTF-8 IPC payload size is checked before validation and accepted
  payload copying.
- A post-open parent-redirection seam proves fail-closed cleanup: no final
  output and no book bytes are written; one empty random temp may remain in the
  old pinned directory because unlinking through the redirected pathname is
  intentionally forbidden. A deterministic Browser DOM-repair differential
  corpus also proves malformed structures repaired by `DOMParser` remain
  rejected by the custom generator-subset recognizer.
- Hardened export/Reader unit: 2 files, 103/103 passed; full desktop unit:
  58 files, 986/986 passed; desktop typecheck and production build passed
  (only the four existing CodeMirror chunk warnings); selected offline export
  Electron E2E passed 1/1; scoped ESLint, Prettier, and `git diff --check`
  passed with only the existing ESLint module-type notice.
- Git commit: not created; nothing was pushed.

### Phase 8B quote-aware tokenizer boundary

- Tag-end discovery now tracks explicit single- and double-quote state, so a
  literal `>` inside an allowed quoted attribute remains part of the value.
  The scan retains the 64 KiB token cap and rejects nested `<`, unterminated
  quotes, NUL, DEL, and disallowed C0 controls in tags or body text.
- A generator-to-validator regression preserves
  `<abbr title="a > b">`, while direct fixtures cover both quote styles and
  fail-closed unterminated/control inputs.
- Hardened export/Reader unit: 2 files, 105/105 passed; desktop typecheck
  passed. Full desktop unit passed 58 files and 988/988; production build
  passed with only the four existing CodeMirror warnings; selected offline
  export Electron E2E passed 1/1; scoped ESLint, Prettier, and
  `git diff --check` passed with only the existing ESLint module-type notice.
- Git commit: not created; nothing was pushed.

## 2026-07-29 — Phase 8B self-contained HTML book export

- User goal: export a LeafBook Markdown collection as one book-like, offline
  HTML file with a table of contents and safe internal navigation.
- Completed:
  - added a main-owned, bounded begin/commit/cancel export lease with a native
    Save dialog, outside-source canonical target enforcement, explicit
    overwrite confirmation, source/SUMMARY revisions, owner/session/root
    revocation, target inode/link-count checks, no-follow atomic replacement,
    and durability reporting;
  - added a pure static generator using the Reader sanitizer, fixed CSP/CSS,
    nested TOC, one body per physical chapter, missing/media placeholders,
    Unicode/duplicate-heading namespaces, and internal-link rewriting;
  - added a strict main-side HTML tokenizer/tag/attribute allowlist;
  - added typed IPC/preload/global APIs and Reader Export UI with the shared
    dirty guard, busy-state exclusivity, generation checks, and success/error
    feedback;
  - documented the offline/security/consistency contract.
- Files:
  - `packages/desktop/src/common/book/exportPolicy.ts`
  - `packages/desktop/src/main/book/sessionManager.ts`
  - `packages/desktop/src/main/ipc/books.ts`
  - `packages/desktop/src/preload/index.ts`
  - `packages/desktop/src/renderer/src/book/exportBookHtml.ts`
  - `packages/desktop/src/renderer/src/store/books.ts`
  - `packages/desktop/src/renderer/src/components/bookWorkspace/index.vue`
  - `packages/desktop/src/shared/types/bookReader.ts`
  - `packages/desktop/src/shared/types/ipc.ts`
  - `packages/desktop/src/types/global.d.ts`
  - `packages/desktop/test/unit/specs/book-export.spec.ts`
  - `packages/desktop/test/unit/specs/book-reader.spec.ts`
  - `packages/desktop/test/e2e/book-reader.spec.ts`
  - `docs/BOOK_EXPORT.md`
- Tests:
  - targeted export/Reader unit: 2 files, 93/93 passed;
  - full desktop unit: 58 files, 976/976 passed;
  - desktop typecheck: passed;
  - production build: passed (only existing CodeMirror chunk warnings);
  - selected offline HTML Electron E2E: 1/1 passed, including an isolated
    Electron session request probe, console probe, complete anchor/resource
    attribute audit, and a successful scoped fragment navigation;
  - scoped ESLint, Prettier check, and `git diff --check`: passed (only the
    existing ESLint module-type warning).
- Key decisions:
  - did not reuse `exportStyledHTML` because it can introduce absolute
    `file://` resource URLs;
  - renderer output is untrusted at commit and must pass the strict main
    allowlist plus exact fixed shell policy;
  - external links remain readable but inert so opening the file causes no
    network navigation or request.
- Unresolved: none in the Phase 8B single-file HTML scope.
- Git commit: not created (not requested).

## 2026-07-29 — Phase 8D local release gate

- User goal: harden LeafBook's default renderer/network boundary and establish
  a truthful, non-publishing local release gate.
- Completed:
  - enabled `webSecurity:true` for Editor and Settings; tightened renderer CSP;
  - denied production renderer HTTP(S)/WS(S) requests, with only the exact
    loopback Vite host allowed in development and main-owned capabilities kept
    separate by `webContentsId`;
  - made remote images fail offline without auto-loading and replaced automatic
    PlantUML rendering with an inert offline message;
  - proved ordinary Editor local images still load; preserved the documented
    Reader/8B/8C media-placeholder contract;
  - added static product identity, attribution, release-blocker, safe package,
    and direct-license-claim gates;
  - added a validate/dry/build macOS command pinned to publish-never,
    identity-null, notarize-false, signer-auto-discovery-false, and OS-enforced
    no-network packaging;
  - added unpacked app identity/license/updater/size audit and isolated packaged
    smoke commands;
  - documented local/static/external evidence and all remaining public-release
    blockers.
- Files:
  - renderer security: `packages/desktop/src/main/config.ts`,
    `packages/desktop/src/main/app/index.ts`,
    `packages/desktop/src/main/security/rendererNetworkPolicy.ts`,
    `packages/desktop/src/renderer/index.html`, Muya image/diagram renderers;
  - gates: root/desktop `package.json`,
    `scripts/package-mac-unsigned-dir.sh`, `scripts/audit-mac-unpacked.sh`,
    `scripts/smoke-mac-unpacked.sh`, E2E helper and release/network tests;
  - metadata/docs: `README.md`, `docs/BUILD.md`, `docs/RELEASE_GATE.md`,
    third-party notice generator and checked notice.
- Tests and checks:
  - renderer policy/static gates: 13/13 passed;
  - security Electron E2E: 2/2 passed, including Editor local image, Reader
    placeholders with Chinese/space/`%23`, zero remote server hits, inert
    PlantUML, and non-executing HTML payloads;
  - desktop full unit: 61 files, 1033/1033 passed;
  - Muya full unit: 212 files, 1438/1438 passed;
  - production build and desktop typecheck: passed;
  - selected real Electron E2E: 6/6 passed across Editor/Reader network
    security, Reader navigation, Arrange save/cancel, single-HTML export, and
    exact two-file website generation;
  - metadata and direct production dependency license validation: passed.
  - full ESLint completed with 0 errors and 135 inherited warnings; scoped
    Prettier and `git diff --check` passed. `app/index.ts` retains unrelated
    pre-existing Prettier drift and the generated `.txt` notice has no
    inferred Prettier parser.
- Offline package result:
  - validate-only and dry-run passed and printed the exact non-publishing
    builder arguments;
  - the network-denied arm64 attempt completed native rebuild and production
    build, then electron-builder failed closed with
    `getaddrinfo ENOTFOUND github.com`;
  - the partial `dist/mac-arm64` tree was not treated as an artifact and was
    neither audited nor smoke-tested.
- Key decisions:
  - no custom filesystem protocol was needed because Editor local `file:`
    images work with `webSecurity:true`;
  - no Reader resource IPC was added because that would expand the Phase 4
    attack surface and violate the established placeholder contract;
  - the third-party notice now says exactly what it proves: direct production
    dependencies, not an SBOM or complete transitive provenance.
- Unresolved:
  - a complete network-denied macOS package requires the missing local cache;
  - real Windows/Linux execution, all platform signing/notarization, SBOM,
    provenance, inherited release-workflow review, and explicit human approval
    remain release blockers;
  - the documented 8B/8C syscall-sized P3 pathname races remain.
- Git commit: not created; nothing was pushed, tagged, signed, notarized, or
  published.

## 2026-07-29 — Phase 8D smoke selection gate correction

- User goal: make the packaged smoke command select exactly the six release
  scenarios documented by Phase 8D.
- Completed:
  - replaced stale substring grep phrases with one anchored current-title
    expression covering Editor security, Reader security, Reader navigation,
    Arrange, HTML export, and website generation;
  - added a Playwright `--list` preflight that fails unless the collector
    reports exactly six tests;
  - added `--source` mode so the selection and execution path can be verified
    without treating the incomplete packaged app as an artifact.
- Files: `scripts/smoke-mac-unpacked.sh`, `docs/BUILD.md`, `WORKLOG.md`.
- Tests: shell syntax passed; Playwright listed the exact expected six titles
  and source-mode Electron passed 6/6; the five-test fixture failed closed;
  full lint completed with 0 errors/135 inherited warnings; scoped formatting
  and `git diff --check` passed.
- Key decision: packaged and source verification share the same immutable test
  argument array and selection; source success is not packaged-release
  evidence.
- Unresolved: packaged smoke remains NOT RUN until a complete network-denied
  app package exists.
- Git commit: not created; nothing was pushed.

## 2026-07-29 — Phase 8B export boundary hardening

- User goal: close the Phase 8B audit findings around concurrent commits,
  cancellation, destination/root/source races, and permissive output
  structure validation.
- Completed:
  - made export commit single-flight with explicit lease/operation
    generations and abort checks after every asynchronous hook or filesystem
    boundary;
  - pinned the canonical destination parent with an open descriptor, added
    pre/post parent, root, target and temp inode checks, and avoided pathname
    cleanup whenever the parent identity is redirected;
  - added two source revision passes plus a final synchronous descriptor hash
    pass immediately before rename;
  - made post-rename identity loss explicit as `committed: true` uncertainty;
  - tightened the HTML validator to one ordered `html > head + body` document,
    head-only CSP/style/meta/title, ASCII whitespace parsing, and no non-void
    self-closing tags;
  - added deterministic race coverage for concurrent commits, cancel and owner
    cleanup after temp sync, parent symlink swaps before temp and before
    rename, root replacement, late source mutation, and post-rename parent
    replacement.
- Files:
  - `packages/desktop/src/main/book/sessionManager.ts`
  - `packages/desktop/src/common/book/exportPolicy.ts`
  - `packages/desktop/test/unit/specs/book-reader.spec.ts`
  - `packages/desktop/test/unit/specs/book-export.spec.ts`
  - `docs/BOOK_EXPORT.md`
  - `WORKLOG.md`
- Tests:
  - hardened export/Reader unit: 2 files, 98/98 passed;
  - full desktop unit: 58 files, 981/981 passed;
  - desktop typecheck and production build: passed (only the four existing
    CodeMirror chunk warnings);
  - selected offline HTML Electron E2E: 1/1 passed;
  - scoped ESLint, Prettier check, and `git diff --check`: passed (only the
    existing ESLint module-type warning).
- Key decision: Node exposes no portable fd-relative `openat`/`renameat`.
  LeafBook therefore pins and verifies the parent descriptor and places all
  final checks plus `renameSync` in one event-loop turn, but explicitly does
  not claim protection from a privileged external process racing between the
  final pathname check and the rename syscall.
- Unresolved: portable Node APIs cannot close the documented final
  pathname-check-to-rename syscall race against a hostile local process.
- Git commit: not created; nothing was pushed.

## 2026-07-29 — Phase 8C Generate Local Website

- User goal: generate a GitBook-like, fully offline local website from a LeafBook Markdown book.
- Completed: reused the exact Phase 8B HTML renderer/policy; added typed begin/commit/cancel
  website IPC; main-owned canonical manifest v1; strict absent/empty/owned destination admission;
  sibling stage/backup directory transaction with bounded pinned file I/O, source/destination
  revalidation, explicit replacement, rollback, identity-proven cleanup, cancellation and
  committed/uncertain truth; renderer dirty guard, mutual exclusion, generation control,
  accessible status and Generate Website action.
- Security hardening: recorded directory and per-leaf device/inode identities and hashes; added
  final synchronous session/parent/root/source/target/stage/backup validation before every rename,
  unlink, and `rmdir`; post-rename target identity checks; identity-bound rollback and per-leaf
  cleanup that preserves swapped attacker directories.
- Cleanup ordering: moved expensive source/target checks before the final per-leaf inspection;
  each `unlink` now follows a fresh `lstat`/`NOFOLLOW` open/`fstat`/hash plus adjacent parent/backup
  identity check. Deterministic index and manifest replacement-window tests verify replacement
  inodes survive; the irreducible syscall-sized Node pathname race remains documented as P3.
- Files: `packages/desktop/src/common/book/websitePolicy.ts`,
  `packages/desktop/src/main/book/sessionManager.ts`, book IPC/preload/types/store/workspace,
  website policy/reader/store tests, and `docs/BOOK_WEBSITE.md`.
- Tests: targeted website/reader/store unit tests 137/137 passed; full unit suite 59 files,
  1020/1020 passed; typecheck and production build passed; real Electron website E2E 1/1 passed
  with exact canonical manifest bytes/hash, zero active-content attributes, scoped Chinese alias
  navigation resolving to its heading, one body per physical document, and isolated `loadFile`
  offline checks; scoped ESLint, Prettier, and `git diff --check` passed.
- Key decisions: output is exactly `index.html` plus `leafbook-manifest.json`; local images remain
  placeholders; no recursive deletion or crash-recovery scanning; filesystem commit is documented
  as best-effort because Node lacks portable `openat`/`renameat`/atomic directory exchange.
- Unresolved: none in Phase 8C scope; PDF, server/cloud publishing, assets, and recovery tooling are
  later phases.
- Git commit: not created (not requested).

## 2026-07-29 — Phase 8D security boundary and artifact provenance hardening

- User goal: finish the LeafBook release-readiness boundary in sequence,
  including uploader/Shell IPC, renderer networking, Windows network-file
  images, artifact audits, packaged-smoke provenance, and accurate dependency
  inventory wording.
- Completed:
  - restricted uploader IPC to trusted Editor owners and main-owned persisted
    settings; replaced shell execution with fixed `execFile` argument arrays,
    validated bounded canonical regular image files, and required native
    confirmation for every PicGo/custom run followed by immediate image and
    executable re-fstat identity checks;
  - restricted external targets to confirmed HTTP/HTTPS/mailto URLs, disabled
    renderer-supplied reveal/openPath operations pending opaque capabilities,
    and applied the trusted-owner gate to clipboard bridges;
  - made ownerless renderer-session traffic fail closed, limited development
    networking to the exact HTTP Vite origin plus matching WS, and rejected
    raw/encoded/mixed-slash UNC and non-empty-authority `file:` images through
    one shared local-resource predicate; static print/PDF now validates in an
    inert template and legacy HTML export emits placeholders before an unsafe
    image can become a live `src`;
  - added canonical fixed-dist artifact path checks for symlinks, FIFO/device
    nodes and containment; applied updater-name audits to unpacked apps,
    extracted ZIPs, mounted DMGs, platform archives, and release trees; one
    shared ASAR-listing audit rejects case-insensitive updater runtimes and
    forbidden updater basenames at any internal path;
  - added a canonical macOS audit receipt under `dist/audit` binding schema and
    audit-config versions, bundle realpath/device/inode and identity, plus a
    canonical sorted complete content-tree manifest: directories and modes,
    exact in-bundle symlink targets, and every regular file's mode, size and
    SHA-256, including frameworks/helpers and `app.asar.unpacked`; packaged
    smoke immediately recomputes exact equality before launching;
  - regenerated the production dependency license inventory with package
    versions preserved (including multiple versions) and documented its
    non-SBOM limitations; documented the inherited `v*` automatic publish
    workflow as a P1 external blocker requiring protected/manual approval.
- Files: uploader/Shell/network/image runtime and tests under
  `packages/desktop` and `packages/muya`; release audit/smoke/receipt helpers
  under `scripts`; `packages/desktop/build/THIRD-PARTY-LICENSES.txt`;
  `docs/RELEASE_GATE.md`; `WORKLOG.md`.
- Tests:
  - desktop full unit: 65 files, 1095/1095 passed;
  - Muya full unit: 212 files, 1449/1449 passed;
  - selected source Electron release smoke: exact 6/6 passed after a six-title
    Playwright collection preflight;
  - desktop typecheck and production build passed (four existing CodeMirror
    chunk warnings only);
  - full ESLint passed with 0 errors and 134 inherited warnings; final scoped
    ESLint and Prettier checks, shell syntax, license validation, receipt/path
    fixtures, and `git diff --check` passed.
- Key decisions: arbitrary renderer paths are not treated as capabilities;
  every uploader execution and external navigation require native confirmation;
  smoke trusts only a fixed audit-produced receipt and recomputes the complete
  audited content tree; the receipt does not claim to bind xattrs, ACLs,
  resource forks, or code-signature validity;
  no release workflow, version, tag, signing, publishing, or dependency changes
  were authorized.
- Unresolved: overall public release remains NOT READY. A complete
  network-denied packaged app and packaged smoke are unavailable because the
  required local Electron/electron-builder cache is missing; Windows/Linux
  runtime evidence, signing/notarization, SBOM/provenance, protected manual
  release approval, and inherited workflow remediation remain external
  blockers.
- Git commit: not created; nothing was pushed.
