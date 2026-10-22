# 模型用量与成本核算（第一阶段）独立验收报告

- 验收人：auditor-usage-phase1（独立验收官实例）
- 验收日期：2026-10-22
- 验收对象：version-planning-tool 仓库 `feat/usage-ledger-contract` 分支，实现提交链 `4ed28ce → 5c8cb4c → 92a3f60 → 2f25127`
- 验收依据：`docs/模型用量数据契约.md`（v1.1）、`docs/成本核算规则.md`（v1）及契约 §14 测试矩阵（T01–T15）

---

## 1. 总体裁决

**PASS**

Summary：四项门禁（typecheck / lint / test / build）全部复跑通过（115 例测试全绿，退出码均 0）；T01–T15 逐项独立取证成立，测试断言语义真正覆盖契约要求（未见"测试绿但断言弱"）；数值口径经手工复算两组（开发夹具 11 事件 + 本人独立构造的 2 事件账本）全部吻合；五个偏差点逐条独立判定，均不构成缺陷，其中符号链接越界用例本人已在本环境用 junction 实测两个分支（开发代理申报"未自动化"属实，但逻辑真实有效）；范围与安全核验通过：server.ts 仅两个 GET 路由、src 无新增写文件/模型调用、父仓 `git status` 为空、测试无 skip/only/快照弱化。存在 2 项非阻塞建议（见 §6 风险清单）。

---

## 2. 取证基准与独立性声明

| 项 | 值 |
|---|---|
| headCommit | `2f251279ab6f18802619e271ed99b9bdf42462f1`（`git rev-parse HEAD` 实取，分支 `feat/usage-ledger-contract`） |
| deliveryBaseline | `b5938482bf738cceba399604f4e5db5519237d64`（契约 v1.1 提交，经 `git merge-base --is-ancestor` 确认是 HEAD 祖先） |
| 实现提交链 | `4ed28ce3ff0c5853b579f07e389843b75c51fcfc` → `5c8cb4c035bb7c5aa448a68a3221fe2329feca7a` → `92a3f6068e05d0f7201f3549f0a62dec7963df51` → `2f251279ab6f18802619e271ed99b9bdf42462f1` |
| independence | 本人（auditor-usage-phase1）未参与该功能任何实现与测试编写；本报告全部结论来自独立复跑、独立构造 fixture 与手工复算，未复用开发代理自述结论作为证据 |
| 只读承诺 | 除本报告文件（`evidence/usage-phase1-acceptance.md`）外未修改仓库任何文件；全部自建 fixture 与日志位于 `%TEMP%\usage-phase1-evidence\`；未执行任何 git 写操作（提交/推送留给主控决定） |

### 2.1 testRuns（真实执行记录）

仓库绝对路径统一记为 `<REPO>` = `D:\git\hx\Game-Agent-Harness\version-planning-tool`；临时目录统一记为 `<TMP>` = `C:\Users\hanhan\AppData\Local\Temp\usage-phase1-evidence`。

| # | 命令 | workingDir | 退出码 | 关键输出 |
|---|---|---|---|---|
| R01 | `pnpm typecheck` | `<REPO>` | 0 | `> tsc --noEmit && tsc -p tsconfig.node.json --noEmit`，无错误（日志 `<TMP>\typecheck.log`） |
| R02 | `pnpm lint` | `<REPO>` | 0 | `> eslint .`，无告警（日志 `<TMP>\lint.log`） |
| R03 | `pnpm test` | `<REPO>` | 0 | `Test Files 8 passed (8) / Tests 115 passed (115)`（日志 `<TMP>\test.log`；分文件：view-model 4、usage 38、version-plan 19、usage-api 6、api 4、usage-validation 25、board-ui 5、usage-ui 14） |
| R04 | `pnpm build` | `<REPO>` | 0 | `✓ built in 8.78s` + `tsc` 产物（日志 `<TMP>\build.log`；仅 chunk 体积提示，非错误） |
| R05 | `node dist/cli.js validate --project <TMP>\smoke\legacy` | `<REPO>` | 0 | `校验通过：2 个需求`（stdout，stderr 空） |
| R06 | `node dist/cli.js validate --project <TMP>\smoke\usage` | `<REPO>` | 0 | `校验通过：2 个需求`（合法账本启用） |
| R07 | `node dist/cli.js validate --project <TMP>\smoke\dangling` | `<REPO>` | 1 | stdout 空；stderr：`[USAGE_UNKNOWN_TASK] 事件 se-1 关联不存在的任务 S-999`（stdout/stderr 分流单独验证，日志 `<TMP>\smoke-dangling.out/.err`） |
| R08 | `node dist/cli.js validate --project <TMP>\smoke\broken` | `<REPO>` | 1 | `[USAGE_FILE_INVALID] 用量账本文件缺失或不可解析：usage.json` |
| R09 | `node dist/cli.js serve --project <TMP>\smoke\usage --port 4317` + `curl --noproxy * -H x-version-plan-token -H x-version-plan-origin -H sec-fetch-site:same-origin http://127.0.0.1:4317/api/roadmap` | `<REPO>` | curl 0，HTTP 200 | `usage.enabled=true`；totals 与五维汇总数值见 §5.2（与手工复算一致；响应存档 `<TMP>\api-roadmap.json`，服务日志 `<TMP>\serve.log`） |
| R10 | `node dist/cli.js validate --project <TMP>\symlink\proj`（usageFile=`linkdir/usage.json`，junction 指向项目外且文件存在） | `<REPO>` | 1 | `[CONFIG_INVALID] 符号链接越出项目目录：linkdir/usage.json` |
| R11 | `node dist/cli.js validate --project <TMP>\symlink\proj`（usageFile=`linkdir/missing.json`，文件缺失、最近存在祖先经 junction 越界） | `<REPO>` | 1 | `[CONFIG_INVALID] 符号链接越出项目目录：linkdir/missing.json` |
| R12 | Schema 深度比对脚本（契约 §4.2 草案 vs `schema/usage.schema.json`，递归排序后 JSON 序列化比对） | `<REPO>` | 0 | `schema identical to contract §4.2: true` |
| R13 | `git status --porcelain`（父仓 Game-Agent-Harness） | 父仓 | 0 | 空输出（零越界） |
| R14 | `git rev-parse HEAD` / `git log --oneline -6` / `git merge-base --is-ancestor b593848 HEAD` | `<REPO>` | 0 | 见 §2 |

