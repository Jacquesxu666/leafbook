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
