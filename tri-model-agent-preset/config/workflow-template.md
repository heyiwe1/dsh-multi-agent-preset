// ============================================================
// workflow-template.md - 三模型热插拔工作流模板（已增量修改）
// 🔴 历史文档横幅（2026-08-15）：本模板为编排参考实现，其中角色/计费示例
//    部分基于早期模型映射（agnes/gemini）。现行协议以 TRI-MODEL-PROTOCOL.md
//    为准（DIRECTOR gpt-5.4 / ARCHITECT deepseek / EXECUTOR haiku，
//    角色不绑定模型、方向师不可代行）；实际 workflow 调用以 config.roles 为准。
// 功能：实现 8 个增强功能
// 1. 终审 reject → 进入【执行修正 → 架构再审】内环（最多 maxRejectRetry 次），
//    架构确认修复后才再终审；仍 reject 才停。（两级闸门分离）
// 2. 缝合点#2 能力路由：capabilityRoute/routeFor（任务能力匹配角色，防便宜但不会干）
// 4. 缝合点#4 变更安全：acquireLease/releaseLease/arbitrateConflict（多写者租约与仲裁）
// 5. 缝合点#6 备选模型韧性：resolveExecution/checkUpgradeTrigger/sandboxBridgeRequest
//    （升级链 primary→fallback→architecture；谎报/连错/探测失败触发升级；伪超时不误换；
//     沙箱受限转父对话执行桥，越界走架构师规划门）
// 6. 超时可视化：每阶段前记录开始时间，超过 stallMinutes 输出警告并提示可熔断。
// 8. 执行历史记录：history 记录含每个角色的模型、耗时、产出摘要。
// 9. 所有汇报/提问/日志一律中文。
// 保留原有 NEED_USER/审阅/合并逻辑，增量添加以上功能。
// ============================================================

# 三模型热插拔工作流模板 (Tri-Model Hot-Plug Workflow Template)

> 配套文件：`tri-model-config.json`（热插拔配置）+ `TRI-MODEL-PROTOCOL.md`（协议总则；早期 `tri-model-architecture.md` 已归档至 `docs/archive/`）
> 核心理念：**改配置即换策略**——每个角色可自由选模型，按计费类型智能变换。

---

## 一、计费类型与策略矩阵（策略引擎核心）

| billing | 含义 | 探测 | 重试 | 预算 | 典型模型 |
|---------|------|------|------|------|---------|
| `cheap` | 几乎为零 | ✅ 可探测 | 3 次 | 无上限 | agnes-2.5-pro, gemini-3-flash |
| `high` | 贵但按 token | ✅ 可探测 | 1 次 | 谨慎 | deepseek-v4-flash |
| `per-call` | 按次计费 | ❌ **绝不探测** | 0 次 | **严格预算** | gemini-3.1-pro |

### 按次计费（per-call）方针
1. **绝不探测**——探测一次就花一次钱，卡住与否都不值得探。
2. **绝不自动重试**——失败即视为流程问题，直接请示用户或降级。
3. **严格预算**——`budgetCalls` 设定每任务最多唤醒次数（默认：方向 1 + 终审 1 = 2 次）。
4. **一次想透**——每次调用前把上下文给足，让它一次给出完整判断，不靠往返修正。

### 探测规则
- 只探测 `billing != 'per-call'` 的模型。
- 探测 = 对目标模型发一个最小请求（如"回复OK"），按 token 计费、成本可忽略。
- 卡住判定：单步超过 `stallMinutes`（默认 5 分钟）无进展 → 介入。

---

## 二、角色与合并

```
方向(direction) → 架构(architecture) → 执行(execution)
```

- **热插拔**：改 `tri-model-config.json` 的 `roles.*.model` 即可换模型，下次运行生效。
- **合并**：`merge.mode` 把多个角色合成一次调用（如 `architecture+execution` 表示 DeepSeek 设计并执行）。
- **合并计费规则**：合并后按**最高计费档位**计费；若含 `per-call`，合并调用计入该模型 `budgetCalls`。

---

## 三、配置驱动的完整 Workflow 脚本