---

## 3. T01–T15 逐项验收表

验证方法分三类：**(测)** = 复跑既有自动化测试并核对断言语义；**(算)** = 手工独立复算数值；**(冒)** = 本人独立构造 fixture 实跑。

| 编号 | 裁决 | 验证方法 | 证据路径 | 复算数值 / 关键输出 |
|---|---|---|---|---|
| T01 旧项目兼容 | PASS | 测+冒 | `tests/usage-validation.test.ts:48-86`（CLI 退出码/输出逐字、`usage:null`、未知字段仍 CONFIG_INVALID）、`tests/usage-api.test.ts:37-51`（既有字段不变+`usage:null`+安全响应头）、`tests/usage-ui.test.tsx:247-260`（未启用无入口、无虚构统计）、`src/web/App.tsx:81`（`usage={payload?.usage ?? null}`）、`src/web/components/Workspace.tsx:47,75,91`（usage 为空时入口与视图均不渲染）；冒烟 R05 | 未配置项目：`校验通过：2 个需求`，exit 0，输出与基线版逐字一致（`git diff b593848 HEAD -- src/cli.ts` 确认仅抽函数不改行为） |
| T02 合法账本关联汇总 | PASS | 测+算 | `tests/usage.test.ts:335-434` | 独立复算：byTask {T1:4, T2:4, T3:3}；byRole {开发执行:4, 独立验收:3, 主控协调:2, 返工:2}；byModel `alpha/model-a`.taskCount=3、`beta/model-b`.eventCount=4——与实现输出一致 |
| T03 数据错误诊断 | PASS | 测+冒 | `tests/usage-validation.test.ts:88-298`（12 个语义码一锅端 + Schema 层 + 文件层）、R07/R08 | 悬空 taskId → `[USAGE_UNKNOWN_TASK]` exit 1；JSON 损坏 → `[USAGE_FILE_INVALID]` exit 1；断言语义核对：每个场景都断言了具体诊断码而非仅 `valid=false` |
| T04 Token 口径 | PASS | 测+算 | `tests/usage.test.ts:217-236`、`src/usage.ts:267-272,299` | 手工求和 11 事件：input 52400、output 13050、cachedInput 16000、reasoning 3200；断言含 `.not.toBe(52400+16000)` 显式防二次累加；交叉约束 `cachedInputTokens ≤ inputTokens`、`reasoningTokens ≤ outputTokens` 由 `src/validation.ts:303-318` 实现并经 `tests/usage-validation.test.ts:277-298` 验证 path 精确到字段 |
| T05 三态费用分离 | PASS | 测+算 | `tests/usage.test.ts:124-215`、`src/usage.ts:150-201` | 口径唯一性优先级（登记 cost > 工具估算 > unknown）与契约 §6.5 逐条对应；T1 桶 costActual {CNY:0.02} 与 costEstimated {CNY:0.04, USD:0.01} 分列，若双重计费估算桶会变 0.057（测试注释显式防） |
| T06 多币种与价格版本 | PASS | 测+算 | `tests/usage.test.ts:238-274` | totals costActual {CNY:0.02, USD:0.05}、costEstimated {CNY:0.13, USD:0.03} 与手工复算一致（0.021+0.05；0.036+0.0496+0.036+0.008=0.1296→0.13，0.021+0.006=0.027→0.03）；PRICES 汇总前后 `toEqual` 防篡改 |
| T07 汇总一致性 | PASS | 测+算 | `tests/usage.test.ts:356-412` | 五维（任务/版本/模型/供应商/角色）各自 eventCount、input、output 之和恒等于 totals（11 / 52400 / 13050）；费用分列与 unknownCostEventCount 跨维求和一致；本人按事件逐条手工重算全部匹配 |
| T08 UI 边界 | PASS | 测 | `tests/usage-ui.test.tsx:206-245` | 空账本空态且无 NaN；仅用量无价格时实际/估算列显示占位符而非虚构金额（`.not.toContain("估算 CNY")`）；actual 与 estimated 同时存在时分列 |
| T09 既有行为回归 | PASS | 测 | R03 全量：`tests/version-plan.test.ts`(19)、`tests/board-ui.test.tsx`(5)、`tests/view-model.test.ts`(4)、`tests/api.test.ts`(4) 全绿；`tests/api.test.ts` 的 diff 仅为增强（`git diff b593848 HEAD -- tests/api.test.ts`）无弱化 | 115/115 |
| T10 价格引用有效期 | PASS | 测+算 | `tests/usage.test.ts:462-485`（5 个反例：过期/未生效/provider 错配/modelId 错配/不存在 → 全部 unknown 且 amount undefined）、`tests/usage-validation.test.ts:301-388`（NOT_EFFECTIVE / MODEL_MISMATCH 诊断 + path 指向 `cost/priceId`） | 显式引用失效价格时 `src/usage.ts:181-190` 置 price=undefined → unknown，无静默回退到错价；断言语义核对：断言的是"unknown 且无金额"而非宽松的"不抛错" |
| T11 双 priceId 职责 | PASS | 测 | `tests/usage-validation.test.ts:391-465`（四场景：只有顶层 / 只有 cost.priceId / 两者一致 / 两者不一致→REF_CONFLICT）、`tests/usage.test.ts:487-523` | 冲突场景同时断言 code 与 path `/events/evt-conflict/priceId`；一致场景 costActual {CNY:2.5} 生效 |
| T12 confidence 三组恒等 | PASS | 测+算 | `tests/usage.test.ts:276-333`、`src/usage.ts:274-281` | measured 7 / estimated 2 / unknown 2（合计 11=桶 eventCount）；tokens 逐字段三组之和=桶 tokens（3100+... 复算一致）；恒等断言覆盖**全部**汇总桶（totals+五维每个桶）而非仅 totals；UI 展示三组及低可信占比 36%（`(2+2)/11`）见 `tests/usage-ui.test.tsx:162-167`、`src/web/components/UsageView.tsx:264-292` |
| T13 cost.amount 缺失 | PASS | 测+算 | `tests/usage.test.ts:166-206` | 四种情况独立成例：无价格匹配/缺 amount/未知可信度 → unknownCostEventCount=3 且 `cost.amount` undefined（显式防"当 0"）；actual 账单 → costActual {CNY:1.5}；`src/usage.ts:156-164,283-284` 缺 amount 走 unknown 分支且 unknownCostEventCount 自增 |
| T14 回退假设冒泡 | PASS | 测+算 | `tests/usage.test.ts:436-460`、`tests/usage-ui.test.tsx:114-127` | evt-005 复算：(10000-4000)/1e6×2 + 4000/1e6×2(回退) + (2000-1000)/1e6×8 + 1000/1e6×8(回退) = 0.036，与实现一致；两个假设标识冒泡进 byTask/byModel/byRelease/byRole/byProvider/totals 六级；未涉及回退的桶 `assumptions` 为 `[]`（显式防空跑） |
| T15 价格只增不改 | PASS | 测+算 | `tests/usage.test.ts:246-259` | evt-001(10 月费率) 0.036 vs evt-004(11 月费率) 0.0496——同模型两版本按 occurredAt 各自命中，旧版本字段不被覆盖（`PRICES` 前后 `toEqual`）；evt-004 复算：16000/1e6×1.5 + 4000/1e6×0.4 + 3000/1e6×6 + 1000/1e6×6 = 0.0496 ✓ |

