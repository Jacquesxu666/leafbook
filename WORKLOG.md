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

## 2026-07-30 — Phase 9C nonblocking preparation source boundary

- User goal: ensure that every untrusted manuscript open used by Prepare Book
  rejects FIFOs and other special files promptly, including at the final
  synchronous publication revalidation, with no unsafe platform fallback.
- Completed: added one mandatory safe-read flag gate for
  `O_RDONLY | O_NOFOLLOW | O_NONBLOCK` and a root-directory variant that also
  requires `O_DIRECTORY`. Missing runtime constants make preparation
  unavailable. Automatic/selected manuscript reads, final source revalidation,
  target-content verification, and final root-directory synchronization now
  use the gated flags and immediately validate descriptor type, link count,
  size, and/or expected inode identity before reading or synchronizing.
  Deterministic POSIX coverage replaces automatic, explicitly selected, and
  final-boundary manuscripts with FIFOs and proves sub-second rejection, no
  `SUMMARY.md`, and preservation of the FIFO. Hosts without `mkfifo` skip only
  those dynamic cases; a platform-static test retains the mandatory flags and
  forbids `?? 0` fallback in every build.
- Files: `packages/desktop/src/main/book/preparationManager.ts`,
  `packages/desktop/test/unit/specs/book-preparation-manager.spec.ts`,
  `docs/PREPARE_BOOK.md`, and this log.
- Tests: preparation manager 23/23; heading/manager/preparation-store/reader
  focused unit 158/158; desktop full unit 1133/1133; desktop typecheck and
  production build passed (main bundle 1,828.98 kB). The image-alt actual
  Prepare Electron scenario passed 1/1 in 4.6 seconds. The no-environment RC
  returned its fixed SKIP result; an authorized real-book root was not
  configured in this process, so no new authorized RC claim is made. Scoped
  ESLint, Prettier, and `git diff --check` passed. An initially mis-forwarded
  Playwright command started the broad suite; its target scenario passed before
  the remaining run was intentionally interrupted, then the exact one-test
  command passed cleanly.
- Key decisions: regular source/target leaves never use a blocking or
  follow-links fallback; the final directory descriptor additionally requires
  `O_DIRECTORY` and must match the leased root inode. Special-file rejection
  preserves the attacker-controlled leaf and remains zero-write.
- Unresolved: the macOS result is covered locally, but Windows and Linux still
  require their release-matrix runtime executions. A runtime without any
  mandatory flag fails closed by design.
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

## 2026-07-29 — Phase 9B opt-in real-book RC harness

- User goal: validate a real Markdown book through inferred and structured
  LeafBook workflows without modifying or disclosing the original.
- Completed: added a skipped-by-default Electron RC suite activated only by
  the package wrapper's marker-bound 256-bit nonce, never by
  `LEAFBOOK_RC_BOOK_ROOT` alone; added a marker/owner/realpath-validated temp
  root, descriptor-based bounded nofollow copier with deterministic
  swap-to-symlink rejection, capped hidden-excluding `O_NOFOLLOW` streaming
  source manifest comparison, broad-root rejection, guarded
  cleanup, caller-owned Electron profile support, Track A inferred-landing
  checks, and Track B generated-fragment SUMMARY checks with search and
  measured position persistence across a new Electron process; Save now uses a
  complete copied-tree manifest to prove only SUMMARY bytes and digest change.
  The runner discards bounded child output without writing it, strips all
  `LEAFBOOK_RC_*` variables from Electron, retains signal handlers through
  cleanup, and emits only fixed aggregate status:
  `RC_HARNESS_PASS product_ready=false adaptation_gaps=2 code=0`.
- Files: `packages/desktop/test/e2e/real-book-rc.spec.ts`,
  `packages/desktop/test/e2e/helpers.ts`,
  `packages/desktop/scripts/run-real-book-rc.mjs`,
  `packages/desktop/package.json`, `docs/REAL_BOOK_RC.md`, and `WORKLOG.md`.
- Tests: before the authorization hardening, real-book Electron RC 1/1 passed
  in 40.8 seconds; this is historical functional evidence, not a current
  hardened-wrapper acceptance run. The hardened absent-environment wrapper
  emitted its fixed SKIP status. The current hardened authorized run completed
  in 16.4 seconds with
  `RC_HARNESS_PASS product_ready=false adaptation_gaps=2 code=0`;
  deterministic child-failure runner
  cleanup, synthetic private-output non-disclosure, direct-bypass plus invalid
  nonce source non-access, pre-root signal cleanup, child-clean-exit signal
  cleanup, and post-run artifact-absence checks passed; selected source Electron regression
  gate passed 6/6; desktop full unit passed 65 files and 1095/1095 tests; Muya
  full unit passed 212 files and 1449/1449 tests; desktop typecheck and
  production build passed; scoped ESLint, Prettier, and `git diff --check`
  passed.
- Evidence: source before/after manifest matched and validated cleanup
  succeeded; inferred navigation exposed four logical entries with Arrange
  disabled; the initial inferred landing was not the manuscript and manual
  selection rendered 34 H1 headings; search,
  reading-position restore, dirty cancel/discard, remote-request zero,
  single-file HTML, and two-file website checks passed; structured navigation
  resolved first/middle/last aliases to their actual ordinal H1 targets, search
  and reading-position reopen persistence passed, arrangement
  Undo+Cancel was an exact zero-write, Save changed only the copied SUMMARY,
  and both outputs contained one physical manuscript body.
- Key decisions: source paths, prose, titles, search tokens, hashes, and visual
  artifacts are never logged or committed; generated labels are synthetic;
  production navigation is not patched from the RC harness. Functional
  stability of the harness is not product acceptance: the wrong inferred
  landing and single physical chapter keep book UX/product RC not passed.
- Unresolved: inferred navigation selects the wrong nested landing and presents
  the main manuscript as one physical chapter; Phase 9C needs a source-splitting
  versus virtual-heading-chapter decision. Ten SVG boundary tags represent five
  inline SVG elements, and the reader safely strips all five; this remains a
  visual-fidelity gap. Node lacks directory-handle-relative traversal and
  cleanup has a validation-to-remove interval; these same-user local races are
  accepted P3 constraints for the opt-in RC harness. `SIGKILL`, a process
  crash, or power loss may leave an owner-private RC temp and orphan child;
  recovery is deliberately manual and requires exact prefix, canonical parent,
  current-UID, type, and marker/nonce validation—never a broad removal or
  automatic sweep.
- Git commit: not created; nothing was pushed.

## 2026-07-29 — Phase 9B final privacy and cleanup hardening

- User goal: close the final RC cleanup-marker and assertion-privacy findings
  without changing production behavior or exposing real-book data.
- Completed: replaced the internal temporary-root cleanup marker read with a
  bounded descriptor read using `O_RDONLY | O_NOFOLLOW | O_NONBLOCK`, exact
  32-byte size/content validation, single-link regular-file checks, and
  descriptor plus pathname post-read identity checks. Cleanup now revalidates
  the authorized runner parent and internal root realpath, prefix, UID, and
  directory identity before recursive removal. Four deterministic fixtures
  prove fail-closed retention for symlink, oversized, directory, and pathname
  identity-swap markers. The runner authorization readers received the same
  nonblocking and pathname-identity checks.
- Privacy: all RC assertions were mechanically audited. Private arrays,
  buffers, paths, headings, fragments, tokens, manifests, raw HTML, and
  SUMMARY bytes are reduced to booleans, counts, or generic numeric evidence
  before assertion. The redundant derived-negation adaptation-gap assertion
  was removed; the independent DOM count observation and later manual
  manuscript selection remain.
- Files: `packages/desktop/test/e2e/real-book-rc.spec.ts`,
  `packages/desktop/scripts/run-real-book-rc.mjs`,
  `docs/REAL_BOOK_RC.md`, and `WORKLOG.md`.
- Tests: the no-environment wrapper emitted the fixed SKIP status; child
  failure, synthetic private-output, direct-bypass, signal cleanup,
  pre-root-signal cleanup, and broad-root rejection self-tests passed. One
  authorized real-book wrapper RC passed with fixed aggregate status and
  exercised all four cleanup fixtures. The assertion privacy scan reported 62
  assertions, zero forbidden direct/container inputs, zero length matchers,
  and zero interpolated errors; the four-file source privacy scan reported zero
  findings. Desktop typecheck and scoped ESLint passed.
- Key decisions: fixture teardown is separate from the guarded cleanup attempt,
  so each fixture first proves that the attacker-shaped root was retained.
  Cleanup remains fail closed; no recovery sweep or production path was added.
- Unresolved: Node still lacks directory-handle-relative recursive removal, so
  the previously documented validation-to-remove same-user race remains an
  accepted P3 constraint.
- Git commit: not created; nothing was pushed.

## 2026-07-30 — Phase 9C Prepare Book workflow

- User goal: let an inferred Markdown folder become a GitBook-style book by
  creating safe heading-based navigation without splitting or changing the
  manuscript.
- Completed: added a Node-safe Muya ATX-H1 analyzer and shared fragment
  normalization; a main-owned preparation lease with inferred-only eligibility,
  opaque source selection, bounded preview, create-only race-safe
  `SUMMARY.md`, session refresh, and typed IPC; and the accessible Prepare Book
  panel/store flow with cancel, Escape, stale-response cleanup, output/Arrange
  mutual exclusion, and truthful durability-uncertain handling. The preview
  renders at most 200 of up to 2,000 chapters and announces the remainder.
  Production bundles the analyzer instead of requiring TypeScript at runtime.
  The real-book RC Track B now clicks the actual Prepare Book UI, proves Cancel
  is zero-write, then creates and exercises the generated summary; it no longer
  writes a synthetic SUMMARY manually. A P1 parity repair now derives H1
  outline text and shared fragment IDs from a sanitized DOM clone before visual
  image placeholders are inserted, so image alt text remains authoritative
  without changing the placeholder shown in the body; H2-H6 behavior is
  unchanged.
- Files: added `packages/muya/src/state/analyzeHeadings.ts` and tests;
  `packages/desktop/src/common/book/heading.ts`;
  `packages/desktop/src/main/book/preparationManager.ts`;
  `packages/desktop/src/renderer/src/components/bookWorkspace/BookPreparationPanel.vue`;
  preparation unit/Electron tests; and `docs/PREPARE_BOOK.md`. Updated Muya
  inline lexer options, desktop main/session/IPC/preload/types/store/workspace,
  fragment consumers, build/test aliases, RC harness/runner/docs, and this log.
- Tests: Muya full Vitest passed 213 files and 1454/1454 tests. Desktop full
  unit passed serially across 68 files and 1118/1118 tests;
  preparation-focused tests passed 3 files and 140/140 tests; the actual
  Prepare Electron scenario passed 1/1 in 5.3 seconds; and the selected source
  release smoke passed 6/6 in 16.4 seconds. Desktop typecheck and production
  build passed. The final main bundle is 1,819,964 bytes versus a
  1,690,840-byte baseline (+129,124 bytes, +7.64%), and the analyzer is bundled
  rather than left as a runtime package require. Full ESLint passed with zero
  errors and 134 inherited warnings after clearing all new panel warnings;
  Prettier and `git diff --check` passed. The no-environment wrapper emitted
  its fixed SKIP status and all six privacy/cleanup runner self-tests passed.
  The authorized hardened wrapper passed with the exact aggregate fields
  `product_ready=false`, `book_structure_ready=true`,
  `visual_fidelity=false`, and `adaptation_gaps=1`. Original-manifest equality,
  validated cleanup, privacy scans, and absence of retained artifacts were
  confirmed. Dependency manifests, lockfiles, release workflows, and version
  files are unchanged. The P1 repair gate additionally passed the Muya analyzer
  suite 5/5, Node without browser globals, desktop
  heading/preparation-manager/reader suites 136/136, desktop typecheck and
  production build, and an image-heading actual-Prepare Electron scenario 1/1
  in 5.9 seconds; scoped ESLint, Prettier, and `git diff --check` passed.
- Key decisions: only root-level readable session candidates may be selected;
  renderer DTOs contain no filesystem paths or manuscript bytes; heading
  extraction uses Muya block/inline semantics without DOM or renderer imports;
  create uses an exclusive staged file plus atomic no-overwrite link and
  identity/hash checks; a committed-but-unconfirmed result is never retried
  automatically. Export and website generation deduplicate aliases to one
  physical manuscript body.
- Unresolved: Muya `tsc --noEmit` retains the pre-existing unused
  `plantumlServer` diagnostic in `diagramPreview.ts`; it is unrelated and was
  not changed. Inline SVG remains safely stripped as a visual-fidelity
  observation. The documented same-user filesystem race and abrupt-process RC
  cleanup limits remain.
- Git commit: not created; nothing was pushed.

## 2026-07-30 — Phase 9C post-hook publication race repair

- User goal: close the `beforeLink` await window so a cancelled or stale
  preparation, changed root/manuscript, attacker-created SUMMARY, or replaced
  staging file can never be published afterward.
- Completed: added a synchronous post-hook boundary validation for the exact
  owner/session/generation/preparation lease, root and target-parent identity,
  source descriptor/path identity and SHA-256, NFC/case-folded SUMMARY absence,
  exact target absence, and staging descriptor/path identity and SHA-256. The
  validated staging descriptor remains open while the manager enters its
  critical turn and immediately performs the create-only hard link without an
  await. Pre-critical failures expire the lease and remove exact staging
  artifacts, including a stage carried by a root renamed within its original
  parent. A close observed after the critical link now truthfully reports a
  committed conflict instead of cancellation success.
- Files: `packages/desktop/src/main/book/preparationManager.ts`,
  `packages/desktop/test/unit/specs/book-preparation-manager.spec.ts`,
  `docs/PREPARE_BOOK.md`, `docs/REAL_BOOK_RC.md`, and this log.
- Tests: deterministic held-`beforeLink` races cover close, session revoke,
  owner cleanup, source overwrite, root inode swap, exact and case-folded
  attacker SUMMARY winners, plus critical cancellation. Manager unit passed
  16/16; heading/manager/store/reader focused unit passed 4 files and 151/151;
  Muya analyzer passed 5/5 and its Node-without-browser-globals smoke passed.
  Desktop typecheck and production build passed. The actual image-alt Prepare
  Electron scenario passed 1/1 in 7.5 seconds. Scoped ESLint, Prettier, and
  `git diff --check` passed. The RC documentation now lists all six runner
  privacy/cleanup self-tests.
- Key decisions: failures after the hook retain semantic error truth
  (`preparation-not-found`, `preparation-source-changed`, or
  `preparation-conflict`) rather than collapsing every race into a generic
  write failure; an attacker-owned target is preserved byte-for-byte.
- Unresolved: Node still has no directory-handle-relative unlink API, so
  recovery of a staging inode after an attacker moves the entire root outside
  its original parent remains within the already documented same-user P3 path
  race.
- Git commit: not created; nothing was pushed.

## 2026-07-30 — Phase 9C direct create-only publication boundary

- User goal: remove the pathname staging/hard-link publication design and use
  a truthful create-only boundary that never overwrites an existing SUMMARY or
  claims crash-atomic content.
- Completed: preparation now performs its final lease/session, root/parent,
  source identity/digest, case-folded conflict, and exact-target validation
  synchronously, then opens `SUMMARY.md` directly with
  `O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_NONBLOCK` and mode `0600`.
  Unsupported no-follow/non-blocking flags fail closed without a fallback.
  After the descriptor is proven to be a regular single-link file, publication
  is a no-await critical turn with a bounded canonical-byte write loop, file
  sync, descriptor size/write-digest verification, root/parent revalidation,
  pathname-to-descriptor inode and content verification, and directory sync.
  Post-open failures unlink only when the unchanged root, parent, pathname, and
  open descriptor prove ownership of the exact inode. Otherwise pathname
  cleanup is forbidden and the revoked lease returns committed/uncertain;
  directory-sync failure returns successful creation with uncertain
  durability. All staging paths, hard-link publication, related hooks, cleanup,
  tests, and current-design claims were removed.
- Files: `packages/desktop/src/main/book/preparationManager.ts`,
  `packages/desktop/test/unit/specs/book-preparation-manager.spec.ts`,
  `docs/PREPARE_BOOK.md`, and this log.
- Tests: direct manager passed 20/20; the heading, manager, preparation-store,
  and reader focused set passed 155/155; Muya analyzer passed 5/5 and a
  Node-without-browser-globals smoke passed. Desktop typecheck and production
  build passed; the main bundle is 1,827,852 bytes. The image-alt actual
  Prepare Electron scenario passed 1/1 in 7.7 seconds. The no-environment RC
  emitted the fixed SKIP result and all six privacy/cleanup runner self-tests
  passed; the authorized hardened real-book RC was independently reported
  passing. Deterministic manager coverage includes direct `EEXIST`,
  case-folded conflict, symlink/FIFO targets, a post-open pathname replacement
  that preserves the attacker, safe write/sync cleanup, root-swap partial
  residue truth, pre-critical cancellation/revocation, critical busy, and
  source/root races. Scoped ESLint, Prettier, and `git diff --check` passed.
- Key decisions: the final pathname is created directly and exclusively;
  neither pathname staging nor hard-link publication is an allowed platform
  fallback. The macOS, Windows, and Linux release matrix must validate the same
  flag behavior. A post-open uncertainty is never auto-retried.
- Unresolved: direct exclusive creation is not content-atomic across process
  crash or power loss. An abrupt stop can leave a partial `SUMMARY.md`; its
  next case-folded existence check fails closed and requires manual inspection
  and removal. This is an explicit P3 durability/recovery limitation.
- Git commit: not created; nothing was pushed.

## 2026-07-30 — Phase 9C bounded publication verification

- User goal: make direct `SUMMARY.md` verification immune to attacker-sized
  allocation and detect target or manuscript changes at every publication
  boundary.
- Completed: the exclusive target still opens write-only, is immediately
  required to be a zero-length regular single-link file, and retains its
  device/inode/mode identity. Target verification safely reopens that exact
  inode read-only and streams its expected bytes through one 64 KiB buffer with
  an EOF probe and SHA-256; it never sizes an allocation from target metadata.
  Full pre/post descriptor state is compared after writing, after file sync,
  and immediately before directory sync. The prepared manuscript now retains
  its complete stable file state and the asynchronous and final synchronous
  reads recheck type, link count, device/inode, mode, size, mtime, ctime, and
  digest. Transient hard-link or metadata changes therefore fail closed even
  when content is restored.
- Files: `packages/desktop/src/main/book/preparationManager.ts`,
  `packages/desktop/test/unit/specs/book-preparation-manager.spec.ts`,
  `docs/PREPARE_BOOK.md`, and this log.
- Tests: preparation manager passed 29/29; heading, manager,
  preparation-store, and reader passed 164/164; desktop full unit passed
  serially across 68 files and 1139/1139 tests; Muya full unit passed serially
  across 213 files and 1454/1454 tests; and the Node-without-browser-globals
  analyzer smoke passed. Desktop typecheck and production build passed, with a
  1,832,945-byte main bundle containing the analyzer. The actual image-alt
  Prepare Electron scenario passed 1/1 in 8.8 seconds. The no-environment RC
  emitted its fixed SKIP status and all six privacy/cleanup self-tests passed.
  The independently run authorized hardened RC passed with the exact aggregate
  fields `product_ready=false`, `book_structure_ready=true`,
  `visual_fidelity=false`, and `adaptation_gaps=1`; original-manifest equality,
  validated cleanup, privacy checks, and zero retained artifacts were
  confirmed. The first intentionally parallel broad run hit unrelated
  five-second resource-contention timeouts; the required serial reruns above
  passed. Scoped ESLint, Prettier, and `git diff --check` passed.
- Key decisions: the create contract remains
  `O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_NONBLOCK`; content is read only
  through a separately opened safe descriptor after matching it to the
  original exclusive-create inode. Exact owned-inode cleanup reports
  `committed: false`; loss of that proof remains truthfully
  committed/uncertain.
- Unresolved: the documented abrupt-process partial create and platform
  release-matrix requirements remain.
- Git commit: not created; nothing was pushed.

## 2026-07-30 — Phase 9C post-open zero-write boundary

- User goal: prevent a root, ancestor, target, source, session, or cancellation
  race after exclusive target creation from receiving canonical SUMMARY bytes.
- Completed: after `O_EXCL` opens the target, preparation now keeps the
  descriptor open and performs a second synchronous prewrite validation of the
  exact lease/session generation, original root and parent realpath/inode,
  case-folded and exact target pathname, pathname-to-descriptor identity, empty
  regular single-link target state and mode, and the manuscript's complete
  state and digest. Canonical writing starts in the same synchronous turn only
  after that boundary succeeds. Prewrite cancellation remains able to win;
  cancellation after canonical writing begins retains the critical/busy
  contract. A failed prewrite removes only a still-empty pathname that proves
  it is the same descriptor inode, without depending on the root still having
  its original identity; otherwise it closes without pathname cleanup and
  truthfully reports an uncertain empty residue. Semantic failure codes remain
  specific to expiration, source/root change, or SUMMARY conflict.
- Files: `packages/desktop/src/main/book/preparationManager.ts`,
  `packages/desktop/test/unit/specs/book-preparation-manager.spec.ts`,
  `docs/PREPARE_BOOK.md`, and this log.
- Tests: preparation manager passed 34/34. Deterministic tests cover root and
  ancestor symlink redirection before open, root symlink redirection after
  open, pathname replacement, empty and attacker-grown targets, source and
  session changes, prewrite cancellation, and critical cancellation after
  writing begins. Desktop full unit passed in isolated serial mode across 68
  files and 1144/1144 tests; Muya full unit passed in isolated serial mode
  across 213 files and 1454/1454 tests. Desktop typecheck and production build
  passed; the main bundle is 1,838,847 bytes. The image-alt actual Prepare
  Electron scenario passed 1/1 in 4.8 seconds, and all six no-environment RC
  privacy/cleanup self-tests passed. The authorized real-book source variable
  was not present in this shell, so no new authorized RC was originated here;
  prior independent authorized RC evidence remains recorded above. Scoped
  ESLint, Prettier, and `git diff --check` passed. Earlier unconstrained broad
  runs hit unrelated five-second resource-contention timeouts in PDF and Muya
  entrypoint tests; each focused test and both required isolated serial full
  reruns passed.
- Key decisions: a prewrite failure never writes canonical content. Safe empty
  cleanup is bound to the open descriptor inode and the exact pathname, not to
  a now-stale root identity. Node exposes no `openat`-style
  directory-descriptor-relative transaction, so the precheck, open, prewrite
  validation, and write remain separate same-user syscalls.
- Unresolved: a same-account process with equal filesystem authority can still
  race individual syscalls. This is a documented P3 limitation; the tested
  observable guarantee is that deterministic ancestor/root redirection and
  post-open prewrite races receive zero canonical bytes.
- Git commit: not created; nothing was pushed.

## 2026-07-30 — Phase 9C Unicode Default Case Folding boundary

- User goal: make every Prepare Book SUMMARY-conflict scan and exact-stem
  manuscript selection use one locale-independent full Unicode case fold.
- Completed: added a generated Unicode 16.0.0 Default Case Folding helper that
  normalizes input to NFC and applies the official C and F mappings while
  excluding simple S alternatives and Turkic T mappings. The initial async
  SUMMARY scan, final synchronous pre-open scan, post-open prewrite scan, and
  exact-stem automatic selection now share that helper. Ill-formed UTF-16 fails
  closed. Added a generator pinned to the official source version, SHA-256, and
  1,557 expected mappings; it rejects source hash/version mismatches, malformed
  data, duplicates, invalid code points, surrogate mappings, and unexpected
  counts. Its self-test covers the valid source and tamper, wrong-version,
  malformed-line, and duplicate failures. The generated runtime is compact and
  performs no network or filesystem access.
- Files: `scripts/generateUnicodeCaseFold.mjs`,
  `packages/desktop/src/common/book/unicodeCaseFold.ts`,
  `packages/desktop/src/main/book/preparationManager.ts`,
  `packages/desktop/test/unit/specs/book-unicode-case-fold.spec.ts`,
  `packages/desktop/test/unit/specs/book-preparation-manager.spec.ts`,
  `docs/PREPARE_BOOK.md`, and this log.
- Tests: Unicode helper and preparation focused coverage passed 45/45; the
  helper, manager, preparation store, and Reader focused set passed 177/177.
  Cases include ASCII, long-s `ſummary.md`, `Straße`/`STRASSE`, Greek sigma and
  final sigma, Kelvin sign/K, NFC/NFD equivalence, duplicate folded candidate
  ambiguity, and conflicts at async, synchronous pre-open, and post-open
  prewrite boundaries. Desktop full unit passed serially across 69 files and
  1155/1155 tests; Muya full unit passed serially across 213 files and
  1454/1454 tests. Desktop typecheck and production build passed; the main
  bundle is 1,855,316 bytes. The Node-without-browser-globals smoke passed, the
  image-alt Prepare Electron scenario passed 1/1 in 3.8 seconds, and all six
  no-environment RC privacy/cleanup self-tests passed. Scoped ESLint, Prettier,
  and `git diff --check` passed.
- Evidence: the official Unicode source SHA-256 is
  `6f1f9c588eb4a5c718d9e8f93b782685e5c7fec872cf05e8e6878053599e09bb`.
  Fresh source generation plus repository Prettier reproduced the generated
  16,784-byte table byte-for-byte; its final content hash was
  `0cadb2c645b05f3366c6b8e7780b63f8ad01692a660ce5aac11f3f589b5147ec`.
  The hardened generator self-test emitted
  `UNICODE_CASE_FOLD_GENERATOR_SELF_TEST_PASS`.
- Key decisions: no locale APIs, upper-to-lower heuristic, runtime download,
  dependency, or lockfile change is used. Unicode data updates require an
  explicit version, source-hash, mapping-count, generated-table, and regression
  review.
- Unresolved: characters assigned new fold mappings after Unicode 16.0.0 remain
  identity-mapped until deliberate regeneration. This pinned Unicode-version
  drift is the residual risk; updating silently at runtime would make
  cross-platform conflict decisions non-reproducible.
- Git commit: not created; nothing was pushed.

## 2026-07-30 — Phase 9C automatic preparation lease cleanup

- User goal: ensure a failed automatically selected manuscript never leaves an
  inaccessible preparation lease that consumes the per-owner cap, while
  preserving successful and explicit-selection leases.
- Completed: the unique automatic-candidate path now wraps preparation in
  `try/finally`. A returned failure or thrown exception releases the lease only
  when the map still contains that exact lease object and its preparation ID,
  owner, session ID, session generation, and preparation generation all match
  the captured automatic attempt. A successful automatic preparation retains
  its lease. A stale failed attempt cannot delete a concurrent or replacement
  lease. Explicit-selection failures retain their lease so the user can choose
  another source or close the preparation.
- Files: `packages/desktop/src/main/book/preparationManager.ts`,
  `packages/desktop/test/unit/specs/book-preparation-manager.spec.ts`,
  `docs/PREPARE_BOOK.md`, and this log.
- Tests: Unicode helper plus preparation manager passed 48/48; the helper,
  manager, preparation store, and Reader focused set passed 180/180. Four
  sequential automatic failures covering invalid headings, invalid UTF-8,
  duplicate fragments, and missing source did not consume the owner cap; a
  corrected fifth begin succeeded and closed. Concurrent failed and valid
  automatic begins preserved the valid lease, and an explicit-selection
  failure could subsequently select a valid source and close. Desktop
  typecheck and production build passed; the main bundle is 1,855,918 bytes.
  The image-alt Prepare Electron scenario passed 1/1 in 3.8 seconds. Scoped
  ESLint, Prettier, and `git diff --check` passed.
- Generator evidence: `docs/PREPARE_BOOK.md` now specifies the exact
  generation command followed by the repository Prettier step. A fresh
  official Unicode 16.0.0 source run through those two documented steps
  reproduced the committed generated artifact byte-for-byte with SHA-256
  `0cadb2c645b05f3366c6b8e7780b63f8ad01692a660ce5aac11f3f589b5147ec`.
- Key decisions: cleanup is identity-bound rather than ID-only, and `finally`
  covers both ordinary error results and unexpected throws. Formatting remains
  an explicit deterministic repository step rather than adding a formatter
  dependency or runtime formatting path to the generator.
- Unresolved: no new issue. The pinned Unicode-version drift documented in the
  preceding entry remains.
- Git commit: not created; nothing was pushed.

## 2026-07-30 — Phase 9C preparation cleanup on session LRU eviction

- User goal: make per-owner session-cap eviction synchronously revoke Prepare
  Book state, restore the preparation capacity slot, and prevent evicted
  sessions' late work from affecting newer leases.
- Completed: `BookSessionManager.registerSession` now revokes the oldest
  session's preparation leases between arrangement and export cleanup, matching
  the established refresh, close, and invalid-root ordering. Added
  identity/currentness checks immediately after the deterministic pre-read
  test boundary so a revoked begin or selection fails before reading. Wired
  narrowly scoped preparation read and pre-open hooks through the session
  manager for deterministic race tests. Regression coverage exceeds the
  20-session owner cap, verifies oldest-first repeated eviction, restores the
  four-lease owner slot, preserves another owner's session and lease across
  eviction and owner cleanup, and proves late automatic begin, explicit
  selection, and commit results cannot revive or clear a newer lease; the late
  commit also publishes no `SUMMARY.md`.
- Files: `packages/desktop/src/main/book/sessionManager.ts`,
  `packages/desktop/src/main/book/preparationManager.ts`,
  `packages/desktop/test/unit/specs/book-reader.spec.ts`, and this log.
- Tests: Reader plus preparation manager passed 174/174; Unicode helper,
  preparation manager, preparation store, and Reader passed 184/184. Desktop
  typecheck and production build passed; the main bundle is 1,856,300 bytes.
  The image-alt Prepare Electron scenario passed 1/1 in 4.6 seconds, and all
  six no-environment RC privacy/cleanup self-tests passed. Scoped ESLint,
  Prettier, and `git diff --check` passed.
- Key decisions: eviction cleanup remains synchronous and ordered as search,
  edits, arrangements, preparations, exports, then session deletion. These
  revokers contain only internal generation, collection, and abort operations;
  export descriptor close is already guarded, and no user hook or filesystem
  operation runs in the eviction path, so no artificial throwing-revoker
  behavior was added. Test hooks are inert unless explicitly supplied.
- Unresolved: no new issue. The authorized hardened real-book RC was left to
  the parent runner with access to the private source.
- Git commit: not created; nothing was pushed.

## 2026-07-30 — Phase 9C true session LRU and book-scoped preparation messages

- User goal: make the 20-session owner cap evict the genuinely least recently
  used session and prevent Prepare Book status or error messages from leaking
  into the bookshelf, editor, or another book.
- Completed: every successful owner-checked session lookup now moves that exact
  session to the newest Map position, and every session registration or
  same-ID replacement uses one delete-plus-set helper. Eviction still filters
  by owner and therefore removes only that owner's oldest remaining session,
  retaining the complete preparation cleanup and late-result protections.
  Internal identity/currentness-only `sessions.get` checks deliberately do not
  manufacture user recency, and owner/library cleanup loops keep direct
  deletion without access-driven Map mutation. The renderer now clears
  preparation status and error state when opening a picker or library,
  entering a session, showing the bookshelf, or leaving for the editor. A late
  committed result reports status only while the original reader session is
  still active, preserving the same-session close result while preventing an
  old book from repopulating messages after a switch.
- Files: `packages/desktop/src/main/book/sessionManager.ts`,
  `packages/desktop/src/renderer/src/store/books.ts`,
  `packages/desktop/test/unit/specs/book-reader.spec.ts`,
  `packages/desktop/test/unit/specs/book-preparation-store.spec.ts`, and this
  log.
- Tests: session, preparation manager, and preparation store passed 186/186;
  Unicode helper, preparation manager, preparation store, and Reader passed
  188/188. Coverage touches the original oldest session before overflow,
  verifies the untouched next-oldest and then the following session are
  evicted, proves refresh replacement recency and cross-owner isolation, and
  retains preparation revocation/cap and late begin/select/commit coverage.
  Renderer tests cover bookshelf, successful book switch, editor, cancelled
  picker, same-session late commit status, and an old commit resolving after a
  book switch. Desktop typecheck and production build passed; the main bundle
  is 1,856,619 bytes. The image-alt Prepare Electron scenario passed 1/1 in
  4.0 seconds, and all six no-environment RC privacy/cleanup self-tests passed.
  Scoped ESLint passed.
- Key decisions: Map delete-plus-set supplies explicit monotonic recency
  without a second timestamp/counter structure or clock edge cases. Only
  authenticated owner access and stored replacements touch recency; background
  lease identity probes do not. Preparation success remains visible after a
  user closes the panel in the same active book, but never follows the user
  across a session or mode reset.
