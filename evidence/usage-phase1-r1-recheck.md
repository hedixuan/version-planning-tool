# 第一阶段「模型用量与成本核算」定点变更复验报告（R1）

- 复验人：auditor-usage-r1（独立验收官，未参与该功能实现，也未参与本次变更）
- 复验对象：commit `58c027a`（父提交 `42725a5`），分支 `feat/usage-ledger-contract`
- 仓库：`D:/git/hx/Game-Agent-Harness/version-planning-tool`
- 复验日期：2026-10-22
- 独立性声明：本复验不代替、不复用原总体 PASS 结论（`evidence/usage-phase1-acceptance.md`，headCommit `2f25127`），仅针对本次变更范围独立取证；未修复、未改动任何代码/测试/文档（本报告除外）。

## 一、总体裁决

**PASS**

变更（文档澄清 + 新增测试，`src/usage.ts` 未修改）完整落地 2026-10-22 项目负责人批准的「回退假设记录规则」。批准口径在核算规则 §3.3 中**逐字一致**（程序化比对 EXACT_MATCH）；实现经独立逐条核对满足 C1–C6 全部条件，主控「现有触发条件已符合批准口径」的核实结论**成立**；3 个新测试用例为强断言且真实执行；四条门禁全部以退出码 0 通过；范围纪律合规。

## 二、变更全貌

`git show 58c027a --stat`：仅 3 个文件，+73/−1：

| 文件 | 变更 |
|---|---|
| `docs/成本核算规则.md` | §3.3 新增「回退假设记录规则（2026-10-22 项目负责人批准）」标题 + 引用块（批准口径逐字）+ 一段闭环说明（+6） |
| `docs/模型用量数据契约.md` | §10 `assumptions` 条目尾部追加指向《成本核算规则.md》§3.3（原句保留，纯增量，±1） |
| `tests/usage.test.ts` | 新增 3 个用例（+66/−0） |

`src/usage.ts`、`schema/usage.schema.json` 未在变更中。headCommit 实取：`58c027a4386efd3c0d649bec5b572231845f7ac9`（`git rev-parse HEAD`）。

## 三、C1–C6 逐条裁决（实现独立判断）

实现位置：`src/usage.ts` `estimateEventCost`（L104–137）、`resolveEventCost`（L150–201）。

### C1 分段 Token > 0 —— 成立

- `src/usage.ts:117`：`if (price.cachedInputPricePerUnit === undefined && cachedInput > 0)`
- `src/usage.ts:122`：`if (price.reasoningPricePerUnit === undefined && reasoning > 0)`

### C2 该分段单价缺失 —— 成立

- 同上两行，以严格 `=== undefined` 判定单价缺失。注意边角：显式单价 `0` 是合法定价（`0 !== undefined`），不会误触发回退标记——判定方式正确。

### C3 实际使用回退单价完成费用估算（而非仅标记） —— 成立

- `src/usage.ts:116`：`const cachedInputPrice = price.cachedInputPricePerUnit ?? price.inputPricePerUnit;`
- `src/usage.ts:121`：`const reasoningPrice = price.reasoningPricePerUnit ?? price.outputPricePerUnit;`
- 两个回退价直接进入金额公式（`src/usage.ts:128`、`src/usage.ts:130`），不是仅打标记。
- 标记条件与计算条件强一致：分段为 0 时回退价虽被赋值，但 `(0/unit)*price` 对 amount 贡献恒 0，且标记条件同时不满足——不存在「标记了但回退价未参与计算」或「回退价参与了计算却未标记」的缝隙。
- 行为钳制证据（新测试）：`tests/usage.test.ts:139-156` 断言回退价金额 `0.036` 与等价显式单价金额完全相等。若回退价不真正参与计算，金额将只有 0.02（仅计非缓存输入与非推理输出），该断言会失败。

### C4 分段为 0：不触发、不记录（该段费用恒 0） —— 成立