### 3.1 手工复算留痕（两组）

**组 A：开发夹具（`tests/usage-fixtures.ts`，11 事件 4 价格）**——按核算规则 §3.2 四段公式逐事件手算：evt-001=0.036（p-a-oct）、evt-003=0.021 USD、evt-004=0.0496（p-a-nov）、evt-005=0.036（双回退）、evt-010=0.006 USD；登记费用 evt-002=0.021 CNY actual、evt-007=0.008 CNY estimated、evt-009=0.05 USD actual、evt-008 缺 amount→unknown。汇总：input 52400 / output 13050 / cachedInput 16000 / reasoning 3200；costActual {CNY:0.02, USD:0.05}；costEstimated {CNY:0.13, USD:0.03}；unknownCostEventCount 3；measured/estimated/unknown = 7/2/2。全部与 `summarizeUsage` 实际输出一致。

**组 B：本人独立构造账本（`<TMP>\smoke\usage\usage.json`，2 事件 1 价格，不复用开发夹具）**——se-1：provX/modX，unit 1000，价 1.0/0.5/2.0/3.0，usage 3000/1000/cached 1000/reasoning 500 → (2000/1000×1.0)+(1000/1000×0.5)+(500/1000×2.0)+(500/1000×3.0)=**5.0 CNY estimated**；se-2：登记 actual USD 12.5。期望 totals：eventCount 2、tokens input 3100/output 1050/cachedInput 1000/reasoning 500、costActual {USD:12.5}、costEstimated {CNY:5}、unknownCostEventCount 0。API 实测（R09）逐字段一致。

