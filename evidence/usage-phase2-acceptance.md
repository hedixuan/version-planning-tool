# P3-28 价格周期时段支持（schedule 与 supersededBy）独立验收报告

- 验收人：auditor-price-schedule（独立验收官，未参与该功能的实现与修正）
- 验收对象：`version-planning-tool` 独立仓库，分支 `feat/price-schedule`
- 提交链：`cbebcb0`（主实现，7 文件 +1186/-36）+ `d38e0f4`（核算规则 §4 一句修正，1 文件 +1/-1）
- PR：#2（OPEN，base `main`，head `feat/price-schedule`，`gh pr view 2` 实取）

## 总体裁决：PASS

| 项 | 裁决 |
|---|---|
| 总体 | **PASS** |
| 设计定稿逐项（7 条） | 6 × PASS，1 × NEEDS_INFO（第 5 条 days-空诊断码分层映射，见下文） |
| 独立验证 6 组 | 5 组全 PASS；第 5 组（结构反例）中 `days: []` 端到端报 `USAGE_SCHEMA_INVALID` 而非契约 §7.2 表格所列 `USAGE_INVALID_SCHEDULE`（数据仍被拒绝，无安全影响），触发第 5 条 NEEDS_INFO |
| 门禁四条 | typecheck / lint / test（148 passed）/ build 全部退出码 0 |

唯一 NEEDS_INFO 不影响放行核心功能，但建议主控会同开发就「days 空数组的诊断码映射」做一次裁决（选项：a) 契约 §7.2 表格补充说明该情形由 Schema 层 `minItems` 拦截报 `USAGE_SCHEMA_INVALID`；b) 从 Schema 移除 `minItems` 让语义层统一报 `USAGE_INVALID_SCHEDULE`）。

## 独立性与基准

- **headCommit**：`d38e0f41c4c5bae1663ee1ecc3d5c5466f53decc`（`git rev-parse HEAD` 实取）
- **deliveryBaseline**：`30e1fff8fb52e6a9d862d29910bcdb1a5d11cbc7`（`git rev-parse origin/main` 实取）
- **independence**：本人未参与 P3-28 实现与修正；未复用开发自述结论；全部 fixture 于 `%TEMP%/p328-audit` 自建；数值全部手工复算后与工具输出比对。
- 提交链实取：`git log --oneline origin/main..HEAD` = `cbebcb0` + `d38e0f4`，仅此两提交。
- 设计权威：父仓 PR #156 登记（父仓 commit `2474e49`，`版本计划/需求池.json` P3-28 acceptance 7 条）+ 工具仓契约文档现行版本。

## 设计定稿 7 条逐项子裁决

### 1. Schema —— PASS
`schema/usage.schema.json` 与设计逐字比对（L87-146）：
- price 增加可选 `schedule`（`$ref` 非 required）与 `supersededBy`（`$ref` id，string minLength1 maxLength200）。
- `schedule`：`additionalProperties: false`；required `timezone`/`windows`；`timezone` string minLength 1（实现附加 maxLength 100，良性收紧，IANA 名均远短于此）；`negate` boolean default false；`windows` minItems 1。
- 窗口项：`additionalProperties: false`；required `days`/`start`/`end`；`days` minItems 1 + uniqueItems + enum mon-sun；`start`/`end` pattern 与设计逐字一致 `^([01][0-9]|2[0-3]):[0-5][0-9]$`。
- 契约 §4.2 内嵌 Schema 与实现文件逐字一致（允许的文档同步）。

### 2. 位图语义 —— PASS
`src/usage.ts`：
- `WEEK_MINUTES = 10080`，索引 0..10079，周一 00:00 = 0（L76-86）。
- 左闭右开：`for (minute = start; minute < end; ...)`（L154）。
- 无 schedule = 共享全集 `FULL_WEEK_MINUTES`（L89-91）；`negate: true` = 补集（L157-163）。
- 时区换算用 `Intl.DateTimeFormat`，`hourCycle: "h23"`（L112）规避 "24" 坑；`en-US` short weekday → `WEEKDAY_INDEX`。