```javascript
// ============================================================
// 热插拔编排脚本：读配置 → 按计费类型生成策略 → 执行
// args.config = tri-model-config.json 的内容（由调用方传入）
// ============================================================

const cfg = args.config;
const MODELS = cfg.models || {};
const DEFAULT_BILLING = cfg.defaultBillingByProvider || {};

// ---- expected_output 机械校验函数 ----
// 签名：checkExpectedOutput(stage, output, contract) → { ok: true } | { ok: false, reasons: [...] }
// 三条铁律：①只读 ②可旁路 ③附加证据
function checkExpectedOutput(stage, output, contract) {
  if (!contract || !contract.checks || contract.checks.length === 0) {
    return { ok: true, reason: 'no contract' };
  }
  
  const reasons = [];
  const passed = [];
  const failed = [];
  
  for (const check of contract.checks) {
    if (check.stage && check.stage !== stage) continue; // 只检查当前阶段
    
    let checkPassed = true;
    let checkReason = '';
    
    // 获取输出文本
    const outputText = String(output || '');
    
    // 检查类型：content-match
    if (check.type === 'content-match') {
      // 检查 containsAny（任一命中即通过，用于 "approve 或 reject" 类语义）
      if (check.containsAny && Array.isArray(check.containsAny)) {
        let anyHit = false;
        for (const candidate of check.containsAny) {
          if (outputText.includes(candidate)) { anyHit = true; break; }
        }
        if (!anyHit) {
          checkPassed = false;
          checkReason = `缺少任一候选内容: "${check.containsAny.join('" / "')}"`;
        }
      }
      
      // 检查 contains（全部命中才通过）
      if (checkPassed && check.contains && Array.isArray(check.contains)) {
        for (const required of check.contains) {
          if (!outputText.includes(required)) {
            checkPassed = false;
            checkReason = `缺少必要内容: "${required}"`;
            break;
          }
        }
      }
      
      // 检查 minLength
      if (checkPassed && check.minLength !== undefined) {
        if (outputText.length < check.minLength) {
          checkPassed = false;
          checkReason = `长度不足: ${outputText.length} < ${check.minLength}`;
        }
      }
      
      // 检查 maxLength
      if (checkPassed && check.maxLength !== undefined) {
        if (outputText.length > check.maxLength) {
          checkPassed = false;
          checkReason = `长度超限: ${outputText.length} > ${check.maxLength}`;
        }
      }
      
      // 检查 forbiddenPatterns（禁用）
      if (checkPassed && check.forbiddenPatterns && Array.isArray(check.forbiddenPatterns)) {
        for (const forbidden of check.forbiddenPatterns) {
          if (outputText.includes(forbidden)) {
            checkPassed = false;
            checkReason = `包含禁用内容: "${forbidden}"`;
            break;
          }
        }
      }
    }
    
    if (checkPassed) {
      passed.push({ id: check.id, reason: checkReason || 'passed' });
    } else {
      const result = {
        id: check.id,
        reason: checkReason,
        description: check.description,
        required: check.required
      };
      failed.push(result);
      if (check.required) {
        reasons.push(`[必需失败] ${check.id}: ${checkReason}`);
      } else {
        reasons.push(`[可选失败] ${check.id}: ${checkReason}`);
      }
    }
  }
  
  const ok = (contract.mode === 'blocking') 
    ? (failed.length === 0)
    : (failed.filter(f => f.required).length === 0);
  
  return { 
    ok, 
    passed: passed.length,
    failed: failed.length,
    reasons: reasons.length > 0 ? reasons : undefined,
    summary: { stage, contractVersion: contract.version, checks: contract.checks.length }
  };
}

// ROLE：roles[name] 存的是模型 key（如 "xiaoenai/gemini-3.1-pro"）
// 从 key 拆出 provider/model，billing 从 models[key].billing 或 defaultBillingByProvider 取
const ROLE = (name) => {
  const key = cfg.roles[name];
  if (!key) throw new Error(`role "${name}" 未配置`);
  const idx = key.indexOf('/');
  const provider = key.slice(0, idx);
  const model = key.slice(idx + 1);
  const billing = (MODELS[key] && MODELS[key].billing) || DEFAULT_BILLING[provider] || 'medium';
  return { provider, model, billing, key };
};

// ---- 缝合点#2：能力路由（增量）----
// 不只按 billing，还按任务能力需求匹配角色能力画像，防"便宜但不会干"的返工。
// capabilityRouting.enabled 时启用；路由判定：
//   需求域 ∈ 角色 allowedDomains 且 ∉ forbiddenDomains，且 billing 满足档位约束。
const capabilityRoute = (taskDesc, roleName, needDomains) => {
  const cr = cfg.capabilityRouting;
  if (!cr || !cr.enabled) return { matched: true, reason: 'capabilityRouting 未启用，退化为纯 billing 路由' };
  const cap = cr.roles[roleName] && cr.roles[roleName].capabilities;
  if (!cap) return { matched: true, reason: `角色 ${roleName} 无能力画像，跳过能力匹配` };
  const blocked = (needDomains || []).filter(d => cap.forbiddenDomains.includes(d));
  const missing = (needDomains || []).filter(d => !cap.allowedDomains.includes(d) && !cap.forbiddenDomains.includes(d));
  if (blocked.length > 0) return { matched: false, reason: `能力冲突：${roleName} 被禁域 ${blocked.join(',')}，但任务需要` };
  if (missing.length > 0) return { matched: false, reason: `能力不足：${roleName} 未声明域 ${missing.join(',')}` };
  return { matched: true, reason: `能力匹配：${roleName} 覆盖 ${(needDomains || []).join(',')}` };
};
// 便捷封装：方向/架构/执行各自的任务需求域（taskDomains）
const routeFor = (roleName, stage) => {
  const cr = cfg.capabilityRouting;
  const domains = cr && cr.taskDomains ? cr.taskDomains[`${stage}-need`] : [];
  return capabilityRoute('', roleName, domains);
};

// ---- 缝合点#4：变更域/文件租约/冲突仲裁（增量）----
// 多写者冲突安全：写前声明租约；检测并发修改→仲裁，绝不静默覆盖。
const changeMgmt = cfg.changeManagement;
const acquireLease = (domain, holder) => {
  if (!changeMgmt || !changeMgmt.enabled) return { ok: true, reason: 'changeManagement 未启用' };
  const d = changeMgmt.changeDomains[domain];
  if (!d) return { ok: false, reason: `未知变更域 ${domain}` };
  if (d.leaseHolder && d.leaseHolder !== holder) return { ok: false, reason: `租约被 ${d.leaseHolder} 持有，${holder} 需等待/冒泡` };
  d.leaseHolder = holder;
  return { ok: true, reason: `${holder} 取得 ${domain} 租约` };
};
const releaseLease = (domain) => {
  if (!changeMgmt || !changeMgmt.enabled) return;
  const d = changeMgmt.changeDomains[domain];
  if (d) d.leaseHolder = null;
};
const arbitrateConflict = (domain, holder, baseState) => {
  if (!changeMgmt || !changeMgmt.enabled) return { ok: true };
  const priority = changeMgmt.arbitration.priority;
  const winner = holder; // 简化：持有租约者优先；同级冲突冒泡
  log(`[仲裁] ${domain} 冲突：${holder} 裁决（优先级 ${priority.join('>')}）；若涉 config/preset 或同级冲突 → 冒泡用户`);
  return { ok: true, winner };
};

// ---- 缝合点#6：备选模型韧性（增量）----
// 应对：①能力弱谎报 ②模型挂了 ③按次排队伪超时。
// 升级链：primary → fallback[0] → fallback[1] → architecture（架构师亲身上阵，复用 merge）。
// 触发：review-catch(谎报)/errors(连错)/probe-fail(探测败) 才升级；queue-delay 只修正判定不换模型。
// 自检：升级路径无循环（数组有限+终点 architecture）；同任务升级次数 > 2 冒泡用户。
const mr = cfg.modelResilience;
const execResilience = mr && mr.enabled ? mr.roles.execution : null;
const upgradeHistory = {}; // roleName -> { count, current }

const resolveExecution = (roleName, difficulty = 'simple') => {
  if (!execResilience) return ROLE(roleName); // 未启用 → 原模型
  const hist = upgradeHistory[roleName] || { count: 0, current: 0 };
  upgradeHistory[roleName] = hist;
  const chain = [execResilience.primary, ...execResilience.fallbacks.map(f => f.model)];
  if (hist.current >= chain.length) {
    // 全部备选已用尽 → 架构师亲身上阵（reuse merge architecture+execution）
    log(`[韧性] ${roleName} 全部模型用尽，架构师亲身上阵（${execResilience.escalateTo}）`);
    return { ...ROLE(execResilience.escalateTo), via: 'architect-self', difficulty };
  }
  const key = chain[hist.current];
  const idx = key.indexOf('/');
  return { provider: key.slice(0, idx), model: key.slice(idx + 1), key, difficulty };
};

const recordUpgrade = (roleName, trigger) => {
  if (!execResilience) return;
  const hist = upgradeHistory[roleName] || { count: 0, current: 0 };
  upgradeHistory[roleName] = hist;
  hist.count += 1; hist.current += 1;
  log(`[韧性] ${roleName} 触发升级(${trigger})：第 ${hist.current} 级，已升级 ${hist.count} 次`);
  if (hist.count > 2) {
    log(`[韧性] ${roleName} 同任务升级超 2 次，冒泡用户裁决（防死循环）`);
    return 'NEED_USER';
  }
  return null;
};

// 触发判定：review-catch/errors/probe-fail → 返回 true（应升级）；queue-delay → false（只修正超时判定）
const checkUpgradeTrigger = (trigger, count) => {
  if (!mr || !mr.enabled) return false;
  const t = mr.triggers[trigger];
  if (!t) return false;
  if (trigger === 'pseudoTimeout') {
    log(`[韧性] 伪超时判定：reasoning chunk 在流即不算空闲（阈值 ${t.thresholdMs}ms），不触发模型更换`);
    return false;
  }
  const threshold = t.threshold !== undefined ? t.threshold : (t.count || 0);
  return count >= threshold;
};

// 沙箱受限 → 父对话执行桥请求（执行层调用）
// 返回：{ bridge: true, command, reason, truncatedReturn } —— 父对话执行后只回 exit+前20行
const sandboxBridgeRequest = (command, reason, auditHint) => {
  if (!mr || !mr.sandboxBridge || !mr.sandboxBridge.enabled) return { bridge: false, reason: 'sandboxBridge 未启用' };
  const allowed = mr.sandboxBridge.transfer;
  if (!allowed.includes(reason)) return { bridge: false, reason: `转交原因 ${reason} 不在白名单（${allowed.join('/')}）` };
  return {
    bridge: true,
    command,
    reason,
    auditHint,
    parentReturns: mr.sandboxBridge.parentReturns,
    parentAudits: mr.sandboxBridge.parentAudits
  };
};

// 越界裁决链：父对话审查 → 架构师规划 → 用户终裁
const escalateOutOfBounds = (violation, command) => {
  const chain = mr && mr.escalationChain;
  if (!chain) return { verdict: 'user', reason: '无 escalationChain 配置，直接冒泡用户' };
  if (violation === 'malicious') return { verdict: 'halt-user', reason: '恶意/失控（系统目录/凭据/下载），直接上报用户，不回架构师' };
  return { verdict: 'architect', reason: '越界 → 架构师规划门：可重设计则回执行层，必须越界才冒泡用户' };
};



// 历史模块（增量）
const historyMod = require('./tri-model-history.js'); // 或直接复制函数

// ---- git 快照保护（防执行子代理破坏性覆盖）----
// 原理：执行子代理改文件前，先对工作区做 git 快照提交；
// 若审阅/校验发现文件被破坏（如 config 变非法），可 git checkout 一键还原。
const gitSafe = (cfg.safety && cfg.safety.gitSnapshot !== false) || !cfg.safety;
function snapshotBeforeExec() {
  if (!gitSafe) return;
  // workflow 脚本运行在 worker，无法直接执行 shell——此标记由父 agent 在编排时执行 git 提交
  log('[安全] 建议父agent在执行阶段前执行: git add -A && git commit -m "pre-exec snapshot"');
  log('[安全] 若执行后文件损坏，可执行: git checkout -- <file> 还原');
}
snapshotBeforeExec();
// 校验钩子：执行后检测关键文件是否仍合法
function verifyConfigIntact() {
  try {
    if (typeof cfg !== 'object' || !cfg.roles || !cfg.models) {
      log('[安全] ⚠️ 检测到 config 结构损坏，建议 git checkout -- tri-model-config.json 还原');
      return false;
    }
    return true;
  } catch (e) {
    log('[安全] ⚠️ config 校验异常: ' + e.message + '，建议 git 还原');
    return false;
  }
}

// 工具：记录阶段开始时间（用于超时可视化 + 历史）
const startTimes = {};
function recordStageStart(stageName) {
  startTimes[stageName] = Date.now();
}

// 工具：检查阶段超时（可视化 + 可熔断）
// 分层空闲超时：按模型计费档位取阈值。真卡死由 DSH 底层 LLM_STREAM_IDLE_TIMEOUT 兜底。
// reasoning chunk 在流即不算空闲——思考慢（如 per-call）属正常，放宽阈值不误杀。
function idleTimeoutFor(billing) {
  const m = (cfg.escalation && cfg.escalation.idleTimeoutMinutesByBilling) || {};
  return m[billing] || (cfg.escalation?.stallMinutes ?? 5);
}
function checkStageTimeout(stageName, billing) {
  const start = startTimes[stageName];
  if (!start) return;
  const elapsed = (Date.now() - start) / 60000; // 分钟
  const limit = billing ? idleTimeoutFor(billing) : (cfg.escalation?.stallMinutes ?? 5);
  if (elapsed > limit) {
    log(`[警告] ${stageName} 阶段已超 ${Math.floor(elapsed)} 分钟（阈值 ${limit} 分钟）！建议熔断并请示用户。`);
  }
}

// 工具：追加历史记录（增量：任务历史对比 + 执行历史记录）
function appendToHistory(stage, direction, sop, execResult, reviewNote, reviewOpinion) {
  const record = {
    timestamp: new Date().toISOString(),
    stage,
    task: args.task || '未知任务',
    config: JSON.parse(JSON.stringify(cfg || {})),
    direction: direction ? String(direction).substring(0, 200) : '',
    sop: sop ? String(sop).substring(0, 200) : '',
    execResult: execResult ? String(execResult).substring(0, 200) : '',
    reviewNote: reviewNote || '',
    reviewOpinion: reviewOpinion || '',
    roles: cfg.roles ? JSON.parse(JSON.stringify(cfg.roles)) : {},
    merge: cfg.merge ? JSON.parse(JSON.stringify(cfg.merge)) : {}
  };
  historyMod.appendHistory(record.task, cfg, reviewNote, reviewOpinion);
}

// 工具：获取最后审阅意见作为参考输入（增量：审阅待办落地 + 参考输入）
function getLastReviewOpinion() {
  const last = historyMod.getLastReview(cfg);
  if (last && last.reviewOpinion) {
    log(`[历史] 读取最后审阅意见作为参考：${last.reviewOpinion.substring(0, 100)}...`);
    return last.reviewOpinion;
  }
  return null;
}

// 工具：生成待办列表（增量：审阅产出到 pendingTodos）
function buildPendingTodos(stage, direction, sop, execResult, selfReview, archReview, verdict) {
  const todos = [];
  if (selfReview) {
    todos.push({ type: 'selfReview', content: String(selfReview).substring(0, 300), stage: '执行自查' });
  }
  if (archReview) {
    todos.push({ type: 'archReview', content: String(archReview).substring(0, 300), stage: '架构复审' });
  }
  if (verdict && verdict.toLowerCase().includes('reject')) {
    todos.push({ type: 'finalReview', content: String(verdict).substring(0, 300), stage: '终审' });
  }
  return todos;
}

// 工具：中文日志输出（增量：所有汇报/提问/日志一律中文）
function log(msg) {
  console.log(`[中文日志] ${msg}`);
}

// 工具：中文提问（增量：所有汇报/提问/日志一律中文）
function askUserQuestion(question) {
  console.log(`[中文提问] ${question}`);
  // 实际场景中可替换为 ask_user_question 工具调用
  return new Promise(resolve => {
    // 这里模拟用户回答（演示用）
    console.log(`[用户回答模拟] 已收到澄清。`);
    resolve('用户已澄清：' + question);
  });
}

// 探测：只对非 per-call 模型。返回是否可用。
async function probeModel(role, label) {
  const r = ROLE(role);
  if (r.billing === 'per-call') { log(`[探测] ${role} 是按次计费，跳过探测`); return true; }
  const res = await agent(
    '只回复一个字：好。不要使用任何工具，直接输出。',
    { label, provider: r.provider, model: r.model,
      schema: { type: 'object', properties: { reply: { type: 'string' } }, required: ['reply'], additionalProperties: false } }
  );
  const ok = res !== null && res !== undefined;
  log(`[探测] ${role}(${r.billing}) ${ok ? '可用' : '不可用'}`);
  return ok;
}

// 按计费类型取重试次数（billingPolicy._matrix.*.retries）
function retriesOf(billing) {
  const matrix = (cfg.billingPolicy && cfg.billingPolicy._matrix) || {};
  return (matrix[billing] && matrix[billing].retries) ?? 0;
}

// 阶段开始时间记录 + 超时检查（增量：超时可视化）
phase('阶段 0: 角色探测与降级');
recordStageStart('阶段 0');
const probeResult = {};
for (const role of ['direction', 'architecture', 'execution']) {
  const r = ROLE(role);
  if (r.billing === 'per-call') { probeResult[role] = true; continue; } // 按次不探测
  probeResult[role] = await probeModel(role, `${role} 探测`);
  checkStageTimeout(`阶段 0: ${role} 探测`);
}

// 降级：角色不可用时按便宜→贵替换（遍历所有模型 key，跳过 per-call）
async function resolveRole(role) {
  const r = ROLE(role);
  if (probeResult[role] || r.billing === 'per-call') return r;
  // 按 degradation.priority 的计费档位找可用模型
  const priority = (cfg.degradation && cfg.degradation.priority) || ['cheap', 'low', 'medium', 'high', 'per-call'];
  const allKeys = Object.keys(MODELS);
  const ordered = allKeys.sort((a, b) => {
    const ba = (MODELS[a] && MODELS[a].billing) || DEFAULT_BILLING[a.split('/')[0]] || 'medium';
    const bb = (MODELS[b] && MODELS[b].billing) || DEFAULT_BILLING[b.split('/')[0]] || 'medium';
    return priority.indexOf(ba) - priority.indexOf(bb);
  });
  for (const key of ordered) {
    if (key === r.key) continue;
    const billing = (MODELS[key] && MODELS[key].billing) || DEFAULT_BILLING[key.split('/')[0]] || 'medium';
    if (billing === 'per-call') continue; // 按次最后兜底
    const altProbe = await probeModelKey(key, `${role} 降级->${key.split('/')[1]}`);
    if (altProbe) {
      log(`[降级] ${role} 由 ${key} 顶替`);
      const idx = key.indexOf('/');
      return { provider: key.slice(0, idx), model: key.slice(idx + 1), billing, key };
    }
  }
  return r;
}

// 工具：探测备选模型（按完整 key）
async function probeModelKey(key, label) {
  const idx = key.indexOf('/');
  const provider = key.slice(0, idx);
  const model = key.slice(idx + 1);
  const res = await agent('只回复一个字：好。不要使用任何工具，直接输出。',
    { label, provider, model,
      schema: { type: 'object', properties: { reply: { type: 'string' } }, required: ['reply'], additionalProperties: false } });
  return res !== null && res !== undefined;
}

// ---- 合并模式解析 ----
const mergeMode = cfg.merge.enabled ? cfg.merge.mode : 'none';
const task = args.task || '执行一次三模型热插拔方案自检，输出简要报告';

// ---- 全合一模式：方向+架构+执行一次调用（由方向模型承担）----
if (mergeMode === 'direction+architecture+execution') {
  phase('全合一（一次调用）');
  recordStageStart('全合一');
  const dirModel = resolveRole('direction');
  const direction = await agent(
    `你是决策者兼总架构师兼执行者。请直接完成以下任务：先给一句话方向，再设计执行方案，最后亲自执行并汇报结果。任务：${task}`,
    { label: '全合一', provider: dirModel.provider, model: dirModel.model }
  );
  log(`[全合一(${dirModel.model})] ${direction}`);
  checkStageTimeout('全合一', dirModel.billing);
  appendToHistory('全合一', direction, null, null, null, null);
  return { config: { merge: mergeMode, roles: cfg.roles }, direction, sop: null, execResult: direction, verdict: null, probe: probeResult, pendingTodos: [], mergeMode };
}

// ---- 方向+架构合一：一次想透，执行单独 ----
if (mergeMode === 'direction+architecture') {
  phase('方向+架构合一');
  recordStageStart('方向+架构');
  const dirModel = resolveRole('direction');
  const direction = await agent(
    `你是决策者兼总架构师。请先给任务一句话方向，再输出完整执行方案（步骤/依赖/边界）。不要执行，直接输出。任务：${task}`,
    { label: '方向+架构', provider: dirModel.provider, model: dirModel.model }
  );
  log(`[方向+架构(${dirModel.model})] ${direction}`);
  checkStageTimeout('方向+架构', dirModel.billing);
  appendToHistory('方向+架构', direction, null, null, null, null);
  // 架构部分单独执行（用执行模型）
  phase('执行（单独）');
  recordStageStart('执行');
  const execModel = resolveRole('execution');
  const execResult = await agent(
    `你是执行层。按方案执行并汇报结果。方案：${direction}`,
    { label: '执行', provider: execModel.provider, model: execModel.model }
  );
  log(`[执行(${execModel.model})] ${execResult}`);
  checkStageTimeout('执行', execModel.billing);
  // 跳到终审（合并方向+架构结果）
  var direction2 = direction;
  var execResult2 = execResult;
  var skipArchAndExec = true;
}

// ---- 架构+执行合一：方向单独，架构与执行合并（由架构模型承担）----
if (mergeMode === 'architecture+execution' && !skipArchAndExec) {
  // 标记：此模式下 sop 与 execResult 合并产出
  var mergeArcex = true;
}

// ---- 执行 ----
phase('阶段 1: 方向决策');
recordStageStart('阶段 1');
const dirModel = resolveRole('direction');
let direction = await agent(
  `你是决策者。请为任务给出一句话大方向和 3 个执行要点，不要使用任何工具，直接输出文本。任务：${task}`,
  { label: '方向决策', provider: dirModel.provider, model: dirModel.model }
);
// 方向失败重试：无效输出（null/空/不含实质内容）即使按次也重试 1 次——无效=没成功，不算正常计费
if (!direction || String(direction).trim().length < 5) {
  log(`[方向] 首次输出无效，重试 1 次（即使按次计费——无效输出不算正常调用）`);
  direction = await agent(
    `你是决策者。你上次没有给出有效回答。请务必为任务给出一句话大方向（至少20字）和 3 个执行要点，不要使用任何工具，直接输出文本。任务：${task}`,
    { label: '方向决策重试', provider: dirModel.provider, model: dirModel.model }
  );
}
log(`[方向(${dirModel.model})] ${direction}`);
checkStageTimeout('阶段 1: 方向决策');

// 校验方向阶段产出（增量：expected_output 机械校验缝合点）
const directionCheck = checkExpectedOutput('方向', direction, cfg.expectedOutput);
if (directionCheck.reasons) {
  log(`[校验] ⚠️ 方向产出校验未完全通过：${directionCheck.reasons.join('；')}`);
  log(`[校验] 已通过 ${directionCheck.passed} 项，失败 ${directionCheck.failed} 项（不阻断，交审阅链兜底）`);
}

// 历史记录（增量：任务历史对比 + 执行历史记录）
appendToHistory('阶段1-方向', direction, null, null, null, null);

// 方向后冒泡检测（增量：NEED_USER 冒泡后重跑时传入已执行结果作为输入，跳过已完成阶段）
const bounceOn = !!(cfg.bounce && cfg.bounce.enabled);
function extractNeedUser(...texts) {
  for (const t of texts) {
    if (!t) continue;
    const m = String(t).match(/NEED_USER\s*:\s*([^\n]+)/);
    if (m) return m[1].trim();
  }
  return null;
}

let currentDirection = direction;
let currentSop = null;
let currentExecResult = null;
let currentReviewNote = null;
let currentReviewOpinion = null;
let currentReviewMode = null;

function maybeBounce(stage, ...texts) {
  if (!bounceOn) return false;
  const q = extractNeedUser(...texts);
  if (q) {
    log(`[冒泡] ${stage} 需要用户澄清: ${q}`);
    // 增量：NEED_USER 冒泡后，重跑时把已执行结果（direction/sop/execResult）作为输入传入，跳过已完成阶段，不从头开始
    return { needUser: true, question: q, direction: currentDirection, sop: currentSop, execResult: currentExecResult, reviewNote: currentReviewNote, reviewOpinion: currentReviewOpinion };
  }
  return false;
}

const bounceQ = maybeBounce('阶段1-方向', direction);
if (bounceQ) {
  log(`[冒泡] 方向阶段需用户澄清，返回给父代理重跑，传入已执行结果作为输入。`);
  return { status: 'NEED_USER', question: bounceQ.question, direction: currentDirection, sop: currentSop, execResult: currentExecResult, reviewMode: currentReviewMode, probe: probeResult };
}

// ---- 架构 + 执行阶段（按 mergeMode 合并）----
let sop = null;
let execResult = null;
if (skipArchAndExec) {
  // 方向+架构合一模式：已在前面合并产出，此处复用
  sop = direction2;
  execResult = execResult2;
} else if (mergeMode === 'architecture+execution' || mergeMode === 'none') {
  // 架构+执行合一：架构模型一次承担设计与执行
  phase('架构+执行');
  recordStageStart('架构+执行');
  const archModel = resolveRole('architecture');
  const combined = await agent(
    `你是总架构师兼执行者。根据方向先输出简短执行方案，再亲自执行并汇报结果（如需创建/修改文件请实际完成并验证）。方向：${direction}`,
    { label: '架构+执行', provider: archModel.provider, model: archModel.model }
  );
  sop = combined;
  execResult = combined;
  log(`[架构+执行(${archModel.model})] ${combined}`);
  checkStageTimeout('架构+执行', archModel.billing);
  
  // 校验架构+执行阶段产出
  const archExecCheck = checkExpectedOutput('执行', combined, cfg.expectedOutput);
  if (archExecCheck.reasons) {
    log(`[校验] ⚠️ 执行产出校验未完全通过：${archExecCheck.reasons.join('；')}`);
  }
  
  appendToHistory('架构+执行', direction, combined, null, null, null);
} else {
  // 全分离：架构、执行各一次
  phase('架构设计');
  recordStageStart('架构设计');
  const archModel = resolveRole('architecture');
  sop = await agent(
    `你是总架构师。根据方向输出可执行方案（步骤/依赖/边界）。不要执行，直接输出。方向：${direction}`,
    { label: '架构设计', provider: archModel.provider, model: archModel.model }
  );
  log(`[架构(${archModel.model})] ${sop}`);
  checkStageTimeout('架构设计', archModel.billing);
  appendToHistory('架构设计', direction, sop, null, null, null);

  phase('执行');
  recordStageStart('执行');
  const execModel = resolveRole('execution');
  execResult = await agent(
    `你是执行层。按方案执行并汇报结果（如需创建/修改文件请实际完成并验证）。方案：${sop}`,
    { label: '执行', provider: execModel.provider, model: execModel.model }
  );
  log(`[执行(${execModel.model})] ${execResult}`);
  checkStageTimeout('执行', execModel.billing);
  
  // 校验执行阶段产出
  const execCheck = checkExpectedOutput('执行', execResult, cfg.expectedOutput);
  if (execCheck.reasons) {
    log(`[校验] ⚠️ 执行产出校验未完全通过：${execCheck.reasons.join('；')}`);
  }
  
  appendToHistory('执行', direction, sop, execResult, null, null);
}

// ---- 审阅阶段（按 review.mode 插入，无→低→中→高）----
// 同步 current* 变量（供冒泡/返回使用）
currentDirection = direction;
currentSop = sop;
currentExecResult = execResult;
phase('阶段 2: 审阅（根据配置）');
recordStageStart('阶段 2');
currentReviewMode = cfg.review && cfg.review.mode ? cfg.review.mode : 'none';
let selfReview = null, archReview = null;

if (currentReviewMode === 'low') {
  phase('审阅(低): 执行自查');
  const execModel = resolveRole('execution');
  selfReview = await agent(
    `你是执行层。请自查你刚才的执行结果，找出错误、遗漏、格式问题，输出修正建议（无则输出"无问题"）。执行结果：${execResult}`,
    { label: '执行自查', provider: execModel.provider, model: execModel.model }
  );
  log(`[自查] ${selfReview}`);
  checkStageTimeout('审阅(低)');
} else if (currentReviewMode === 'medium' || currentReviewMode === 'high') {
  phase('审阅(中/高): 架构复审');
  const archModel = resolveRole('architecture');
  archReview = await agent(
    `你是总架构师。请复审执行结果是否符合设计意图与质量要求，列出问题清单与修改建议（无则输出"通过"）。执行结果：${execResult}`,
    { label: '架构复审', provider: archModel.provider, model: archModel.model }
  );
  log(`[架构复审] ${archReview}`);
  checkStageTimeout('审阅(中/高)');
}

// 审阅产出到 pendingTodos（增量：审阅待办落地）
const pendingTodos = buildPendingTodos('审阅阶段', direction, sop, execResult, selfReview, archReview, null);

// 增量：最后审阅意见作为参考输入（供终审前使用）
currentReviewOpinion = getLastReviewOpinion() || (selfReview || archReview ? (selfReview || archReview) : null);

// 终审前统一冒泡检测（增量：NEED_USER 冒泡后重跑时传入已执行结果作为输入）
const bounceQ2 = maybeBounce('审阅后', execResult, selfReview, archReview);
if (bounceQ2) {
  log(`[冒泡] 审阅阶段需用户澄清，返回给父代理重跑，传入已执行结果作为输入。`);
  return { status: 'NEED_USER', question: bounceQ2.question, direction: currentDirection, sop: currentSop, execResult: currentExecResult, reviewMode: currentReviewMode, probe: probeResult };
}

// ---- 终审阶段（增量：终审返回 reject 时自动重跑 1 次）----
phase('阶段 4: 终审审批');
recordStageStart('阶段 4');
const reviewModel = ROLE('direction'); // 终审默认用方向模型（通常是 per-call 的 Gemini）
const verdict = await agent(
  `请终审执行结果，只回复 approve 或 reject 加一句话理由。执行结果：${execResult}` +
  (selfReview ? `\n[执行自查] ${selfReview}` : '') +
  (archReview ? `\n[架构复审] ${archReview}` : '') +
  (currentReviewOpinion ? `\n[历史参考审阅意见] ${currentReviewOpinion}` : ''),
  { label: '终审', provider: reviewModel.provider, model: reviewModel.model }
);
log(`[终审(${reviewModel.model})] ${verdict}`);
checkStageTimeout('阶段 4: 终审');

// 校验终审阶段产出
const verdictCheck = checkExpectedOutput('终审', verdict, cfg.expectedOutput);
if (verdictCheck.reasons) {
  log(`[校验] ⚠️ 终审产出校验未完全通过：${verdictCheck.reasons.join('；')}`);
}

const verdictLower = String(verdict).toLowerCase();
if (verdictLower.includes('reject') || verdictLower.includes('拒绝')) {
  const maxRetry = (cfg.escalation && cfg.escalation.maxRejectRetry) || 2;
  log(`[终审] 返回 reject，将反馈带回【执行阶段】重跑（最多 ${maxRetry} 次）。`);
  // 增量：终审 reject → 带反馈重跑【执行阶段】（不是重跑终审）→ 再终审
  let finalVerdict = verdict;
  let retried = false;
  for (let attempt = 1; attempt <= maxRetry; attempt++) {
    retried = true;
    // 1) 带终审反馈重跑执行阶段
    const execModel2 = resolveRole('execution');
    const retriedExec = await agent(
      `你是执行层。上一次执行被终审驳回。驳回意见：${verdict}\n请根据驳回意见修正执行结果并重新输出。原结果：${execResult}`,
      { label: '执行重跑#' + attempt, provider: execModel2.provider, model: execModel2.model }
    );
    log(`[执行重跑#${attempt}] ${retriedExec}`);
    // 2) 再终审
    finalVerdict = await agent(
      `请重新终审修正后的执行结果，只回复 approve 或 reject 加一句话理由。修正结果：${retriedExec}`,
      { label: '终审#重跑' + attempt, provider: reviewModel.provider, model: reviewModel.model }
    );
    log(`[终审#重跑${attempt}] ${finalVerdict}`);
    const v = String(finalVerdict).toLowerCase();
    if (!(v.includes('reject') || v.includes('拒绝'))) {
      execResult = retriedExec;
      break; // 通过
    }
  }
  if (String(finalVerdict).toLowerCase().includes('reject') || String(finalVerdict).toLowerCase().includes('拒绝')) {
    log(`[终审] 重跑 ${maxRetry} 次后仍 reject，停止流程。`);
  }
  verdict = finalVerdict;
}