---

## 4. 五个偏差/解释点专项判定

### 4.1 回退假设触发条件 —— **PASS（附契约澄清建议）**

- 实现：`src/usage.ts:117`（`price.cachedInputPricePerUnit === undefined && cachedInput > 0`）与 `:122`（reasoning 同理），即"价格字段缺失**且对应分段 Token>0**"才标注假设。
- 判定理由：(a) 契约 §3.3 表格是"缺失项→回退规则→假设标识"的索引式表述，而同节正文的操作性措辞是"**发生回退时**，事件的估算结果携带对应假设标识"——正文以"回退实际发生"为条件；(b) 当分段 Token 为 0 时，回退单价乘以 0，金额与不回退完全相等，回退未对估算产生任何影响，标注一个零影响的假设只会稀释审计信号（一条不带缓存 Token 的事件也会挂上 `cached_input_price_fallback_to_input`）；(c) 假设标识的目的（§3.3 末句"回退估算是估算，不得冒充供应商实际账单"、核算规则 §7.2）是提示"此处估算可能误导"，0 分段不存在误导可能。实现符合契约字义与目的，且两种读法下**数值结果完全相同**（仅标注多寡之分），无计费风险。
- 澄清建议（不阻塞）：在契约 §3.3 表格后补充一句，例如"当对应分段 Token 数量为 0 时，该回退不改变估算金额，事件可不标注对应假设标识"，以消除"缺字段即标注"与"实际发生回退才标注"的歧义。