### 3. 匹配 —— PASS
- `priceMatchesEvent` = provider/modelId 一致 + 绝对区间 + 位图命中（L187-197）。
- `findEffectivePrice` 过滤 `supersededBy === undefined` 候选，多条命中取 effectiveFrom 最新（L200-211）。
- 显式 `priceId` 路径（L296-307）：superseded 的 price 被显式引用合法（独立验证 G3：旧全天气闲档显式引用估算 5.8949 与原口径一致）；时段不符 → `priceMatchesEvent` 不成立 → `unknownCost()`，不静默估算（独立验证 G4：state=unknown、amount=undefined）。

### 4. 重叠判定（位图法）—— PASS
`src/validation.ts` L317-344：同 (provider, modelId) 分组；**双方均未被 supersededBy 取代**（L332）+ 绝对有效期半开重叠（L296-301）+ 一周位图有交集（L304-310）三条件同时满足才报 `USAGE_OVERLAPPING_PRICE`。
- 互补窗口（高峰正向 + 空闲 negate 同 windows）位图无交集 → 零诊断（独立验证 G2 + 主锚点账本本身）。
- 真重叠（mon 10:00-12:00 交集）→ 报错（独立验证 G2）。
- 被 supersededBy 取代者退出判定（主锚点中旧全天气闲档与高峰档绝对重叠且位图有交集，因旧档 superseded 不报）。
- 位图左闭右开边界（mon 09-12 vs mon 12-18）零误报（独立验证 G2）。

### 5. 五个新诊断码 —— NEEDS_INFO
`src/types.ts` L254-258 五码齐全；`src/validation.ts` 实现与 path 规范（`/prices/<id>/schedule`、`/prices/<id>/supersededBy`）全部正确：
- `USAGE_INVALID_SCHEDULE`：start≥end ✓（端到端实报）；时区无效（`Intl` 试构造抛 RangeError）✓（端到端实报）；**days 空数组**：端到端被 Schema 层 `minItems: 1` 先行拦截报 `USAGE_SCHEMA_INVALID`（path `/prices/<id>/schedule/windows/0/days`），语义层 `USAGE_INVALID_SCHEDULE` 仅在直接调用 `validateUsageSemantics` 时可达（已实测复现，与契约 §7.2 表格一致）。账本在两种路径下均被拒绝（exit 1），无静默放行。
- `USAGE_UNKNOWN_SUPERSEDE` / `USAGE_SUPERSEDE_SELF` / `USAGE_SUPERSEDE_CYCLE` / `USAGE_SUPERSEDE_MODEL_MISMATCH`：四个反例端到端各报对应码，path 正确；成环时环上每个成员各报一次（指向环但不在环上的节点不报，实现与开发测试文档行为一致）。
- 裁决理由：验收条件字面要求「days 空 → USAGE_INVALID_SCHEDULE」，端到端诊断码与契约 §7.2 表格映射不一致；数据安全性无损。留待主控/开发裁决文档口径。

### 6. 契约条款 —— PASS
契约 §13（L611）已写入：「**仅追加 `supersededBy` 的豁免（P3-28 增补）**：允许对既有 price **仅追加** `supersededBy` 字段（计价字段零改动）……这不违反"价格只增不改"；除该字段外，既有 price 的任何字段仍禁止修改。」

### 7. 文档一致性 —— PASS
- 契约 §5 规则 2（位图法不重叠，L259）、规则 5（显式引用四要素 + superseded 仍合法，L262）、规则 6（schedule 语义含 `hourCycle: "h23"` 说明，L263-269）、规则 7（supersededBy 四约束，L270-274）均在位。
- 契约 §7.2 语义层诊断码表计 18 个用量码（`USAGE_SCHEMA_INVALID` 归 §7.1，全表 19 行 minus 1）。
- 核算规则 §3.1 位图语义（L37-41）、**§4（L93）已改为位图法三条件口径**——`git show d38e0f4` 实取 diff 确认仅此一句（"有效期不得重叠；重叠即校验失败" → "绝对有效期重叠、一周时段位图有交集且双方均未被 supersededBy 取代时校验失败；互补窗口不构成重叠；被取代者退出判定"）。
- 全文 grep 残留旧口径（`不得重叠`/`重叠即`）：零命中（唯一命中即修正后的新句子）。