- Unresolved: no new issue. The authorized hardened real-book RC remains with
  the parent runner that has private-source access.
- Git commit: not created; nothing was pushed.

## 2026-07-30 — Phase 9C stale preparation commit message isolation

- User goal: keep a delayed committed or durability-uncertain result truthful
  in its original book without ever presenting that old result as an error or
  success belonging to a newly opened book or the bookshelf.
- Completed: the stale preparation commit branch now applies both successful
  status and committed-error feedback through one exact context predicate. The
  original Reader session must still be active, its preparation generation
  must have advanced exactly once for the deliberate panel close, and no
  replacement preparation may be active. A book switch, bookshelf transition,
  additional close/reset, or overlapping preparation generation therefore
  suppresses both old success and old error writes symmetrically. A current
  commit and a commit that finishes after closing its panel in the same book
  remain truthful and are never retried.
- Files: `packages/desktop/src/renderer/src/store/books.ts`,
  `packages/desktop/test/unit/specs/book-preparation-store.spec.ts`, and this
  log.
- Tests: preparation store passed 14/14. Unicode helper, preparation manager,
  preparation store, and Reader passed 192/192. New deterministic cases cover
  same-session late committed-error visibility, successful old-result
  suppression after a book switch, committed-error suppression after opening
  another book and after returning to the bookshelf, and an older committed
  error losing to a newer preparation generation. Desktop typecheck and
  production build passed; the main bundle is 1,856,619 bytes. The image-alt
  Prepare Electron scenario passed 1/1 in 3.9 seconds, and all six
  no-environment RC privacy/cleanup self-tests passed.
- Key decisions: an exact `token + 1` generation boundary distinguishes the
  supported same-book “closed while commit finished” journey from any
  overlapping request or later reset. The global committed-error banner uses
  the same scope predicate as the success status rather than acting as an
  unscoped cross-book notification.
- Unresolved: no new issue. A future application-wide notification system
  could surface background outcomes with explicit book identity, but the
  current Reader banner must remain scoped to its active session.
- Git commit: not created; nothing was pushed.

## 2026-07-30 — Phase 9C reader-request commit isolation and uncertain retry block

- User goal: prevent an old preparation commit from changing Reader feedback
  after same-session navigation or refresh, and prevent users from retrying
  Prepare while a committed-uncertain SUMMARY still requires inspection.
- Completed: preparation commit now captures the Reader request generation at
  dispatch. A post-close result is visible only when that generation, the
  original session, the exact one-step preparation close generation, Reader
  mode, and absence of a replacement preparation all still match. Explicit
  chapter navigation, search-result navigation, refresh, book switching,
  bookshelf transitions, and overlapping preparation work therefore suppress
  old success and committed-error feedback. A visible committed uncertainty
  enters a session-scoped retry-blocked state, displays explicit folder
  inspection and refresh guidance, blocks both the store action and Prepare
  button, and never retries or removes anything automatically. Cancelling the
  folder picker preserves that state. A successful refresh clears it and the
  refreshed navigation source independently decides whether Prepare remains
  available; actual context transitions also clear it.
- Files: `packages/desktop/src/renderer/src/store/books.ts`,
  `packages/desktop/src/renderer/src/components/bookWorkspace/index.vue`,
  `packages/desktop/test/unit/specs/book-preparation-store.spec.ts`, and this
  log.
- Tests: preparation store passed 20/20. Unicode helper, preparation manager,
  preparation store, and Reader passed 198/198. Deterministic cases cover
  commit-close followed by explicit chapter reading, search-result activation,
  and refresh; stale success/error symmetry; same-book post-close truth;
  switch, bookshelf, and overlapping-generation isolation; no-retry store
  dispatch; cancelled-picker guidance retention; and inferred/summary refresh
  recomputation. Desktop typecheck and production build passed; the main
  bundle is 1,856,619 bytes. The image-alt Prepare Electron scenario passed
  1/1 in 3.8 seconds, and all six no-environment RC privacy/cleanup self-tests
  passed.
- Key decisions: the global Reader generation is the request identity because
  every accepted navigation and refresh already advances it. The uncertainty
  block is separate from ordinary transient preparation errors and survives
  cancelled open intent, but it is cleared by verified refresh or a real
  session/mode transition. Refresh is the explicit recovery boundary; no
  speculative filesystem action is added in the renderer.
- Unresolved: no new issue. An application-wide notification system could
  later surface background outcomes with explicit book identity, but current
  feedback remains session-scoped.
- Git commit: not created; nothing was pushed.

## 2026-07-30 — Phase 9C session uncertainty marker and refresh epoch

- User goal: keep old commit banners request-scoped while retaining a
  same-session no-retry safety marker after navigation, without allowing a
  result older than a successful authoritative refresh to re-block the book.
- Completed: the retry block is now keyed to the exact session independently
  of the Reader request-scoped error/status predicate. A delayed committed
  uncertainty in the same active session sets the marker even after chapter or
  search navigation, while its obsolete banner remains suppressed. Cross-book
  and bookshelf outcomes set neither. Commit captures a session verification
  epoch; only successful refresh or a real context transition advances it.
  Therefore error-then-refresh-success clears the marker, refresh-success-then
  old-error remains clear, and failed refresh retains the marker and guidance.
  The computed current-session marker continues to drive the Prepare store
  guard and disabled UI, while cancelled picker intent preserves it.
- Files: `packages/desktop/src/renderer/src/store/books.ts`,
  `packages/desktop/test/unit/specs/book-preparation-store.spec.ts`, and this
  log.
- Tests: preparation store passed 22/22. Unicode helper, preparation manager,
  preparation store, and Reader passed 200/200. The navigation matrix now
  covers both success and committed-error after explicit chapter reading,
  committed-error after search-result reading, and successful refresh before
  a late error. It verifies that same-session navigation suppresses obsolete
  messages but blocks Prepare dispatch, successful refresh in either ordering
  clears/recomputes the marker, and failed refresh retains the block and
  inspection guidance. Existing current, cancelled-picker, switch, bookshelf,
  overlapping-generation, inferred-refresh, and summary-refresh cases remain
  green. Desktop typecheck and production build passed; the main bundle is
  1,856,619 bytes. The image-alt Prepare Electron scenario passed 1/1 in
  3.9 seconds, and all six no-environment RC privacy/cleanup self-tests passed.
- Key decisions: banner visibility uses Reader request generation, whereas
  retry safety uses session identity plus a successful-refresh epoch. Only a
  completed authoritative refresh advances verification; an attempted or
  failed refresh cannot erase uncertainty. This separates message freshness
  from filesystem-safety recovery without adding renderer filesystem access.
- Unresolved: no new issue. Background outcomes remain intentionally silent
  outside their original session.
- Git commit: not created; nothing was pushed.

## 2026-07-30 — Phase 9C accessible refresh-required guidance

- User goal: make the session uncertainty no-retry state understandable to
  keyboard and assistive-technology users even when the obsolete request
  banner is intentionally suppressed.
- Completed: the disabled Prepare button now uses `aria-describedby` to
  reference one stable `book-preparation-refresh-required` explanation. When
  current request guidance already exists, that live status owns the ID. When
  request-scoped feedback is suppressed but the session marker remains, a
  persistent visible non-live explanation owns it instead. These branches are
  mutually exclusive, so there is no duplicate ID, duplicate text, or
  conflicting live announcement. Clearing the marker through successful
  refresh or context transition removes both the description and ARIA binding.
  The hover title remains supplemental rather than the only explanation.
- Files:
  `packages/desktop/src/renderer/src/components/bookWorkspace/index.vue`,
  `packages/desktop/test/unit/specs/book-preparation-a11y.spec.ts`, and this
  log.
- Tests: the new real-DOM accessibility test and preparation store passed
  23/23. Unicode helper, preparation manager, preparation accessibility,
  preparation store, and Reader passed 201/201. Because the desktop unit
  runner has neither the Vue SFC plugin nor `@vue/test-utils`, the test extracts
  the actual accessibility-sensitive nodes from `index.vue`, compiles them
  with `@vue/compiler-dom`, and mounts the real render function into jsdom. It
  verifies disabled state, the stable ARIA relationship, exactly one visible
  description, non-live suppressed guidance, current `role=status` guidance,
  and complete binding/description removal after clearing. Existing store
  coverage verifies switch and refresh clearing. Desktop typecheck and
  production build passed; the main bundle is 1,856,619 bytes. The image-alt
  Prepare Electron scenario passed 1/1 in 3.9 seconds, and all six
  no-environment RC privacy/cleanup self-tests passed.
- Key decisions: persistent safety guidance is visible text, not tooltip-only.
  Only current request guidance is a live region; already-established
  session-safety state is not re-announced merely because navigation changed.
  The test compiles real template source to avoid a static assertion or
  handwritten duplicate template.
- Unresolved: no new issue.
- Git commit: not created; nothing was pushed.

## 2026-07-30 — Phase 9C unified preparation product closure

- User goal: close the remaining preparation accessibility, navigation,
  candidate-privacy, stale-feedback, and RC release-truth gaps as one coherent
  product boundary.
- Completed: preparation now expands a collapsed Contents panel before opening,
  focuses the active panel, and restores focus to the stable Prepare trigger
  after Cancel or Escape. The complete workspace and preparation-panel
  templates have a single live owner for progress/errors and committed
  uncertainty; visible chapter counts and persistent refresh guidance are
  static. Candidate DTOs expose only opaque ID, title, and deterministic
  `Document N` labels, making duplicate titles distinguishable without paths or
  bodies. Begin, select, and commit scope away stale Reader errors while the
  committed-uncertain guard remains authoritative. RC public aggregates now
  report `content_adaptation_gaps=1`, `release_matrix_ready=false`, and explicit
  privacy-safe accepted P3 boundary identifiers; documentation does not claim
  SVG is the only production blocker.
- Files: `packages/desktop/src/shared/types/bookReader.ts`,
  `packages/desktop/src/main/book/preparationManager.ts`,
  `packages/desktop/src/renderer/src/components/bookWorkspace/BookPreparationPanel.vue`,
  `packages/desktop/src/renderer/src/components/bookWorkspace/index.vue`,
  `packages/desktop/src/renderer/src/store/books.ts`,
  `packages/desktop/scripts/run-real-book-rc.mjs`,
  `packages/desktop/test/unit/specs/book-preparation-manager.spec.ts`,
  `packages/desktop/test/unit/specs/book-preparation-store.spec.ts`,
  `packages/desktop/test/unit/specs/book-preparation-a11y.spec.ts`,
  `packages/desktop/test/e2e/book-reader.spec.ts`, `docs/PREPARE_BOOK.md`,
  `docs/REAL_BOOK_RC.md`, and this log.
- Tests: focused preparation manager/store/full-template DOM passed 71/71;
  complete desktop unit suite passed 1181/1181; typecheck, production build,
  scoped ESLint, Prettier, and `git diff --check` passed. The no-environment RC
  emitted the exact new SKIP aggregate and all six privacy/cleanup self-tests
  passed. The Electron book-reader run passed 9/11, including the complete new
  Prepare flow; two unrelated existing mobile-drawer and whole-book-search
  cases timed out without an assertion failure and were rerun separately.
- Key decisions: the candidate ordinal follows the already deterministic
  preparation source order and is presentation-only. A current preparation
  error is announced by the panel, committed uncertainty by the workspace
  status, and established refresh guidance remains visible but non-live.
  Product readiness stays false for the release matrix and accepted P3
  boundaries in addition to the one SVG adaptation gap.
- Unresolved: isolated reruns reproduced the two unrelated Electron timeouts.
  Playwright API tracing identified the mobile case waiting on its existing
  post-drawer **Edit** button because it is outside the 650px viewport; the
  search case still supplies no assertion detail. The requested Prepare E2E
  scenario itself is green.
- Git commit: not created; nothing was pushed.

## 2026-07-30 — Phase 9C RC preparation assertion and responsive header follow-up

- User goal: diagnose the authorized RC failure without exposing private data
  and resolve the two isolated Electron timeouts observed during unified
  preparation closure.
- Completed: inspection found the RC still querying the preparation count as
  `role=status` after the accessibility contract intentionally made the visible
  count static. The RC now separately verifies the visible chapter count and
  exactly one `.sr-only[aria-live="polite"]` announcement. A temporary
  allowlisted stage-only diagnostic was prototyped, privacy-tested, and then
  removed because the deterministic selector regression was identified; no new
  child output is retained. Playwright API tracing also showed both unrelated
  Electron timeouts waiting for header buttons outside the viewport after the
  Prepare action increased header width. Reader actions now wrap, and the
  mobile contents drawer is positioned relative to the reader grid so a
  multi-row header does not overlap it.
- Files:
  `packages/desktop/test/e2e/real-book-rc.spec.ts`,
  `packages/desktop/src/renderer/src/components/bookWorkspace/index.vue`, and
  this log.
- Tests: the exact Prepare, mobile drawer, and whole-book search Electron
  scenarios passed 3/3 in 9.4 seconds after rebuilding. Production build,
  desktop typecheck, scoped ESLint, Prettier, the no-environment RC aggregate,
  and all six permanent privacy/cleanup self-tests passed.
- Key decisions: RC checks both halves of the accessibility contract instead of
  restoring a duplicate status role. Stage diagnostics are unnecessary once
  the failure is locally deterministic, so the privacy wrapper continues to
  expose only its existing aggregate. Header controls wrap rather than becoming
  horizontally unreachable.
- Unresolved: the authorized private RC still requires one wrapper rerun by the
  parent environment; no private path or content was accessed here.
- Git commit: not created; nothing was pushed.

## 2026-07-30 — Phase 9C P2#14 begin-failure ownership and success focus

- User goal: make a thrown/rejected preparation begin visible before a panel
  exists, and restore keyboard focus after a successful preparation commit
  removes the panel and changes navigation.
- Completed: an unexpected begin throw or rejected invoke now sets the
  workspace Reader error only while its preparation generation, Reader mode,
  and owning session remain current. The panel-less workspace therefore owns
  one visible alert; a new begin clears it, and a late failure after session
  change is silent. Preparation-panel progress announcements are suppressed
  while its error alert is present, preventing two live owners. Successful
  commit handling now waits for store/session navigation and Vue DOM update,
  then focuses the first visible stable target in order: current chapter,
  Contents, Arrange. Hidden/disconnected targets are skipped and the tested
  desktop, collapsed, and mobile paths never leave focus on `body`.
- Files: `packages/desktop/src/renderer/src/store/books.ts`,
  `packages/desktop/src/renderer/src/components/bookWorkspace/index.vue`,
  `packages/desktop/src/renderer/src/components/bookWorkspace/BookPreparationPanel.vue`,
  `packages/desktop/src/renderer/src/components/bookWorkspace/bookPreparationFocus.ts`,
  `packages/desktop/test/unit/specs/book-preparation-store.spec.ts`,
  `packages/desktop/test/unit/specs/book-preparation-a11y.spec.ts`,
  `packages/desktop/test/unit/specs/book-preparation-focus.spec.ts`,
  `packages/desktop/test/e2e/book-reader.spec.ts`, and this log.
- Tests: targeted store/full-SFC DOM/focus tests passed 31/31. The complete
  desktop unit suite passed 1187/1187 across 71 files. Desktop typecheck,
  production build, scoped ESLint, Prettier, and `git diff --check` passed.
  Existing desktop Prepare plus collapsed mobile commit focus E2E passed 2/2
  in 5.8 seconds after the final build. The no-environment RC aggregate and all
  six permanent privacy/cleanup self-tests passed.
- Key decisions: begin failures reuse the existing scoped Reader alert because
  no preparation panel exists to own them. Commit focus is a renderer concern,
  kept in a small DOM helper with explicit visibility checks; the store remains
  independent of DOM timing. Committed-uncertain results do not run the success
  focus path.
- Unresolved: the parent still owns the authorized private RC rerun.
- Git commit: not created; nothing was pushed.

## 2026-07-30 — Phase 9C P2#15 exclusive operation live ownership

- User goal: guarantee that Prepare, export, website, arrangement, and search
  transitions cannot leave stale success feedback competing with the current
  operation's live announcement, while preserving committed-uncertain truth.
- Completed: Prepare begin/select/commit now clear stale export and website
  success/error feedback. Export and website starts clear each other's feedback
  plus ordinary Prepare feedback and Reader errors. Arrangement and search
  starts clear the same transient feedback. A committed-uncertain session
  blocks export/website in both store guards and UI; search may continue, but
  converts the already-announced uncertainty to the existing visible static
  refresh guidance while retaining the marker and committed error in state.
  The workspace suppresses the old committed alert whenever that marker owns
  the static guidance. Full compiled workspace/panel DOM coverage now walks
  export success, website success, Prepare begin/select, begin rejection,
  commit success, and committed uncertainty with exactly one live owner in
  every reachable state.
- Files: `packages/desktop/src/renderer/src/store/books.ts`,
  `packages/desktop/src/renderer/src/components/bookWorkspace/index.vue`,
  `packages/desktop/test/unit/specs/book-preparation-store.spec.ts`,
  `packages/desktop/test/unit/specs/book-preparation-a11y.spec.ts`, and this log.
- Tests: targeted preparation store plus full-SFC DOM passed 30/30. The complete
  desktop unit suite passed 1189/1189 across 71 files. Desktop typecheck,
  production build, scoped ESLint, Prettier, and `git diff --check` passed.
  Prepare, collapsed-mobile focus, export, website, and whole-book search E2E
  passed 5/5 in 13.2 seconds. The no-environment RC aggregate and all six
  permanent privacy/cleanup self-tests passed.
- Key decisions: committed uncertainty is never silently cleared to make room
  for another output operation; those writes are blocked until authoritative
  refresh. Search remains available because it is read-only, but its current
  live region takes precedence over an uncertainty event that was already
  announced, leaving the safety instruction visible and non-live.
- Unresolved: the parent still owns the authorized private RC rerun.
- Git commit: not created; nothing was pushed.

## 2026-07-30 — Phase 9C P2#16 committed-uncertain workspace freeze

- User goal: after a preparation commit reports committed uncertainty, freeze
  every current-book operation except authoritative refresh or leaving/switching
  the book, without losing the visible safety guidance or creating another live
  announcement owner.
- Completed: the session-scoped committed-uncertain marker now blocks Prepare,
  Arrange, Search scheduling/execution/progress/result activation, Edit, export,
  website generation, chapter/tree/external-link navigation, previous/next
  navigation, and new reading-position persistence at store boundaries. Pending
  debounced position writes are dropped when the marker is set. Toolbar,
  book-home, tree chapter, and previous/next controls expose the same visible
  `book-preparation-refresh-required` description and are disabled; `/` and
  arrow-key entrypoints are also guarded. Refresh and bookshelf/session-switch
  paths remain available. Purely local outline scrolling and tree disclosure
  remain available because they perform no store or IPC operation and cannot
  compete for the live region. The committed error, retry marker, and the single
  visible refresh status remain unchanged by blocked attempts.
- Files:
  `packages/desktop/src/renderer/src/store/books.ts`,
  `packages/desktop/src/renderer/src/components/bookWorkspace/index.vue`,
  `packages/desktop/src/renderer/src/components/bookWorkspace/BookTreeNode.vue`,
  `packages/desktop/test/unit/specs/book-preparation-store.spec.ts`,
  `packages/desktop/test/unit/specs/book-preparation-a11y.spec.ts`, and this log.
- Tests: targeted preparation store plus full-SFC accessibility tests passed
  32/32. The complete desktop unit suite passed 1191/1191 across 71 files.
  Desktop typecheck, production build, scoped ESLint, Prettier, and
  `git diff --check` passed. The complete book-reader Electron E2E suite passed
  12/12 in 28.5 seconds. The no-environment RC aggregate emitted its fixed SKIP
  result and all six permanent privacy/cleanup self-tests passed.
- Key decisions: “only refresh or leave/switch” is enforced at both UI and store
  boundaries, including read-only Search and background reading-position writes,
  because either would be a new current-session operation after an uncertain
  filesystem commit. Store guards remain authoritative for keyboard, rendered
  Markdown links, and any future menu caller; no separate LeafBook application
  menu entrypoints exist in the current implementation.
- Unresolved: the parent still owns the authorized private RC rerun; no private
  path or content was accessed here.
- Git commit: not created; nothing was pushed.

## 2026-07-30 — Phase 9C P2#17 centralized session lifecycle finalization

- User goal: finish the interrupted session lifecycle hardening so every
  removal and replacement uses central helpers, retained edit leases rebind
  safely, library removal and the per-owner cap revoke all dependent state,
  and stale or repeated cleanup remains isolated and idempotent.
- Completed: centralized direct `sessions` Map writes in touch, insert, delete,
  and replacement-publication helpers. Public refresh now publishes its
  already-invalidated replacement without revoking the old session twice;
  private arrangement, preparation, and edit-save replacements still
  invalidate exactly once. Edit-save replacement retains and atomically
  rebinds only the saving lease, while `removeLibrary` and all removal
  boundaries revoke the current session through the shared delete helper.
  Added a source assertion that rejects direct session Map mutators outside
  the helper block, exact old-versus-new replacement assertions, a table for
  close/remove/owner-cleanup/cap idempotence, and repeated edit-save rebind
  followed by cross-owner library-removal coverage. Existing preparation cap,
  owner isolation, and deterministic late begin/select/commit tests remain
  green.
- Files: `packages/desktop/src/main/book/sessionManager.ts`,
  `packages/desktop/test/unit/specs/book-reader.spec.ts`, and this log.
- Tests: Reader passed 137/137; focused Unicode, preparation manager,
  preparation store, and Reader passed 211/211. The complete desktop unit suite
  passed 1198/1198 across 71 files. Desktop typecheck and production build
  passed; the main bundle is 1,855.73 kB. The complete Reader Electron suite
  passed 12/12 in 28.2 seconds. The no-environment RC aggregate emitted its
  fixed privacy-safe SKIP result and all six permanent privacy/cleanup
  self-tests passed. Scoped ESLint and Prettier passed, and `git diff --check`
  passed.
- Key decisions: public refresh uses an explicit publish-only helper because it
  revokes at dispatch before any scan can race; all other replacements use the
  invalidate-and-publish helper. Tests inspect old and replacement object
  identity so a future duplicate revoke or accidental new-session revoke
  cannot hide behind an otherwise successful DTO.
- Unresolved: the authorized private real-book RC remains with the parent
  environment; no private path or content was accessed.
- Git commit: not created; nothing was pushed.

## 2026-07-30 — Phase 9C P2#18 atomic refresh freeze

- User goal: make public refresh an atomic authorization boundary so the
  revoked session cannot acquire any new operation while its replacement scan
  is pending, while preserving safe failure recovery, owner isolation, and an
  accessible renderer freeze.
- Completed: main now tracks the exact refreshing session object separately
  from its public ownership lookup. Public refresh revokes leases once, marks
  that object frozen before the scan starts, and uses a narrowly privileged
  identity-only path for refresh internals. All ordinary read, link, search,
  edit, arrangement, preparation, export, and website acquisition fails closed
  during the window. Success publishes the replacement before clearing the old
  marker; scan failure clears the marker and restores the old session without
  restoring any lease. Repeated same-owner refresh shares the scan, other
  owners cannot join it, unrelated owners remain usable, and owner close can
  remove the frozen session so a late scan cannot publish an orphan.
  Renderer state exposes `refreshing`, guards every current-book IPC entrypoint
  and shortcut without waiting/replaying intent, preserves only the pre-refresh
  reading-position flush, disables and describes current-book controls, leaves
  the bookshelf exit available, and presents one visible `role=status`
  refresh instruction without a competing loading announcement.
- Files: `packages/desktop/src/main/book/sessionManager.ts`,
  `packages/desktop/src/renderer/src/store/books.ts`,
  `packages/desktop/src/renderer/src/components/bookWorkspace/index.vue`,
  `packages/desktop/test/unit/specs/book-reader.spec.ts`,
  `packages/desktop/test/unit/specs/book-preparation-a11y.spec.ts`, and this log.
- Tests: focused lifecycle, preparation, store, and full-template accessibility
  tests passed 230/230. The complete desktop unit suite passed 1211/1211 across
  71 files. After the final single-live-owner and failed-refresh guidance
  strengthening, Reader, preparation store, and full-template accessibility
  passed 182/182. Desktop typecheck and production build passed; the main
  bundle is 1,856.34 kB. The complete Reader Electron suite passed 12/12 in
  27.9 seconds. The no-environment RC aggregate emitted its fixed privacy-safe
  SKIP result and all six permanent privacy/cleanup self-tests passed. Scoped
  ESLint, Prettier, and `git diff --check` passed.
- Key decisions: the freeze is keyed by object identity rather than only the
  reusable session ID. Close remains a lifecycle control allowed to target the
  exact frozen object; ordinary authorization always rejects it. Renderer
  actions are dropped rather than queued so user intent from the revoked model
  can never replay against the replacement.
- Unresolved: the authorized private real-book RC remains with the parent
  environment; no private path or content was accessed.
- Git commit: not created; nothing was pushed.

## 2026-07-30 — Phase 9C P2#19 strict local UI freeze

- User goal: make refresh and committed-uncertain states freeze local
  current-book navigation as strictly as IPC-backed actions, including
  recursive tree disclosure, chapter-outline scrolling, and Escape-driven
  Contents collapse, while retaining leave, cancel, and authoritative refresh
  behavior.
- Completed: introduced one local navigation freeze boundary for refresh and
  committed uncertainty. Contents and Outline controls now share the visible
  freeze description and use guarded handlers. Chapter-outline anchors expose
  disabled semantics, leave the tab order while frozen, and reject click,
  Enter, and Space activation; `scrollToHeading` independently rejects frozen
  calls. The fragment-restoration path has a narrow refresh-only bypass so the
  authoritative replacement can restore its heading without weakening the
  committed-uncertain boundary. Rendered chapter links, tree activation,
  post-activation mobile collapse, and Escape Contents collapse also fail
  closed. Every recursive tree toggle, group label, and chapter label now
  inherits disabled/described state and uses a defensive guarded handler.
  Added full-template refresh and committed-uncertainty assertions plus a
  three-level recursive tree test covering disabled semantics and click,
  Enter, and Space no-ops.
- Files: `packages/desktop/src/renderer/src/components/bookWorkspace/BookTreeNode.vue`,
  `packages/desktop/src/renderer/src/components/bookWorkspace/index.vue`,
  `packages/desktop/test/unit/specs/book-preparation-a11y.spec.ts`, and this log.
- Tests: focused Reader and full-template accessibility tests passed 157/157.
  The complete desktop unit suite passed 1212/1212 across 71 files after the
  final test strengthening. Desktop typecheck, production build, Prettier,
  ESLint, and `git diff --check` passed; lint retained only existing warnings
  and the existing module-type warning. The complete Reader Electron E2E suite
  passed 12/12 in 29.1 seconds. The no-environment RC aggregate emitted its
  fixed privacy-safe SKIP result, the opt-in real-book scenario skipped without
  a private source, and all six permanent privacy/cleanup self-tests passed.
- Key decisions: local disclosure and scrolling are frozen because they still
  mutate UI state derived from a revoked or uncertain book model. Search and
  panel closure remain allowed cleanup. The only frozen scroll bypass is
  conditioned on active refresh, so it cannot operate merely because a caller
  marks an operation internal.
- Unresolved: the authorized private real-book RC remains with the parent
  environment; no private path or content was accessed.
- Git commit: not created; nothing was pushed.

## 2026-07-30 — Phase 9C P2#20 rendered body-link freeze

- User goal: make every rendered Markdown link expose and enforce the same
  refresh and committed-uncertain freeze as the surrounding Reader controls,
  including exact accessibility-state restoration, rerenders, pointer and
  keyboard input, and focus management.
- Completed: added an explicit per-anchor snapshot manager for `tabindex`,
  `aria-disabled`, and `aria-describedby`. A post-render watcher synchronizes
  current body links whenever the content root, rendered HTML, freeze state, or
  shared guidance owner changes. Frozen links retain their exact `href` and
  `data-book-href` targets while becoming disabled, described, and absent from
  sequential focus. Removed links are restored before their snapshots are
  discarded, replacement links are frozen in the same render cycle, and
  unfreeze or unmount restores every original attribute exactly. Delegated
  pointer-down, click, Enter, and Space guards prevent activation and page
  scrolling. Already-focused and programmatically focused frozen links move to
  an enabled Bookshelf/Refresh control, with the content region as a final
  stable fallback.
- Files:
  `packages/desktop/src/renderer/src/components/bookWorkspace/bookContentAnchorFreeze.ts`,
  `packages/desktop/src/renderer/src/components/bookWorkspace/index.vue`,
  `packages/desktop/test/unit/specs/book-content-anchor-freeze.spec.ts`,
  `packages/desktop/test/unit/specs/book-preparation-a11y.spec.ts`, and this log.
- Tests: the final focused Reader, full-template accessibility, and real
  rendered-link suite passed 159/159. The complete desktop unit suite passed
  1214/1214 across 72 files. Desktop typecheck, production build, Prettier,
  ESLint, and `git diff --check` passed; lint retained only the existing 134
  warnings and module-type warning. The complete Reader Electron E2E suite
  passed 12/12 in 29.5 seconds. The no-environment RC aggregate emitted its
  fixed privacy-safe SKIP result, the direct opt-in scenario skipped without a
  private source, and all six permanent privacy/cleanup self-tests passed.
- Key decisions: snapshot only attributes this freeze owns, never navigation
  targets. Refresh and committed uncertainty use their existing single visible
  guidance IDs. Pointer-down prevention closes the focus-before-click gap, and
  delegated `focusin` handling closes programmatic-focus gaps that
  `tabindex="-1"` alone cannot address. No IPC, preload, shared type, filesystem,
  or network surface changed.
- Unresolved: the authorized private real-book RC remains with the parent
  environment; no private path or content was accessed.
- Git commit: not created; nothing was pushed.

## 2026-07-30 — Phase 9C P2#21 rendered-link focus-ref wiring

- User goal: correct the rendered-link freeze focus target so committed
  uncertainty lands on the real enabled Refresh control, while refreshing
  lands on an allowed enabled control and never on disabled output actions or
  the document body.
- Completed: removed the misplaced `refreshButton` ref from the output controls
  and attached its single occurrence to the button that invokes
  `books.refresh`. Audited all workspace focus refs against their rendered
  labels, visibility conditions, disabled conditions, and focus callers.
  Strengthened the complete compiled-workspace mount with live Vue template
  refs, the real anchor snapshot helper, post-render synchronization, and the
  actual delegated focus handler. The test renders real external and fragment
  body links, proves committed-uncertain programmatic focus lands on enabled
  Refresh, proves refreshing focus lands on enabled Bookshelf, and explicitly
  rejects disabled Export and `document.body` as destinations.
- Files: `packages/desktop/src/renderer/src/components/bookWorkspace/index.vue`,
  `packages/desktop/test/unit/specs/book-preparation-a11y.spec.ts`, and this log.
- Tests: the final focused Reader, real-link, and complete-template suite passed
  160/160. The complete desktop unit suite passed 1215/1215 across 72 files.
  Desktop typecheck, production build, Prettier, ESLint, and
  `git diff --check` passed; lint retained only the existing 134 warnings and
  module-type warning. The complete Reader Electron E2E suite passed 12/12 in
  29.2 seconds. The no-environment RC aggregate emitted its fixed privacy-safe
  SKIP result, the direct opt-in scenario skipped without a private source, and
  all six permanent privacy/cleanup self-tests passed.
- Key decisions: the focus ref is validated by DOM identity and control label,
  not merely by a non-null ref. Refresh remains the preferred recovery target
  for committed uncertainty; during active refresh, its disabled state makes
  the enabled Bookshelf leave action the correct fallback. The content region
  remains only a final non-body fallback if neither allowed button is enabled.
  No IPC, preload, shared type, filesystem, or network surface changed.
- Unresolved: the authorized private real-book RC remains with the parent
  environment; no private path or content was accessed.
- Git commit: not created; nothing was pushed.

## 2026-07-30 — Phase 9C final independent acceptance

- User goal: close Phase 9C only after fresh independent code, privacy,
  accessibility, lifecycle, filesystem, and product-quality reviews reported
  no remaining P0–P2 findings, while keeping release-readiness limitations
  explicit.
- Completed: the final independent acceptance reported P0=0, P1=0, and P2=0.
  It confirmed the actual Refresh and Bookshelf focus targets, rendered-link
  freeze and exact attribute restoration, strict refresh and
  committed-uncertain operation freezes, centralized session invalidation and
  lease revocation, Node-safe heading analysis, Unicode 16.0 default case
  folding, path-free preparation DTOs, create-only bounded SUMMARY writes,
  single-owner live feedback, and the real Prepare Book workflow. No private
  sample path, title, body text, or child-process output was retained or added
  to repository output.