### 4.2 cli.ts isDirectRun 守卫 —— **PASS**

- `git diff b593848 HEAD -- src/cli.ts` 显示：validate 逻辑原样抽为 `runValidate`（输出字符串 `校验通过：N 个需求`、`[CODE] message` 格式、exitCode 赋值逐字未变），新增 `isDirectRun()` 仅在 `realpathSync(process.argv[1]) === import.meta.url` 时执行 `main()`——这是 Node ESM 标准惯用法，对直接执行（含经符号链接的全局 bin）行为不变。
- 实跑复核：R05–R08、R10–R11 均以 `node dist/cli.js` 直接执行，退出码与输出和基线语义一致；失败场景 stdout 为空、诊断全部落 stderr（R07 分流验证）。

### 4.3 符号链接越界用例 —— **PASS（本环境已实测，自动化仍缺失列为建议）**

- 代码逻辑真实存在：`src/project.ts:44-59`（文件存在时 realpath 后检查 `path.relative` 越界）与 `src/project.ts:72-84`（`realpathNearestExisting`：allowMissing 场景逐级上找最近存在祖先并复验越界）。
- 本环境实测（开发代理因沙箱未跑，本人补跑）：用 Node `symlinkSync(..., 'junction')` 在 `%TEMP%` 构造项目外目录 junction（`fs.realpathSync` 对 junction 与 symlink 解析路径相同，等效覆盖该代码路径）：
  - R10（usageFile 指向 junction 内**已存在**文件）：exit 1，`[CONFIG_INVALID] 符号链接越出项目目录：linkdir/usage.json`；
  - R11（usageFile 指向 junction 内**不存在**文件，走 allowMissing + realpathNearestExisting 分支）：exit 1，同样拒绝。
- 结论：逻辑真实且两个分支均有效；未自动化属实但不构成缺陷。建议（非阻塞）：后续在具备 symlink 权限的环境补一条自动化用例（file + 目录两种）。

### 4.4 USAGE_PRICE_MODEL_MISMATCH 对 cost.priceId 的 path —— **PASS（判定合理）**

- 契约 §7.2 表 path 列自注为"**示例**"；同表 `USAGE_PRICE_NOT_EFFECTIVE` 行已并列列出 `/events/<id>/priceId` 与 `/events/<id>/cost/priceId` 两种 path，`USAGE_CURRENCY_MISMATCH` 行使用 `/events/<id>/cost/currency`。实现对 `cost.priceId` 引用使用其自身字段路径 `/events/<id>/cost/priceId`（`src/validation.ts:232,245-251`）与上述先例一致，且比笼统指向顶层 priceId 更利于定位；契约 §6.4/§5 规则 5 明确两个引用字段"适用同一套引用校验"，path 精确到出错字段符合契约意图。测试 `tests/usage-validation.test.ts:346-367` 断言了该精确 path。

### 4.5 API summary 服务端计算 + 前端同源重算 —— **PASS**

- 服务端：`src/validation.ts:369-371`（`buildUsageSummary(ledger.events, prices, releaseByTask)`）→ `GET /api/roadmap` 原样返回（`src/server.ts:74`）。
- 前端：`src/web/lib/usage-view-model.ts:23-32`（`createUsageContext` 用**同一** `buildUsageEventViews` + `summarizeUsage` 纯函数链重算）；筛选时 `scopeUsageSummary`（:35-40）仅按 taskId 过滤 views 后重新汇总，口径与整体一致。
- 一致性核验：无筛选时两端为同一纯函数对同一输入的输出，构造上一致；R09 实测 API 侧数值与手工复算一致；筛选口径经 `tests/usage-ui.test.tsx:191-203`（T2 筛选：input 22,900 = 900+20000+2000 ✓、USD 0.05 ✓）与本人复算确认。

---

## 5. 门禁与冒烟真实输出

### 5.1 门禁（均重定向至 `<TMP>\*.log` 后取 `$?`，未丢退出码）

```
pnpm typecheck  → exit 0   （tsc --noEmit && tsc -p tsconfig.node.json --noEmit）
pnpm lint       → exit 0   （eslint .）
pnpm test       → exit 0   （Test Files 8 passed (8)；Tests 115 passed (115)；Duration 13.29s）
pnpm build      → exit 0   （✓ built in 8.78s；tsc -p tsconfig.node.json 产物正常；仅 chunk>1000kB 提示）
```