- 标记条件含 `> 0`（C1 证据），分段为 0 时不标记。
- 金额公式中 `(cachedInput/unit)*cachedInputPrice` 与 `(reasoning/unit)*reasoningPrice` 在分段为 0 时恒为 0，无论单价是否缺失。
- `normalizeLedger`（`src/usage.ts:56-57`）将未声明的 `cachedInputTokens`/`reasoningTokens` 归一为 0，与 §3.3 表格「视为 0」一致，「无该分段」与「分段为零」走同一条不标记路径。

### C5 不改费用公式 —— 成立

- `estimateEventCost` 金额公式（`src/usage.ts:126-130`）与《成本核算规则.md》§3.2 四段公式逐项一致；假设标记仅旁路 `assumptions.push`，不触碰公式。
- 行为证据：新测试「回退价与等价显式单价金额一致」（金额均为 0.036），证明标记规则变化不以任何方式改变金额。

### C6 事件已登记 cost 时不执行自动估算（费用优先级不变） —— 成立

- `resolveEventCost` 第一分支即 `if (event.cost)`（`src/usage.ts:154`）并 `return`，自动估算路径（`src/usage.ts:192` 调用 `estimateEventCost`）位于其后，有 cost 时**根本不可达**。
- 返回的 `assumptions` 仅取 `cost.assumptions ?? []`（`src/usage.ts:171`），估算回退假设不可能混入。
- 边角：cost 存在但缺 amount 时走 unknown + `basis: "registered"`（`src/usage.ts:156-163`），同样不进估算路径。

**结论：主控「实现现有触发条件已符合批准口径、无需修改」的核实结论，经独立逐条核对成立。**

## 四、文档裁决

| 项 | 裁决 | 证据 |
|---|---|---|
| 核算规则 §3.3 新增文本与批准口径逐字一致 | PASS | 程序化逐字比对（`git show 58c027a:docs/成本核算规则.md` 提取引用块 vs 批准口径原文）：`EXACT_MATCH: True`，无任何增删改 |
| 契约 §10 指向一致 | PASS | `docs/模型用量数据契约.md:453`（位于「## 10. 只读 API」小节，L371 起）尾部追加「回退假设的**触发条件**（分段 Token 为零时不记录）见《成本核算规则.md》§3.3 回退假设记录规则」；原句「`assumptions` 汇总该桶涉及的全部估算假设标识，供统计口径说明展示。」完整保留，纯增量 |
| Schema 仍为 v1 | PASS | `schema/usage.schema.json` 不在变更文件清单；`git show 42725a5:schema/usage.schema.json` 与 `git show 58c027a:schema/usage.schema.json` 的 `"schemaVersion": { "const": 1 }` 逐字相同 |

## 五、新测试有效性裁决

3 个新用例（`git show 58c027a -- tests/usage.test.ts`，`tests/usage.test.ts:117-181`）：

1. **「分段 Token 为零时不触发回退、不记录假设」**（L118-136）
   - 构造：`evt-zero-segment`，input 900 / output 400，无 cached/reasoning 细分；价格 `PRICES[3]`（`p-fallback`，缺 cachedInputPricePerUnit 与 reasoningPricePerUnit）。
   - 断言强度：**强**——`toEqual({ currency: "CNY", amount: 0.005, assumptions: [] })` 全对象相等，含金额精确断言 0.005。
   - 金额复算：900/1e6×2 + 400/1e6×8 = 0.0018 + 0.0032 = 0.005，与注释及断言一致。
   - 覆盖：C4（分段为零不标记）。

2. **「回退价与等价显式单价金额一致，标记规则不改变费用公式」**（L139-156）
   - 构造：`evt-005`（input 10000 / output 2000 / cached 4000 / reasoning 1000）分别以 `PRICES[3]`（缺两价）与 `explicitEquivalent`（补 cachedInputPricePerUnit=2、reasoningPricePerUnit=8，恰为回退目标价）估算。
   - 断言强度：**强**——`withFallback.amount === withExplicit.amount`；`withFallback.amount === 0.036`（精确值）；`withFallback.assumptions` 以 `toEqual` 精确匹配两个回退标识；`withExplicit.assumptions` `toEqual([])`。
   - 金额复算：(10000−4000)/1e6×2 + 4000/1e6×2 + (2000−1000)/1e6×8 + 1000/1e6×8 = 0.012+0.008+0.008+0.008 = 0.036，一致。
   - 覆盖：C3（回退价真正参与计算——否则金额为 0.02）+ C5（公式不变）+ 反向（有显式价不标记）。这是三条中设计最有力的用例：等价显式价构成公式不变的双路径对照。