- Files: the final Phase 9C worktree consists of the preparation manager and
  typed IPC/preload/store/UI integration; shared heading and Unicode case-fold
  helpers; Muya heading analysis; Reader rendering, focus, tree, and body-link
  accessibility helpers; focused unit/Electron/real-book RC tests;
  `docs/PREPARE_BOOK.md`, `docs/REAL_BOOK_RC.md`, the Unicode generator, and
  this log.
- Tests and gates: the final complete desktop unit run passed 1215/1215 across
  72 files; the final focused Reader/rendered-link/template run passed
  160/160; Muya's serial full suite passed 1454/1454 across 213 files; the
  Reader Electron E2E suite passed 12/12. Desktop typecheck, production build,
  scoped/full ESLint (zero errors; only existing warnings), Prettier, and
  `git diff --check` passed. The built main bundle is 1,856,342 bytes and
  contains the analyzer without a runtime Muya analyzer require. The
  no-environment RC emitted its fixed SKIP aggregate and all six
  privacy/cleanup self-tests passed.
- Authorized real-book RC: the parent-authorized, privacy-safe wrapper passed
  with the exact aggregate `RC_HARNESS_PASS product_ready=false
visual_fidelity=false content_adaptation_gaps=1 release_matrix_ready=false
accepted_p3_boundaries=crash_partial_create,same_user_syscall_path_boundary,unicode_casefold_pin_drift
book_structure_ready=true code=0`. The harness verified the original sample
  manifest unchanged, validated cleanup of its temporary writable copy, and
  zero retained private artifacts. No private source path, title, prose,
  fragment, token, manifest value, or child-process output was written to the
  log or retained in the repository.
- Key decisions: Phase 9C book-structure preparation is accepted, but the
  application is not declared product/release ready. Inline-SVG visual
  fidelity remains an adaptation gap; the Windows/Linux/macOS release matrix
  is not complete; and the three named accepted P3 boundaries remain explicit.
  Those readiness fields are not hidden or collapsed into a single SVG claim.
- Artifacts and Git: generated `test-results` output was removed from the
  project after verification. Dependency manifests, the lockfile, workflows,
  and version files are unchanged. HEAD remains
  `596ad81aced1f9924d2956f62e94c496a91c07d7`. No commit or push was created.

## 2026-07-30 — Phase 9C commit and next-version assessment

- User goal: commit the completed Phase 9C work, then assess the remaining
  work and define the next LeafBook iteration.
- Completed: committed the complete Phase 9C heading-based book preparation
  workflow as `4edcfec2` (`feat: prepare inferred books from headings`). The
  commit contains the independently accepted main-process preparation and
  session lifecycle, typed IPC/preload surface, Muya heading analysis, Unicode
  case-fold boundary, Reader UI/accessibility behavior, real-book RC harness,
  tests, and documentation. No push was requested or performed.
- Files: the Phase 9C commit contains 39 intended files. This follow-up changes
  only `WORKLOG.md`.
- Tests: no tests were rerun after the commit because the committed tree is the
  exact accepted tree. Its final evidence remains Desktop 1215/1215, Muya
  1454/1454, Reader Electron E2E 12/12, typecheck, production build, ESLint,
  Prettier, `git diff --check`, privacy/cleanup 6/6, and the authorized
  privacy-safe real-book RC. The post-commit worktree was clean before this
  log-only update.
- Key decisions: the next version should be a release-hardening iteration, not
  another broad feature phase. Recommended order: safe inline-SVG visual
  fidelity; macOS/Windows/Linux release-matrix automation and packaging
  verification; partial-create detection/recovery and durability guidance;
  then an explicit decision to accept the same-user syscall/path race in the
  desktop threat model or fund a native descriptor-relative filesystem layer.
  Unicode case-fold drift is a small scheduled maintenance task rather than a
  runtime update.
- Estimated effort: one experienced developer should budget about 15–22
  engineering days for an RC and 20–30 engineering days for a stable release,
  including cross-platform stabilization and a short soak period. A native
  cross-platform filesystem helper to materially reduce the accepted syscall
  race would add roughly 8–15 engineering days and should be treated as a
  separate go/no-go item.
- Unresolved: `product_ready=false`, `visual_fidelity=false`,
  `content_adaptation_gaps=1`, and `release_matrix_ready=false` remain truthful.
  The accepted P3 boundaries remain crash partial create, the same-user
  syscall/path window, and pinned Unicode case-fold drift.
- Git commit: Phase 9C is `4edcfec2`; this log-only handoff is committed
  separately so the functional commit remains reviewable.

## 2026-07-30 — Apple Silicon local Beta DMG

- User goal: produce an installable LeafBook DMG now, without waiting for the
  formally signed and notarized stable release.
- Completed: built and verified
  `dist/leafbook-mac-arm64-0.1.0.dmg` for Apple Silicon. Prevented
  electron-builder from inferring the inherited GitHub repository as an
  updater channel, restored the KaTeX ESM runtime file required by `mhchem`,
  made the packaged-editor smoke flow accept both valid initial editor states,
  normalized trailing-slash `TMPDIR` values in the artifact audit, and added
  static/runtime packaging assertions. Applied an ad-hoc signature to the
  application and rebuilt the DMG directly from the signed app bundle.
- Files: `packages/desktop/electron-builder.yml`,
  `packages/desktop/test/e2e/book-reader.spec.ts`,
  `packages/desktop/test/unit/specs/release-gate-static.spec.ts`,
  `scripts/audit-mac-artifact.sh`, and this log. Generated artifacts remain
  under ignored `dist/`.
- Tests: macOS app/ZIP/DMG artifact audit passed; unpacked app audit and receipt
  verification passed; all six packaged release-smoke tests passed; the
  focused source editor-flow E2E passed; the static release gate passed 16/16;
  desktop typecheck, shell syntax validation, and `git diff --check` passed.
  `hdiutil verify` confirmed a valid DMG checksum, and strict deep code-sign
  verification passed against the app mounted from the final DMG.
- Artifact: 150,441,312 bytes; SHA-256
  `0a08874a837c34b47f236feec5d0fe33856305fb07c3fbb21310fe0d5ba865e2`.
- Key decisions: this is a local Beta installer, not a public production
  release. Ad-hoc signing improves bundle integrity for local testing but does
  not replace an Apple Developer ID signature or Apple notarization. Invalid
  intermediate packages and transient test output were moved to isolated
  system-temporary directories rather than retained in the project.
- Unresolved: Gatekeeper may require Control-click → Open or approval in
  Privacy & Security on first launch. Public distribution still requires a
  Developer ID certificate, hardened-runtime signing, notarization, release
  matrix coverage, and the remaining declared product-readiness work.
- Git commit: not created; HEAD remains `e88b3107` and nothing was pushed.

## 2026-07-30 — Phase 10A fail-closed release candidate baseline

- User goal: continue from the verified Apple Silicon Beta toward a formal
  release, beginning with a release workflow that cannot publish before its
  executable quality gates and a separate human approval.
- Completed: replaced the tag-only validation job with a quality gate covering
  the repository's frozen-lockfile setup, tag/version validation, generated
  metadata, Windows association policy, dependency-license validation,
  deterministic third-party notice generation, ESLint, TypeScript, desktop
  unit tests, and a production build. Added a separate Linux/Xvfb Electron E2E
  gate by copying the existing E2E workflow's system dependency, postinstall,
  build, and Playwright pattern. Every platform build now explicitly depends on
  both gates, and draft creation explicitly depends on both gates plus the full
  platform matrix.
- Release policy: removed the automatic `gh release edit --draft=false`
  promotion. A `v*` tag can now create only a GitHub draft; SemVer prerelease
  tags, including RC tags, retain prerelease metadata, while stable tags also
  remain drafts. Public promotion requires a separate reviewed human action.
- Files: `.github/workflows/release.yml`, `docs/RELEASE_GATE.md`,
  `packages/desktop/test/unit/specs/release-gate-static.spec.ts`, and this log.
  The five pre-existing local Beta changes were preserved.
- Tests: release workflow YAML parsed successfully; focused static release
  tests passed 17/17; desktop unit tests passed 1216/1216; tag/version,
  generated metadata, Windows association, dependency licenses, and generated
  third-party notice consistency passed; ESLint passed with 134 pre-existing
  warnings and no errors; typecheck and production build passed; Prettier and
  `git diff --check` passed. Electron E2E execution is an explicit required CI
  job matching `.github/workflows/e2e.yml`; Phase 10A did not simulate Linux
  Xvfb execution on the local macOS host.
- Key decisions: candidate creation remains fail-closed and draft-only even for
  a stable tag. The workflow uses the repository's pinned setup action and
  existing commands rather than introducing a new publishing API or bypass.
- Unresolved: no tag rehearsal has run on GitHub yet. Developer ID signing,
  notarization, Gatekeeper download validation, Windows/Linux runtime evidence,
  trusted provenance/SBOM review, credentials and repository-settings review,
  and the final human approval all remain public-release blockers.
- Git commit: not created; no tag, GitHub Release, push, or publication was
  performed.

## 2026-07-30 — Phase 10A independent review fixes

- User goal: resolve all P1/P2 findings from the independent Phase 10A review
  without committing, tagging, pushing, creating a Release, or publishing.
- Completed: replaced the write-capable third-party release action with the
  runner-provided GitHub CLI. The release job now enumerates all Releases
  visible to the repository token immediately before creation and fails on an
  existing same-tag Release, API failure, or JSON failure. Its sole creation
  command uses `--draft --verify-tag`, preserves generated notes, the composed
  notes prefix, title and `dist/*` assets, and conditionally adds
  `--prerelease`; it has no edit or public-promotion path. Reworked the static
  test to parse the workflow with the repository's `yaml` package and assert
  the trigger, dependency graph, permissions, ordered preflight, unique
  creation command, arguments, and absence of release-edit behavior from
  parsed step data. Replaced the packaged/source E2E count-based skip with an
  explicit wait for either the New File welcome state or an initialized editor,
  verifying the selected branch before entering the editor. The macOS artifact
  audit now applies the same updater-free ASAR listing, KaTeX runtime, and
  packaged-metadata checks independently to the source app, ZIP app, and DMG
  app.
- Files: `.github/workflows/release.yml`, `package.json`, `pnpm-lock.yaml`,
  `packages/desktop/test/e2e/book-reader.spec.ts`,
  `packages/desktop/test/unit/specs/release-gate-static.spec.ts`,
  `scripts/audit-mac-artifact.sh`, `docs/RELEASE_GATE.md`, and this log.
  All earlier local Beta and Phase 10A changes were preserved.
- Tests: release workflow YAML AST parsing passed; static release-gate tests
  passed 17/17; arm64 source-app/ZIP/DMG artifact audit passed with all three
  ASAR audits; the focused book/editor-flow Electron E2E passed in both source
  and packaged modes; desktop typecheck, focused ESLint, Shell syntax, and
  `git diff --check` passed.
- Key decisions: authenticated pagination over the Releases collection makes
  the preflight cover drafts as well as published Releases without treating an
  expected 404 as success. Shell `pipefail` and `set -e` make API/JQ errors
  abort before the only write step. Parsed YAML tests avoid comments or
  unrelated jobs satisfying release-policy assertions.
- Unresolved: the GitHub-hosted tag rehearsal and the broader formal-release
  blockers in `docs/RELEASE_GATE.md` remain outstanding.
- Git commit: not created; no tag, push, GitHub Release, or publication was
  performed.

## 2026-07-30 — Phase 10A final release-hardening review

- User goal: close the remaining Phase 10A release-gate findings while
  preserving all existing work and without committing, tagging, pushing, or
  creating/publishing a Release.
- Completed: added a fail-closed GitHub server-tag verifier that handles
  lightweight and recursively nested annotated tags, requires the peeled
  commit to equal `GITHUB_SHA`, rejects malformed/API/error responses and any
  existing same-tag Release, and runs both before release assembly and again
  immediately before the workflow's sole draft-create command. Strengthened
  the parsed-YAML static contract to require exact gate names, actions,
  commands, dependencies, conditions and ordering; reject
  `continue-on-error`; ignore shell comments when counting writes; and prove
  the sole `gh release create` structure. Added lightweight/annotated,
  mismatch, existing-Release and API-error negative tests.
- Quality and macOS gates: the release quality job now runs Muya's package
  `lint:types` and complete `test` commands as well as the desktop gates. Each
  macOS matrix build must pass the app/ZIP/DMG artifact audit, unpacked receipt
  audit, and exact six packaged smoke tests before upload. The mac artifact
  audit now applies the same full identity, complete Info.plist/document
  association, canonical license-content, updater, KaTeX runtime, ASAR and
  packaged-metadata invariants to source, ZIP and DMG bundles, and requires
  their Info.plist and ASAR hashes to match.
- Cross-platform carriers: Linux tar.gz, deb, rpm, AppImage and snap are now
  independently extracted and bundle-audited; native package metadata,
  AppImage desktop metadata and snap metadata are also checked. Windows ZIP is
  fully bundle-audited. Prerelease NSIS setup receives PE and 7-Zip integrity
  checks and is explicitly labelled incomplete evidence; stable Windows
  candidates fail closed until native install/run/uninstall and
  installed-bundle auditing exists.
- Reader evidence: after returning from Reader/Bookshelf to Editor, the smoke
  E2E now enters a unique sentinel through the editor UI and reads it back with
  `getMarkdownContent`, proving the returned editor is actually editable. The
  new Muya type gate exposed one obsolete `plantumlServer` destructuring
  binding in the already-disabled offline PlantUML path; removing that unused
  binding made the real package command pass without changing behavior.
- Files: `.github/workflows/release.yml`, `docs/RELEASE_GATE.md`,
  `scripts/verify-release-preconditions.mjs`,
  `scripts/audit-mac-artifact.sh`,
  `scripts/audit-platform-artifacts.sh`,
  `packages/desktop/test/e2e/book-reader.spec.ts`,
  `packages/desktop/test/unit/specs/release-gate-static.spec.ts`,
  `packages/muya/src/block/extra/diagram/diagramPreview.ts`, and this log.
  Earlier Phase 10A/Beta changes in `package.json`, `pnpm-lock.yaml`, and
  `packages/desktop/electron-builder.yml` were preserved.
- Tests: parsed release/static gate 20/20; desktop typecheck; Muya
  `lint:types`; complete Muya unit suite 1454/1454 across 213 files; six source
  release-smoke E2Es; six packaged arm64 release-smoke E2Es; macOS source
  app/ZIP/DMG audit; unpacked audit and receipt verification; focused desktop
  ESLint; focused Muya ESLint; Prettier; Bash syntax; Node syntax; and
  `git diff --check` all passed.
- Key decisions: the GitHub API cannot atomically bind a tag check to Release
  creation, so the remaining check/create micro-window is not silently
  accepted. A protected tag ruleset that prevents the workflow credential from
  moving or deleting stable tags is a stable blocker. RC drafts may retain
  clearly labelled incomplete NSIS evidence; stable candidates may not.
- Unresolved external gates: no GitHub-hosted rehearsal has run; Windows native
  install/run/uninstall and signing, Linux runtime/desktop integration,
  Developer ID signing/hardened runtime/notarization/Gatekeeper download
  validation, SBOM/provenance/attestation review, protected tags/environments,
  credential review, soak testing, and explicit human publication approval
  remain required.
- Git commit: not created; HEAD remains `e88b3107`. No tag, push, Release, or
  publication was performed.

## 2026-07-30 — Phase 10A P1 final acceptance closure

- **User goal**: close the remaining P1 release-candidate findings without
  committing, tagging, pushing, or creating a release.
- **Completed**:
  - Reproduced the Reader → Bookshelf → Editor packaged readback failure: a
    zero-delay synthetic keyboard burst entered only a prefix of
    `LEAFBOOK_READER_RETURN_EDITOR_EDITABLE_SENTINEL` before the source-mode
    readback. `typeIntoEditor` now keeps real keyboard interaction at a
    human-realistic event cadence, waits for the complete visible input, and
    crosses two rendered frames before readback. The full-sentinel
    `expect.poll` assertion remains unchanged and fail-closed.
  - Replaced every tag-string hyphen heuristic with one strict SemVer parser
    output, `is_prerelease`. Stable build metadata containing hyphens remains
    stable, RC identifiers select prerelease, and malformed tags fail. Build
    audits, release notes, and draft flags consume the same quality-gate
    output; stable Windows candidates still fail before assembly.
  - Pinned every release-path external Action to the full 40-character commit
    behind its documented version tag and set `persist-credentials: false` on
    every checkout. Split read-only candidate assembly from the
    minimum-permission draft-creation job. The final job rechecks the official
    server tag target immediately before its only repository write,
    `gh release create --draft`; it has no edit or publication path.
  - Added an extracted-application layout auditor that rejects decoys and
    multiple bundles, requires exactly one executable beside exactly one
    `resources/app.asar`, validates x64/arm64 ELF or PE headers, and hashes the
    complete normalized application payload. Linux tar/deb/rpm/AppImage/snap
    carriers are tied to the same payload digest, with architecture also bound
    through executable and package metadata; Windows ZIP receives the same
    root/PE audit.
  - Upgraded the macOS source/ZIP/DMG comparison from two selected file hashes
    to the complete application tree, including the main executable,
    Frameworks, `app.asar.unpacked`, Resources, modes, symlinks, and every file
    hash. The stale pre-ad-hoc-signing ZIP was moved recoverably to
    `/tmp/leafbook-stale-zip.EIWVXR` and rebuilt from the signed prepackaged
    app; source, rebuilt ZIP, and DMG now match exactly.
  - Expanded the fixed release smoke gate from six to seven tests by adding the
    existing real editor → save IPC → disk-byte readback scenario.
- **Files**:
  - `.github/actions/setup/action.yml`, `.github/workflows/release.yml`
  - `scripts/validate-release-tag.mjs`,
    `scripts/verify-release-preconditions.mjs`,
    `scripts/audit-application-layout.mjs`,
    `scripts/audit-platform-artifacts.sh`, `scripts/audit-mac-artifact.sh`,
    `scripts/smoke-mac-unpacked.sh`
  - `packages/desktop/test/e2e/helpers.ts`,
    `packages/desktop/test/e2e/book-reader.spec.ts`,
    `packages/desktop/test/unit/specs/release-gate-static.spec.ts`
  - `docs/RELEASE_GATE.md`, `WORKLOG.md` (plus the other already-present
    Phase 10A packaging changes retained in the worktree).
- **Verification**:
  - release/static/fixture suite: 22/22; includes stable build metadata with
    hyphens, RC, invalid SemVer, positive x64/arm64 ELF/PE trees, duplicate
    bundle rejection, and wrong-architecture rejection;
  - full desktop unit: 72 files, 1221/1221; full Muya unit: 213 files,
    1454/1454;
  - desktop and Muya typechecks passed; production build passed; ESLint passed
    with zero errors and 134 pre-existing warnings;
  - complete Reader Electron suite: source 12/12 and packaged 12/12; packaged
    Reader return focused test also passed three consecutive runs;
  - exact release smoke: source 7/7 and packaged arm64 7/7, including real
    edit/save/disk readback;
  - unpacked macOS audit and receipt verification passed; complete-tree
    source/ZIP/DMG audit passed; `hdiutil verify`, strict deep `codesign`
    verification, shell syntax, Node syntax, YAML parsing through the static
    suite, and `git diff --check` passed.
  - DMG remains 150,441,312 bytes with SHA-256
    `0a08874a837c34b47f236feec5d0fe33856305fb07c3fbb21310fe0d5ba865e2`;
    rebuilt signed ZIP is 149,590,040 bytes with SHA-256
    `df8f582d5bd2205e396a7d3a8e699bfcc58e356a9ff353f2bfb7673c633ef84f`.
- **Key decisions**: carrier equality binds the complete executable payload
  rather than a sample of identity files; RC may produce a labelled draft,
  while stable cannot reach draft creation before native Windows evidence
  exists; all publication remains a separate human action.
- **Unresolved external blockers**: Developer ID signing, hardened runtime,
  notarization and downloaded Gatekeeper testing; native Windows
  install/run/uninstall plus installed-bundle audit and signing; real Linux
  build/run evidence; protected stable-tag rules, protected/manual publication
  controls, SBOM/provenance/attestations, and final human approval.
- **Git**: not committed, tagged, pushed, or released.

## 2026-07-30 — Phase 10A adversarial release-boundary closure

- **User goal**: close all remaining P1/P2 adversarial findings in the release
  carrier and draft-creation gates, without committing, tagging, pushing, or
  publishing.
- **Completed**:
  - Removed checkout and all tag-controlled repository execution from the
    `contents: write` job. Its immediately adjacent final preflight is fixed
    inline shell that performs read-only GitHub API calls, recursively peels
    annotated tags, binds the commit to `GITHUB_SHA`, and rejects an existing
    same-tag Release. `GH_TOKEN` is scoped only to fixed preflight/create steps;
    the only write command remains draft `gh release create`.
  - Reworked extracted-carrier auditing around one format-specific topology
    and the complete carrier manifest. Windows ZIP/tar portable roots and the
    deb/rpm, AppImage, and snap launchers are bound to the audited application.
    Unexpected roots, sibling payloads/executables, escaping or unmanifested
    app symlinks, duplicate app roots, and carrier drift fail closed.
  - Added complete native-tree scanning. Main binaries, helpers, shared
    libraries and `.node` addons are identified by ELF/PE/Mach-O magic and
    matched to the matrix architecture. Mixed architecture and foreign formats
    are rejected; macOS may contain only a bounded x64/arm64 universal binary.
  - Added pre-extraction archive budgets for tar, ZIP, deb, rpm and SquashFS
    carriers: count, depth, path/target bytes, single and total uncompressed
    bytes, compressed bytes, duplicate/traversal/link/type checks, plus bounded
    external listing/extraction. macOS ZIP and DMG now also enforce an exact
    carrier-root allowlist and reject executable payloads beside the app.
  - Renamed the overstated `all-blocks` E2E fixture to
    `representative-blocks`. The release smoke now makes its dirty mutation
    through real keyboard input, saves over the production IPC path, and
    compares the resulting on-disk bytes to the editor serialization.
  - Corrected SemVer prerelease validation so alphanumeric identifiers such as
    `1a` are valid while purely numeric identifiers still reject leading zeroes.
- **Files**: `.github/workflows/release.yml`, `docs/RELEASE_GATE.md`,
  `scripts/audit-application-layout.mjs`, `scripts/audit-native-tree.mjs`,
  `scripts/audit-mac-carrier.mjs`, `scripts/preflight-archive.py`,
  `scripts/preflight-entry-list.mjs`, `scripts/audit-platform-artifacts.sh`,
  `scripts/audit-mac-artifact.sh`, `scripts/smoke-mac-unpacked.sh`,
  `scripts/validate-release-tag.mjs`,
  `packages/desktop/test/unit/specs/release-gate-static.spec.ts`,
  `packages/desktop/test/e2e/representative-blocks-roundtrip.spec.ts`, its
  renamed data fixture, and this log. All earlier Phase 10A changes were
  preserved.
- **Verification**:
  - adversarial static/fixture gate 24/24, including decoy/sibling executable,
    escaping symlink, mixed ELF/native-addon architecture, universal Mach-O,
    traversal archive, oversized entry and SemVer `1a`;
  - desktop unit 72 files / 1222 tests and Muya unit 213 files / 1454 tests;
    desktop and Muya typechecks passed;
  - source release smoke 7/7 and packaged arm64 smoke 7/7, including the real
    keyboard → dirty → save IPC → exact disk-byte test; complete Reader source
    12/12 and packaged arm64 12/12;
  - complete macOS app/ZIP/DMG carrier audit, unpacked receipt audit,
    `hdiutil verify`, strict deep `codesign`, production build, full ESLint
    (zero errors; 134 existing warnings), focused Prettier, Node/Bash/Python
    syntax checks, and `git diff --check` passed.
- **Key decisions**: archive metadata must be rejected before extraction rather
  than relying on a post-extraction walk; complete carrier topology is audited
  separately from cross-format application-payload equality; the privileged
  job may consume assembled bytes but may not execute tag-controlled code.
- **Unresolved external blockers**: real Windows build/install/run/uninstall
  and signing; real Linux build/run and desktop integration; Developer ID,
  hardened runtime, notarization and downloaded Gatekeeper validation;
  protected stable tags/environments, SBOM/provenance/attestation, credential
  rehearsal, and explicit human publication approval.
- **Git**: not committed, tagged, pushed, or released; HEAD remains `e88b3107`.

## 2026-07-30 — Phase 10B2a Reader local-image integration

- **User goal**: safely display local PNG/JPEG/GIF/WebP Markdown images in
  Reader without adding SVG/export support or weakening Phase 10B1.
- **Completed**:
  - Added Markdown-token provenance to static Muya rendering. After strict
    sanitization, only genuine Markdown images can become path-free `image-N`
    slots; raw HTML, remote/data/file, SVG, malformed, and unsupported inputs
    remain inert accessible placeholders and never enter resource IPC.
  - Added a two-worker Reader hydrator with session/resource-token/node binding,
    strict cross-realm `Uint8Array`/media/byte-length validation, Blob copying,
    lazy async decode, and path-free error placeholders.
  - Added generation cancellation and complete object-URL revocation for
    chapter/session/token changes, refresh, Reader exit, component unmount,
    renderer decode errors, and stale responses. Bytes, references, and URLs
    are never persisted.
  - Kept export explicitly inert; added no filesystem protocol, Node renderer
    API, absolute path, raw native URL, fetch loader, SVG support, or new
    main-process capability.
  - Extended exact source/packaged smoke from seven to eight tests. The new
    Electron case decodes four real formats, contains missing/remote/SVG/raw
    HTML failures, and verifies zero HTTP requests, renderer errors, DOM paths,
    or capability tokens.
  - Updated `docs/RESOURCE_PIPELINE.md`, `docs/BOOK_READER.md`, and
    `docs/RELEASE_GATE.md`.
- **Files**: added
  `packages/desktop/src/renderer/src/book/hydrateBookImages.ts` and
  `packages/desktop/test/unit/specs/book-reader-images.spec.ts`; updated Reader
  rendering/workspace/export, Muya's optional image-token renderer, Reader and
  release-gate unit/E2E tests, `scripts/smoke-mac-unpacked.sh`, the three
  documents above, and this log.
- **Verification**:
  - focused Reader/render/export/image unit: **3 files / 172 passed**;
  - complete Desktop unit: **75 files / 1300 passed / 1 native-Windows-only
    skipped**;
  - Desktop and Muya typechecks, production build, focused ESLint/Prettier, and
    complete ESLint (**0 errors / 134 existing warnings**) passed;
  - exact source smoke: **8/8 passed**;
  - final current-tree arm64 build, DMG/ZIP artifact audit, `hdiutil` checksum,
    unpacked audit, receipt verification, and exact packaged smoke:
    **8/8 passed**.
- **Candidate**:
  - `dist/leafbook-mac-arm64-0.1.0.dmg` (144 MiB), SHA-256
    `43e7771abebefb2a1339c8bc00e24d1af983b08422e302b8245b870cc2bfb8b1`;
  - `dist/leafbook-mac-arm64-0.1.0.zip` (144 MiB), SHA-256
    `ddae32cac250342b717668c8a85e0893514f8bf378579a7c83f5eba5b0d9810f`;
  - replaced candidates remain intact under
    `/var/folders/kq/dz44fm994nz94zw2dfqnz_g00000gn/T/leafbook-pre-10b2a-candidate.7pGEVE`
    and
    `/var/folders/kq/dz44fm994nz94zw2dfqnz_g00000gn/T/leafbook-preformat-10b2a-candidate.qllqPm`.
- **Key decisions**: remove the path-free slot before IPC; validate
  structured-cloned typed arrays without realm-local `instanceof`; start
  hydration only after Vue commits the `v-html` article and only while slots
  remain.
- **Unresolved**: the candidate is unsigned and unnotarized because no
  Developer ID is installed; strict `codesign` therefore fails. Formal release
  still requires signing, hardened runtime, notarization/Gatekeeper, native
  Windows/Linux evidence, and the remaining release-gate blockers. SVG and
  export image rewriting remain deferred.
- **Git**: not committed, tagged, pushed, or released; HEAD remains `e88b3107`.

## 2026-07-30 — Phase 10B1 review hardening

- **User goal**: close the Phase 10B1 security-review findings before Reader UI
  integration and preserve a fail-closed path toward the formal release.
- **Completed**:
  - Replaced path-shape-only resource authority with an exact per-chapter
    Markdown AST allowlist. A pinned `readChapter` uses Marked's lexer to
    authorize only inline and resolved reference-style image destinations; raw
    HTML, code, links, remote/data/file sources, unsupported types, and
    unreferenced in-root images do not gain authority.
  - Made refresh invalidate the resource generation immediately. A failed
    rescan deletes the invalidated session, so an old token cannot become live
    again and recovery requires reopening the library.
  - Added complete bounded PNG/JPEG/GIF/WebP container validation, including
    PNG CRC/chunk structure, JPEG segment/entropy structure, GIF
    frame/subblock structure, exact RIFF/WebP chunk structure, exact endings,
    dimension/pixel/frame/aggregate-decode limits, and truncation/trailing-data
    rejection.
  - Added before/after snapshots for every resource ancestor plus final
    target-realpath verification. Documented the residual P3 same-user
    pathname micro-window because portable Node does not provide a complete
    descriptor-relative `openat` walk.
  - Corrected the renderer global Electron API type, bundled the ESM-only
    Marked lexer into the CommonJS main output, and added a static build-contract
    test for that requirement.
  - Added actual PNG/JPEG/GIF/WebP fixtures and adversarial tests for exact AST
    membership, polyglots, truncation, dimension/pixel/frame bombs, symlink and
    ancestor races, hard links, case aliases, Windows drive/backslash input,
    lifecycle revocation, refresh failure, and concurrency budgets. POSIX
    symlink tests are platform-gated; the Windows case-alias test needs no
    symlink privilege.
- **Files**: added
  `packages/desktop/src/main/book/imageContainer.ts` and
  `packages/desktop/src/main/book/resourceReferences.ts`; updated
  `packages/desktop/src/main/book/resourceReader.ts`,
  `packages/desktop/src/main/book/sessionManager.ts`,
  `packages/desktop/src/types/global.d.ts`,
  `packages/desktop/electron.vite.config.ts`,
  `packages/desktop/package.json`, `pnpm-lock.yaml`, the Phase 10B1 unit tests,
  `docs/RESOURCE_PIPELINE.md`, `docs/BOOK_READER.md`,
  `docs/RELEASE_GATE.md`, and this log.
- **Verification**:
  - focused resource/contract/manager suite: **3 files / 198 passed / 1
    Windows-only skipped**;
  - complete Desktop unit suite: **74 files / 1283 passed / 1 Windows-only
    skipped**;
  - Desktop typecheck and production `electron-vite` build passed; the main
    output contains bundled Marked code and no runtime `require("marked")`;
  - focused ESLint passed; complete ESLint passed with **0 errors** and the
    existing **134 warnings**;
  - focused Prettier passed; final `git diff --check` passed.
- **Key decisions**: the chapter bytes returned to the renderer are the sole
  source of image authority; refresh failures destroy rather than preserve an
  unreturnable generation; animated WebP and SVG remain unsupported; full
  image-container parsing stays in the main process.
- **Unresolved**: Reader rendering/object-URL lifecycle and export rewriting
  remain deferred. Native Windows NTFS execution plus privileged
  reparse-point/symlink coverage is required before stable evidence; the
  documented same-user `openat` limitation remains P3. Phase 10A's signing,
  notarization, native installer, provenance, and publication blockers remain.
- **Git**: not committed, tagged, pushed, or released; HEAD remains `e88b3107`.

## 2026-07-30 — Phase 10A carrier/control and bounded-extraction closure

- **User goal**: close the remaining installer/carrier attack surfaces before
  treating the current release gate as formal-version evidence, while
  preserving all existing Phase 10A work and making no commit, tag, push, or
  Release.