## 独立验证 6 组（fixture 与 runner 均自建于 %TEMP%，不复用开发用例）

环境：Node v22.22.2；fixture 根 `%TEMP%/p328-audit/fixtures`（15 个消费项目形态目录，各含 roadmap + version-plan.config.json + usageFile）；runner `%TEMP%/p328-audit/run-checks.mjs` 动态 import 工具仓 `dist/`（即交付构建产物）。

### 组1 回归锚点（主锚点 + 自动匹配变体）
主锚点账本：DeepSeek 三条 price（空闲 negate 0.02/1/4、高峰正向 0.04/2/8、旧全天气闲档 supersededBy 指向新空闲档）+ GLM price（0.8/0.23/2.8，推理不设）+ 10 事件（evt-test-001..006 复刻父仓 + 4 条 2026-10-24 真实事件，前三条显式绑旧全天气闲档）。

手工复算（公式：`(in-cached)/u*in价 + cached/u*缓存价 + (out-reason)/u*out价 + reason/u*推理价`，u=1e6）：
- ds-flash：2.323995 + 2.57259008 + 0.636732 + 0.361604 = **5.89492108 → 5.8949**
- v4.1-flash：1.78132 + 0.7691648 + 0.33512 + 0.370752 = **3.2563568 → 3.2564**
- 1017：0.442946 + 0.519232 + 0.354032 + 0.185184 = **1.501394 → 1.5014**
- GLM：0.1594248 + 0.88096256 + 0.0298648 + 0.0319424 = **1.10219456 → 1.1022**
- evt-001 = 0.036；evt-004 = 0.13；evt-006 = 0.03（登记 estimated）
- 合计 estimated = 11.9509 → **11.95**；actual = 0.021 → **0.02**；unknown = 2（evt-003 无价格、evt-005 可信度 unknown）
- deepseek = 0.036+0.03+5.8949+3.2564+1.5014 = 10.7187 → **10.72**；zhipu → **1.10**；stepfun → **0.13**

实测（与复算逐项一致）：
- `node dist/cli.js validate --project <main>` → 退出码 **0**（"校验通过：5 个需求"）。
- `node dist/cli.js serve --project <main> --port 41799` + `curl /api/roadmap`（带 `x-version-plan-token` 与 Origin 头，服务端令牌机制）→ HTTP **200**：`valid=true`、`diagnostics=0`、`eventCount=10`、`costEstimated={CNY:11.95}`、`costActual={CNY:0.02}`、`unknownCostEventCount=2`；`byProvider`：deepseek 10.72 / zhipu 1.1 / stepfun 0.13；zhipu `assumptions=["reasoning_price_fallback_to_output"]`、stepfun `assumptions=["cached_input_price_fallback_to_input"]`。
- 自动匹配变体（三条真实事件去掉 priceId）：validate 退出码 **0**；三条事件均命中 `deepseek-flash-offpeak-2026-10`（新 negate 空闲档，非 superseded 旧档）；金额 5.8949 / 3.2564 / 1.5014 不变；汇总 11.95 / 0.02 / 2 与 byProvider 10.72 / 1.10 / 0.13 全部不变。

### 组2 重叠判定
- 互补窗口（高峰正向 + 空闲 negate 同 windows，1 事件）→ 零诊断，valid=true。
- 位图左闭右开边界（mon 09:00-12:00 vs mon 12:00-18:00）→ 零诊断（12:00 分钟归后者，无交集）。
- 真重叠（mon 09-12 vs mon 10-14）→ `USAGE_OVERLAPPING_PRICE`，path `/prices/ds-overlap-b`。