3. **「已登记 cost 的事件不执行自动估算、不产生回退假设」**（L159-181）
   - 构造：`evt-cost-no-estimate`，登记 `cost: { basis: "actual", currency: "CNY", amount: 0.5 }`，且 usage 带**非零** cached 4000 / reasoning 1000；provider/modelId/occurredAt 均可匹配缺价快照 `p-fallback`。
   - 断言强度：**强**——`cost.state === "actual"`、`cost.amount === 0.5`、`cost.assumptions` `toEqual([])`（精确空数组）。
   - 陷阱设计有效：若实现改为「先估算再被 cost 覆盖」，估算必产生两个回退假设，`toEqual([])` 会失败。
   - 覆盖：C6。

**复跑确认**：`pnpm vitest run tests/usage.test.ts --reporter=verbose`（退出码 0）逐一显示三个用例 ✓ 通过，非 skip。三个用例均为强断言（全对象/精确金额/精确数组内容），未发现「只断言长度不断言内容或金额」的弱断言。

## 六、门禁与无回归裁决

四条门禁均重定向至 `%TEMP%` 日志后取真实退出码（无管道丢退出码）：

| 命令 | workingDir | 退出码 | 结果 |
|---|---|---|---|
| `pnpm typecheck` | version-planning-tool | 0 | 通过 |
| `pnpm lint` | version-planning-tool | 0 | 通过 |
| `pnpm test` | version-planning-tool | 0 | **118 passed (118)**，8 个测试文件全过；其中 `tests/usage.test.ts 41 tests` 全过 |
| `pnpm build` | version-planning-tool | 0 | 通过（chunk >1000kB 提示为既有 warning，非 error，与本次变更无关） |

无回归：

- `git diff 42725a5 58c027a --numstat -- tests/` = `66  0  tests/usage.test.ts`：**纯新增，零删除**，既有断言（含原 T01–T15 相关用例）零改动、零弱化。
- 测试总数 115 → 118，与新增 3 个用例精确闭合。

## 七、范围纪律裁决

- `git show 58c027a --stat --name-only`：仅 `docs/成本核算规则.md`、`docs/模型用量数据契约.md`、`tests/usage.test.ts` 三份文件；`src/usage.ts` 未修改（与变更声明一致），`schema/` 未动。
- 工具仓工作区干净：`git status --porcelain` 空（本报告写入前）。
- 父仓零改动：`git -C D:/git/hx/Game-Agent-Harness status --porcelain` 空。

## 八、未覆盖项与保留意见

1. 新用例 1 的事件未显式声明 `cachedInputTokens`/`reasoningTokens` 字段（走 `normalizeLedger` 的 `?? 0` 归一化路径），而非「字段存在且值为 0」的字面零值场景。两条路径归一化逻辑相同，且归一化行为另有既有用例覆盖（`tests/usage.test.ts:32-42`），覆盖等价，不构成缺口。
2. C4 的「该段费用恒 0」在新用例 1 中经总金额 0.005 间接体现（无分段级金额 API），可接受。
3. `pnpm test` 默认 reporter 未逐条列名三个新用例，已用 verbose reporter 单独复跑 `tests/usage.test.ts` 补齐执行证据（退出码 0，三用例 ✓）。
4. 原总体 PASS 结论（`2f25127`）的历史效力不在本复验范围内重新认定。

## 九、结论

本次定点变更（`58c027a`）**PASS**：批准口径逐字落地、实现六条件全部成立且被强断言测试钳制、门禁四条全绿（118/118）、范围零溢出。无需修复项。