- **Completed**:
  - Split Linux auditing into an application manifest containing only the
    cross-carrier Electron payload and a complete carrier manifest. Added exact
    carrier-metadata and launcher checks for archive, AppImage, snap, deb, and
    rpm shapes; carrier-only `AppRun`, desktop/icon, snap metadata, and package
    integration files no longer cause a false application-digest mismatch.
  - Added real-shape positive fixtures proving identical application digests
    across five Linux carrier forms, plus negative fixtures for an extra `usr`
    tree, escaping symlink, and a launcher containing comments/side effects.
  - Audited Debian `control.tar` before extraction. Only bounded regular
    `control` and optional `md5sums` metadata are accepted; `preinst`,
    `postinst`, `prerm`, `postrm`, `config`, `templates`, `triggers`, and any
    other hook fail closed. RPM `--scripts` and `--triggers` must both be empty
    before payload extraction.
  - Added `safe-extract-zip.py`, which parses local ZIP headers and streams
    stored/deflate output under actual single-entry and total-byte budgets,
    validates CRC/declared-size equality before accepting output, rejects
    duplicate/traversal/escaping or unmanifested link paths, and safely resolves
    manifest-listed framework symlink chains. macOS and Windows ZIP auditing no
    longer delegates extraction to `unzip`/`tar` or trusts central sizes.
  - Added a portable bounded-command runner with wall-clock, CPU, output-file,
    and process-group kill enforcement, and applied it to archive metadata
    listing, ASAR, tar, dpkg, rpm/cpio, SquashFS, ZIP, and 7-Zip commands.
  - Tightened DMG shape validation: `Applications` is exactly the
    `/Applications` symlink; `LeafBook.app` and `.background` are real
    directories; Finder/background metadata has a fixed type/content allowlist;
    other root entries and root-escaping symlinks are rejected.
  - Removed the remaining exhaustive “all block types” wording from the
    deliberately representative E2E spec and documented these boundaries in
    `docs/RELEASE_GATE.md`.
- **Files**: `scripts/audit-application-layout.mjs`,
  `scripts/audit-platform-artifacts.sh`, `scripts/audit-mac-artifact.sh`,
  `scripts/audit-mac-carrier.mjs`, `scripts/preflight-archive.py`,
  new `scripts/safe-extract-zip.py`, new `scripts/run-bounded.py`,
  `packages/desktop/test/unit/specs/release-gate-static.spec.ts`,
  `packages/desktop/test/e2e/representative-blocks-roundtrip.spec.ts`,
  `docs/RELEASE_GATE.md`, and this log. All unrelated and preceding changes
  remain preserved.
- **Verification**:
  - adversarial carrier/control/extraction gate: 29/29;
  - final complete desktop unit run: **72 files / 1228/1228 tests** (this
    supersedes the earlier interim Phase 10A count); Muya unit:
    213 files / 1454/1454 tests;
  - desktop and Muya typechecks passed;
  - source release smoke 7/7 and packaged arm64 smoke 7/7; complete Reader E2E
    source 12/12 and packaged arm64 12/12;
  - the real arm64 source app, safely streamed ZIP, and mounted DMG passed the
    complete macOS artifact audit; unpacked receipt audit, `hdiutil verify`, and
    strict deep `codesign` verification passed;
  - production build passed; full ESLint passed with zero errors and 134
    existing warnings; focused Prettier, Node/Bash/Python syntax checks, and
    `git diff --check` passed.
- **Key decisions**: central-directory sizes are untrusted hints, not extraction
  budgets; application equality excludes only strictly allowlisted carrier
  metadata while the full carrier remains independently manifested; package
  installation hooks default to rejection unless a separately reviewed exact
  template is deliberately introduced.
- **Unresolved external blockers**: no real Linux artifacts or Linux desktop
  integration environment were available locally, so the stricter deb/rpm and
  AppImage/snap gates still require CI execution against actual carriers. Real
  Windows native install/run/uninstall and signing, Developer ID/hardened
  runtime/notarization/downloaded Gatekeeper evidence, protected tags and
  environments, SBOM/provenance/attestation, credential rehearsal, and explicit
  human publication approval remain external stable-release blockers.
- **Git**: not committed, tagged, pushed, or released; HEAD remains `e88b3107`.

## 2026-07-30 — Phase 10A metadata and resource-bound closure

- **User goal**: finish the remaining Phase 10A package-metadata and
  resource-exhaustion defenses so the formal-release gate fails closed before
  extracting or executing untrusted carriers.
- **Completed**:
  - Replaced permissive Debian metadata checks with a single-paragraph RFC 822
    schema, exact LeafBook identity/version/architecture/dependency values, and
    rejection of duplicate, unknown, maintainer-script, pre-dependency,
    conflict, replacement, essential, and protected fields.
  - Expanded RPM fail-closed inspection across scripts, triggers,
    file-triggers, trans-file-triggers, and their corresponding header tags.
  - Bound AppImage and snap launchers to the exact electron-builder 26.15.3
    templates. Added strict snap YAML-AST validation, architecture binding,
    exact plug descriptors, MIME metadata, desktop/icon paths, and rejection of
    extra apps, daemons, hooks, layouts, aliases, and unknown keys.
  - Added cumulative ASAR entry/depth/path/single-file/total-size and carrier
    offset checks before extraction, including support for the real unpacked
    directory header shape.
  - Made ZIP symlink handling streaming and payload-independent during
    preflight; added compressed-size budgets and a forged large-symlink
    regression fixture.
  - Hardened the bounded runner with streamed combined-output limits and POSIX
    CPU/file/open-file limits; Linux dedicated CI additionally receives address
    space and process-count limits.
  - Added DMG compressed and Finder-presentation budgets, file magic checks,
    and bounded `hdiutil` verification, mounting, and cleanup.
- **Files**: `scripts/preflight-archive.py`,
  `scripts/audit-platform-artifacts.sh`,
  `scripts/audit-application-layout.mjs`, `scripts/run-bounded.py`,
  `scripts/audit-mac-artifact.sh`, `scripts/audit-mac-carrier.mjs`, new
  `scripts/preflight-asar.mjs`,
  `packages/desktop/test/unit/specs/release-gate-static.spec.ts`,
  `packages/desktop/electron-builder.yml`, `docs/RELEASE_GATE.md`, and this
  log. Shared-worktree changes outside this scope remain preserved.
- **Verification**:
  - metadata/resource adversarial gate: **30/30 passed**;
  - complete desktop unit: **72 files / 1229/1229 tests passed**; Muya unit:
    **213 files / 1454/1454 tests passed**;
  - desktop and Muya typechecks and production build passed;
  - source and packaged arm64 release smoke: **7/7 each**; complete Reader E2E
    source and packaged arm64: **12/12 each**;
  - real arm64 ASAR preflight, unpacked audit, complete ZIP/DMG artifact audit,
    strict deep `codesign`, and `hdiutil verify` passed;
  - ESLint passed with zero errors and 134 existing warnings; focused Prettier,
    Node/Bash/Python syntax validation, and `git diff --check` passed.
- **Key decisions**: exact builder-version contracts are generated from the
  installed builder implementation; untrusted declared sizes never replace
  actual streamed-output budgets; Darwin does not receive unsafe shared-user
  `RLIMIT_NPROC` or unreliable `RLIMIT_AS`; Windows remains wall/output bounded
  until a native Job Object implementation is proven.
- **Unresolved external blockers**: real Linux carriers and isolated Linux
  resource-quota execution are still required; current electron-builder
  Debian/RPM maintainer scripts must be deliberately removed or exactly
  reviewed before those carriers can pass. Native Windows
  install/run/uninstall, Job Object containment and signing; Developer ID,
  hardened runtime, notarization and downloaded Gatekeeper validation;
  protected stable tags/environments, SBOM/provenance/attestation, credential
  rehearsal, and explicit human publication approval remain.
- **Git**: not committed, tagged, pushed, or released; HEAD remains `e88b3107`.

## 2026-07-30 — Phase 10A final generator and timeout-window closure

- **User goal**: close the final explicit Linux metadata-generator,
  post-exit resource-boundary, ASAR-prefix, AppImage-marker, snap-wrapper, and
  DMG attach-timeout gaps without committing or publishing.
- **Completed**:
  - Linux desktop entries are now regenerated with the installed
    electron-builder 26.15.3 `LinuxTargetHelper.computeDesktopEntry` and
    compared byte-for-byte per carrier. AppImage version/Exec, deb/rpm absolute
    Exec, snap Exec, Keywords, MIME values and every emitted key are bound to
    the actual builder contract; tampered values fail.
  - Snap accepts only a manifested executable regular `command.sh` whose bytes
    equal the pinned core20 builder wrapper. The formerly tolerated
    `app/leafbook` command and non-executable wrappers now fail.
  - The bounded runner keeps monitoring output readers after the direct process
    exits, checks output/wall state before returning, and kills the process
    group when a descendant retains an inherited pipe through the shared
    deadline. Fast 70 MiB output and retained-pipe fixtures cover both paths.
  - ASAR preflight reads and validates the eight-byte pickle prefix before
    invoking the ASAR library; a header over 64 MiB, truncated header, or header
    outside the carrier is rejected. A sparse 70 MiB header fixture proves the
    early budget failure.
  - Added `find-squashfs-offset.py`, a fixed-memory streaming AppImage scanner
    requiring exactly one `hsqs` marker, replacing unbounded grep/mapfile
    output.
  - DMG cleanup is armed before attach, performs bounded state inspection,
    resolves the audited image path to its unique base `/dev/disk*`, and uses a
    bounded detach in normal and timeout/error cleanup. The real artifact audit
    verified the path and left no matching image mounted.
- **Files**: `scripts/audit-application-layout.mjs`,
  `scripts/run-bounded.py`, `scripts/preflight-asar.mjs`, new
  `scripts/find-squashfs-offset.py`, `scripts/audit-platform-artifacts.sh`,
  `scripts/audit-mac-artifact.sh`,
  `packages/desktop/test/unit/specs/release-gate-static.spec.ts`,
  `docs/RELEASE_GATE.md`, and this log. Other shared-worktree changes remain
  preserved.
- **Verification**:
  - final focused metadata/resource/timeout gate: **34/34 passed**;
  - complete Desktop unit: **72 files / 1233/1233 tests passed**; complete Muya
    unit: **213 files / 1454/1454 tests passed**;
  - Desktop and Muya typechecks, production build, and ESLint passed (zero
    errors; 134 existing warnings);
  - source and packaged arm64 release smoke: **7/7 each**; complete current
    Reader/security/representative E2E: **19/19 source and 19/19 packaged**;
  - real arm64 ASAR preflight, unpacked receipt audit, complete app/ZIP/DMG
    artifact audit, strict deep `codesign`, and `hdiutil verify` passed;
  - focused Prettier, Node/Bash/Python syntax checks, `git diff --check`, and
    post-audit no-mounted-image check passed.
- **Key decisions**: builder output is the source of truth rather than a
  hand-written approximation; desktop entries are exact complete documents;
  DMG cleanup identifies the actual attached image rather than assuming the
  requested mount path; Windows remains honestly wall/output bounded and a
  stable blocker until native Job Object process-tree containment is proven.
- **Unresolved external blockers**: real isolated Linux carrier execution,
  removal or exact approval of electron-builder deb/rpm maintainer scripts,
  native Windows Job Object/install/run/uninstall/signing, Developer ID
  hardened-runtime/notarization/downloaded Gatekeeper evidence, protected
  release tags/environments, SBOM/provenance/attestation, credential rehearsal,
  and explicit human publication approval remain.
- **Git**: not committed, tagged, pushed, or released; HEAD remains `e88b3107`.

## 2026-07-30 — Phase 10A seven-association P1 closure

- **User goal**: remove the final mismatch between the desktop-entry audit and
  the seven Linux Markdown file associations in electron-builder configuration.
- **Completed**:
  - Added `scripts/linux-file-associations.mjs` as the frozen seven-entry
    contract for `md`, `markdown`, `mmd`, `mdown`, `mdtxt`, `mdtext`, and `mdx`.
  - The real electron-builder 26.15.3 desktop generator now consumes that
    contract, including the previously omitted `mdtext` and `mdx` MIME entries.
  - Added a YAML-AST assertion that the complete
    `linux.fileAssociations` configuration is identical to the shared contract,
    plus real-helper negative fixtures proving that one missing association or
    a changed MIME value fails exact desktop-file validation.
- **Files**: new `scripts/linux-file-associations.mjs`,
  `scripts/audit-application-layout.mjs`,
  `packages/desktop/test/unit/specs/release-gate-static.spec.ts`,
  `docs/RELEASE_GATE.md`, and this log.
- **Verification**: focused release gate **35/35 passed**; real arm64 app/ZIP/DMG
  audit and packaged smoke **7/7** passed; Desktop and Muya typechecks passed;
  ESLint passed with zero errors and 134 existing warnings; focused Prettier,
  Node/Bash syntax checks, and `git diff --check` passed.
- **Key decision**: Linux file-association values have one executable source of
  truth, while the non-importable builder YAML is required by test to remain an
  exact structural copy.
- **Unresolved external blockers**: unchanged from the preceding entry.
- **Git**: not committed, tagged, pushed, or released; HEAD remains `e88b3107`.

## 2026-07-30 — Phase 10B1 session-bound local book resources

- **User goal**: establish the secure main-process foundation for reading local
  Markdown-book resources without yet connecting images to Reader rendering or
  export.
- **Completed**:
  - Added a typed resource request bound to the renderer owner, live book
    session, per-generation resource token, and a model-owned chapter whose
    exact content was successfully returned by `readChapter` in that same
    generation.
    Refresh rotates the token; refresh, close, root invalidation, and owner
    teardown prevent in-flight reads from returning bytes.
  - Added a path-free response containing only an allowlisted MIME, byte count,
    and `Uint8Array`. No root/absolute path, Node filesystem object, custom
    protocol, `file:` URL, or renderer filesystem capability was introduced.
  - Added a descriptor-pinned reader for PNG/JPEG/GIF/WebP. It rejects SVG,
    HTML/script/unknown types, remote/data/file references, authorities,
    percent encoding, query/fragment tricks, NUL/control characters,
    backslashes, non-NFC input, traversal outside the root, case-ambiguous
    paths, symlinks, hard links, non-regular files, oversized files, and
    extension/magic mismatches.
  - Pinned and revalidated both the session root and resource descriptor using
    realpath/lstat, `O_NOFOLLOW`, device/inode, mode, link count, size,
    mtime/ctime, EOF, and final pathname checks. Reads are capped at 8 MiB, one
    resource per request, two concurrent reads per owner, and eight globally.
  - Wired the capability through the existing manager, editor-gated IPC,
    shared typed contract, and sandboxed preload bridge. Added focused
    filesystem, manager lifecycle, race, budget, IPC, preload, and static
    security tests.
  - Documented the threat model and deferred UI/export work in
    `docs/RESOURCE_PIPELINE.md`; updated Reader and release-gate documentation
    to state that images remain placeholders in this bounded phase.
- **Files**: new
  `packages/desktop/src/main/book/resourceReader.ts`,
  `packages/desktop/test/unit/specs/book-resource.spec.ts`,
  `packages/desktop/test/unit/specs/book-resource-contract.spec.ts`, and
  `docs/RESOURCE_PIPELINE.md`; updated
  `packages/desktop/src/main/book/sessionManager.ts`,
  `packages/desktop/src/main/ipc/books.ts`,
  `packages/desktop/src/preload/index.ts`,
  `packages/desktop/src/shared/types/bookReader.ts`,
  `packages/desktop/src/shared/types/ipc.ts`, relevant Reader/store/a11y unit
  fixtures, `docs/BOOK_READER.md`, `docs/RELEASE_GATE.md`, and this log.
- **Verification**:
  - focused resource/manager/IPC/preload suite: **3 files / 187 tests passed**;
  - complete Desktop unit: **74 files / 1272/1272 tests passed**;
  - Desktop typecheck and production `electron-vite` build passed;
  - focused ESLint passed; complete ESLint passed with **0 errors** and the
    existing **134 warnings**;
  - focused Prettier and `git diff --check` passed.
- **Key decisions**: resource authority is a short-lived session-generation
  capability rather than a renderer path; magic and extension must agree; SVG
  remains a separate future sanitization problem; UI display, object-URL cache
  lifecycle, and export rewriting remain outside Phase 10B1.
- **Unresolved**: Reader and export integration are intentionally deferred.
  Formal-release external blockers listed in Phase 10A remain unchanged.
- **Git**: not committed, tagged, pushed, or released; HEAD remains `e88b3107`.

## 2026-07-30 — Phase 10B1 final P2 closure

- **User goal**: close the remaining PNG decode and refresh-exception P2
  findings without committing or widening the renderer capability.
- **Completed**:
  - Restricted PNG to static, non-interlaced content. APNG `acTL`/`fcTL`/`fdAT`,
    compressed metadata `iCCP`/`zTXt`/`iTXt`, unknown critical chunks, unknown
    ancillary chunks, malformed CRC/order/schema, and oversized ancillary
    payloads now fail closed.
  - Added bit-depth/color-type-aware scanline sizing and a 64 MiB raw decode
    budget. Contiguous IDAT is capped at 8 MiB, inflated with
    `maxOutputLength`, required to consume the exact zlib input and produce the
    exact expected bytes, and checked for valid PNG filter bytes on every row.
  - Contained a thrown refresh loader: the exact invalidated session is
    deleted, the caller receives a structured path-free `book-unavailable`
    result instead of a rejected IPC promise, and neither the old nor rotated
    resource token remains usable.
  - Corrected the capability documentation: authority belongs to any
    node-bound chapter successfully returned by `readChapter` in the same
    session generation, not to a renderer-reported “current chapter”.
- **Files**: updated
  `packages/desktop/src/main/book/imageContainer.ts`,
  `packages/desktop/src/main/book/sessionManager.ts`,
  `packages/desktop/test/unit/specs/book-resource.spec.ts`,
  `packages/desktop/test/unit/specs/book-reader.spec.ts`,
  `docs/RESOURCE_PIPELINE.md`, and this log.
- **Verification**:
  - focused resource/contract/manager suite: **3 files / 209 passed / 1
    Windows-only skipped**;
  - complete Desktop unit suite: **74 files / 1294 passed / 1 Windows-only
    skipped**;
  - Desktop typecheck and production `electron-vite` build passed;
  - focused ESLint passed; complete ESLint passed with **0 errors** and the
    existing **134 warnings**;
  - focused Prettier and final `git diff --check` passed.
- **Key decisions**: no PNG path may cause hidden secondary decompression;
  interlaced/APNG support requires a separately budgeted implementation;
  refresh exceptions revoke instead of attempting to preserve an invalidated
  generation.
- **Unresolved**: Reader object-URL/rendering integration, native Windows
  evidence, the documented same-user P3 pathname window, and Phase 10A's
  external release blockers remain.
- **Git**: not committed, tagged, pushed, or released; HEAD remains `e88b3107`.

## 2026-07-30 — Phase 10B2a final verification supplement

- The complete Phase 10B2a implementation and candidate record appears above;
  this appended supplement records the final, post-format rebuild.
- Final current-tree macOS arm64 artifact/unpacked audits and bound receipt
  verification passed; exact packaged smoke passed **8/8**.
- DMG SHA-256:
  `43e7771abebefb2a1339c8bc00e24d1af983b08422e302b8245b870cc2bfb8b1`.
  ZIP SHA-256:
  `ddae32cac250342b717668c8a85e0893514f8bf378579a7c83f5eba5b0d9810f`.
- The candidate remains unsigned/unnotarized and is not a formal release.
- Git remains uncommitted, untagged, unpushed, and unpublished at
  `e88b3107`.

## 2026-07-30 — Phase 10B2a review-fix closure

- **User goal**: close the Reader raster review findings while preserving the
  complete existing diff and without committing, tagging, pushing, or
  releasing.
- **Completed**:
  - Added one pure Marked tokenizer-extension contract shared by Muya Reader,
    Muya block lexing, and main-process image-reference authorization. Math
    block/inline and sub/sup boundaries can no longer drift; ordinary inline
    and reference images remain authoritative while math, sub/sup, code, and
    raw HTML do not. Main-process heading analysis now follows direct pure
    imports, and the production main bundle contains no DOMPurify, KaTeX, or
    Prism runtime.
  - Added per-node `readChapter` nonces so only the latest concurrent response
    can commit the node's resource-reference set.
  - Changed PNG validation from synchronous inflate to asynchronous Node
    zlib/libuv inflate. All accepted containers now return trusted width,
    height, frame count, and decode-pixel metadata through the path-free DTO.
  - Deduplicated repeated references to one IPC read, Blob URL, and revoke.
    Each generation now admits at most 64 unique images, 32 MiB compressed
    bytes, 120 million decode pixels, and 512 frames, while retaining the
    two-read concurrency limit.
  - Added bounded cancellation/staleness-aware retry for `resource-busy` only,
    allowing two draining old-chapter reads and two new-chapter reads to
    converge without retrying permanent failures.
  - Added a real compiled `bookWorkspace/index.vue` mount test covering chapter
    and token replacement, refresh, Reader exit, unmount, late-response
    rejection, and one-time URL revocation.
  - Renamed the workflow/static macOS step from seven to eight packaged smoke
    tests and corrected Reader/resource/release documentation. The old ad-hoc
    Beta hash and pre-review `43e777...` hash are explicitly historical, while
    the current 0.1.0 candidate remains mutable, unsigned, and release-ineligible.
- **Files**: added
  `packages/muya/src/utils/marked/tokenizerContract.ts`,
  `packages/muya/src/utils/inlinePure.ts`, and
  `packages/desktop/test/unit/specs/book-workspace-image-lifecycle.spec.ts`;
  updated the Muya parser/heading/inline helpers, desktop main resource
  extraction/container/reader/session code, shared resource DTO, Renderer
  render/hydration code, Vite/Vitest/TypeScript configuration, resource/Reader
  and release-gate tests, `.github/workflows/release.yml`,
  `docs/BOOK_READER.md`, `docs/RESOURCE_PIPELINE.md`,
  `docs/RELEASE_GATE.md`, and this log.
- **Verification**:
  - Desktop unit: **76 files / 1310 passed / 1 native-Windows-only skipped**;
  - Muya unit: **213 files / 1454 passed**;
  - Desktop and Muya typechecks passed;
  - complete repository ESLint passed with **0 errors / 134 existing
    warnings**; focused Muya ESLint passed;
  - production Electron build passed; the emitted main bundle was checked to
    contain the shared contract but no DOMPurify/KaTeX/Prism runtime;
  - exact source smoke passed **8/8**;
  - current-tree arm64 build, app/ZIP/DMG audit, `hdiutil` checksum,
    unpacked receipt audit, receipt re-verification, and packaged smoke
    **8/8** passed;
  - unpacked app size: **391,684,096 bytes**; ASAR size:
    **149,182,914 bytes**.
- **Candidate artifacts**:
  - DMG:
    `dist/leafbook-mac-arm64-0.1.0.dmg`, **151,502,680 bytes**, SHA-256
    `7057222c186ef7d89b0c12cc65ea81ed92e310eef2f26457bb0d64d95fa219e2`;
  - ZIP:
    `dist/leafbook-mac-arm64-0.1.0.zip`, **150,651,159 bytes**, SHA-256
    `c3e0a59a4d437f13a8f8238bd3ae7af2b512017bbf1c9beb006c515f030296e3`.
- **Key decisions**: resource references remain only in the mounted
  generation's in-memory table; decoded trust metadata comes only from the
  main container validator; aggregate budgets count unique responses; export
  and SVG stay deferred.
- **Unresolved**: no Developer ID identity is installed, so electron-builder
  skipped signing and `codesign --verify --deep --strict` failed with
  `code has no resources but signature indicates they must be present`.
  Notarization and external formal-release evidence therefore remain blocked.
- **Git**: not committed, tagged, pushed, or released; HEAD remains
  `e88b3107`.

## 2026-07-30 — Phase 10B2a authoritative-budget and queue closure

- **User goal**: close every remaining Reader raster P0–P2 review item, rebuild
  the macOS candidate, and preserve the existing worktree without committing,
  tagging, pushing, or releasing.
- **Completed**:
  - Split Reader admission into a 256-occurrence cap and 64-unique-reference
    cap. Repeated destinations share one path-free resource slot/IPC/Blob URL,
    while overflow becomes an inert placeholder.
  - Added one shared pure local-raster reference policy for main and Renderer.
    PNG/JPEG/GIF/WebP are the only eligible extensions; unsupported and
    extensionless image tokens consume no quota.
  - Added an authoritative main-process ledger keyed to the live
    session/node/read nonce. References are one-shot leases reserved before
    filesystem work; request/unique counts are reserved synchronously and
    byte/decode-pixel/frame totals are atomically finalized before bytes are
    returned. The first aggregate overrun fail-stops the generation and
    cancels its queued work.
  - Replaced immediate owner/global busy rejection with a bounded 64-entry,
    30-second queue. It preserves FIFO among currently admissible owners,
    avoids head-of-line starvation from a saturated owner, and rejects stale
    session/token/nonce work before it can start.
  - Made Renderer budget failure stop all later scheduling while tolerating
    only already in-flight work, and made every resource-busy backoff timer
    synchronously cancellable on generation replacement/unmount.
  - Migrated clipboard parsing and `walkTokens` to the shared tokenizer
    contract, deleted the old duplicate math and super/subscript regex
    implementations, and added a Muya package-level `imageRenderer` provenance
    contract test.
  - Added local timeouts only to the heavy nonce/carrier fixtures rather than
    weakening the global test timeout.
- **Files**: added
  `packages/desktop/src/common/book/resourceReference.ts` and
  `packages/muya/src/__tests__/staticImageRenderer.spec.ts`; updated
  `packages/desktop/src/main/book/sessionManager.ts`,
  `packages/desktop/src/main/book/resourceReferences.ts`,
  `packages/desktop/src/renderer/src/book/renderMarkdown.ts`,
  `packages/desktop/src/renderer/src/book/hydrateBookImages.ts`,
  `packages/desktop/test/unit/specs/book-reader-images.spec.ts`,
  `packages/desktop/test/unit/specs/book-resource.spec.ts`,
  `packages/desktop/test/unit/specs/book-reader.spec.ts`,
  `packages/desktop/test/unit/specs/release-gate-static.spec.ts`, the Muya
  marked/static-rendering helpers, `docs/BOOK_READER.md`,
  `docs/RESOURCE_PIPELINE.md`, `docs/RELEASE_GATE.md`, and this log; deleted
  the superseded Muya math and super/subscript extension files.
- **Verification**:
  - Desktop unit: **76 files / 1315 passed / 1 native-Windows-only skipped**;
  - Muya unit: **214 files / 1455 passed**;
  - Desktop and Muya typechecks passed;
  - complete repository ESLint passed with **0 errors / 134 existing
    warnings**; focused changed-file lint passed;
  - production Electron build passed; the main bundle contains the shared
    tokenizer contract and no DOMPurify/KaTeX/Prism runtime;
  - exact source and packaged macOS arm64 smoke each passed **8/8**;
  - unpacked app audit/receipt creation, full app/ZIP/DMG carrier audit,
    `hdiutil verify`, and independent receipt re-verification passed;
  - unpacked app size: **418,320,384 bytes**; ASAR size:
    **175,125,288 bytes**.
- **Candidate artifacts**:
  - DMG: `dist/leafbook-mac-arm64-0.1.0.dmg`, **159,387,639 bytes**,
    SHA-256
    `7778b0374a6f5bfb02d6836af85703dc51b179427c71ca5a7a8393f5b6e4d88d`;
  - ZIP: `dist/leafbook-mac-arm64-0.1.0.zip`, **158,583,383 bytes**,
    SHA-256
    `19f54ec917e7da772e0c4e487b6025bcb08e124944205427047082f58c20d15e`.
- **Key decisions**: the main ledger, not the Renderer, is the authority for
  aggregate resource cost; a saturated owner cannot block unrelated owners;
  legal slow I/O is allowed to complete and release its slot; unsupported
  formats never consume supported-image quotas.
- **Unresolved**: this candidate is unsigned and unnotarized because no
  Developer ID identity is installed. Native Windows/Linux release evidence,
  notarization/Gatekeeper checks, protected release controls, and final human
  approval remain formal-release blockers.
- **Git**: not committed, tagged, pushed, or released; HEAD remains
  `e88b3107`.

## 2026-07-30 — Phase 10B2a third-review fairness and policy closure

- **User goal**: close the third Reader raster review, rebuild the macOS
  candidate, and keep moving toward a formal release without committing,
  tagging, pushing, or publishing.
- **Completed**:
  - Made resource admission reserve each one-shot lease before enqueueing, so
    duplicate requests cannot occupy queue capacity or reach filesystem I/O.
  - Added an eight-entry per-owner queue cap alongside the 64-entry global cap.
    Admission now lets an unrelated owner use an available global slot even
    when an earlier owner's two active slots and private queue are saturated.
  - Made queued timeout, cancellation, stale session/read nonce, and generation
    revocation clean their timers and per-owner counters. A queue-cap rejection
    does not consume the lease; an admitted request that later times out keeps
    the lease burned fail-closed.
  - Consolidated every supported extension/MIME and byte, dimension, pixel,
    frame, occurrence, unique-resource, and aggregate-generation raster limit
    in `packages/desktop/src/common/book/rasterPolicy.ts`. Main, Renderer, and
    tests now consume or verify that single pure policy.
  - Corrected Reader refresh documentation: a failed public refresh invalidates
    and deletes the mounted session, so callers must reopen the book. Replaced
    the inaccurate all-operations claim with the actual core Reader operation
    groups.
  - Added regression coverage proving the real admission/open order, per-owner
    and global queue limits, injected 30-second timeout cleanup, fail-closed
    lease behavior, and that an unrelated component rerender neither re-reads
    nor revokes a hydrated image.
- **Files**: added
  `packages/desktop/src/common/book/rasterPolicy.ts`; updated
  `packages/desktop/src/main/book/imageContainer.ts`,
  `packages/desktop/src/main/book/resourceReader.ts`,
  `packages/desktop/src/main/book/resourceReferences.ts`,
  `packages/desktop/src/main/book/sessionManager.ts`,
  `packages/desktop/src/renderer/src/book/renderMarkdown.ts`,
  `packages/desktop/src/renderer/src/book/hydrateBookImages.ts`,
  `packages/desktop/test/unit/specs/book-reader.spec.ts`,
  `packages/desktop/test/unit/specs/book-resource-contract.spec.ts`,
  `packages/desktop/test/unit/specs/book-workspace-image-lifecycle.spec.ts`,
  `packages/desktop/test/unit/specs/release-gate-static.spec.ts`,
  `docs/BOOK_READER.md`, `docs/RESOURCE_PIPELINE.md`,
  `docs/RELEASE_GATE.md`, and this log.
- **Verification**:
  - focused Reader/resource suites: **271 passed / 1 native-Windows-only
    skipped**;
  - complete Desktop unit suite: **76 files / 1321 passed / 1
    native-Windows-only skipped**;
  - complete Muya unit suite: **214 files / 1455 passed**;
  - Desktop and Muya typechecks passed;
  - complete repository ESLint passed with **0 errors / 134 existing
    warnings**;
  - production Electron build passed; the main bundle contains the shared
    raster-generation policy and no DOMPurify/KaTeX/Prism runtime;
  - exact source and packaged macOS arm64 smoke each passed **8/8**;
  - unpacked app audit/receipt creation, full app/ZIP/DMG carrier audit,
    `hdiutil verify`, and independent receipt re-verification passed;
  - unpacked app size: **418,664,448 bytes**; ASAR size:
    **175,134,683 bytes**.
- **Candidate artifacts**:
  - DMG: `dist/leafbook-mac-arm64-0.1.0.dmg`, **159,379,093 bytes**,
    SHA-256
    `ffe72c8d9ea498d5fcf8366d1e4e32a2e38fba5527088e67cf092ee5bf6ff4bc`;
  - ZIP: `dist/leafbook-mac-arm64-0.1.0.zip`, **158,582,687 bytes**,
    SHA-256
    `38f3e479c3b54568ac3c1af52535445f2fe47ed836ac56784d384a3250135c60`.
- **Key decisions**: queue capacity is separate from one-shot lease
  authority; only successfully admitted work burns a lease; timeout remains
  fail-closed; all raster safety constants have one runtime source.
- **Unresolved**: the candidate is unsigned and unnotarized because no
  Developer ID identity is installed. Native Windows/Linux release evidence,
  notarization/Gatekeeper checks, protected release controls, and final human
  approval remain formal-release blockers.
- **Git**: not committed, tagged, pushed, or released; HEAD remains
  `e88b3107`.

## 2026-07-30 — Phase 10B2a final-P2 determinism closure

- **User goal**: resolve the final quality-review P2 findings, prove the
  concurrency and carrier tests are stable, and rebuild the local macOS
  candidate without committing or publishing.