### 5.2 冒烟（全部使用本人独立构造 fixture，位于 `<TMP>\smoke\`）

| 场景 | 结果 |
|---|---|
| 未配置 usageFile 项目 validate | exit 0，stdout `校验通过：2 个需求`，stderr 空 |
| 启用合法账本 validate | exit 0，`校验通过：2 个需求` |
| 悬空 taskId | exit 1，stdout 空，stderr `[USAGE_UNKNOWN_TASK] 事件 se-1 关联不存在的任务 S-999` |
| 账本 JSON 损坏 | exit 1，stderr `[USAGE_FILE_INVALID] 用量账本文件缺失或不可解析：usage.json` |
| serve + curl `/api/roadmap` | HTTP 200；`usage.enabled=true`；`ledger.schemaVersion=1`、`ledger.project=smoke-proj`；totals：`eventCount 2 / taskCount 2 / modelCount 2 / tokens {input:3100, output:1050, cachedInput:1000, reasoning:500} / confidence.measured.eventCount 2 / costActual {USD:12.5} / costEstimated {CNY:5} / unknownCostEventCount 0 / assumptions []`；byTask S-01 {input:3000, costEstimated {CNY:5}}、S-02 {input:100, costActual {USD:12.5}}；byModel {provX/modX, provY/modY}、byProvider {provX, provY}、byRelease {r1}、byRole {开发执行, 独立验收}——五维键与 §10 一致，数值与 §3.1 组 B 手工复算一致 |

（注：本环境 `HTTP_PROXY` 会劫持 curl，实测时加 `--noproxy '*'`；服务以后台任务方式运行，令牌从启动输出实取。）

---

## 6. 未覆盖项与风险清单

| # | 项 | 级别 | 说明 |
|---|---|---|---|
| 1 | 符号链接越界无自动化测试 | 低（建议） | 本人已用 junction 实测两个分支均正确拒绝（R10/R11）；建议在具备 symlink 权限的环境补自动化用例。契约 §8 要求的行为本身已实现且验证。 |
| 2 | 契约 §3.3 假设标注条件存在两种读法 | 低（建议） | 已判定实现符合契约目的（见 §4.1）；建议按 §4.1 措辞补充契约，避免后续实现者按另一读法产生标注漂移。 |
| 3 | 核算规则 §7 第 6 要点（示例与测试数据标注）在 UI 文案中无独立条目 | 提示 | UI 口径说明 4 条 bullet + 假设区覆盖了 §7 的 1–5 点；第 6 点由数据层满足（契约 §11 示例与测试夹具均带"测试数据/构造值"标注，`tests/usage-fixtures.ts` 头注与 schema basis 字段），工具 UI 不展示内置示例数据，无混淆通道。不判缺陷。 |
| 4 | 需求池语义校验失败但账本合法时，API 仍返回 usage 载荷（`valid=false` + `usage≠null`） | 提示 | 契约仅规定"账本校验失败时 usage 为 null"；此组合契约未禁止，前端按失败态展示，不影响只读与安全。记录备查。 |
| 5 | 汇总金额为"事件级 4 位舍入后求和再 2 位舍入" | 提示 | 与核算规则 §3.4"汇总=各事件金额之和（不做二次四舍五入到事件级）"相容；与"未舍入事件金额求和"的差异 ≤ 11×0.00005=0.00055，2 位展示下不可见。 |

---

## 7. 机器可读块