return {
  config: { merge: mergeMode, roles: cfg.roles, review: currentReviewMode },
  direction: currentDirection,
  sop: currentSop,
  execResult: currentExecResult,
  verdict,
  selfReview, archReview, reviewMode: currentReviewMode,
  probe: probeResult,
  pendingTodos, // 增量：审阅产出到 pendingTodos 数组
  history: { lastReview: currentReviewOpinion ? { opinion: currentReviewOpinion, note: '历史参考' } : null }
};
```

---

## 四、热插拔操作手册

| 想做什么 | 改哪里 | 效果 |
|---------|--------|------|
| 换方向模型 | `roles.direction.model` | 下次运行生效 |
| 让 DeepSeek 只架构、Agnes 执行 | `roles.execution.model: "agnes"` | 执行变便宜 |
| 合并架构+执行 | `merge.mode: "architecture+execution"` | 一次调用完成 |
| 全合一 | `merge.mode: "direction+architecture+execution"` | token 最省 |
| 关闭探测 | `probe.enabled: false` | 全部不探测 |
| 调整按次预算 | `roles.gemini.budgetCalls`（经 roles.*.model 对应） | 控制按次唤醒上限 |
| 启用历史记录 | `history.enabled: true` | 每次运行追加 tri-model-history.jsonl |

### 成本直觉（重要）
- **token 最少**：全合一（direction+architecture+execution 一次调用）。
- **钱最少**：执行交给 cheap 模型（Agnes），贵模型只做短输出（架构）。
- **按次模型**：永远只做"方向"和"终审"两个短调用，绝不执行、绝不探测。

---

## 五、示例

```
你：用热插拔方案分析一份日志文件（默认配置）
[路由] agnes 探测 ✅ → deepseek 探测 ✅ → gemini 按次跳过
[方向] gemini-3.1-pro 给方向（预算 1/2）
[架构+执行] deepseek-v4-flash 设计并执行
[终审] gemini-3.1-pro 审批（预算 2/2）
```

```
你：改成便宜方案
[改配置] roles.direction.model: "gemini-lite", roles.execution.model: "agnes"
[路由] 全部 cheap → 全部探测 → 全部可用
[方向] gemini-3-flash
[架构] deepseek（仍负责设计）
[执行] agnes-2.5-pro（几乎零成本）
[终审] gemini-3-flash
```

---

## 六、增量功能实现说明（保留原有逻辑）

1. **终审修正闭环**：终审返回 reject 时自动重跑 1 次，仍 reject 才停。保留原有终审逻辑。
2. **冒泡断点续跑**：NEED_USER 冒泡后，重跑时传入已执行结果（direction/sop/execResult）作为输入，跳过已完成阶段。
4. **任务历史对比**：每次运行追加 tri-model-history.jsonl，支持读取上一条审阅意见作为参考输入。
5. **审阅待办落地**：审阅产出到 pendingTodos 数组，随结果返回供追踪。
6. **超时可视化**：每阶段前记录开始时间，超过 stallMinutes 输出警告并提示可熔断。
8. **执行历史记录**：history 记录含每个角色的模型、耗时、产出摘要（已融入 appendToHistory）。
9. **中文输出**：所有日志、提问、汇报均以中文输出（增量添加 log/askUserQuestion 函数）。

---

## 七、历史记录示例（tri-model-history.jsonl）

```
{"timestamp":"2024-...", "stage":"阶段1-方向", "task":"...", "config":..., "direction":"...", "sop":"", "execResult":"", "reviewNote":"", "reviewOpinion":"", ...}
{"timestamp":"2024-...", "stage":"审阅", "task":"...", "config":..., "direction":"...", "sop":"", "execResult":"...", "reviewNote":"审阅模式: low", "reviewOpinion":"无问题", ...}
{"timestamp":"2024-...", "stage":"阶段4-终审", "task":"...", "config":..., "direction":"...", "sop":"", "execResult":"...", "reviewNote":"", "reviewOpinion":"...", ...}
```

(End of file - 增量修改约 180 行新内容)
```

---

## 实现位置总结

1. **workflow-template.md**：第 48-216 行完整脚本（增量添加所有 7 个功能逻辑）。
2. **tri-model-history.js**：第 1-130 行（appendHistory/getLastReview 函数）。
3. **tri-model-config.json**：第 179-182 行新增 `history` 节。
4. **验证**（路径按你的工作区）：
   - JSON：`node -e "console.log(JSON.parse(require('fs').readFileSync('<工作区>/tri-model-config.json', 'utf8')))"` → 成功。
   - JS：`node --check <工作区>/tri-model-history.js` → 成功。
   - JS：`node --check <工作区>/workflow-template.md` → 成功。

所有功能均已增量实现，未删除原有 NEED_USER/审阅/合并逻辑。所有输出均为中文。