- **Completed**:
  - Removed the fair-admission test's invalid assumption about the ordering of
    two concurrent active opens. It now checks their set and requires the
    unrelated owner's real open to be third.
  - Added an explicit `firstEntered` loader barrier to the concurrent
    `readChapter` nonce test before starting the second read, and reduced its
    local timeout because ordering no longer depends on scheduler luck.
  - Gave the heavy multi-carrier fixture a scoped 30-second timeout. Three
    independent cold runs of the related six-file suite exposed a real
    same-owner queue-start race; admission now hands one queued item per owner
    into the real loader before admitting that owner's next queued item.
  - Added real `afterResourceOpen` FIFO coverage after releasing two same-owner
    active slots. The focused concurrency group then passed five consecutive
    runs and the complete six-file cold combination passed three consecutive
    runs.
  - Made the frozen raster extension map the only MIME value source.
    `BookRasterMediaType` and the runtime MIME collection are derived from its
    values, while `BookResourceDto` directly imports that type instead of
    repeating a union. Contract tests assert mapping/value-set/runtime parity.
- **Files**: updated
  `packages/desktop/src/common/book/rasterPolicy.ts`,
  `packages/desktop/src/shared/types/bookReader.ts`,
  `packages/desktop/src/main/book/sessionManager.ts`,
  `packages/desktop/test/unit/specs/book-reader.spec.ts`,
  `packages/desktop/test/unit/specs/book-resource-contract.spec.ts`,
  `packages/desktop/test/unit/specs/release-gate-static.spec.ts`,
  `docs/RESOURCE_PIPELINE.md`, `docs/RELEASE_GATE.md`, and this log.
- **Verification**:
  - focused concurrency selection passed **4/4** in five consecutive
    independent runs;
  - six-file Reader/resource/lifecycle/carrier cold combination passed three
    consecutive independent runs, each **271 passed / 1 native-Windows-only
    skipped**;
  - complete Desktop unit suite: **76 files / 1321 passed / 1
    native-Windows-only skipped**;
  - complete Muya unit suite: **214 files / 1455 passed**;
  - Desktop and Muya typechecks passed;
  - complete repository ESLint passed with **0 errors / 134 existing
    warnings**;
  - production Electron build and exact source smoke **8/8** passed;
  - rebuilt macOS arm64 app/ZIP/DMG audits, audit receipt creation and
    re-verification, `hdiutil verify`, and packaged smoke **8/8** passed;
  - unpacked app size: **417,456,128 bytes**; ASAR size:
    **175,137,002 bytes**.
- **Candidate artifacts**:
  - DMG: `dist/leafbook-mac-arm64-0.1.0.dmg`, **159,386,241 bytes**,
    SHA-256
    `2181a51d1542538aac637fc68ae67e23603b6388c30e6973dfd7de84768a9a3c`;
  - ZIP: `dist/leafbook-mac-arm64-0.1.0.zip`, **158,585,126 bytes**,
    SHA-256
    `54fc5d056de654e2b669b088217033b20bcbeb801eb7d50ac6ee8ec034f08021`.
- **Key decisions**: cross-owner fairness and same-owner FIFO are separate
  invariants; a queued owner start is serialized only until the actual loader
  has opened it, retaining later parallel I/O. Raster MIME values must be
  defined once at runtime and derived for both TypeScript and validation.
- **Unresolved**: this candidate remains unsigned and unnotarized because no
  Developer ID identity is installed. Native Windows/Linux release evidence,
  notarization/Gatekeeper checks, protected release controls, and final human
  approval remain formal-release blockers.
- **Git**: not committed, tagged, pushed, or released; HEAD remains
  `e88b3107`.

## 2026-07-30 — Phase 10B2a final-P1 handoff-token closure

- **User goal**: eliminate the remaining queued-start ABA race, bound the
  admitted pre-open phase, repeat the complete gates, and rebuild the local
  candidate without committing or publishing.
- **Completed**:
  - Replaced the owner-only pending-start set with an owner-to-opaque-token
    map. Each token binds a unique operation ID, session object and ID, owner,
    session generation, resource token, node ID, and chapter read nonce.
  - Made real open, final cleanup, session/token invalidation, chapter nonce
    replacement, budget revocation, and the watchdog release a handoff only
    when the owner's current map value is the exact same token object. A late
    request can no longer delete a newer handoff for the same owner.
  - Added an independent 30-second watchdog for a queued request that has been
    admitted but has not reached the real file open. Expiry releases only its
    admission gate and drains eligible work; the active operation may finish
    below and remains subject to the existing return-time session, generation,
    token, nonce, and budget checks.
  - Added an injected-clock ABA regression: an old admitted request blocks
    before open, its watchdog expires, refresh creates a new same-owner
    session that uses the spare slot and creates a new handoff, the old request
    returns late without clearing it, and a second refresh releases only the
    matching new token. Handoff timers and queued/active owner counters end
    empty.
  - Increased the separately identified carrier-layout binding fixture's
    scoped timeout from 10 to 30 seconds; the multi-carrier fixture already
    uses the same bounded local timeout.
- **Files**: updated
  `packages/desktop/src/main/book/sessionManager.ts`,
  `packages/desktop/test/unit/specs/book-reader.spec.ts`,
  `packages/desktop/test/unit/specs/release-gate-static.spec.ts`,
  `docs/RESOURCE_PIPELINE.md`, `docs/RELEASE_GATE.md`, and this log.
- **Verification**:
  - focused handoff/fairness/timeout/nonce selection: **5 passed**;
  - six-file Reader/resource/lifecycle/carrier cold combination passed three
    consecutive independent runs, each **272 passed / 1 native-Windows-only
    skipped**;
  - complete Desktop unit suite: **76 files / 1322 passed / 1
    native-Windows-only skipped**;
  - complete Muya unit suite: **214 files / 1455 passed**;
  - Desktop and Muya typechecks passed;
  - repository ESLint passed with **0 errors / 134 existing warnings**;
  - production Electron build and exact source smoke **8/8** passed;
  - rebuilt macOS arm64 app/ZIP/DMG audits, audit receipt creation and
    re-verification, `hdiutil verify`, and packaged smoke **8/8** passed;
  - unpacked app size: **416,960,512 bytes**; ASAR size:
    **175,144,363 bytes**.
- **Candidate artifacts**:
  - DMG: `dist/leafbook-mac-arm64-0.1.0.dmg`, **159,385,065 bytes**,
    SHA-256
    `61e6e70a925933840945e188652bf643f29bde112b137532d6c97ac1a91cc13e`;
  - ZIP: `dist/leafbook-mac-arm64-0.1.0.zip`, **158,587,090 bytes**,
    SHA-256
    `4cb38806cc2c94cc01ba481b1d22e834b1858b211b32cb69fea5ddd38739814b`.
- **Key decisions**: identity, not owner ID, governs handoff release; watchdog
  expiry only removes admission starvation and never declares the underlying
  filesystem work safe; final byte delivery remains independently fail-closed.
- **Unresolved**: this candidate remains unsigned and unnotarized because no
  Developer ID identity is installed. Native Windows/Linux release evidence,
  notarization/Gatekeeper checks, protected release controls, and final human
  approval remain formal-release blockers.
- **Git**: not committed, tagged, pushed, or released; HEAD remains
  `e88b3107`.

## 2026-07-30 — Phase 10B2a watchdog contract and revocation matrix

- **User goal**: document the precise FIFO-versus-liveness contract, add the
  final watchdog overtaking test and a defensive revocation matrix, and avoid
  rebuilding unchanged application code.
- **Completed**:
  - Documented that same-owner queued starts are strict FIFO until the
    30-second pre-open watchdog expires. After expiry, liveness takes priority:
    a later request in the same live generation may pass the stuck request,
    while owner/global active caps and the late request's return-time
    authorization checks remain mandatory.
  - Added a real-open regression proving the later same-generation request
    reaches `afterResourceOpen` before the stuck request only after the
    watchdog fires, and that the stuck request may then complete normally
    without leaking admission state.
  - Added a pending pre-open handoff revocation matrix for chapter read-nonce
    replacement, cumulative generation-budget fail-stop, `closeSession`, and
    `cleanupOwner`. Each case verifies exact token/timer release, a fail-closed
    late response where applicable, and empty handoff, queue-owner, and
    active-owner state after completion.
- **Files**: updated
  `packages/desktop/test/unit/specs/book-reader.spec.ts`,
  `docs/RESOURCE_PIPELINE.md`, and this log. No application source, build
  configuration, or packaged resource changed in this closure.
- **Verification**:
  - focused watchdog/overtaking/revocation matrix: **6 passed**;
  - six-file Reader/resource/lifecycle/carrier cold combination passed three
    consecutive independent runs, each **277 passed / 1 native-Windows-only
    skipped**;
  - complete Desktop unit suite: **76 files / 1327 passed / 1
    native-Windows-only skipped**;
  - Desktop typecheck, Prettier check, and `git diff --check` passed;
  - existing audit receipt re-verification and `hdiutil verify` passed;
  - existing packaged macOS arm64 exact smoke passed **8/8**;
  - DMG and ZIP hashes were re-read and remain unchanged.
- **Candidate artifacts**:
  - DMG: `dist/leafbook-mac-arm64-0.1.0.dmg`, SHA-256
    `61e6e70a925933840945e188652bf643f29bde112b137532d6c97ac1a91cc13e`;
  - ZIP: `dist/leafbook-mac-arm64-0.1.0.zip`, SHA-256
    `4cb38806cc2c94cc01ba481b1d22e834b1858b211b32cb69fea5ddd38739814b`.
- **Key decision**: no repackaging was performed because this closure changed
  only tests and documentation. Rebuilding would create a different
  nondeterministic carrier hash without changing the audited application
  runtime; receipt verification and packaged smoke instead reconfirmed the
  existing candidate.
- **Unresolved**: this candidate remains unsigned and unnotarized because no
  Developer ID identity is installed. Native Windows/Linux release evidence,
  notarization/Gatekeeper checks, protected release controls, and final human
  approval remain formal-release blockers.
- **Git**: not committed, tagged, pushed, or released; HEAD remains
  `e88b3107`.

## 2026-07-30 — Phase 10B2b safe local SVG Reader pipeline

- User goal: extend the Reader's local-image pipeline with safe SVG support,
  validate it against a representative local book document, and produce a new auditable
  Apple Silicon installer candidate without committing or releasing.
- Completed: added a shared SVG/image policy; a strict `saxes` main-process
  sanitizer with deterministic canonical output, finite geometry/path/
  transform validation, bounded local fragment references, and fail-closed
  namespace/URL/script/style/animation handling; integrated sanitized bytes
  into the existing session capability, one-shot lease, FIFO and generation
  budgets; and kept rendering limited to revocable Blob URLs on `<img>`.
- Completed: added malicious-corpus, policy-contract, resource, hydration,
  lifecycle, and Electron tests. The exact release smoke slice is now nine
  tests and includes a separate safe/malicious SVG zero-network case.
- Files: `packages/desktop/src/common/book/imagePolicy.ts`,
  `packages/desktop/src/common/book/svgPolicy.ts`,
  `packages/desktop/src/main/book/svgSanitizer.ts`,
  `packages/desktop/src/main/book/resourceReader.ts`,
  `packages/desktop/src/main/book/resourceReferences.ts`,
  `packages/desktop/src/renderer/src/book/hydrateBookImages.ts`,
  `packages/desktop/src/renderer/src/book/renderMarkdown.ts`, shared DTOs,
  session integration, unit/Electron tests, release workflow/smoke scripts,
  `docs/BOOK_READER.md`, `docs/RESOURCE_PIPELINE.md`,
  `docs/RELEASE_GATE.md`, package manifests, and lockfile.
- Tests: Desktop typecheck passed; Desktop unit 1360 passed/1 skipped; Muya
  typecheck passed; Muya unit 1455 passed; lint completed with 0 errors
  (repository-existing warnings only); production build passed; source smoke
  9/9 passed; arm64 app/ZIP/DMG and unpacked receipt audits passed; packaged
  smoke 9/9 passed. The isolated local-book regression copied a matching
  representative local Markdown document to a private temporary root, rendered a safe SVG,
  kept a script SVG inert with zero network requests, removed the copy, and
  left the original unchanged.
- Artifact: unsigned/unnotarized
  `dist/leafbook-mac-arm64-0.1.0.dmg`, 159,413,134 bytes, SHA-256
  `f2a0a6ffb0c9b989dc92057177f65106c520fe52aa8b7a1e1325bbb755ee4082`;
  ZIP 158,615,018 bytes, SHA-256
  `faeec5a9bf3ed75b9232fc7e4fa18495175598c45c7576bb730e818f7efc7cec`;
  audit receipt SHA-256
  `ca647d94a81a55d6352395fa0b5f63eec077ee67a499fca220967d43282f14bc`.
- Key decisions: reject all XML entities/DTD/PI and any unknown SVG surface;
  reject `xml:base`, `xlink`, external/protocol-relative/data/file references,
  nested/foreign namespaces and over-budget graphs; return only canonical
  main-validated bytes; never insert raw SVG into the DOM; keep export resource
  embedding deferred to its own threat model.
- Unresolved: this local candidate is not a formal release because it is not
  signed or notarized and native Windows/Linux release evidence remains open.
  The main bundle still contains Marked's pre-existing HTML attribute
  `DOMParser` helper; the new SVG sanitizer itself has no DOM dependency and
  uses only the direct lightweight `saxes` runtime dependency.
- Git commit: none; no tag, push, or release was created.

## 2026-07-30 — Phase 10B2b third-review security remediation

- User goal: resolve every third-review SVG blocker, establish replayable
  private-book evidence, rerun the complete gate, and replace the unsigned
  Apple Silicon candidate without committing or releasing.
- Completed: moved all SVG numeric magnitudes to `svgPolicy.ts`; rejected
  non-finite values, exponent overflow and non-zero underflow; added semantic
  path tracking for absolute/relative endpoints, explicit and reflected
  smooth-curve controls, and arcs; bounded points, shape geometry, `pathLength`,
  root/viewBox geometry, transform parameters and every composed matrix result.
- Completed: rebuilt fragment validation as typed ID-resource graphs. Each ID
  owns references in its complete subtree; paint, clipping and gradient href
  targets are type checked; three-color DFS rejects cycles and memoized longest
  depth rejects reordered and merged-tail over-depth DAGs.
- Completed: canonical attribute ordering now uses a fixed code-unit comparator.
  Child processes under three locale settings produced the same canonical
  SHA-256
  `b50eed59244101024d05e6024a59401f92d2c472528c1954289adbdd429b4f79`.
  Renderer response validation is shared per MIME and requires SVG frame count
  1, exact width×height decode pixels, and SVG-specific byte/dimension/pixel
  limits.
- Completed: added explicit duplicate-attribute, XML declaration, CDATA,
  comment, numeric boundary, relative accumulation, transform composition,
  arc, impossible DTO, typed-reference, structural-cycle, 41/512-node chain,
  exact-depth and locale-child-process tests.
- Real-book evidence: the filename-free replayable production Electron harness
  ran against a representative local Markdown source and the packaged app. Its
  content-derived digest, count, and byte size were withheld; the receipt recorded
  `unchanged=true`, `safeSvg=true`,
  `maliciousSvgInert=true`, `networkRequests=0`,
  `temporaryCopyRemoved=true`. No path, filename or content entered the
  receipt. Two temporary roots retained while developing stricter cleanup were
  individually owner/marker/type validated and removed.
- Files: `packages/desktop/src/common/book/svgPolicy.ts`,
  `packages/desktop/src/common/book/imagePolicy.ts`,
  `packages/desktop/src/main/book/svgSanitizer.ts`,
  `packages/desktop/src/renderer/src/book/hydrateBookImages.ts`,
  `packages/desktop/scripts/svg-canonical-probe.ts`,
  `packages/desktop/scripts/run-real-book-svg-harness.mjs`,
  SVG/Renderer/contract/harness/release static tests, package manifest,
  `docs/BOOK_READER.md`, `docs/RESOURCE_PIPELINE.md`,
  `docs/REAL_BOOK_RC.md`, `docs/BUILD.md`, and `docs/RELEASE_GATE.md`.
- Tests: Desktop typecheck passed; Desktop unit 1402 passed/1 skipped; Muya
  typecheck passed; Muya unit 1455 passed; lint completed with 0 errors and
  repository-existing warnings only; production build passed; source smoke
  9/9 passed; final focused release/SVG/harness check 110/110 passed; arm64
  app/ZIP/DMG and unpacked receipt audits passed; packaged smoke 9/9 passed;
  packaged real-book SVG harness passed.
- Artifact: unsigned/unnotarized
  `dist/leafbook-mac-arm64-0.1.0.dmg`, 159,409,037 bytes, SHA-256
  `ae0d37038ff14bb83eeef81e1349db15acfbc8a40787e72480dd26232e511249`;
  ZIP 158,617,949 bytes, SHA-256
  `b182f9f35e694eb9cfebd0cad6485d04217591d33af87fb297eee5a20f9d894b`;
  audit receipt SHA-256
  `162efc4d8ce2c908e5a9aabebeb141729e2fb3f8dd2fa2496c97ae0f3c95d5ec`.
- Key decisions: canonical output cannot depend on locale; reference depth is
  the longest resource dependency path, not traversal order; displayed SVG
  metadata cannot be weaker than its canonical geometry; real-book validation
  must be replayable without disclosing the source.
- Unresolved: the candidate remains unsigned and unnotarized; native
  Windows/Linux release evidence and the documented public-release blockers
  remain open.
- Git commit: none; no tag, push, or release was created. HEAD remains
  `e88b3107`.

### Phase 10B2c final validation addendum

- Final re-review: after updating the candidate-hash contract assertion,
  Desktop unit reran cleanly at 1418 passed/1 skipped and Desktop typecheck
  reran cleanly. No application source changed after the recorded package was
  built and audited.
- Git commit: none; no tag, push, or release was created.

## 2026-07-31 — Phase 10B2c stable-read and private-snapshot release hardening

- User goal: close the remaining SVG-surface and macOS package TOCTOU review
  findings, rebuild the unsigned Apple Silicon candidate, and rerun every
  applicable local release gate without committing or releasing.
- Completed: reduced SVG to a documented static basic-graphics subset. Removed
  `text`, `tspan`, `clipPath`, `clip-path`, and their attributes/references.
  Stroked geometry, including inherited strokes, now reserves four full stroke
  widths for default miter joins; acute path/polyline/polygon and rectangle
  regressions enforce the bound.
- Completed: packaged real-book validation now brackets Electron execution
  with stable receipt reads, caller-hash checks, full app-tree rebuilds, and
  exact executable device/inode/mode/link-count/size/mtime/ctime comparison.
  The non-atomic check-to-kernel-exec interval remains explicitly documented
  as P3.
- Completed: macOS receipts now stable-read every regular file and receipt
  through no-follow descriptors with matching pre/post descriptor and pathname
  identity and one-link policy. Directory identity and sorted entry sets are
  snapshotted twice. Version is parsed independently from stable
  `Info.plist` bytes and architecture from the stable Mach-O header.
- Completed: local Electron archives are descriptor-stably copied into a
  random mode-0700 private root and the copied hash/full identity plus
  caller-bound state are verified before and after builder use. ZIP/DMG
  carriers are built from an independently receipted private app snapshot,
  revalidated after generation, and followed automatically by complete
  app/ZIP/DMG and `hdiutil` audits. Cleanup requires the original canonical
  root, mode, owner marker, uid, and one-link marker.
- Completed: added dynamic adversarial coverage for same-size content writes,
  receipt inode replacement, Electron archive replacement, same-content
  carrier-app replacement, and a live TOCTOU write race.
- Files: `packages/desktop/src/common/book/svgPolicy.ts`,
  `packages/desktop/src/main/book/svgSanitizer.ts`,
  `packages/desktop/scripts/svg-canonical-probe.ts`,
  `packages/desktop/scripts/run-real-book-svg-harness.mjs`,
  `packages/desktop/test/unit/specs/book-svg-sanitizer.spec.ts`,
  `packages/desktop/test/unit/specs/book-resource-contract.spec.ts`,
  `packages/desktop/test/unit/specs/package-security-adversarial.spec.ts`,
  `packages/desktop/test/unit/specs/release-gate-static.spec.ts`,
  `scripts/mac-audit-receipt.mjs`,
  `scripts/package-private-snapshot.mjs`,
  `scripts/package-mac-unsigned-dir.sh`, `docs/BOOK_READER.md`,
  `docs/RESOURCE_PIPELINE.md`, `docs/REAL_BOOK_RC.md`, `docs/BUILD.md`,
  `docs/RELEASE_GATE.md`, and `WORKLOG.md`.
- Tests: Desktop unit 1418 passed/1 skipped; Muya unit 1455 passed; Desktop and
  Muya type checks passed; lint completed with 0 errors and 134
  repository-existing warnings; Prettier checks passed for the changed
  JavaScript/TypeScript/Markdown files; production build passed; source smoke
  9/9 and packaged smoke 9/9 passed; privacy-safe source and receipt-bound
  packaged real-book SVG harnesses passed; unpacked app receipt audit passed;
  private-snapshot ZIP/DMG generation, complete carrier audit, and DMG checksum
  verification passed.
- Artifact: unsigned/unnotarized
  `dist/leafbook-mac-arm64-0.1.0.dmg`, 159,514,904 bytes, SHA-256
  `a4a8bbe41926b11b07ee1ee6d200aa4108391f989c07e36a9a64debb05cf28d1`;
  ZIP 158,705,630 bytes, SHA-256
  `3a69be81e3866524e58a004ca8b09aee0ec4336cc1afb08a17fdf4cfa5e0a2d4`;
  app-tree audit receipt SHA-256
  `109042a9689b664c572c4e9b2a4173be6d6cf829836a096513c44e3cc2b331d1`.
- Key decisions: the formal SVG boundary favors a smaller static subset over
  rendering breadth; package checks bind content and filesystem identity at
  every controllable boundary; carrier creation cannot report success before
  automatic post-generation artifact audits finish.
- Unresolved: the candidate remains unsigned and unnotarized; Developer ID,
  hardened runtime, notarization/Gatekeeper, native Windows/Linux release
  evidence, and the documented instantaneous check-to-exec P3 remain formal
  release blockers. Historical append-only worklog content was not rewritten.
- Git commit: none; no tag, push, or release was created. HEAD remains
  `e88b3107`.

## 2026-07-31 — Phase 10B2b tree-CTM and privacy-contract remediation

- User goal: close the remaining third-review SVG and real-book-harness
  blockers, rerun the complete local release gate, and replace the unsigned
  Apple Silicon candidate without committing or releasing.
- Completed: changed SVG transform parsing to return matrices and added a
  whole-tree effective-CTM pass. Validation begins with the root
  viewport/viewBox and default `preserveAspectRatio` mapping, composes every
  parent-to-child transform, rejects excessive intermediate CTMs before a
  descendant can cancel them, and checks conservative transformed bounds for
  shapes, path endpoints, explicit/reflected controls, and arcs.
- Completed: tightened the real-book harness public schema to explicit
  source/packaged mode, a random run ID, and fixed booleans only. Source
  digest, count, byte size, paths, filenames, content, and other
  manuscript-derived or exact-scale fields are no longer published. Packaged
  mode now requires an explicit app-tree audit receipt plus caller-supplied
  receipt hash, rebuilds the receipt-bound app tree, and requires the selected
  executable to be the exact executable in that package.
- Completed: unified source snapshot and copy creation, required the copied
  content manifest to equal the before-manifest, compared stable device/inode/
  mode/link-count/size/nanosecond-time metadata, and added unified total-entry,
  per-directory, depth, per-file-byte and total-byte budgets, including a
  dynamic empty-directory fanout regression.
- Completed: expanded locale-independence probing to Lithuanian and Latvian
  locale settings and real `cx`, `cy`, and `clip-path` attributes. Updated the
  resource, Reader, real-book, build, and release-gate documentation.
- Packaging: the first network-denied attempt exposed an offline
  checksum-fetch cache miss. The package entry point now optionally accepts a
  canonical local Electron archive only after version/architecture filename
  validation and exact SHA-256 verification against the installed Electron
  checksum manifest. It also has a carrier mode that verifies the app-tree
  receipt before building ZIP/DMG from that audited app in the same
  network-denied sandbox.
- Files: `packages/desktop/src/main/book/svgSanitizer.ts`,
  `packages/desktop/scripts/svg-canonical-probe.ts`,
  `packages/desktop/scripts/run-real-book-svg-harness.mjs`,
  `packages/desktop/test/unit/specs/book-svg-sanitizer.spec.ts`,
  `packages/desktop/test/unit/specs/book-real-svg-harness.spec.ts`,
  `packages/desktop/test/unit/specs/release-gate-static.spec.ts`,
  `scripts/package-mac-unsigned-dir.sh`, `docs/BOOK_READER.md`,
  `docs/RESOURCE_PIPELINE.md`, `docs/REAL_BOOK_RC.md`, `docs/BUILD.md`,
  `docs/RELEASE_GATE.md`, and `WORKLOG.md`.
- Tests: Desktop unit 1410 passed/1 skipped; Muya unit 1455 passed; Desktop and
  Muya type checks passed; lint completed with 0 errors and 134
  repository-existing warnings; production build passed; source smoke 9/9
  passed; source and receipt-bound packaged real-book SVG harnesses passed;
  unpacked app audit passed; packaged smoke 9/9 passed; ZIP/DMG carrier audit
  and DMG checksum verification passed.
- Artifact: unsigned/unnotarized
  `dist/leafbook-mac-arm64-0.1.0.dmg`, 159,507,027 bytes, SHA-256
  `d000f06d212f1cf1f6faed735e8719a38823f68ae4061f38cb636183180d2a6e`;
  ZIP 158,705,754 bytes, SHA-256
  `f0f6dcce31c68947054b7574e3a6b048b0665744d6bd9e3b16c668014e99b788`;
  app-tree audit receipt SHA-256
  `9195b68dac826ba8b2f5fc4a9594592a00d571a07aabb18f7e4e91a4ca0168dd`.
- Key decisions: manuscript invariants remain internal booleans; package
  identity may be publicly hashed but manuscript-derived metadata may not;
  effective SVG safety is evaluated in viewport coordinates across the full
  transform tree, not one attribute at a time.
- Unresolved: earlier append-only worklog entries contain legacy manuscript
  identifiers and manuscript-derived aggregate metadata. They were not
  rewritten because targeted historical redaction requires explicit user
  authorization. The candidate remains unsigned and unnotarized; native
  Windows/Linux evidence and other documented public-release blockers remain.
- Git commit: none; no tag, push, or release was created. HEAD remains
  `e88b3107`.

### Phase 10B2c append-only final confirmation

- The stable-read/private-snapshot candidate remained byte-identical through
  the final contract rerun. Desktop unit finished at 1418 passed/1 skipped and
  Desktop typecheck passed.
- Git commit: none; no tag, push, or release was created.

## 2026-07-31 — Phase 10B2d triple-tree and public-dist binding

- User goal: close the remaining SVG arc, whole-tree race, private-root
  replacement, and public-carrier binding findings without changing historical
  worklog records or creating a commit.
- Completed: removed `A`/`a` elliptical arcs from the accepted SVG path grammar
  and added explicit absolute/relative rejection tests. Other bounded static
  path commands remain supported.
- Completed: receipt construction now performs two complete content,
  filesystem-identity, symlink-target, and directory-entry-set snapshots and
  requires their full JSON equality, followed by a third terminal full-tree
  scan. A deterministic early-target/slow-tail same-size persistent-write race
  fails closed.
- Completed: package, unpacked-app, and carrier audits now share an
  identity-bound private-root helper. Root device, inode, uid, mode, and random
  token are retained in shell plus a caller-hashed root-external state file.
  Cleanup rejects a replacement inode even when it copies the old token.
- Completed: carrier audits operate on private copies so `hdiutil` cannot
  mutate public artifact metadata. Before copying, the public app/ZIP/DMG
  receive stable digest and full-identity snapshots; public objects must remain
  exactly identical afterward, while the audited private app content/identity
  and carrier digests must equal the public objects. The public app receipt is
  verified again as the final carrier step.
- Files: `packages/desktop/src/main/book/svgSanitizer.ts`,
  `packages/desktop/test/unit/specs/book-svg-sanitizer.spec.ts`,
  `packages/desktop/test/unit/specs/package-security-adversarial.spec.ts`,
  `packages/desktop/test/unit/specs/release-gate-static.spec.ts`,
  `scripts/mac-audit-receipt.mjs`,
  `scripts/package-private-snapshot.mjs`, `scripts/private-root.sh`,
  `scripts/package-mac-unsigned-dir.sh`, `scripts/audit-mac-artifact.sh`,
  `scripts/audit-mac-unpacked.sh`, `docs/BOOK_READER.md`,
  `docs/RESOURCE_PIPELINE.md`, `docs/BUILD.md`, `docs/REAL_BOOK_RC.md`,
  `docs/RELEASE_GATE.md`, and `WORKLOG.md`.
- Tests: Desktop unit 1420 passed/1 skipped; Muya unit 1455 passed; both type
  checks passed; lint completed with 0 errors and 134 repository-existing
  warnings; production build passed; source and packaged smoke each passed
  9/9; privacy-safe real-book source and packaged harnesses passed; unpacked
  receipt audit passed; two private-copy carrier audits, both with public-dist
  pre/post binding and `hdiutil` verification, passed. No private-root or
  root-state residue remained.
- Artifact: unsigned/unnotarized
  `dist/leafbook-mac-arm64-0.1.0.dmg`, 159,513,755 bytes, SHA-256
  `267d14d54d3c5ef9cbcad238ac598a0c6a7418d421cf22f50833bb610f8c0c6c`;
  ZIP 158,705,748 bytes, SHA-256
  `0865cdcfa0ad936e1f0cdae1f158a2f0698b204c9076101bc8f91cfe171c0e4a`;
  app-tree audit receipt SHA-256
  `42eb75a2bf70d8e37fa91ab4eb07bd9ac9c401b0d73b2dc1afcc0789d3ed8542`.
- Key decisions: the safer formal SVG subset omits arcs rather than
  approximating radii correction; whole-tree stability is a global invariant,
  not a set of local directory checks; auditing a private carrier copy avoids
  expected `hdiutil` ctime mutation of the public DMG.
- Unresolved: same-uid instantaneous swap/restore after the terminal scan, the
  packaged check-to-kernel-exec interval, and private-root check-to-recursive-
  remove remain documented P3 limits of portable pathname APIs. The candidate
  is still unsigned and unnotarized; signing, hardened runtime, notarization,
  Gatekeeper, native Windows/Linux evidence, and other documented external
  blockers remain.
- Git commit: none; no tag, push, or release was created. HEAD remains
  `e88b3107`.

## 2026-07-31 — Phase 10B2d P2 deterministic receipt-test closure

- User goal: close the final P2 test gap without changing packaged runtime
  behavior, publishing, or rewriting historical privacy-sensitive records.
- Completed: exported the receipt tree collector as an import-safe module
  function and added an optional second-argument dependency containing
  `onSnapshotFile(passIndex, relativePath)`. The callback exists only inside
  the importing process; the production CLI accepts exactly its documented
  three arguments, reads no environment hook, and remains behind a direct-
  execution guard.
- Completed: replaced the 10 ms early-file mutation timer with an explicit
  pass-1 callback after `Contents/Resources/AA-target.dat` has been hashed. The
  callback performs one same-size write, the changed bytes remain until the
  test ends, and receipt construction deterministically fails on the later
  complete snapshot.
- Files: `scripts/mac-audit-receipt.mjs`,
  `packages/desktop/test/unit/specs/package-security-adversarial.spec.ts`,
  `docs/BUILD.md`, `docs/RELEASE_GATE.md`, and `WORKLOG.md`.
- Test-count correction: the preceding 1420-passed result was the valid count
  before adding the new import-safety/module-only injection test. The current
  suite is 1421 passed/1 skipped, and that exact result passed in three
  consecutive full Desktop runs. The targeted adversarial file passed 9/9 in
  five consecutive runs.
- Additional verification: Desktop typecheck, selected Prettier check, Node
  and shell syntax checks, and `git diff --check` passed. The unpacked macOS
  audit and full app/ZIP/DMG carrier audit passed; packaged smoke passed 9/9;
  final receipt verification passed. An initial audit wrapper invocation with
  an extra separator was rejected by usage validation; the documented command
  was then run successfully.
- Artifact decision: no Electron main/renderer source or bundle input changed,
  so the app was not repackaged. Reverification retained the exact previous
  candidate bytes: DMG SHA-256
  `267d14d54d3c5ef9cbcad238ac598a0c6a7418d421cf22f50833bb610f8c0c6c`,
  ZIP SHA-256
  `0865cdcfa0ad936e1f0cdae1f158a2f0698b204c9076101bc8f91cfe171c0e4a`,
  and receipt SHA-256
  `42eb75a2bf70d8e37fa91ab4eb07bd9ac9c401b0d73b2dc1afcc0789d3ed8542`.
  No private-root state or active packaging/audit temporary root remained.