```acceptance
{
  "verdict": "PASS",
  "scope": "usage-phase1 §3.3 rollback-assumption recording rule targeted change recheck",
  "headCommit": "58c027a4386efd3c0d649bec5b572231845f7ac9",
  "changeCommit": "58c027a4386efd3c0d649bec5b572231845f7ac9",
  "deliveryBaseline": "42725a5e8faf191600ca7cd1336c8a960f8bf11b",
  "branch": "feat/usage-ledger-contract",
  "independence": "auditor-usage-r1 did not participate in the feature implementation nor in this change; prior overall PASS (evidence/usage-phase1-acceptance.md, headCommit 2f25127) is historical record only and was neither reused nor replaced by this recheck",
  "conditions": {
    "C1_segmentTokensGreaterThanZero": "PASS (src/usage.ts:117,122)",
    "C2_segmentPriceMissing": "PASS (src/usage.ts:117,122 strict === undefined; explicit 0 not misflagged)",
    "C3_fallbackPriceActuallyUsedInCalculation": "PASS (src/usage.ts:116,121,128,130; pinned by 0.036 equals-explicit-price test)",
    "C4_zeroSegmentNoTriggerNoRecord": "PASS (src/usage.ts:117,122 + normalizeLedger 56-57; toEqual amount 0.005, assumptions [])",
    "C5_formulaUnchanged": "PASS (formula identical to doc §3.2; dual-path amount equality 0.036)",
    "C6_registeredCostSkipsEstimation": "PASS (resolveEventCost early return src/usage.ts:154 before estimate path L192; assumptions only from cost.assumptions ?? [])"
  },
  "documentation": {
    "rule33VerbatimMatch": true,
    "contractSection10Pointer": true,
    "schemaVersionConst1Unchanged": true
  },
  "tests": {
    "newCases": 3,
    "totalTests": 118,
    "allPassed": true,
    "assertionStrength": "strong (full-object toEqual / exact amounts 0.005 & 0.036 / exact array toEqual)",
    "existingAssertionsModified": 0,
    "testsDiffLinesAdded": 66,
    "testsDiffLinesDeleted": 0
  },
  "testRuns": [
    { "command": "pnpm typecheck", "workingDir": "D:/git/hx/Game-Agent-Harness/version-planning-tool", "exitCode": 0, "logFile": "%TEMP%/r1-typecheck.log" },
    { "command": "pnpm lint", "workingDir": "D:/git/hx/Game-Agent-Harness/version-planning-tool", "exitCode": 0, "logFile": "%TEMP%/r1-lint.log" },
    { "command": "pnpm test", "workingDir": "D:/git/hx/Game-Agent-Harness/version-planning-tool", "exitCode": 0, "result": "118 passed (118)", "logFile": "%TEMP%/r1-test.log" },
    { "command": "pnpm build", "workingDir": "D:/git/hx/Game-Agent-Harness/version-planning-tool", "exitCode": 0, "logFile": "%TEMP%/r1-build.log" },
    { "command": "pnpm vitest run tests/usage.test.ts --reporter=verbose", "workingDir": "D:/git/hx/Game-Agent-Harness/version-planning-tool", "exitCode": 0, "result": "41 passed (41), 3 new cases individually confirmed executed", "logFile": "%TEMP%/r1-test-verbose.log" }
  ],
  "scopeDiscipline": {
    "filesChanged": ["docs/成本核算规则.md", "docs/模型用量数据契约.md", "tests/usage.test.ts"],
    "srcUsageTsModified": false,
    "schemaModified": false,
    "toolRepoWorktreeClean": true,
    "parentRepoClean": true
  },
  "gaps": [
    "New case 1 exercises missing-segment normalization path rather than literal zero-valued segment fields (equivalent normalization, covered by existing test)",
    "C4 zero-segment cost verified indirectly via total amount 0.005 (no segment-level amount API)"
  ],
  "evidencePaths": [
    "evidence/usage-phase1-r1-recheck.md",
    "%TEMP%/r1-typecheck.log",
    "%TEMP%/r1-lint.log",
    "%TEMP%/r1-test.log",
    "%TEMP%/r1-build.log",
    "%TEMP%/r1-test-verbose.log"
  ]
}
```