```acceptance
{
  "verdict": "PASS",
  "headCommit": "2f251279ab6f18802619e271ed99b9bdf42462f1",
  "deliveryBaseline": "b5938482bf738cceba399604f4e5db5519237d64",
  "branch": "feat/usage-ledger-contract",
  "independence": "auditor-usage-phase1；未参与实现与测试编写；全部结论来自独立复跑、独立构造 fixture 与手工复算",
  "gates": {
    "typecheck": { "exitCode": 0, "log": "C:\\Users\\hanhan\\AppData\\Local\\Temp\\usage-phase1-evidence\\typecheck.log" },
    "lint": { "exitCode": 0, "log": "C:\\Users\\hanhan\\AppData\\Local\\Temp\\usage-phase1-evidence\\lint.log" },
    "test": { "exitCode": 0, "total": 115, "passed": 115, "log": "C:\\Users\\hanhan\\AppData\\Local\\Temp\\usage-phase1-evidence\\test.log" },
    "build": { "exitCode": 0, "log": "C:\\Users\\hanhan\\AppData\\Local\\Temp\\usage-phase1-evidence\\build.log" }
  },
  "matrix": {
    "T01": "PASS", "T02": "PASS", "T03": "PASS", "T04": "PASS", "T05": "PASS",
    "T06": "PASS", "T07": "PASS", "T08": "PASS", "T09": "PASS", "T10": "PASS",
    "T11": "PASS", "T12": "PASS", "T13": "PASS", "T14": "PASS", "T15": "PASS"
  },
  "deviations": {
    "fallbackAssumptionTrigger": "PASS+澄清建议（符合契约§3.3正文'发生回退时'；建议补充0分段不标注措辞）",
    "cliIsDirectRunGuard": "PASS（diff+实跑证实行为逐字不变）",
    "symlinkEscape": "PASS（本环境junction实测两个分支均拒绝；自动化缺失列为低风险建议）",
    "modelMismatchPathForCostPriceId": "PASS（path精确到字段，与NOT_EFFECTIVE/CURRENCY_MISMATCH先例一致，契约path列为示例）",
    "apiSummarySameSourceRecompute": "PASS（服务端与前端同一纯函数链；无筛选一致、筛选口径一致，实测复核）"
  },
  "evidencePaths": [
    "docs/模型用量数据契约.md",
    "docs/成本核算规则.md",
    "schema/usage.schema.json",
    "src/usage.ts",
    "src/validation.ts",
    "src/project.ts",
    "src/cli.ts",
    "src/server.ts",
    "src/web/lib/usage-view-model.ts",
    "src/web/components/UsageView.tsx",
    "tests/usage.test.ts",
    "tests/usage-validation.test.ts",
    "tests/usage-api.test.ts",
    "tests/usage-ui.test.tsx",
    "tests/usage-fixtures.ts",
    "C:\\Users\\hanhan\\AppData\\Local\\Temp\\usage-phase1-evidence\\typecheck.log",
    "C:\\Users\\hanhan\\AppData\\Local\\Temp\\usage-phase1-evidence\\lint.log",
    "C:\\Users\\hanhan\\AppData\\Local\\Temp\\usage-phase1-evidence\\test.log",
    "C:\\Users\\hanhan\\AppData\\Local\\Temp\\usage-phase1-evidence\\build.log",
    "C:\\Users\\hanhan\\AppData\\Local\\Temp\\usage-phase1-evidence\\smoke-legacy.log",
    "C:\\Users\\hanhan\\AppData\\Local\\Temp\\usage-phase1-evidence\\smoke-usage.log",
    "C:\\Users\\hanhan\\AppData\\Local\\Temp\\usage-phase1-evidence\\smoke-dangling.log",
    "C:\\Users\\hanhan\\AppData\\Local\\Temp\\usage-phase1-evidence\\smoke-dangling.out",
    "C:\\Users\\hanhan\\AppData\\Local\\Temp\\usage-phase1-evidence\\smoke-dangling.err",
    "C:\\Users\\hanhan\\AppData\\Local\\Temp\\usage-phase1-evidence\\smoke-broken.log",
    "C:\\Users\\hanhan\\AppData\\Local\\Temp\\usage-phase1-evidence\\smoke-symlink.log",
    "C:\\Users\\hanhan\\AppData\\Local\\Temp\\usage-phase1-evidence\\smoke-symlink-missing.log",
    "C:\\Users\\hanhan\\AppData\\Local\\Temp\\usage-phase1-evidence\\serve.log",
    "C:\\Users\\hanhan\\AppData\\Local\\Temp\\usage-phase1-evidence\\api-roadmap.json",
    "C:\\Users\\hanhan\\AppData\\Local\\Temp\\usage-phase1-evidence\\smoke\\usage\\usage.json"
  ],
  "testRuns": [
    { "id": "R01", "command": "pnpm typecheck", "workingDir": "D:\\git\\hx\\Game-Agent-Harness\\version-planning-tool", "exitCode": 0 },
    { "id": "R02", "command": "pnpm lint", "workingDir": "D:\\git\\hx\\Game-Agent-Harness\\version-planning-tool", "exitCode": 0 },
    { "id": "R03", "command": "pnpm test", "workingDir": "D:\\git\\hx\\Game-Agent-Harness\\version-planning-tool", "exitCode": 0, "keyOutput": "Tests 115 passed (115)" },
    { "id": "R04", "command": "pnpm build", "workingDir": "D:\\git\\hx\\Game-Agent-Harness\\version-planning-tool", "exitCode": 0 },
    { "id": "R05", "command": "node dist/cli.js validate --project <TMP>\\smoke\\legacy", "workingDir": "D:\\git\\hx\\Game-Agent-Harness\\version-planning-tool", "exitCode": 0, "keyOutput": "校验通过：2 个需求" },
    { "id": "R06", "command": "node dist/cli.js validate --project <TMP>\\smoke\\usage", "workingDir": "D:\\git\\hx\\Game-Agent-Harness\\version-planning-tool", "exitCode": 0, "keyOutput": "校验通过：2 个需求" },
    { "id": "R07", "command": "node dist/cli.js validate --project <TMP>\\smoke\\dangling", "workingDir": "D:\\git\\hx\\Game-Agent-Harness\\version-planning-tool", "exitCode": 1, "keyOutput": "stderr: [USAGE_UNKNOWN_TASK] 事件 se-1 关联不存在的任务 S-999" },
    { "id": "R08", "command": "node dist/cli.js validate --project <TMP>\\smoke\\broken", "workingDir": "D:\\git\\hx\\Game-Agent-Harness\\version-planning-tool", "exitCode": 1, "keyOutput": "stderr: [USAGE_FILE_INVALID] 用量账本文件缺失或不可解析：usage.json" },
    { "id": "R09", "command": "node dist/cli.js serve --port 4317 + curl /api/roadmap", "workingDir": "D:\\git\\hx\\Game-Agent-Harness\\version-planning-tool", "exitCode": 0, "keyOutput": "HTTP 200; usage.enabled=true; totals.tokens.input=3100; costEstimated={CNY:5}; costActual={USD:12.5}" },
    { "id": "R10", "command": "node dist/cli.js validate --project <TMP>\\symlink\\proj (junction file exists)", "workingDir": "D:\\git\\hx\\Game-Agent-Harness\\version-planning-tool", "exitCode": 1, "keyOutput": "[CONFIG_INVALID] 符号链接越出项目目录：linkdir/usage.json" },
    { "id": "R11", "command": "node dist/cli.js validate --project <TMP>\\symlink\\proj (junction missing file)", "workingDir": "D:\\git\\hx\\Game-Agent-Harness\\version-planning-tool", "exitCode": 1, "keyOutput": "[CONFIG_INVALID] 符号链接越出项目目录：linkdir/missing.json" },
    { "id": "R12", "command": "schema deep-compare (contract §4.2 vs schema/usage.schema.json)", "workingDir": "D:\\git\\hx\\Game-Agent-Harness\\version-planning-tool", "exitCode": 0, "keyOutput": "schema identical to contract §4.2: true" },
    { "id": "R13", "command": "git status --porcelain (parent repo)", "workingDir": "D:\\git\\hx\\Game-Agent-Harness", "exitCode": 0, "keyOutput": "empty (no parent-repo violations)" },
    { "id": "R14", "command": "git rev-parse HEAD; git merge-base --is-ancestor b593848 HEAD", "workingDir": "D:\\git\\hx\\Game-Agent-Harness\\version-planning-tool", "exitCode": 0, "keyOutput": "2f251279ab6f18802619e271ed99b9bdf42462f1; baseline is ancestor of HEAD" }
  ],
  "openItems": [
    "symlink 越界自动化用例待补（低风险，逻辑已实测）",
    "契约 §3.3 建议补充'0 分段不标注假设'措辞（低风险澄清）"
  ]
}
```

---

*报告完。本文件为验收唯一写入库内文件的交付物；提交与推送由主控决定。*