- Key decision: deterministic in-process fault injection is a testability
  interface, not a production CLI feature; there is no environment-variable
  or hidden command-line path to it.
- Unresolved: rolling back a partially created private root when the helper
  itself fails during creation remains a follow-up P3. Existing same-uid
  pathname-race P3 limits and external signing/notarization/platform blockers
  are unchanged.
- Git commit: none; no tag, push, or release was created. HEAD remains
  `e88b3107`.

## 2026-07-31 — Phase 10B2d stable-read chunk race P2 closure

- User goal: remove the last scheduler-dependent live-race test without adding
  a timeout or changing packaged runtime behavior.
- Completed: `stableRegular` now accepts the module-only
  `onStableReadChunk(passIndex, relativePath, bytesRead)` dependency. The
  collector awaits it after hashing each chunk and threads it through
  snapshot/build options. Normal callers pass no dependency, while the
  production CLI still accepts exactly three documented arguments and exposes
  no command-line or environment hook. Import remains side-effect-free.
- Completed: replaced the 48 MiB target, 1 ms interval, repeated synchronous
  writes, and timer cleanup with one bounded 16 KiB file. Immediately after
  pass 1 hashes its first chunk, the callback performs one same-size overwrite,
  calls `fsync`, closes the writer, and leaves the changed bytes in place.
  Stable descriptor/path identity comparison then deterministically rejects
  the file during that same hashing operation.
- Files: `scripts/mac-audit-receipt.mjs`,
  `packages/desktop/test/unit/specs/package-security-adversarial.spec.ts`,
  `docs/BUILD.md`, `docs/RELEASE_GATE.md`, and `WORKLOG.md`.
- Stability-evidence correction: the preceding five-round targeted result is
  superseded by the final chunk-injection implementation. The adversarial file
  passed 9/9 in ten consecutive runs. Desktop unit passed 79 files, 1421
  tests/1 skipped in three consecutive full runs.
- Additional verification: Desktop typecheck, selected Prettier check, Node
  and shell syntax checks, explicit removal check for the old interval/48 MiB
  implementation, and `git diff --check` passed. The unpacked app audit,
  complete app/ZIP/DMG audit, DMG checksum verification, packaged smoke 9/9,
  and final receipt verification all passed. No current private-root state or
  packaging/audit temporary root remained.
- Artifact decision: only the receipt script, tests, and documentation changed;
  no Electron main/renderer bundle input changed, so no repack was required.
  Candidate bytes remain exact: DMG SHA-256
  `267d14d54d3c5ef9cbcad238ac598a0c6a7418d421cf22f50833bb610f8c0c6c`,
  ZIP SHA-256
  `0865cdcfa0ad936e1f0cdae1f158a2f0698b204c9076101bc8f91cfe171c0e4a`,
  and receipt SHA-256
  `42eb75a2bf70d8e37fa91ab4eb07bd9ac9c401b0d73b2dc1afcc0789d3ed8542`.
- Key decision: the fault is injected at an awaited descriptor-read boundary,
  making the failure causal and repeatable instead of probabilistic.
- Unresolved: private-root creation-failure rollback remains a follow-up P3.
  Existing same-uid pathname-race limits and external
  signing/notarization/platform blockers are unchanged.
- Git commit: none; no tag, push, or release was created. HEAD remains
  `e88b3107`.

## 2026-07-31 — Phase 10B2d isolated heavy-test quality gate

- User goal: close the remaining load-sensitive test-quality findings without
  increasing the global timeout, reducing coverage, repackaging, or committing.
- Completed: only the SVG child-process locale probe receives a local 30-second
  timeout. It still executes the real canonical probe under C, en_US, tr_TR,
  lt_LT, and lv_LV locales and requires one identical hash.
- Completed: only the PDF inline-theme dynamic-import test receives a local
  30-second timeout. It records whether `window.marktext` and
  `window.fileUtils` existed plus both original values, removes them inside a
  `try`, and restores the exact prior presence/value in `finally`, including
  when import or assertions fail.
- Files: `packages/desktop/test/unit/specs/book-svg-sanitizer.spec.ts`,
  `packages/desktop/test/unit/specs/pdf.spec.ts`, and `WORKLOG.md`. No global
  Vitest timeout was changed.
- Isolated tests: the SVG sanitizer file passed 77/77 by itself; the PDF file
  passed 16/16 by itself.
- Stability-evidence correction: Desktop unit passed 79 files, 1421 tests/1
  skipped in three consecutive clean runs with no concurrent heavy audit.
  It then produced the same result in two further full runs while a complete
  app/ZIP/DMG artifact audit and DMG checksum verification ran concurrently;
  both concurrent audits also passed.
- Additional verification: Desktop typecheck, selected Prettier check, and
  `git diff --check` passed. Receipt verification and packaged smoke 9/9
  passed. No private-root state or current audit temporary root remained.
- Artifact decision: only tests and this append-only log changed, so no repack
  was required. Candidate bytes remain exact: DMG SHA-256
  `267d14d54d3c5ef9cbcad238ac598a0c6a7418d421cf22f50833bb610f8c0c6c`,
  ZIP SHA-256
  `0865cdcfa0ad936e1f0cdae1f158a2f0698b204c9076101bc8f91cfe171c0e4a`,
  and receipt SHA-256
  `42eb75a2bf70d8e37fa91ab4eb07bd9ac9c401b0d73b2dc1afcc0789d3ed8542`.
- Key decision: accommodate known child-process/dynamic-import startup cost at
  the individual test boundary while keeping the repository-wide timeout
  strict and proving isolation under real concurrent artifact load.
- Unresolved: existing P3 and external release blockers are unchanged.
- Git commit: none; no tag, push, or release was created. HEAD remains
  `e88b3107`.

## 2026-07-31 — Phase 10B3 main-owned offline export resources

- User goal: make verified local book images survive both single-file HTML and
  local-website export without exposing source paths or weakening the Reader
  resource boundary; validate the result against a representative local book.
- Completed: added a separate main-process export-resource transaction that
  rereads exact model-ordered chapter Markdown, extracts only authorized
  Markdown image tokens, opens resources through the descriptor-pinned
  raster/SVG pipeline, and retains the authoritative ledger in main. Renderer
  snapshots contain only document-local ordered opaque targets: verified data
  URLs for HTML or `assets/<sha256>.<ext>` for websites.
- Completed: unique sanitized bytes are SHA-256 deduplicated across chapters.
  Single HTML has a 24 MiB unique-resource budget plus the existing 64 MiB
  final-HTML limit. Website resources have a separate 32 MiB budget. Both
  modes cap unique assets, references, decode pixels, and frames. Remote,
  data, file, absolute, raw-HTML, unsupported, malformed, missing, and
  over-budget resources fail closed as placeholders without renderer
  filesystem access.
- Completed: commit rereads chapters and every accepted resource and requires
  the exact document order, reference sets, metrics, hashes, targets, and
  ledger fingerprint. Export IDs remain random and owner/session/generation
  bound; the two-minute lease is single-use and now revokes its ledger
  immediately when an expired HTML or website commit is attempted.
- Completed: website output now uses strict website CSP, no scripts or external
  resources, one content-addressed file per unique asset, and a canonical
  schema-2 manifest binding every index/asset path, size, and SHA-256. Main
  writes assets itself into a private sibling stage, fsyncs files/directories,
  checks exact entry sets, symlink/hardlink/inode/link-count identities, and
  atomically renames with pinned backup/rollback behavior. An APFS regression
  was fixed by pinning the asset-directory link count after its final contents
  are written.
- Files: `packages/desktop/src/main/book/exportResources.ts`,
  `packages/desktop/src/main/book/sessionManager.ts`,
  `packages/desktop/src/common/book/exportPolicy.ts`,
  `packages/desktop/src/common/book/websitePolicy.ts`,
  `packages/desktop/src/renderer/src/book/exportBookHtml.ts`,
  `packages/desktop/src/shared/types/bookReader.ts`, the corresponding export,
  Reader, website-policy, real-book, release-gate, and Electron E2E tests,
  `packages/desktop/scripts/run-real-book-svg-harness.mjs`,
  `scripts/smoke-mac-unpacked.sh`, release workflow, Reader/resource/build/RC/
  release-gate documentation, and this log.
- Tests: full Desktop unit passed 80 files, 1432 tests/1 skipped before the
  final lease-expiry regressions; the final focused Reader/harness run passed
  178/178 including both new expiry cases. Desktop typecheck and production
  build passed. Full source smoke selected exactly 10 tests in 3 files and
  passed 10/10, including the new embedded-data/hashed-website-asset case.
  Full lint passed with 0 errors and 136 inherited warnings; `git diff --check`
  passed.
- Real-book evidence: the privacy-safe isolated harness passed against the
  representative local Markdown source. It verified the original source snapshot remained
  unchanged, safe SVG rendering, malicious SVG inertness, single-HTML resource
  embedding, website asset/manifest binding, zero network requests, and
  validated temporary-copy cleanup. Its public receipt contained only
  aggregate booleans and a random run ID.
- Key decisions: export is deliberately not Reader's one-shot resource lease;
  renderer asset bytes/source references are never authoritative. SVG remains
  an `<img>` resource only. The real-book harness validates the exported bytes
  and manifest; browser loading/decoding of the website output stays in the
  dedicated bounded Electron E2E because a hidden window can indefinitely
  defer a lazy image at the end of a long real manuscript.
- Unresolved: the existing DMG/ZIP/receipt candidate predates these
  main/renderer changes and must be rebuilt and re-audited before it can be
  treated as evidence. External signing/notarization and real Windows/Linux
  runtime blockers remain unchanged.
- Git commit: none; no tag, push, or release was created. HEAD remains
  `e88b3107`.

### Phase 10B3 final validation addendum

- After the expiry regressions and lint-only formatting fixes, the complete
  Desktop unit suite reran at 80 files, 1432 passed/1 skipped. Typecheck,
  production build, and `git diff --check` reran successfully.
- No commit, tag, package, push, or release was created by this validation.

### Phase 10B3 unsigned arm64 candidate addendum

- The approved network-denied package entry initially failed honestly when
  electron-builder attempted to resolve a missing cache entry. The canonical
  local Electron 42.1.0 arm64 archive was then supplied explicitly; the
  package script matched its filename and SHA-256 against Electron's installed
  `checksums.json`, copied it descriptor-stably into a random private root,
  verified it before and after use, and removed that root.
- The first packaged smoke run passed 9/10 and exposed a test timing defect:
  the hidden validation window inspected website images before Chromium
  scheduled their `loading="lazy"` fetch. The E2E now explicitly switches the
  two exported images to eager loading, scrolls them into view, and awaits
  `decode()` before inspecting dimensions. The focused source E2E passed, and
  the complete app, receipt, ZIP, and DMG were rebuilt after this correction.
- Final candidate evidence: unpacked audit passed with a 416,759,808-byte app
  and 175,374,867-byte ASAR. The private-snapshot carrier flow and a separate
  public-dist audit both proved app/ZIP/DMG topology and content equivalence;
  `hdiutil verify` passed both inside the carrier audit and independently.
  Packaged smoke selected exactly 10 tests in 3 files and passed 10/10.
- The receipt-bound packaged representative-book schema-2 harness passed with unchanged
  source and package snapshots, safe SVG rendering, malicious SVG inertness,
  offline HTML resources, complete website manifest binding, zero network
  requests, and verified temporary-copy cleanup.
- Candidate files: DMG 159,542,114 bytes, SHA-256
  `c584a90bc7b654ac5b937866ce90d2573a47408d848ec6411b982dd2586a2aad`;
  ZIP 158,716,365 bytes, SHA-256
  `328226d481bf4942f8e71404ecba4b97fd2b139500e5cbffc4cdc41924f57742`;
  receipt 38,329 bytes, SHA-256
  `ec2b95f09eaaa1a8b16d77429c887b89dded43c9b471390df3ee2fb2cb53f9b3`.
- Three exact mode-0700 harness roots left by earlier manually interrupted
  diagnostic runs were individually validated under the canonical temporary
  parent with current ownership and single-link 32-byte owner markers, then
  removed. Final checks found no package state file and no current package,
  harness, or platform-audit temporary root.
- The candidate is explicitly unsigned and unnotarized. Signing,
  notarization/Gatekeeper, and real Windows/Linux runtime evidence remain
  release blockers.
- Git commit: none; no tag, push, or release was created. HEAD remains
  `e88b3107`.

### Phase 10B3 third-review hardening and replacement candidate

- User goal: continue under orchestration until LeafBook reaches a formal
  release-quality threshold, while keeping publication and irreversible
  release actions gated.
- Completed: export leases now have identity-bound active TTL timers and are
  pruned before admission. Revocation aborts and removes the lease, clears the
  timer, closes the pinned parent descriptor, zeroes retained asset buffers,
  and releases all ledger state. Exact recorded temp/stage identities permit
  safe cancellation cleanup after those capabilities have been released.
- Completed: export resource ledgers now retain private root/ancestor/file
  identities plus raw SHA-256 and byte length, enforce a 32 MiB unique raw-byte
  budget, and synchronously reopen, bound-read, EOF-check, hash, and revalidate
  every raw source immediately adjacent to HTML or website rename.
- Completed: the shared Markdown occurrence plan authorizes only the first 256
  supported image occurrences and preserves duplicates and document order.
  Final HTML validation requires the exact issued image sequence and count,
  including null placeholders. Image tags receive a bounded 8 MiB token limit;
  all other tags remain capped at 64 KiB.
- Completed: the schema-2 website manifest requires each asset basename hash
  to equal its declared SHA-256. The ownership inspector uses bounded directory
  iteration, rejects undeclared or unused files, enforces 8 MiB per-asset and
  32 MiB aggregate budgets before content reads, and verifies the exact index
  image sequence. Raw resource snapshots remain private and non-enumerable at
  the low-level Reader result boundary.
- Files: `packages/desktop/src/main/book/resourceReader.ts`,
  `packages/desktop/src/main/book/resourceReferences.ts`,
  `packages/desktop/src/main/book/exportResources.ts`,
  `packages/desktop/src/main/book/sessionManager.ts`,
  `packages/desktop/src/common/book/exportPolicy.ts`,
  `packages/desktop/src/common/book/websitePolicy.ts`, their focused unit tests,
  `docs/BOOK_WEBSITE.md`, `docs/RESOURCE_PIPELINE.md`,
  `docs/RELEASE_GATE.md`, the static release-gate test, and this log.
- Tests: lint passed with 0 errors and 134 inherited warnings; Desktop
  typecheck passed; Desktop unit passed 80 files with 1,435 tests and one
  platform skip; Muya typecheck and 214-file/1,455-test suite passed;
  production build passed; source and packaged release-smoke each selected the
  exact ten tests and passed 10/10. The packaged privacy-safe local-book
  schema-2 harness passed with unchanged source/package snapshots, safe SVG,
  inert malicious SVG, offline export resources, bound website manifest, zero
  network requests, and verified cleanup. `git diff --check` passed.
- Candidate: the network-denied arm64 build used the locally checksum-verified
  Electron 42.1.0 archive. Unpacked audit passed with a 417,611,776-byte app
  and 175,388,332-byte ASAR. Private-snapshot and independent public-dist
  carrier audits plus independent `hdiutil verify` passed. DMG: 159,516,647
  bytes, SHA-256
  `55f6db52b432c8050e058fd697f56f6bf991c2ccffe7828174574d41a2d0dc57`;
  ZIP: 158,718,874 bytes, SHA-256
  `6caf12afcd89b803b08791db7f208cefe2d32f2932d710227c60ad9054210586`;
  receipt: 38,329 bytes, SHA-256
  `e2869ace7656a48db2de0e0cb9cbfa3f934812cdea71784df1bfcb840c8501e8`.
- Key decisions: the earlier Phase 10B3 artifact is retained only as previous
  evidence; the new bytes are the current local candidate. Neither artifact is
  a formal release because signing, notarization/Gatekeeper, and real native
  Windows/Linux runtime evidence remain unresolved blockers.
- Git commit: none; no tag, push, signing, notarization, publication, or GitHub
  Release was created. HEAD remains `e88b3107`.

### Phase 10B3 final-third-review resource/export correction

- User goal: address the remaining Phase 10B3 review findings without a commit
  or release, then rebuild and independently validate a replacement local
  candidate.
- Completed: renderer snapshot targets are now unique and aligned with the
  first-occurrence order of Reader `image-N` slots. Main retains a separate
  occurrence-expanded sequence, so `[A,A,B]` renders and validates as A, A, B
  while `[missing,missing,B]` renders two exact managed placeholders followed
  by B. Unsupported and raw-HTML placeholders remain outside that contract.
- Completed: HTML preparation rejects more than 48 MiB of occurrence-expanded
  data-URL characters before the snapshot crosses IPC. Tests cover a shared
  maximum-size URL repeated 256 times, the exact boundary, and one character
  over it. The calculated image-token bound now independently includes the
  maximum 6 MiB asset's base64 source, bounded attribute overhead, and explicit
  4 KiB `alt` and `title` limits; non-image tags retain the 64 KiB token cap.
- Completed: export leases now use an in-flight reference. Cancel or active TTL
  expiry immediately aborts and removes admission, but a running commit retains
  its pinned parent descriptor and ledger until its operation `finally`; the
  last reference then closes the descriptor, zeroes bytes, and disposes the
  ledger. Rebuilt validation ledgers and every post-build begin failure path
  dispose explicitly.
- Completed: website staging now journals the root identity immediately, the
  assets-directory identity at creation, and every exclusive file identity
  before content awaits. Exact journal cleanup handles cancellation after the
  first asset, cancellation after a middle asset, and active TTL expiry with no
  stage residue, even before a manifest exists. Unknown or changed entries are
  left untouched.
- Files: `packages/desktop/src/main/book/exportResources.ts`,
  `packages/desktop/src/main/book/sessionManager.ts`,
  `packages/desktop/src/common/book/exportPolicy.ts`,
  `packages/desktop/src/renderer/src/book/exportBookHtml.ts`, focused export,
  Reader, website and release-static tests, `docs/BOOK_WEBSITE.md`,
  `docs/RESOURCE_PIPELINE.md`, `docs/RELEASE_GATE.md`, and this log.
- Tests: focused export/Reader/website tests passed 208/208. Full Desktop unit
  passed 80 files with 1,448 tests and one platform skip. Full Muya passed 214
  files/1,455 tests. Desktop and Muya typechecks, production build, lint with
  zero errors/134 inherited warnings, source smoke 10/10, packaged smoke 10/10,
  and `git diff --check` passed. The packaged local-book schema-2 harness passed
  with unchanged source/package snapshots, safe SVG, inert malicious SVG,
  offline resources, a bound manifest, zero network requests, and verified
  cleanup.
- Candidate: the network-denied arm64 build used the locally checksum-verified
  Electron 42.1.0 archive. Unpacked audit passed with a 418,086,912-byte app
  and 175,409,638-byte ASAR. Private-snapshot and independent public-dist
  carrier audits plus independent `hdiutil verify` passed. DMG: 159,524,027
  bytes, SHA-256
  `fd5755d326706936f27de4f413112ead4e03c2987f26c1fe40544b3375963e7c`;
  ZIP: 158,722,387 bytes, SHA-256
  `25e84eb7dbdd7dd72ac195edea64b99783fd0214bdb06f0c42afef94eaa2b086`;
  receipt: 38,329 bytes, SHA-256
  `0688ff8da2cefbf24da0a93cc5f3930ae79c9672ea9dcb3bf06575c5f1e26a12`.
- Key decision: the preceding candidate is now previous evidence and the new
  bytes are the sole current local candidate. It remains unsigned and
  unnotarized; signing/Gatekeeper and real Windows/Linux runtime evidence still
  block a formal public release.
- Git commit: none; no tag, push, signing, notarization, publication, or GitHub
  Release was created. HEAD remains `e88b3107`.

### 2026-07-31 Phase 10B3 staging-journal finalization

- User goal: continue the formal-release hardening under orchestration and
  replace the local candidate after the final defensive export review.
- Completed: bounded directory enumeration now invalidates its result if the
  directory descriptor cannot be closed and continues to reject a maximum+1
  entry. Website staging records each exclusively created file and the assets
  directory synchronously before the next asynchronous yield, so early stat,
  write, cancellation, TTL, or other exceptions remain covered by exact
  identity-bound cleanup.
- Files: `packages/desktop/src/main/book/sessionManager.ts`,
  `docs/RELEASE_GATE.md`, the release-gate static test, and this log.
- Tests: focused export/Reader/release tests passed 241/241; Desktop unit passed
  80 files with 1,448 tests and one platform skip; Desktop typecheck passed;
  Muya typecheck and its 214-file/1,455-test suite passed; the production build
  and focused ESLint passed; source and packaged smoke each selected exactly
  ten tests and passed 10/10; `git diff --check` passed.
- Packaging: the arm64 app was rebuilt with Electron 42.1.0 from its locally
  checksum-verified archive under the network-denied sandbox. Unpacked audit
  passed with a 416,985,088-byte app and 175,410,566-byte ASAR. Private carrier
  and independent public-dist audits plus independent `hdiutil verify` passed.
  The packaged local-book schema-2 harness passed with unchanged source and
  package trees, safe SVG, inert malicious SVG, offline exports, bound website
  manifest, zero network requests, and verified temporary-copy cleanup.
- Candidate: DMG 159,524,354 bytes, SHA-256
  `f21caea117a0ae6f5e12214f0174c5f97ed9d3e46f9aeb498a517b7a6083c99f`;
  ZIP 158,721,122 bytes, SHA-256
  `667989e14eb892ec92ee866b3490358914fc79768da413a6c926914e543cc13c`;
  receipt 38,329 bytes, SHA-256
  `2c76e008dc7307c8f1947f5c5d03762d7d56302b48e6b3bebd44447dfe2c9d5d`.
- Key decision: the immediately preceding final-third-review bytes are retained
  only as previous evidence. This replacement is the sole current local
  candidate and remains unsigned and unnotarized; Apple signing/notarization,
  Gatekeeper download validation, and real Windows/Linux runtime evidence
  remain formal public-release blockers.
- Git commit: none; no tag, push, signing, notarization, publication, or GitHub
  Release was created. HEAD remains `e88b3107`.

### 2026-07-31 Phase 10B3 final negative-source and lease-boundary hardening

- User goal: close the final two export-review findings without committing or
  publishing, then rebuild and verify a replacement local candidate.
- Completed: every supported unique export reference now carries a source
  state. Successful resources retain their descriptor-stable positive raw
  snapshot. Missing, too-large, type-mismatched, symlinked, multiply-linked,
  or otherwise invalid resources retain an exact negative snapshot of the root
  and observed path chain, including type, identity, link count, timestamps,
  canonical path, symlink text, and bounded stable raw hash when applicable.
  Unverifiable permission or I/O states fail preparation instead of producing
  an unbound placeholder.
- Completed: async rebuilt-ledger fingerprints and final synchronous checks
  include those negative states. Missing-to-created, changed corrupt bytes,
  corrupt-to-valid, and symlink-to-regular transitions fail with the existing
  source-changed error class; an unchanged negative state remains allowed.
  HTML and website commits recheck lease time, token, owner, session, and
  generation immediately after final synchronous source/resource validation
  and before rename without an async yield. Website cancellation cleans the
  exact staged tree; replacement rollback preserves the old target.
- Files: `packages/desktop/src/main/book/exportResources.ts`,
  `packages/desktop/src/main/book/sessionManager.ts`, focused resource/Reader
  tests, `docs/RESOURCE_PIPELINE.md`, `docs/BOOK_WEBSITE.md`,
  `docs/RELEASE_GATE.md`, the release-gate static test, and this log.
- Tests: focused negative-state, export, Reader, and policy tests passed. Full
  Desktop unit passed 80 files with 1,457 tests and one platform skip. Full
  Muya passed 214 files/1,455 tests. Desktop and Muya typechecks, production
  build, lint with zero errors/134 inherited warnings, source smoke 10/10,
  packaged smoke 10/10, release-static tests, and `git diff --check` passed.
- Packaging: the arm64 app was rebuilt with Electron 42.1.0 from the locally
  checksum-verified archive inside the network-denied sandbox. Unpacked audit
  passed with a 416,403,456-byte app and 175,429,518-byte ASAR. Private carrier
  and independent public-dist audits plus independent `hdiutil verify` passed.
  The packaged local-book schema-2 harness passed with unchanged source and
  package trees, safe SVG, inert malicious SVG, offline exports, bound website
  manifest, zero network requests, and verified temporary-copy cleanup.
- Candidate: DMG 159,526,128 bytes, SHA-256
  `9edf73bad24bab7243a05b8887a0181409cb5c2fb6208110f12892f0a2be654d`;
  ZIP 158,723,947 bytes, SHA-256
  `de24a3a644e420269215bed91d3eacb663b044f689038b19dfc0eebb94a74923`;
  receipt 38,329 bytes, SHA-256
  `56a19194fee52a3791f4de81135a359247b797039beed451e84b0358de138cc8`.
- Key decision: the staging-journal-final bytes are now previous evidence.
  This replacement is the sole current local candidate and remains unsigned
  and unnotarized; Apple signing/notarization, Gatekeeper download validation,
  and real Windows/Linux runtime evidence remain public-release blockers.
- Git commit: none; no tag, push, signing, notarization, publication, or GitHub
  Release was created. HEAD remains `e88b3107`.

### 2026-07-31 Phase 10B3 physical-source budget and rollback finalization

- User goal: continue formal-release hardening under orchestration, close the
  final physical-source accounting, rollback, and error-classification review
  findings, and produce a replacement local candidate without publishing it.
- Completed: positive resources and readable invalid regular sources now share
  one 32 MiB physical-source ledger. Device/inode plus exact metadata
  deduplicates hard-link aliases, so each physical file is opened and hashed at
  most once per validation pass; directory and symlink negative states require
  no content read. Final synchronous validation uses the same proof cache.
- Completed: budget exhaustion uses the explicit `budget` error code and maps
  to too-large; I/O, unstable identity, or unverifiable proof capture uses
  `source-unverifiable` and maps to source-changed. Five distinct 8 MiB corrupt
  files fail the aggregate budget, while 2,048 aliases of one inode stay
  bounded.
- Completed: replacement rollback after target-to-backup rename is authorized
  by operation/owner/session identity, destination parent, absent target, and
  exact stage/backup identities, intentionally excluding source freshness.
  Missing-to-valid, corrupt-to-valid, and Markdown source changes abort with
  `website-source-changed`, `committed: false`, restore the prior website, and
  leave no known stage or backup.
- Files: `packages/desktop/src/main/book/exportResources.ts`,
  `packages/desktop/src/main/book/sessionManager.ts`, focused resource/Reader
  and release-static tests, `docs/RESOURCE_PIPELINE.md`,
  `docs/BOOK_WEBSITE.md`, `docs/RELEASE_GATE.md`, and this log.
- Tests: focused resource/Reader tests passed 208/208; Desktop unit passed 80
  files with 1,464 tests and one platform skip; Muya passed 214 files/1,455
  tests. Desktop and Muya typechecks, production build, lint with zero errors
  and 134 inherited warnings, source and packaged smoke 10/10, release-static
  35/35, and `git diff --check` passed. The receipt-bound packaged local-book
  schema-2 harness passed with unchanged source/package trees, safe SVG, inert
  malicious SVG, offline exports, a bound manifest, zero network requests, and
  verified temporary-copy cleanup.
- Packaging: the arm64 app was rebuilt with Electron 42.1.0 from its locally
  checksum-verified archive under the network-denied packaging policy. Unpacked
  audit passed with a 416,960,512-byte app and 175,438,674-byte ASAR. Private and
  independent public carrier audits plus independent `hdiutil verify` passed.
- Candidate: DMG 159,522,764 bytes, SHA-256
  `ed6bfc37b2fa8514d6c566b9bab307810d20e86c51fb4e53c796d71898f8ce56`;
  ZIP 158,725,144 bytes, SHA-256
  `6bc89caed789810cbf4513a4aa04dcd27bde3349aacf7a58ac801c15c3dffbb3`;
  receipt 38,329 bytes, SHA-256
  `c49e9e8e9ad42f5d474cbd468a35485b21f82195b994a1d5aecf312c536cb592`.
- Key decision: the negative-source-state-final bytes are retained only as
  previous evidence. This replacement is the sole current local candidate and
  remains unsigned and unnotarized; Apple signing/notarization, Gatekeeper
  download validation, and real Windows/Linux runtime evidence remain formal
  public-release blockers.
- Git commit: none; no tag, push, signing, notarization, publication, or GitHub
  Release was created. HEAD remains `e88b3107`.

### 2026-07-31 Phase 10B3 private Prepare draft recovery finalization

- User goal: continue formal-release hardening under orchestration by making
  Prepare-book edits crash-safe and explicitly recoverable, then rebuild and
  verify a replacement local candidate without publishing it.
- Completed: Prepare rename, order, remove, and add-back operations now use one
  main-process canonical chapter model and persist through typed, generation-
  scoped IPC. Renames are debounced and flushed before close or commit. A
  restart never restores silently: the matching book shows Restore/Discard;
  stale, invalid, or mismatched drafts can only be discarded. Closing or
  cancelling keeps a recoverable draft, explicit discard deletes it, and a
  successful SUMMARY commit deletes it only after the source, target, and
  directory durability checks complete.
- Completed: the user-data draft store uses a private 0700 directory, a random
  0600 HMAC key, HMAC-derived per-book filenames, 0600 single-link files,
  bounded schema/checksum validation, descriptor-stable no-follow reads,
  monotonic nonces, exclusive temporary files, file and directory fsync, and
  atomic rename. Corrupt, truncated, old-schema, oversized, public-mode,
  symlink, hardlink, replaced-root, and changed-source states fail closed.
  Startup cleanup is limited to exact known private temporary-file identities.
  Draft data contains only relative source structure and base identities—no
  Markdown body, absolute source path, or book name is written to public logs.
- Completed: added bilingual accessible recovery and chapter-edit controls,
  multi-book/crash/concurrency/durability/privacy tests, an eleventh packaged
  smoke scenario, and real-book harness checks for private storage and HMAC
  isolation. Updated Prepare, build, real-book, workflow, and release-gate
  documentation without rewriting historical candidate evidence.
- Files: `packages/desktop/src/main/book/preparationDraftStore.ts`, preparation
  manager/session/IPC/preload/shared types, renderer book store and Prepare UI,
  focused unit/E2E/static tests, `packages/desktop/scripts/run-real-book-svg-harness.mjs`,
  `scripts/smoke-mac-unpacked.sh`, `.github/workflows/release.yml`,
  `docs/PREPARE_BOOK.md`, `docs/BUILD.md`, `docs/REAL_BOOK_RC.md`,
  `docs/RELEASE_GATE.md`, and this log.
- Tests: lint passed with zero errors and 134 inherited warnings. Desktop unit
  passed 81 files with 1,478 tests and one platform skip; Muya passed 214
  files/1,455 tests. Desktop typecheck, production build, source smoke 11/11,
  packaged smoke 11/11, focused final tests 84/84, and `git diff --check`
  passed. Source and receipt-bound packaged schema-2 runs against a
  representative local book both passed with unchanged source/package trees, private draft
  isolation, safe SVG, inert malicious SVG, offline exports, a bound website
  manifest, zero network requests, and verified temporary-copy cleanup.
- Packaging: the arm64 app was rebuilt with Electron 42.1.0 from its locally
  checksum-verified archive under the network-denied packaging policy. Unpacked
  audit passed with a 417,521,664-byte app and 175,502,522-byte ASAR. Private and
  independent public carrier audits plus independent `hdiutil verify` passed.
- Candidate: DMG 159,541,029 bytes, SHA-256
  `29d71bd6a8f531fb44593d6d76b351ea4fa704188a04c3c866fb609230bf7227`;
  ZIP 158,738,577 bytes, SHA-256
  `202e6af585c725710387cd11da90db829bc5126d346d5c66cbb5065c3a3eeebc`;
  receipt 38,329 bytes, SHA-256
  `7142eab68de12ff6fb988242973a5a709652459f1a485e332f3768b896c565ab`.
- Key decision: the physical-source-budget-and-rollback-final bytes are
  retained only as previous evidence. This replacement is the sole current
  local candidate and remains unsigned and unnotarized; Apple signing,
  notarization, Gatekeeper download validation, and real Windows/Linux runtime
  evidence remain formal public-release blockers.
- Git commit: none; no tag, push, signing, notarization, publication, or GitHub
  Release was created. HEAD remains `e88b3107`.

### 2026-07-31 Phase 10B3 Prepare concurrency review remediation