### 组3 supersededBy
- 旧档退出自动匹配：组1 自动匹配变体命中新空闲档（旧档不在候选）。
- 历史显式引用仍解析原金额：主锚点 ds-flash 显式绑 superseded 旧档 → priceId=旧档、amount=5.8949（与原口径一致）。
- 四反例端到端各报对应码（path `/prices/deepseek-flash-offpeak-allday-2026-10/supersededBy`）：
  - 指向不存在 → `USAGE_UNKNOWN_SUPERSEDE`
  - 自引用 → `USAGE_SUPERSEDE_SELF`
  - 成环（offpeak↔allday，peak 指向环）→ `USAGE_SUPERSEDE_CYCLE`（环上两成员各报一次）
  - 目标不同 (provider, modelId) → `USAGE_SUPERSEDE_MODEL_MISMATCH`

### 组4 时段命中（Asia/Shanghai）
自动匹配（usage in/out 各 1e6，高峰 2+8=10、空闲 1+4=5）：
- 周二 2026-10-27 10:30 → peak，10 ✓；周二 20:00 → offpeak，5 ✓；周六 2026-10-24 10:30 → offpeak，5 ✓。
- 跨时区书写：`2026-10-27T01:30:00Z`（=北京 09:30）→ peak 10 ✓；`2026-10-26T17:00:00Z`（=北京周二 01:00）→ offpeak 5 ✓（换算按 price 时区，与事件书写偏移无关）。
- 边界分钟：08:59 → offpeak；09:00 → peak（左闭）；11:59 → peak；12:00 → offpeak（右开）✓。
- 显式绑错档（周六 10:30 绑 peak）→ `USAGE_PRICE_NOT_EFFECTIVE`（path `/events/evt-wrong-slot/priceId`）且费用 state=unknown、amount=undefined，不静默估算 ✓。

### 组5 结构反例
- `start=12:00, end=12:00` → 端到端 `USAGE_INVALID_SCHEDULE`（path `/prices/ds-struct-001/schedule`）✓。
- `days: []` → 端到端 `USAGE_SCHEMA_INVALID`（Schema `minItems` 先行拦截，账本仍被拒绝 exit 1）；直接调 `validateUsageSemantics` 报 `USAGE_INVALID_SCHEDULE` ✓（触发设计第 5 条 NEEDS_INFO）。
- `timezone: "Not/AZone"` → 端到端 `USAGE_INVALID_SCHEDULE` ✓。

### 组6 门禁复跑（工具仓工作目录实跑，重定向取真实退出码）
| 命令 | workingDir | 退出码 | 关键输出 |
|---|---|---|---|
| `pnpm typecheck` | version-planning-tool | **0** | tsc 双配置无输出通过 |
| `pnpm lint` | version-planning-tool | **0** | eslint 无告警 |
| `pnpm test` | version-planning-tool | **0** | **148 passed (148)**；tests/usage-schedule.test.ts 30 tests；既有 118 全绿（41+19+6+4+25+4+14+5） |
| `pnpm build` | version-planning-tool | **0** | vite + tsc 构建成功（chunk >1000kB 为既有告警，非失败） |

范围核对：
- `git show cbebcb0 --stat`：7 文件（契约、核算规则、usage.schema.json、types.ts、usage.ts、validation.ts、usage-schedule.test.ts）+1186/-36。
- `git show d38e0f4`：1 文件（成本核算规则.md）+1/-1，仅 §4 一句。
- 两提交合计工具仓 8 文件；父仓 `git status --short` 为空（零改动）。
- 全仓 grep `.skip(`/`.only(`：零命中。
- 开发测试断言强度抽查（tests/usage-schedule.test.ts）：事件级精确金额（5.8949/3.2564/1.5014/1.1022）、汇总精确值（11.95/0.02/2、10.72/1.1/0.13）、边界分钟（09:00 含/11:59/12:00 不含、negate 补集边界、16:00Z/17:59:59Z/18:00Z 跨星期换日）、跨时区书写（Z/+00:00/+08:00）断言均在；未发现弱断言（无对数值用 toBeTruthy/宽范围）。