- User goal: remediate the blocking third-review findings in Prepare draft
  debounce, recovery/discard concurrency, and nonce handling; fully reverify
  and replace the local candidate without committing or publishing.
- Completed: renderer title debounce is now an ordered map keyed by chapter ID,
  so rapid edits to different chapters cannot overwrite one another while the
  latest edit to the same chapter is coalesced. Rename batches serialize
  through one drain promise; move/remove/add-back, Create, and Close wait for
  every queued or already-running title write before continuing.
- Completed: restore and discard capture their initial generation, prepared
  object, recovery object/token, file identity, draft ID, and nonce. Every
  asynchronous boundary revalidates those bindings, and the current private
  file must exactly match the initially discovered identity plus draft ID and
  nonce. A second window's newer replacement can therefore neither be restored
  through an old token nor deleted by it. Select, close, discard, replacement,
  or lease revocation during a deferred read returns a typed stale result.
- Completed: draft operations now accept only the exact next nonce and reject
  gaps, replays, and `Number.MAX_SAFE_INTEGER`; persisted schema validation
  applies the same upper bound. Added deferred-read multi-manager regressions
  for n1/n2 replacement, restore/select, restore/close, restore/discard, and
  discard/close, plus rapid A/B rename, rename/move, and Create/Close flush.
- Documentation: `docs/PREPARE_BOOK.md` records Node's lack of directory-
  descriptor-relative `unlinkat` as a P3 same-user race boundary and the exact
  no-yield identity checks that narrow it.
- Files: `packages/desktop/src/renderer/src/store/books.ts`,
  `packages/desktop/src/main/book/preparationManager.ts`,
  `packages/desktop/src/main/book/preparationDraftStore.ts`, Prepare draft and
  renderer-store tests, `docs/PREPARE_BOOK.md`, `docs/RELEASE_GATE.md`, the
  release-gate static test, and this log.
- Tests: focused Prepare tests passed 52/52. Desktop unit passed 81 files with
  1,481 tests and one platform skip; Muya passed 214 files/1,455 tests. Lint
  passed with zero errors and 134 inherited warnings. Desktop typecheck,
  production build, source and packaged smoke 11/11, release-static tests, and
  `git diff --check` passed. Source and receipt-bound packaged schema-2 runs
  against a representative local book passed with unchanged source/package trees,
  private draft isolation, safe SVG, inert malicious SVG, offline exports, a
  bound website manifest, zero network requests, and temporary-copy cleanup.
- Packaging: the arm64 app was rebuilt with Electron 42.1.0 from its locally
  checksum-verified archive under the network-denied packaging policy. Unpacked
  audit passed with a 417,046,528-byte app and 175,516,939-byte ASAR. Private
  and independent public carrier audits plus independent `hdiutil verify`
  passed.
- Candidate: DMG 159,545,630 bytes, SHA-256
  `e0ab227ee8d61f8ede30f89f0cab26d833762e37615feba453e97626d54d8e76`;
  ZIP 158,740,540 bytes, SHA-256
  `516c79ab5b4518d3cb05c05735e05c0a9c91adf13fd29c2d24fdb049ba0b3c0b`;
  receipt 38,329 bytes, SHA-256
  `facf3be0844838f90f0b9b3d3e0f81cc6bf8ac84121f60d0ca8454a62f714925`.
- Key decision: the preparation-draft-recovery-final bytes are retained only
  as previous evidence. This replacement is the sole current local candidate
  and remains unsigned and unnotarized; Apple signing/notarization, Gatekeeper
  download validation, and real Windows/Linux runtime evidence remain formal
  public-release blockers.
- Git commit: none; no tag, push, signing, notarization, publication, or GitHub
  Release was created. HEAD remains `e88b3107`.

### 2026-07-31 Phase 10B3 Prepare flush-failure gate remediation

- User goal: fix the second quality-review P1 where a failed debounced rename
  could be silently skipped while later edits or Create/Close continued, then
  rerun every release gate and replace the local candidate without publishing.
- Completed: the renderer rename drain and flush now return explicit success.
  The ordered chapter map removes an entry only after its main-process write
  succeeds. The first failure stops the drain and preserves both the failed
  coalesced title and every later chapter entry; no later success can clear the
  original error in the same drain.
- Completed: move, remove, add-back, current-draft discard, Create, and Close
  all treat a failed rename flush as a hard gate. They send no subsequent IPC,
  keep the preparation open, retain the visible error, and leave the queue
  available for an explicit later retry. A timer firing while another Prepare
  request is busy likewise retains its rename for the next flush.
- Tests: added failure injection for two queued chapter renames with the first
  failing, retry order/nonces, rename-before-move, rename-before-remove,
  rename-before-Create, rename-before-Close, and timer/busy recovery. Focused
  Prepare tests passed 58/58. Desktop unit passed 81 files with 1,487 tests and
  one platform skip; Muya passed 214 files/1,455 tests. Lint passed with zero
  errors and 134 inherited warnings. Desktop typecheck, production build,
  source and packaged smoke 11/11, release-static tests, and `git diff --check`
  passed. Source and receipt-bound packaged schema-2 runs against the local
  representative local book passed with unchanged source/package trees, private draft
  isolation, safe SVG, inert malicious SVG, offline exports, a bound website
  manifest, zero network requests, and temporary-copy cleanup.
- Files: `packages/desktop/src/renderer/src/store/books.ts`, its Prepare store
  regression tests, `docs/PREPARE_BOOK.md`, `docs/RELEASE_GATE.md`, the
  release-gate static test, and this log.
- Packaging: the arm64 app was rebuilt with Electron 42.1.0 from its locally
  checksum-verified archive under the network-denied packaging policy. Unpacked
  audit passed with a 416,792,576-byte app and 175,522,905-byte ASAR. Private
  and independent public carrier audits plus independent `hdiutil verify`
  passed.
- Candidate: DMG 159,542,555 bytes, SHA-256
  `45a19a624f914f7d7135bc19a19833fd3f56e350083ab7127723d13f7e4e088c`;
  ZIP 158,739,320 bytes, SHA-256
  `f42dd17a240cfce1887b9ce183bbd31d0495b0f59ad2726a537fd4d3f973b7f6`;
  receipt 38,329 bytes, SHA-256
  `d3ee774d717f437b31d14476d54861b2a7d88121e98e6a5065ba9ec4009ec19b`.
- Key decision: the preparation-concurrency-final bytes are retained only as
  previous evidence. This replacement is the sole current local candidate and
  remains unsigned and unnotarized; Apple signing/notarization, Gatekeeper
  download validation, and real Windows/Linux runtime evidence remain formal
  public-release blockers.
- Git commit: none; no tag, push, signing, notarization, publication, or GitHub
  Release was created. HEAD remains `e88b3107`.

### 2026-07-31 Phase 10B3 Prepare navigation gate finalization

- User goal: complete the flush-failure remediation and ensure every caller of
  Prepare Close honors that failure before leaving the preparation workspace,
  then regenerate and verify the final local candidate without publishing.
- Completed: `closePreparation` now returns its flush result. Bookshelf, folder
  picker, library switching, refresh, edit, and editor transition callers stop
  immediately when a pending rename cannot be persisted. Picker/library flows
  clear prior messages only after a successful close, so the draft-write error
  remains visible and the preparation stays open.
- Tests: Prepare store tests passed 33/33 and the full focused Prepare suite
  remained 58/58. Desktop unit passed 81 files with 1,487 tests and one
  platform skip; Muya passed 214 files/1,455 tests. Lint passed with zero errors
  and 134 inherited warnings. Desktop typecheck, production build, source and
  packaged smoke 11/11, final release-static/focused tests, and
  `git diff --check` passed. Source and receipt-bound packaged schema-2 runs
  against a representative local book passed with unchanged source/package trees,
  private draft isolation, safe SVG, inert malicious SVG, offline exports, a
  bound website manifest, zero network requests, and temporary-copy cleanup.
- Files: `packages/desktop/src/renderer/src/store/books.ts`,
  `docs/RELEASE_GATE.md`, the release-gate static test, and this log.
- Packaging: the arm64 app was rebuilt with Electron 42.1.0 from its locally
  checksum-verified archive under the network-denied packaging policy. Unpacked
  audit passed with a 417,525,760-byte app and 175,523,472-byte ASAR. Private
  and independent public carrier audits plus independent `hdiutil verify`
  passed.
- Candidate: DMG 159,540,413 bytes, SHA-256
  `ab515a89b3dfee5ad131eeb53831f9c5ddc05ca34fb3011c646ff30aa3a6be85`;
  ZIP 158,741,044 bytes, SHA-256
  `ca2b6312a5028f6d89d71ff5d7cc9de381869b5eff395790d93306f66feb2c1f`;
  receipt 38,329 bytes, SHA-256
  `e963b51fe7102c7784e2f1c609c9b6a6b4157185aadac5c981253d71702cb4fb`.
- Key decision: the preparation-flush-failure-final bytes are retained only as
  previous evidence. This replacement is the sole current local candidate and
  remains unsigned and unnotarized; Apple signing/notarization, Gatekeeper
  download validation, and real Windows/Linux runtime evidence remain formal
  public-release blockers.
- Git commit: none; no tag, push, signing, notarization, publication, or GitHub
  Release was created. HEAD remains `e88b3107`.

### 2026-07-31 Phase 10C local release-readiness controls

- User goal: complete the locally implementable supply-chain, cross-platform
  CI-definition, signed-macOS preflight, formal documentation, and static-gate
  scope without changing the current binary candidate or triggering any remote
  release operation.
- Completed: added a deterministic SPDX 2.3 generator over the frozen LeafBook
  production closure. It found 481 package/version components, fails closed on
  unknown or disallowed transitive licenses, and binds three reviewed metadata
  exceptions to exact license-file hashes. Added a byte-sorted top-level
  SHA-256 manifest writer/verifier and a required-section release-note gate.
- Completed: release CI now gates release notes, carries the SPDX document into
  assembly, writes and immediately verifies `SHA256SUMS.txt`, and verifies it
  again after the assembled artifact is downloaded. License CI regenerates the
  SBOM twice and requires byte identity. Official actions touched by this work
  are pinned to full commit SHAs.
- Completed: added an uncalled reusable GitHub provenance/SBOM-attestation
  workflow using the documented `actions/attest` v4 permission and input model.
  Added manual Windows/Linux native build, source-smoke, and carrier-audit
  definitions; the existing stable Windows NSIS evidence blocker remains
  fail-closed. Added a separate manual macOS signing/notarization workflow with
  protected-environment credential-presence preflight, no-publish packaging,
  signature/staple/Gatekeeper checks, existing artifact audits, and packaged
  smoke. No workflow was triggered, so these definitions are not native or
  signing evidence.
- Completed: added formal install/upgrade/uninstall/data-location,
  privacy/security/known-limitations, release-note, and release-checklist docs;
  linked them from the README and release gate. New log text names required
  credential variables only and contains no credential values, manuscript
  contents, private paths, or user identifiers.
- Files: `.github/workflows/release.yml`,
  `.github/workflows/validate-licenses.yml`, the three new evidence workflows,
  `package.json`, `README.md`, `docs/RELEASE_GATE.md`, the four new formal docs,
  four new release-control scripts, the Phase 10C static test, and this log.
- Tests: touched-file Prettier check passed; targeted ESLint passed (one
  pre-existing module-type runtime warning only); all five touched workflows
  parsed as YAML; release notes passed; SPDX generation ran twice with 481
  packages and byte-identical output; macOS preflight rejected absent variables
  and accepted synthetic presence without emitting values; focused Phase 10C
  plus existing release-static tests passed 41/41; `git diff --check` passed.
- Key decision: the existing unsigned/unnotarized local package and `dist` were
  left untouched. Windows/Linux native results, signed/notarized macOS results,
  downloaded Gatekeeper validation, hosted attestations, and human approval
  remain explicit stable release blockers until real retained evidence exists.
- Git commit: none; no tag, push, signing, notarization, publication, workflow
  dispatch, or GitHub Release was created.

### 2026-07-31 Phase 10C static-test type narrowing

- User goal: clear the two TypeScript nullable-access errors in the new Phase
  10C workflow test without changing any other implementation scope.
- Completed: asserted and narrowed each attestation step's optional `with`
  inputs before indexing, then separately asserted and narrowed the second SBOM
  attestation step.
- Files: `packages/desktop/test/unit/specs/phase10c-release-readiness.spec.ts`
  and this log.
- Tests: focused Phase 10C tests passed 6/6; full desktop `pnpm typecheck`
  passed; targeted ESLint and Prettier checks passed; `git diff --check` passed.
  ESLint emitted only the pre-existing module-type performance warning.
- Key decision: retain explicit runtime assertions so malformed parsed workflow
  data fails with a precise test error while satisfying static narrowing.
- Git commit: none; no `dist`, secret, workflow, signing, notarization,
  publication, tag, push, or release operation was touched.

### 2026-07-31 Phase 10C release-gate formatting follow-up

- User goal: clear the remaining touched-file Prettier failure without changing
  release-gate meaning or historical evidence.
- Completed: applied the project Prettier formatter mechanically to
  `docs/RELEASE_GATE.md` only.
- Files: `docs/RELEASE_GATE.md` and this log.
- Tests: targeted Prettier passed; Phase 10C plus release-static tests passed
  41/41; full desktop typecheck passed; `git diff --check` passed.
- Key decision: formatting-only change; no substantive release claim changed.
- Git commit: none; no `dist`, secret, workflow, signing, notarization,
  publication, tag, push, or release operation was touched.

### 2026-07-31 Phase 10C generated license-notice gate

- User goal: retain the production `saxes` notice missing from the checked-in
  generated inventory and prove the release license gate is repeatable.
- Completed: regenerated the canonical third-party notice. The only dependency
  addition is `saxes@6.0.0 (ISC)`, with generated numbering adjustment and its
  license-checker-provided body. A second generation was byte-identical with
  SHA-256 `294739784e45cfe606179b2dee7d8d6436e287fcc2fabfce77689ba4c7d80580`.
- Files: `packages/desktop/build/THIRD-PARTY-LICENSES.txt` and this log.
- Tests: production license validation passed with 66 entries; regeneration
  plus scoped byte comparison passed; Phase 10C plus release-static tests passed
  41/41; full desktop typecheck, targeted ESLint, touched-file Prettier, and
  `git diff --check` passed. ESLint emitted only the pre-existing module-type
  performance warning.
- Key decision: retain the canonical generated change so the workflow's scoped
  post-generation diff gate will be clean once the implementation is committed;
  the current intentionally dirty working tree was verified by exact byte
  comparison rather than staging or committing.
- Git commit: none; no `dist`, secret, workflow, signing, notarization,
  publication, tag, push, or release operation was touched.

### 2026-07-31 Phase 10C evidence-boundary remediation

- User goal: remove four release-control anti-patterns covering signing-secret
  lifetime, artifact/manifest set equality, draft-time exact verification, and
  substring-only release-note validation.
- Completed: macOS signing credentials are no longer job environment values.
  Only the credential-presence preflight and signed/notarized builder step can
  receive them; checkout, source build, audits, trust checks, smoke, and upload
  cannot. A pre-checkout shell gate now requires an exact selected tag, lowercase
  40-character commit, and matching operator input without reading or printing
  credential values; package-version validation runs before repository setup.
- Completed: manual macOS and Windows/Linux workflows stage only their exact,
  versioned carrier allowlists into a newly created bounded evidence directory.
  Checksums are written and verified there, and `evidence/*` is the sole upload
  source. Missing, empty, symlinked, oversized, duplicate-destination, or
  unexpected evidence shapes fail closed.
- Completed: checksum verification now rejects every extra file, directory,
  symlink, missing subject, and byte mismatch. The assembled release carries the
  exact verifier into the read-only candidate artifact; the draft-write job runs
  it against the downloaded `dist` set before its final server-state check and
  sole draft creation command.
- Completed: release-note validation is a 128 KiB-bounded Markdown structure
  parser. It recognizes ordered anchored ATX headings only outside fenced code
  and HTML comments, requires all five sections to be nonempty, and requires nine
  exact disclosure fields. The formal notes now contain those structured values.
- Files: `.github/workflows/macos-signed-evidence.yml`,
  `.github/workflows/platform-evidence.yml`, `.github/workflows/release.yml`,
  `scripts/release-checksums.mjs`, new `scripts/stage-release-evidence.mjs`,
  `scripts/verify-release-notes.mjs`, `docs/RELEASE_NOTES.md`, the Phase 10C
  static/runtime test, and this log.
- Tests: current release notes passed with five sections and nine disclosures;
  three touched workflows parsed as YAML; Phase 10C and release-static tests
  passed 45/45, including positive/negative ref binding, secret scope, exact
  staging, missing carrier, extra file/directory, tamper, fenced/comment decoy
  headings, empty section, wrong disclosure, and oversized-note cases. Full
  desktop typecheck, targeted ESLint, targeted Prettier, and `git diff --check`
  passed. ESLint emitted only the pre-existing module-type performance warning.
- Key decision: a checksum manifest is the sole metadata exception to its own
  subject set; every other uploaded evidence file is staged before manifest
  creation and must appear exactly once in it.
- Git commit: none; no `dist`, credential value, workflow dispatch, signing,
  notarization, publication, tag, commit, push, or release operation occurred.

### 2026-07-31 Phase 10C checksum-manifest symlink hardening

- User goal: prevent checksum manifest write or verification from following a
  `SHA256SUMS.txt` symlink outside the bounded evidence directory.
- Completed: manifest names now use a bounded safe basename grammar. Both modes
  lstat and reject any non-regular or symbolic-link manifest before opening it.
  Write creates a random same-directory mode-0600 file with exclusive flags,
  writes and syncs it, rechecks the destination identity/nonexistence, atomically
  replaces the manifest, and validates the resulting regular file. Verify uses
  no-follow where available and binds pre-open, descriptor, post-read, and final
  pathname identity before accepting exact content.
- Files: `scripts/release-checksums.mjs`, the Phase 10C static/runtime test, and
  this log.
- Tests: the new negative test points the manifest at an outside file, proves
  both verify and write fail, and proves the outside bytes remain unchanged;
  static checks cover exclusive/no-follow open and atomic rename. Phase 10C plus
  release-static tests passed 46/46; three release workflows parsed as YAML;
  full desktop typecheck, targeted ESLint, targeted Prettier, and
  `git diff --check` passed. ESLint emitted only the pre-existing module-type
  performance warning.
- Key decision: an existing manifest may be replaced only when its identity is
  the same regular file observed before staging the atomic replacement; any
  disappearance, appearance, link, or identity change fails closed.
- Git commit: none; no app source, `dist`, credential, workflow dispatch,
  signing, notarization, publication, tag, commit, push, or release operation
  was touched.

### 2026-07-31 Phase 10C final evidence-code quality hardening

- User goal: bind manual platform evidence to tag-derived release state, close
  carrier staging/checksum replacement races without large reads, and prevent
  the repository-write job from executing downloaded candidate code.
- Completed: the platform workflow no longer accepts a self-reported channel.
  Before checkout it binds the selected release tag to an operator-supplied full
  commit SHA; after checkout the existing strict tag/package validator emits the
  sole prerelease value consumed by native audits and evidence naming.
- Completed: evidence staging exclusively creates a new directory and each
  destination file. Source carriers are opened no-follow and copied in 1 MiB
  descriptor chunks while hashing; source and destination descriptor/path
  identity, size, modification time, and change time are checked before and
  after. The staging hash becomes the final manifest, which is independently
  reverified before upload.
- Completed: checksum subjects are likewise hashed through no-follow file
  descriptors in bounded chunks. Every subject is rechecked after hashing and
  the directory is re-enumerated, rejecting set, identity, metadata, link, or
  byte changes without loading a carrier into memory.
- Completed: the `contents:write` job no longer downloads or runs the repository
  checksum script. Its workflow-defined inline verifier performs a bounded
  manifest read, exact subject-set check, no-follow descriptor streaming hashes,
  and identity rechecks; only then can the existing server tag check and single
  draft-write command run.
- Files: `.github/workflows/platform-evidence.yml`,
  `.github/workflows/macos-signed-evidence.yml`, `.github/workflows/release.yml`,
  `scripts/stage-release-evidence.mjs`, `scripts/release-checksums.mjs`, the
  Phase 10C static/runtime test, and this log.
- Tests: three workflows parsed as YAML; Phase 10C plus release-static tests
  passed 50/50, including platform branch/SHA rejection, tag-derived channel,
  source and subject symlink rejection, descriptor-streaming static contracts,
  and positive/extra-file negative execution of the fixed inline write-job
  verifier. Full desktop typecheck, targeted ESLint, targeted Prettier, and
  `git diff --check` passed. ESLint emitted only the pre-existing module-type
  performance warning.
- Key decision: hosted native evidence remains unavailable until a manually
  approved exact release tag run succeeds; workflow definitions and local tests
  do not satisfy that blocker.
- Git commit: none; no app source, `dist`, credential, workflow dispatch,
  signing, notarization, publication, tag, commit, push, or release operation
  was touched.

### 2026-07-31 Phase 10C final race closure

- User goal: close the remaining manifest, carrier, and directory replacement
  races in release checksum verification and staged evidence generation.
- Completed: the repository-write job's fixed inline verifier now snapshots the
  manifest before and after reading, including device, inode, size, modification
  time, and change time; carrier final comparisons include change time; and the
  subject directory is re-enumerated with directory identity and timestamp
  checks before the draft release can be written.
- Completed: evidence staging now independently rehashes every final destination
  through no-follow descriptors, checks descriptor/path metadata and directory
  stability around the final read, rejects post-hash mutation, and writes the
  destination-derived digest into `SHA256SUMS`.
- Files: `.github/workflows/release.yml`,
  `scripts/stage-release-evidence.mjs`, the Phase 10C static/runtime test, and
  this log.
- Tests: all three evidence workflows parsed as YAML; Phase 10C and release
  static tests passed 51/51, including controlled destination mutation,
  carrier-ctime mutation, and subject-set growth negatives. Full desktop
  typecheck, targeted ESLint, targeted Prettier, and `git diff --check` passed.
  ESLint emitted only the pre-existing module-type performance warning.
- Key decision: test-only hooks make the sub-second race windows deterministic;
  production CLI execution does not supply those hooks and remains bound to the
  fixed stable-read checks.
- Remaining issue: hosted native evidence still requires a manually approved
  exact release-tag run; this local hardening does not satisfy that gate.
- Git commit: none; no app source, `dist`, credential, workflow dispatch,
  signing, notarization, publication, tag, commit, push, or release operation
  was touched.

### 2026-07-31 Phase 10C release artifact-flow closure

- User goal: prevent quality-gate metadata from contaminating the exact
  13-carrier release set, and make the license workflow explicitly read-only
  with complete dependency-manifest path coverage.
- Completed: release assembly now downloads exactly five named build artifacts
  into `dist`; it no longer uses an unbounded all-artifact download or
  `merge-multiple`, so `leafbook-release-metadata` remains separate from release
  carriers and the existing asset contract remains unchanged.
- Completed: the license workflow now declares `permissions: contents: read`.
  Its pull-request and develop-push filters cover the workspace definition,
  all three package manifests read by the SBOM/license inventory, and the
  license validation scripts in addition to the lockfile and release-note gate.
- Files: `.github/workflows/release.yml`,
  `.github/workflows/validate-licenses.yml`, the Phase 10C static/integration
  test, and this log.
- Tests: four relevant workflows parsed as YAML; Phase 10C and release-static
  tests passed 53/53. The integration-style artifact-store fixture proved that
  the five explicitly selected build artifacts yield the same 13 subjects as
  the audit allowlist and checksum manifest, while SBOM/release-note metadata
  never enters `dist`; the draft command remains bound to that checked set plus
  `SHA256SUMS.txt`. Full desktop typecheck, targeted ESLint and Prettier, and
  `git diff --check` passed. ESLint emitted only the pre-existing module-type
  performance warning.
- Key decision: release metadata stays a separate evidence artifact rather than
  becoming a public release asset, preserving installation documentation and
  the exact-set audit contract.
- Remaining issue: hosted native evidence still requires a manually approved
  exact release-tag run; this local workflow correction does not satisfy that
  external gate.
- Git commit: none; no app source, `dist`, credential, workflow dispatch,
  signing, notarization, publication, tag, commit, push, or release operation
  was touched.

### 2026-07-31 Phase 10C deterministic SBOM namespace and source time

- User goal: close the final P2 by making SPDX creation time fail-closed and
  source-bound, and make the document namespace change for every normalized
  input that determines SBOM output without hashing the SBOM itself.
- Completed: the generator now requires a canonical positive in-range
  `SOURCE_DATE_EPOCH`, emits that instant as UTC SPDX `creationInfo.created`, and
  versions its creator/policy contract. The namespace uses length-framed,
  name-sorted hashing over the epoch, lockfile, workspace definition, relevant
  package manifests, generator constants, license allowlist, and hash-bound
  reviewed overrides. Duplicate/empty inputs fail closed and generated output
  is excluded from the input set.
- Completed: release, reusable supply-chain, and license-validation workflows
  derive `SOURCE_DATE_EPOCH` from the exact checked-out `GITHUB_SHA` commit
  before SBOM creation. Maintainer, security, release-gate, and formal-checklist
  documentation now records the contract and exact local command.
- Files: `scripts/generate-release-sbom.mjs`,
  `packages/desktop/test/unit/specs/phase10c-release-readiness.spec.ts`,
  `.github/workflows/release.yml`,
  `.github/workflows/supply-chain-evidence.yml`,
  `.github/workflows/validate-licenses.yml`, `docs/BUILD.md`,
  `docs/PRIVACY_SECURITY.md`, `docs/RELEASE_CHECKLIST.md`,
  `docs/RELEASE_GATE.md`, and this log.
- Tests: Phase 10C focused tests passed 21/21; combined Phase 10C plus release
  static tests passed 56/56. Tests cover byte-identical repeated output, exact
  UTC creation time, missing/malformed/zero/out-of-range epoch rejection, every
  namespace input mutation, generator constants, allowlist, overrides, and
  non-self-reference. Two real generations from the HEAD commit were
  byte-identical and contained 481 packages; the license gate passed. Full
  desktop typecheck, targeted ESLint, targeted Prettier, generator syntax,
  workflow YAML parsing, and `git diff --check` passed. ESLint emitted only the
  pre-existing module-type performance warning.
- Key decision: raw repository input bytes are normalized through sorted named
  length framing so any byte change affects the namespace, while semantic
  policy data is serialized from a versioned canonical object. Policy behavior
  changes must bump `SBOM_GENERATOR_VERSION`.
- Remaining issue: hosted native/signing/notarization/attestation evidence and
  human review remain formal-release blockers; local SBOM determinism does not
  satisfy those external gates.
- Git commit: none; no `dist`, publication, signing, notarization, workflow
  dispatch, tag, push, release, or credential operation was performed.

### 2026-07-31 Phase 10C third-review release trust-boundary closure

- User goal: close the third-review blockers in the repository-write draft job,
  formal release-note flow, SBOM attestation subject set, SBOM namespace, and
  maintainer command documentation without publishing or changing `dist`.
- Completed: the fixed inline verifier in `create-release` derives the exact 13
  carrier names from the canonical SemVer tag and requires exactly those files
  plus `SHA256SUMS.txt`. It rejects a symlink root, non-regular entries, link
  count other than one, empty or over-1-GiB subjects, malformed/self-consistent
  but wrong manifests, and identity/content changes using Python integer and
  nanosecond stat fields before, during, and after descriptor hashing.
- Completed: quality-gate metadata now contains exactly the generated SBOM,
  formal `docs/RELEASE_NOTES.md`, and a separate metadata checksum manifest.
  Assembly downloads it outside `dist`, verifies exact names, hashes, regular
  one-link files, sizes, and equality with the reviewed source notes, then
  composes only a fixed prerelease banner plus those notes and reverifies both.
  The write job independently rechecks metadata hashes and exact body bytes.
  GitHub draft creation uses that body without generated notes. Quarantine/
  Gatekeeper bypass guidance was removed.
- Completed: the public asset policy remains exactly 13 carriers plus
  `SHA256SUMS.txt`; SBOM and notes are retained evidence outside `dist`. The
  callable supply-chain workflow verifies the carrier manifest, creates a
  dedicated SBOM subject manifest containing only those 13 carriers, and uses
  it for SBOM attestation, so neither SBOM nor notes can attest themselves.
- Completed: SBOM namespace generation now canonicalizes and domain-separates
  the complete emitted SPDX payload except `documentNamespace`, including
  creation information, inventory, licenses, platform-dependent packages,
  document descriptors, and relationships. Any output mutation changes the
  namespace; source/policy changes with byte-identical normalized output do not.
- Files: `.github/workflows/release.yml`,
  `.github/workflows/supply-chain-evidence.yml`,
  `scripts/generate-release-sbom.mjs`, `README.md`, `docs/BUILD.md`,
  `docs/PRIVACY_SECURITY.md`, `docs/RELEASE_CHECKLIST.md`,
  `docs/RELEASE_GATE.md`, `packages/website/content/docs/dev/RELEASE.md`,
  `packages/desktop/test/unit/specs/phase10c-release-readiness.spec.ts`,
  `packages/desktop/test/unit/specs/release-gate-static.spec.ts`, and this log.
- Tests: focused Phase 10C passed 23/23; combined Phase 10C and release static
  passed 58/58. Runtime fixtures cover exact 13 positive verification, wrong
  tag, extra self-consistent subject, hard link, empty file, sparse over-1-GiB
  file, root symlink, ctime/set races, metadata/body mutation, metadata hard
  link, and SBOM/notes subject pollution. Three workflows parsed as YAML and
  full desktop typecheck passed. Two real HEAD-time SBOM generations were
  byte-identical with 481 packages and a recomputed matching canonical payload
  digest; license and formal release-note gates passed. Targeted ESLint,
  Prettier, generator syntax, forbidden bypass-text scan, and
  `git diff --check` passed; ESLint emitted only the pre-existing module-type
  performance warning.
- Key decision: trusted release code keeps three disjoint contracts: public
  carrier assets, formal draft notes, and SBOM evidence. A checksum manifest is
  never accepted merely because it agrees with an arbitrary downloaded set.
- Remaining issue: these are definitions and local fixtures, not retained
  hosted signing, notarization, native-platform, attestation, or human-approval
  evidence; all remain formal release blockers.
- Git commit: none; no `dist`, credential, workflow dispatch, signing,
  notarization, publication, tag, push, release, or commit operation occurred.

### 2026-07-31 Phase 10C final-snapshot upload boundary

- User goal: eliminate the post-verification mutation window in which the
  repository-write job still uploaded mutable `candidate` files, add controlled
  late-mutation coverage, and tighten release evidence size limits.
- Completed: the write job exclusively creates `final-release` and copies the
  exact manifest and 13 tag-derived carriers from no-follow source descriptors
  to exclusive destination descriptors in bounded chunks. It fsyncs each copy,
  verifies full source/destination identity and digest, rechecks every early
  source plus the manifest after all copies, checks directory identity/set, and
  makes the completed asset directory read-only.
- Completed: formal notes, metadata manifest, and SBOM are copied through the
  same descriptor-stable path into a separate snapshot evidence directory. The
  draft body is independently copied and compared with the fixed banner plus
  verified notes. All snapshot file identities/digests and three directory
  identities/entry sets are saved in an exclusive read-only sibling state file;
  snapshot files and directories are read-only defense-in-depth.
- Completed: the `gh release create` shell begins with a complete no-follow,
  bounded rehash and identity/entry-set comparison against that saved state,
  then references only `final-release/release_body.md` and
  `final-release/assets/*`. No candidate glob reaches the upload command. The
  SBOM cap is now 16 MiB; carrier caps are 512 MiB for packages/installers,
  640 MiB for ZIP/tar archives, and 768 MiB for DMGs.
- Files: `.github/workflows/release.yml`,
  `packages/desktop/test/unit/specs/phase10c-release-readiness.spec.ts`,
  `packages/desktop/test/unit/specs/release-gate-static.spec.ts`,
  `docs/PRIVACY_SECURITY.md`, `docs/RELEASE_CHECKLIST.md`,
  `docs/RELEASE_GATE.md`, and this log.
- Tests: focused Phase 10C passed 23/23 and combined Phase 10C/release-static
  passed 58/58. Controlled tests reject late same-size carrier and manifest
  rewrites, preserve snapshot bytes after a post-verification candidate-body
  rewrite, reject a forced snapshot-body mutation during the immediate final
  rehash, enforce the 16-MiB sparse SBOM negative, and verify upload arguments
  contain only final-snapshot paths. Three workflows parsed as YAML; full
  desktop typecheck, targeted ESLint and Prettier, generator syntax, fixture
  execution, and `git diff --check` passed. ESLint emitted only the pre-existing
  module-type performance warning.