## 未覆盖项与风险

1. **父仓侧登记待办（P3-28 验收条件之一，不在本交付范围）**：父仓 DeepSeek 双档 price 登记、旧全天气闲档追加 supersededBy、父仓 validate 通过——按父仓 `2474e49` 登记说明「父仓登记待工具合并后执行」，本交付仅工具仓代码；工具合并后需另行验证父仓账本（本人已用复刻 fixture 等价验证金额不变）。
2. **days-空诊断码映射**（NEEDS_INFO，见设计第 5 条）：无安全影响，需主控/开发裁决文档口径。
3. **UI 层**：本交付无新 UI 表面；usage-ui/board-ui 既有 19 例随 test 门禁全绿。
4. **时区 maxLength 100**：设计未规定上限，实现附加（良性，IANA 名最长约 32 字符）。
5. **合并动作**：本人为只读验收，未合并、未推送、未改父仓；报告文件为工具仓唯一写入。

## 机器可读块

```acceptance
verdict: PASS
headCommit: d38e0f41c4c5bae1663ee1ecc3d5c5466f53decc
deliveryBaseline: 30e1fff8fb52e6a9d862d29910bcdb1a5d11cbc7
independence: auditor-price-schedule 未参与实现与修正；fixture 自建于 %TEMP%/p328-audit；数值手工复算
designItems:
  schema: PASS
  bitmapSemantics: PASS
  matching: PASS
  overlapBitmap: PASS
  diagnosticCodes: NEEDS_INFO
  contractClause13: PASS
  docsConsistency: PASS
testRuns:
  - command: pnpm typecheck
    workingDir: D:/git/hx/Game-Agent-Harness/version-planning-tool
    exitCode: 0
  - command: pnpm lint
    workingDir: D:/git/hx/Game-Agent-Harness/version-planning-tool
    exitCode: 0
  - command: pnpm test
    workingDir: D:/git/hx/Game-Agent-Harness/version-planning-tool
    exitCode: 0
    detail: 148 passed (118 既有 + 30 新增)
  - command: pnpm build
    workingDir: D:/git/hx/Game-Agent-Harness/version-planning-tool
    exitCode: 0
  - command: node dist/cli.js validate --project %TEMP%/p328-audit/fixtures/main
    workingDir: %TEMP%/p328-audit/fixtures/main
    exitCode: 0
  - command: node dist/cli.js serve --project . --port 41799 + curl /api/roadmap
    workingDir: %TEMP%/p328-audit/fixtures/main
    exitCode: 0
    detail: HTTP 200；costEstimated CNY 11.95 / costActual CNY 0.02 / unknownCostEventCount 2；byProvider deepseek 10.72 / zhipu 1.10 / stepfun 0.13；zhipu reasoning_price_fallback_to_output
  - command: node %TEMP%/p328-audit/run-checks.mjs
    workingDir: %TEMP%/p328-audit
    exitCode: 0
    detail: 30/30 assertions passed（自动匹配/重叠/supersede/时段/结构五组）
regressionAnchor:
  costEstimatedCNY: 11.95
  costActualCNY: 0.02
  unknownCostEventCount: 2
  byProviderDeepseek: 10.72
  byProviderZhipu: 1.10
  byProviderStepfun: 0.13
evidencePaths:
  - D:/git/hx/Game-Agent-Harness/version-planning-tool/evidence/usage-phase2-acceptance.md
  - %TEMP%/p328-audit/setup-fixtures.mjs
  - %TEMP%/p328-audit/run-checks.mjs
  - %TEMP%/p328-audit/fixtures/main/版本计划/模型用量.json
  - %TEMP%/p328-audit/roadmap-api.json
```

（报告完。验收过程未对工具仓做除本报告文件外的任何写入；未执行 git 写操作。）