- Key decision: snapshot creation removes mutable candidate paths from the
  upload set and the same-shell rehash minimizes the remaining boundary. The
  unavoidable interval between the final check and `gh` opening pathname-based
  inputs remains a documented same-user P3 because `gh` exposes no
  descriptor-based atomic upload API.
- Remaining issue: hosted/native/signing/notarization/attestation evidence and
  human approval remain release blockers independent of this local boundary.
- Git commit: none; no `dist`, credential, workflow dispatch, signing,
  notarization, publication, tag, push, release, or commit operation occurred.

### 2026-07-31 Phase 10C trusted snapshot-state root

- User goal: prevent an attacker or late mutation from replacing both the final
  snapshot and its self-consistent local state, and require independent final
  verification of carrier, metadata, and draft-body truth before the write.
- Completed: the final-snapshot step now binds state schema, exact tag,
  `GITHUB_SHA`, and a 256-bit random nonce. After exclusive state creation it
  performs a no-follow, bounded, identity-stable state read and emits the
  resulting SHA-256 through `GITHUB_OUTPUT` as `state_sha256`.
- Completed: the `gh release create` step injects only that trusted step output
  as `EXPECTED_STATE_SHA256`. Before parsing state, its fixed inline verifier
  hashes the exact bytes and uses `hmac.compare_digest`; a replacement state
  cannot select its own root digest. State binding to tag/commit/nonce is then
  rechecked.
- Completed: the final verifier no longer relies on state alone. It independently
  parses `assets/SHA256SUMS.txt` as the exact 13 tag-derived names and compares
  every recomputed asset digest; parses the metadata manifest as exactly notes
  plus SBOM and compares both recomputed digests; and reconstructs the exact
  fixed prerelease banner plus formal notes for the selected channel. Only then
  does it cross-check saved file/directory identities, digests, and entry sets.
- Completed: source and final-snapshot checks reject files of at least 1 MiB
  whose allocated blocks are less than half their logical size, covering
  significant sparse carrier/SBOM inputs in addition to format size bounds.
- Files: `.github/workflows/release.yml`,
  `packages/desktop/test/unit/specs/phase10c-release-readiness.spec.ts`,
  `docs/PRIVACY_SECURITY.md`, `docs/RELEASE_CHECKLIST.md`,
  `docs/RELEASE_GATE.md`, and this log.
- Tests: focused Phase 10C passed 23/23 and combined Phase 10C/release-static
  passed 58/58. A second fully valid snapshot/state is generated with a distinct
  nonce and digest: it passes with its own output digest but fails with the
  original trusted step digest, proving a self-consistent whole-set replacement
  cannot cross the root. Existing manifest/carrier/body races remain covered;
  within-limit sparse carrier/SBOM fixtures are rejected when the filesystem
  reports sparse allocation. Three workflows parsed as YAML; full desktop
  typecheck, targeted ESLint and Prettier, generator syntax, fixture execution,
  and `git diff --check` passed. ESLint emitted only the pre-existing module-type
  performance warning.
- Key decision: the GitHub step-output digest is the trust root; local state is
  evidence to verify, not authority to redefine what is trusted. The same-shell
  final-check-to-`gh` pathname-open micro-window remains the documented P3.
- Remaining issue: hosted/native/signing/notarization/attestation evidence and
  human approval remain separate release blockers.
- Git commit: none; no `dist`, credential, workflow dispatch, signing,
  notarization, publication, tag, push, release, or commit operation occurred.

### 2026-07-31 Phase 10C final publication ordering and signed macOS contract

- User goal: clear the final quality findings by correcting the stale LeafBook
  brand test and moving the last server preflight into the only release-create
  shell after the trusted snapshot verifier.
- Completed: the brand contract now requires the protected macOS evidence
  workflow—not the unsigned tag workflow—to install the signed DMG at
  `/Applications/LeafBook.app`, verify its signature, stapled ticket, and
  Gatekeeper assessment, launch it, and observe the installed process. The
  release workflow and its test reject the old `xattr -cr` bypass.
- Completed: fixed inline GitHub API logic for recursively peeling the server
  tag to `GITHUB_SHA` and confirming release absence now runs in the same shell
  after the final Python snapshot verifier and immediately before the sole
  `gh release create`. Candidate code is never executed. Static tests assert
  this exact verifier → server preflight → repository-write ordering.
- Files: `.github/workflows/release.yml`,
  `.github/workflows/macos-signed-evidence.yml`,
  `packages/desktop/test/unit/specs/leafbook-brand-foundation.spec.ts`,
  `packages/desktop/test/unit/specs/release-gate-static.spec.ts`,
  `packages/desktop/test/unit/specs/phase10c-release-readiness.spec.ts`,
  `docs/PRIVACY_SECURITY.md`, `docs/RELEASE_CHECKLIST.md`,
  `docs/RELEASE_GATE.md`, and this log.
- Tests: full desktop unit suite passed with 82 files and 1510 passed/1 skipped;
  the three focused release/brand files passed 72/72. Four workflow files parsed
  as YAML. Full desktop typecheck, targeted ESLint, and targeted Prettier passed;
  ESLint emitted only the pre-existing module-type performance warning.
- Key decision: the remote preflight is trusted fixed workflow text and shares
  the `gh` shell so no separate-step code can run between it and release
  creation. Protected tags remain required for the remote API check/create
  micro-window; the independent same-UID final-file-check/pathname-open P3 also
  remains documented.
- Remaining issue: hosted native/signing/notarization/attestation evidence and
  human approval are still release blockers; the macOS workflow definition is
  not evidence that a hosted run occurred.
- Git commit: none; no `dist`, credential, workflow dispatch, signing,
  notarization, publication, tag, push, release, or commit operation occurred.

### 2026-07-31 Phase 10D Windows/Linux native evidence and exact-16 release contract

- User goal: replace incomplete Windows/Linux definitions with fail-closed
  signed/native evidence, remove Snap, bind evidence to exact bytes, and require
  successful receipts before release attestation or draft creation.
- Completed: the release contract is exactly 16 carriers. Linux x64 and arm64
  each produce architecture-qualified AppImage, deb, rpm, and tar.gz; Windows
  and macOS retain two carriers per architecture. Snap is absent from builder,
  upload, staging, checksum, SBOM, final snapshot, audit, test, and docs.
- Completed: only the protected `windows-signing` build job receives step-scoped
  `WIN_CSC_LINK`/`WIN_CSC_PASSWORD`, and it stays `--publish never`. Separate
  fresh x64/arm64 jobs verify the same bytes, Authenticode signer, silent
  default-No associations/protocols, launch, shortcuts, uninstall, and residue.
- Completed: Linux builds once per native Ubuntu 24.04 x64/arm64 runner. Fresh
  jobs exercise AppImage, real tar extract/run/remove, and deb install/MIME/
  launch/purge. RPM uses real `dnf install`, Xvfb smoke, and `dnf remove` in
  Fedora 42 pinned to multiarch digest
  `sha256:99e203b80b1c3d8f7e161ec10a68fd02b081ef83a3963553e513c82846b97814`;
  the receipt records the resolved image ID. No `rpm --nodeps` success path exists.
- Completed: fixed `leafbook-native-evidence-v1` receipts bind tag, commit,
  platform, architecture, runner/image, exact carrier names/sizes/SHA-256,
  signature and complete lifecycle results. Extra/unsafe/changed files, failed
  phases, and a wrong Fedora digest fail closed.
- Completed: release assembly downloads the same candidates and receipts,
  rebinds them to tag/SHA/platform/architecture, recomputes hashes, and copies
  only verified bytes into the exact-16 set. Provenance/SBOM attestation covers
  that assembly, and draft creation depends on every evidence job.
- Files: `.github/workflows/{build,release,platform-evidence,windows-signed-evidence,supply-chain-evidence}.yml`,
  root/Desktop package files and builder config, three platform staging/audit
  scripts, new `scripts/native-evidence-receipt.mjs`, new
  `scripts/verify-windows-authenticode.ps1`, three release/native test files,
  release/build/install/privacy docs, website release docs, and this log.
- Tests: five workflows passed strict YAML and extracted Bash syntax; audit
  scripts passed `bash -n`; focused suites passed 64/64; full Desktop unit passed
  83 files, 1516 passed and 1 skipped; typecheck and full ESLint passed. Metadata,
  Windows association, release-note, Prettier, and `git diff --check` gates passed.
- Key decisions: a carrier is releasable only when receipt production and final
  assembly use the same artifact bytes. Partial reports, RPM extraction, or
  build-only success do not satisfy the gate. Signing secrets never enter fresh
  validation, and dependency setup receives no `GITHUB_TOKEN`.
- Remaining issues: no workflow was dispatched locally. Protected environments,
  signing inputs/public thumbprint, native runners, retained attestations,
  signed/notarized macOS evidence, tag protection, and human review remain
  external prerequisites. `pwsh` is unavailable, so its verifier was not run here.
- Application source and `dist`: untouched by Phase 10D; no desktop main,
  preload, renderer, Muya, application binary, or `dist` file changed.
- Git commit: none; no push, dispatch, publication, signing, tag, release,
  secret read, or `dist` mutation occurred.

### 2026-07-31 Phase 10D independent-verification corrections

- User goal: correct every issue found by independent Phase 10D verification
  before treating the Windows/Linux native evidence work as complete.
- Correction to the preceding Phase 10D entry: its completion and test claims
  described the pre-review implementation. Independent verification found that
  dependency setup still exposed `GITHUB_TOKEN`, Linux collapsed three native
  lifecycles into a misleading final-runner receipt, two Peter Evans actions
  used mutable tags, the new static test had an ESLint error, and the reusable
  release call inherited all secrets. Those defects are fixed by this entry;
  the authoritative receipt schema is `leafbook-native-evidence-v2`, not v1.
- Completed: the composite dependency action now runs the frozen, ignore-scripts
  install without any token environment. Static coverage parses and expands the
  local action rather than trusting only the calling workflows.
- Completed: portable/tar, deb, and RPM validation now emit three strict,
  non-overlapping lifecycle reports only after their actual commands succeed.
  Each report binds tag, commit, architecture, exact carrier hashes, the actual
  hosted runner identity/image, and install/smoke/uninstall/residue success.
  Portable/deb host-image fields must match their runner fields. RPM additionally
  binds the fixed reviewed Fedora digest and resolved `sha256:` image ID. Final
  Linux aggregation accepts exactly one report of each category and no fabricated
  aggregate runner. Release verification rehashes those same carrier bytes.
- Completed: `peter-evans/find-comment` and
  `peter-evans/create-or-update-comment` are pinned to official 40-character
  commit SHAs verified with `git ls-remote`. The reusable Windows call explicitly
  passes only `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD`, and its `workflow_call`
  contract uses those exact names; `secrets: inherit` is absent.
- Files: `.github/actions/setup/action.yml`,
  `.github/workflows/{build,release,platform-evidence,windows-signed-evidence}.yml`,
  `scripts/native-evidence-receipt.mjs`,
  `packages/desktop/test/unit/specs/phase10d-native-evidence.spec.ts`,
  `docs/{BUILD,RELEASE_GATE}.md`, and this log.
- Tests: focused Phase 10C/10D/release suites passed 65/65. Full Desktop unit
  passed 83 files with 1517 passed and 1 skipped. Typecheck passed. Full ESLint
  passed with 0 errors and 134 pre-existing warnings. Metadata, Windows
  association, and release-note gates passed. Six workflow/action YAML files
  passed strict parsing and 55 extracted Bash blocks passed `bash -n`.
- Key decision: a lifecycle report is evidence for only the carrier class and
  runner that produced it. A final aggregation runner cannot stand in for an
  earlier validation runner, and an RPM report cannot be substituted by a
  portable/deb report.
- Remaining issues: no hosted workflow was dispatched, so native runner,
  signing, notarization, attestation, protected-environment, and human-review
  evidence remain external release prerequisites. `pwsh` is unavailable locally,
  so the PowerShell verifier was not executed here.
- Application source and `dist`: untouched by this correction. No product source,
  generated application binary, credential, secret, tag, release, dispatch,
  publication, push, or `dist` file was read or changed.
- Git commit: none.

### 2026-07-31 Hosted PR validation and portability fixes

- User goal: continue the LeafBook release process after redaction, commit, and push; validate the pushed branch through GitHub Actions.
- Completed: created Draft PR #1, pushed cross-platform portability fixes, repaired SBOM inventory handling, and isolated CI dependency stores from stale cache indexes.
- Files: `.github/actions/setup/action.yml`, `.github/workflows/validate-licenses.yml`, release scripts, desktop export logic, Muya image utility, and related release tests.
- Tests: local targeted portability/release suites passed; hosted checks passed for licenses/SBOM, lint, Muya, website validation, and desktop unit tests in completed runs.
- Key decision: retain no-secret installs and do not publish until all hosted platform builds and E2E jobs are green.
- Remaining issues: final platform/E2E validation and the pnpm git-hosted `file-icons` license-index behavior remain before release tagging.
- Git commits pushed: `057d213b`, `a3dc89c0`, `81f15de7`, `fb75f9a0`, `b105e89c`, `0177b634`, `7bcf21ab`, `8244dd0e`, `d7a48a4b`, `a51eba1d`, `00fb7d45`, `453cda42`.

### 2026-07-31 Phase 10D anti-pattern audit remediation

- User goal: close the remaining release-evidence anti-patterns so a formal
  draft can consume only signed/notarized macOS carriers, actual hosted runner
  identities, and per-stage lifecycle observations.
- Completed: `.github/workflows/macos-signed-evidence.yml` now supports manual
  and reusable single-architecture invocation. Its protected `macos-signing`
  job receives exactly five explicit Apple secrets, builds/signs/notarizes with
  `--publish never`, and uploads exact carrier bytes without installing,
  validating, or launching the candidate. A separate fresh job receives no
  signing secret, downloads the same bytes, performs `codesign`, stapler and
  Gatekeeper checks, carrier/tree audits, packaged smoke, DMG installation into
  `/Applications`, launch observation, cleanup, and strict receipt generation.
- Completed: the tag release calls the macOS workflow separately for x64 and
  arm64 with only those five secrets. Assembly downloads both signed candidates
  and both receipts, rebinds schema/tag/commit/architecture and recomputes the
  exact carrier hashes before copying mac4. The ordinary unsigned macOS job was
  removed from the tag workflow entirely; ordinary regression builds remain in
  the separate PR workflow and contribute no release carrier bytes.
- Completed: Windows environment evidence now uses actual `ImageOS`,
  `ImageVersion`, runner label/OS/architecture and rejects spoofed host bindings.
  Its install, association, shortcut, smoke, uninstall, and residue observations
  are written immediately after the corresponding checks and then aggregated.
- Completed: Linux portable, deb, and RPM lifecycles now consist of four actual
  stage observations written after install, smoke, uninstall, and residue
  commands/checks. RPM uses one persistent pinned-Fedora container so each
  observation follows its real `dnf`/Xvfb/removal action. Missing, duplicate,
  failed, carrier-inconsistent, or runner/image-inconsistent stages fail closed.
- Completed: added timeouts to both macOS jobs and `validate-licenses`; removed
  the macOS postinstall token; corrected the stale release-draft comment and
  updated release/build/checklist documentation.
- Files: `.github/workflows/{release,macos-signed-evidence,platform-evidence,windows-signed-evidence,validate-licenses}.yml`,
  `scripts/{native-evidence-receipt,macos-native-evidence}.mjs`,
  `packages/desktop/test/unit/specs/{phase10c-release-readiness,phase10d-native-evidence,release-gate-static}.spec.ts`,
  `docs/{BUILD,RELEASE_GATE,RELEASE_CHECKLIST}.md`,
  `packages/website/content/docs/dev/RELEASE.md`, and this log.
- Tests: focused release/native/brand suites passed 82/82. Full Desktop unit
  passed 83 files with 1520 passed and 1 skipped. Full Muya unit passed 214 files
  and 1455 tests; root/Desktop and Muya typechecks passed. Full ESLint passed
  with 0 errors and 134 pre-existing warnings. Metadata, Windows association,
  and release-note gates passed. Eight workflow/action YAML files passed strict
  parsing and 83 extracted Bash blocks passed `bash -n`.
- Key decision: signing jobs may produce carrier bytes but may not execute them;
  only fresh no-secret jobs may create runtime evidence. A stage is accepted only
  through its separately materialized observation, never from a final hardcoded
  all-true object.
- Remaining issues: no hosted workflow was dispatched. Apple/Windows signing,
  notarization, native runner, attestation, protected-environment, tag-protection,
  and human-review evidence remain external prerequisites. `pwsh` and
  `actionlint` are unavailable locally, so PowerShell execution and actionlint
  validation were not performed.
- Application source and `dist`: untouched by this remediation. No product
  source, generated application binary, credential, secret, tag, release,
  dispatch, publication, push, or `dist` file was read or changed.
- Git commit: none.

### 2026-07-31 Phase 10D release-documentation correction

- User goal: correct the two stale release-documentation contracts found by
  final independent verification without changing application code or release
  state.
- Completed: the website release guide now describes the reusable protected
  signed/notarized macOS workflow, fresh no-secret validation, receipt-bound
  macOS 4 + Windows 4 + Linux 8 assembly, exact-16 attestation, and draft-only
  repository write. It distinguishes unsigned local development builds from
  formal release carriers.
- Completed: formal release notes now state that signed/notarized macOS and
  complete Windows/Linux native receipts are prerequisites for any draft. They
  also state that checked-in definitions and local tests are not retained
  hosted evidence, and that publication remains blocked until the hosted run,
  receipts, attestations, logs, and approvals receive human review.
- Completed: the release-note validator and focused unit contract require the
  corrected fields and reject regression to the removed six-job/six-artifact
  description.
- Files: `packages/website/content/docs/dev/RELEASE.md`,
  `docs/RELEASE_NOTES.md`, `scripts/verify-release-notes.mjs`,
  `packages/desktop/test/unit/specs/phase10c-release-readiness.spec.ts`, and this
  log.
- Tests: release-note gate, focused release/native tests, Prettier, and
  `git diff --check` were run after the correction.
- Key decision: successful native evidence is required before draft creation,
  but a draft and its producing workflow still require retained human review
  before public publication.
- Remaining issues: hosted signing, notarization, native runners, attestations,
  environment/tag protection, and publication review remain external evidence;
  no workflow was dispatched locally.
- Application source and `dist`: untouched. No credential, secret, tag,
  release, dispatch, publication, push, or `dist` operation occurred.
- Git commit: none.

### 2026-07-31 Phase 10D GitHub Environment signing-secret correction

- User goal: make the protected GitHub Environments the sole source of Windows
  and macOS signing secrets for both manual dispatch and reusable-workflow
  invocation, without publishing or reading credentials.
- Completed: removed all required signing-secret declarations from the Windows
  and macOS `workflow_call` contracts and removed every signing-secret mapping
  from the three release caller jobs. The protected `windows-signing` and
  `macos-signing` jobs still resolve Environment secrets directly and expose
  them only to the intended signing preflight/build steps; fresh validation
  jobs remain secret-free.
- Completed: strengthened static contracts to require zero reusable-workflow
  signing-secret declarations, zero release-caller mappings, exact protected-job
  secret-reference locations and counts, and no secret references in fresh
  validation. Release documentation now requires Environment-level rather than
  repository-level secrets and explains that callers cannot pass Environment
  secrets into reusable workflows.
- Files: `.github/workflows/{release,windows-signed-evidence,macos-signed-evidence}.yml`,
  `packages/desktop/test/unit/specs/{phase10c-release-readiness,phase10d-native-evidence}.spec.ts`,
  `docs/{BUILD,RELEASE_GATE,RELEASE_CHECKLIST}.md`,
  `packages/website/content/docs/dev/RELEASE.md`, and this log.
- Tests: focused release/native/brand suites passed 82/82; full Desktop unit
  passed 83 files with 1520 passed and 1 skipped. Eight workflow/action YAML
  files passed strict parsing and 97 extracted Bash blocks passed `bash -n`.
  Root/Desktop and Muya typechecks passed. Full ESLint passed with 0 errors and
  134 pre-existing warnings. Metadata, Windows association, release-note, and
  license gates passed; targeted Prettier and `git diff --check` passed.
- Key decision: signing credentials exist only as secrets on the protected
  `windows-signing` and `macos-signing` GitHub Environments. A reusable workflow
  caller cannot forward those Environment secrets; the called job must declare
  its Environment and read its secrets directly.
- Remaining issues: no hosted workflow was dispatched. Environment approvals,
  actual certificate provisioning, signing/notarization, retained native
  receipts, attestations, tag protection, and human publication review remain
  external prerequisites.
- Application source and `dist`: untouched. No secret value, credential, tag,
  release, dispatch, publication, push, or `dist` file was read or changed.
- Git commit: none.

### 2026-07-31 Phase 10D dependency-setup token hardening

- User goal: close the final P3 repository-token exposure in protected native
  dependency setup without changing application code or release state.
- Completed: the shared dependency-setup composite now explicitly passes an
  empty `token` input to pinned `actions/setup-node`, preventing its default
  `${{ github.token }}` input from being used while Node and the pnpm cache are
  prepared.
- Completed: the native-evidence static contract now requires every
  `actions/setup-node` step in the composite to set an empty token, forbids both
  `github.token` and `GITHUB_TOKEN` in that action definition, and preserves the
  exact frozen `pnpm install --frozen-lockfile --ignore-scripts` assertion.
- Files: `.github/actions/setup/action.yml`,
  `packages/desktop/test/unit/specs/phase10d-native-evidence.spec.ts`, and this
  log.
- Tests: focused release/native/static tests passed 68/68; strict YAML parsing,
  root TypeScript typecheck, full ESLint, targeted Prettier, and
  `git diff --check` were run after the correction.
- Key decision: keep checkout credentials disabled and also override
  `setup-node`'s otherwise implicit read-only repository token, so dependency
  preparation has neither a persisted checkout credential nor an action input
  token.
- Remaining issues: hosted Environment approvals, signing/notarization,
  retained native receipts and attestations, protected tags, and human release
  review remain external prerequisites. Full ESLint retains 134 existing
  warnings and zero errors.
- Application source and `dist`: untouched. No credential, secret, tag,
  release, dispatch, publication, push, or `dist` operation occurred.
- Git commit: none.

### 2026-07-31 Phase 10D draft-release Environment governance

- User goal: require an independently protected GitHub Environment before the
  repository's sole release-write job may create a draft, without changing
  application code, release artifacts, credentials, or external release state.
- Completed: assigned the unique `contents: write` `create-release` job to the
  job-level `release` Environment. The static contract now requires that exact
  job/environment pairing while preserving the protected `windows-signing` and
  `macos-signing` job contracts and forbidding any additional release write job.
- Completed: documented that `release` requires one or more required reviewers,
  **Prevent self-review**, and a deployment policy limited to selected `v*`
  tags with branch deployments denied. Creating an Environment without every
  protection rule is explicitly not accepted and blocks formal release.
- Files: `.github/workflows/release.yml`,
  `packages/desktop/test/unit/specs/release-gate-static.spec.ts`,
  `packages/desktop/test/unit/specs/phase10c-release-readiness.spec.ts`,
  `packages/desktop/test/unit/specs/phase10d-native-evidence.spec.ts`,
  `docs/RELEASE_GATE.md`, `docs/RELEASE_CHECKLIST.md`, and this log.
- Tests: focused release/native/static suites passed 68/68; full Desktop unit
  passed 83 files with 1520 passed and 1 skipped. Eight workflow/action YAML
  files passed strict parsing and 97 extracted Bash blocks passed `bash -n`.
  Root/Desktop typecheck, targeted ESLint, targeted Prettier, and
  `git diff --check` passed.
- Key decision: Environment naming in YAML is only the attachment point;
  reviewer, self-review, and deployment-policy settings are external
  repository governance and remain mandatory fail-closed prerequisites.
- Remaining issues: repository administrators must create and configure the
  three protected Environments and tag rules, then retain hosted signing,
  notarization, native receipt, attestation, approval, and draft evidence.
- Application source and `dist`: untouched. No secret value, credential, tag,
  release, dispatch, publication, push, commit, or `dist` operation occurred.
- Git commit: none.

### 2026-07-31 Phase 10D independent release-reviewer wording

- User goal: make the protected `release` Environment governance contract
  explicitly require an independent human reviewer, without changing code,
  artifacts, credentials, or release state.
- Completed: `RELEASE_GATE.md` and `RELEASE_CHECKLIST.md` now require at least
  one independent required reviewer in addition to **Prevent self-review** and
  the selected-`v*`-tag-only deployment policy.
- Completed: the release-readiness static documentation contract now rejects
  wording that omits the explicit independent-reviewer requirement.
- Files: `docs/RELEASE_GATE.md`, `docs/RELEASE_CHECKLIST.md`,
  `packages/desktop/test/unit/specs/phase10c-release-readiness.spec.ts`, and
  this log.
- Tests: focused release/native/static suites, strict YAML parsing, targeted
  Prettier, and `git diff --check` were run after the wording correction.
- Key decision: retain **Prevent self-review** as an executable repository
  setting while stating reviewer independence directly, rather than relying on
  readers to infer it from that setting.
- Remaining issues: repository administrators must configure the protected
  Environments and tag rules, then retain hosted signing, notarization, native
  receipt, attestation, approval, and draft evidence.
- Application source and `dist`: untouched. No secret, credential, tag,
  release, dispatch, publication, push, commit, or `dist` operation occurred.
- Git commit: none.

### 2026-07-31 Phase 10D release-Environment policy test hardening

- User goal: make the static release-readiness contract reject governance
  wording that no longer limits the `release` Environment to selected `v*`
  tags or that permits branch deployments.
- Completed: both `RELEASE_CHECKLIST.md` and `RELEASE_GATE.md` are now matched
  against the complete selected-tag and branch-denial phrase, with whitespace-
  tolerant assertions that remain stable across Markdown wrapping.
- Files: `packages/desktop/test/unit/specs/phase10c-release-readiness.spec.ts`
  and this log.
- Tests: focused release/native/static suites passed 68/68; strict workflow and
  action YAML parsing, targeted Prettier, and `git diff --check` were run after
  the assertion hardening.
- Key decision: keep the exact external governance semantics executable in the
  documentation contract even though GitHub Environment settings themselves
  remain repository configuration outside the workflow YAML.
- Remaining issues: administrators must still configure and retain evidence of
  the protected Environment reviewer, self-review, selected-tag, and branch-
  denial settings before formal release.
- Application source and `dist`: untouched. No secret, credential, tag,
  release, dispatch, publication, push, commit, or `dist` operation occurred.
- Git commit: none.

### 2026-07-31 Phase 10D personal-project release Environment correction

- User goal: synchronize the formal release governance contract with the actual
  personal-project GitHub Environment configuration without changing workflows,
  application code, artifacts, credentials, or external release state.
- Completed: the authoritative release gate and checklist now require
  `Jacquesxu666` as a required reviewer on `windows-signing`, `macos-signing`,
  and `release`. The `release` Environment explicitly uses personal-project
  owner approval with **Prevent self-review** disabled
  (`prevent_self_review=false`), while selected tags matching `v*` remain the
  only allowed deployment path and branch deployment remains denied.
- Completed: retained the stronger separation-of-duties posture as an explicit
  future recommendation: if the project becomes multi-person, enable **Prevent
  self-review** and require at least one independent reviewer before another
  formal release.
- Correction: the preceding Phase 10D Environment-governance entries remain
  historical records, but their claim that independent review and enabled
  **Prevent self-review** describe the current required configuration is
  superseded by this entry and the current `RELEASE_GATE.md` /
  `RELEASE_CHECKLIST.md` contract.
- Files: `docs/RELEASE_GATE.md`, `docs/RELEASE_CHECKLIST.md`,
  `packages/desktop/test/unit/specs/phase10c-release-readiness.spec.ts`, and this
  log.
- Tests: focused release/native/static suites passed 68/68; full Desktop unit
  passed 83 files with 1520 passed and 1 skipped. Targeted Prettier and
  `git diff --check` were run after the correction.
- Key decision: a required reviewer remains a mandatory deployment gate for all
  three Environments, but owner approval is intentional for the current
  single-owner project. Reviewer independence becomes mandatory only when the
  project moves to a multi-person governance model.
- Remaining issues: hosted Environment approvals, signing/notarization,
  retained native receipts and attestations, protected tags, and human draft
  review remain external prerequisites.
- Application source and `dist`: untouched. No secret value, credential, tag,
  release, dispatch, publication, push, commit, or `dist` operation occurred.
- Git commit: none.

### 2026-07-31 LeafBook brand migration

- User goal: retire the inherited `marktext` project identity and make the
  personal project consistently publish as LeafBook.
- Completed: renamed the GitHub repository from `Jacquesxu666/marktext` to
  `Jacquesxu666/leafbook`, updated the local `origin`, and kept `upstream`
  pointed at the original MarkText repository.
- Completed: changed project-owned package metadata, public URLs, issue and
  discussion templates, website download links, Linux AppStream metadata,
  archive metadata, SBOM namespace, and release tests to `leafbook`.
- Preserved: MarkText attribution, license notices, upstream URLs, and
  `@marktext/*`/Muya identifiers that belong to inherited source or third-party
  compatibility rather than LeafBook branding.
- Files: project manifests, desktop branding metadata, website links, GitHub
  templates, release scripts/tests, `CLAUDE.md`, `.vscode/settings.json`, and
  this log.
- Tests: targeted LeafBook branding, Phase 10C release-readiness, and static
  release-gate suites passed (72/72).
- Key decision: use the lowercase GitHub slug `leafbook`; GitHub's old URL is
  retained by redirect, while all new project-owned links use the new slug.
- Remaining issues: inherited localized MarkText documentation still contains
  upstream branding and should only be replaced when LeafBook-specific manuals
  are ready.
- Git commit: pending.

#### Hosted CI follow-up

- Completed: updated the native-evidence regression test to validate the
  dedicated pnpm-store configuration step introduced to make setup-node cache
  finalization reliable on hosted runners.
- Files: `packages/desktop/test/unit/specs/phase10d-native-evidence.spec.ts` and
  this log.
- Tests: focused native-evidence suite passed 10/10; targeted Prettier and
  `git diff --check` passed.
- Remaining issues: the refreshed hosted run must finish successfully before
  the release branch can advance to tagging.
- Git commit: pending.

#### LeafBook 1.0.0 release candidate metadata

- Completed: promoted the Desktop package, formal release notes, and Linux
  AppStream release entry from `0.1.0` to the stable `1.0.0` candidate.
- Files: `packages/desktop/package.json`, `docs/RELEASE_NOTES.md`,
  `packages/desktop/build/linux/leafbook.appdata.xml`, the GitHub issue and
  discussion templates, and this log.
- Tests: stable `v1.0.0` tag validation, release-notes validation, and LeafBook
  generated-metadata validation passed; focused release-readiness, native-
  evidence, and static release-gate suites passed 68/68; targeted Prettier and
  `git diff --check` passed.
- Key decision: keep the release notes' fail-closed disclosures until hosted
  signing, notarization, native evidence, and human publication approval have
  actually completed.
- Remaining issues: the `v1.0.0` tag must not be created until the candidate
  commit passes CI and the protected signing environments contain their real
  credentials.
- Git commit: pending.

### 2026-07-31 LeafBook 1.0 release blocker remediation

- User goal: clear every CI failure and continue through the formal LeafBook
  1.0 release workflow.
- Completed: aligned PlantUML, remote-image, and auto-pair E2E coverage with
  LeafBook's offline renderer policy; made icon verification resilient to
  macOS tool metadata differences; and removed the unstable git-hosted
  `file-icons` tarball from the production dependency graph.
- Completed: added a private MIT `file-icons` compatibility workspace because
  `@marktext/file-icons` ships all runtime JS, CSS, and fonts prebuilt and uses
  the replaced package only during its own upstream build.
- Files: CI setup/license workflows, E2E tests, icon verification, root package
  metadata and lockfile, SBOM generator, `packages/file-icons-compat`, and this
  log.
- Tests: license validation passed; deterministic SPDX generation produced 471
  packages twice with byte-identical output; focused release tests passed
  58/58; lint passed with 0 errors; Desktop typecheck passed; full Desktop unit
  suite passed 1520 with 1 skipped.
- Key decision: eliminate the non-reproducible production tarball rather than
  continue mutating pnpm's runner cache or weakening the SBOM gate.
- Remaining issues: hosted CI must validate the new dependency graph. Formal
  macOS/Windows publication still requires protected-Environment signing
  credentials, native receipts, approval, and release evidence.
- Git commit: pending.
