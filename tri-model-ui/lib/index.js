import { readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'tri-model-ui'
export const inject = ['webServer']

// 白名单：允许编辑的顶层键
const EDITABLE_KEYS = ['models', 'roles', 'merge', 'review', 'clarify', 'bounce', 'safety']

// 每次计费模型禁止承担的角色
const PER_CALL_FORBIDDEN_ROLES = ['architecture', 'execution']

// 标准的5档计费档位（缺失时回退）
const DEFAULT_BILLING_TIERS = [
  { key: 'cheap', label: '几乎无' },
  { key: 'low', label: '低' },
  { key: 'medium', label: '中' },
  { key: 'high', label: '高' },
  { key: 'per-call', label: '按次' }
]

/**
 * 解析配置文件路径优先级：
 * 1. patch 行 config.configPath
 * 2. 环境变量 DSH_TRI_MODEL_CONFIG
 * 3. 默认工作区 tri-model-config.json
 */
function resolveConfigPath(config) {
  let configPath = config?.configPath || process.env.DSH_TRI_MODEL_CONFIG
  if (!configPath) {
    configPath = join(process.cwd(), 'tri-model-config.json')
  }
  return resolve(process.cwd(), configPath)
}

/**
 * 解析重置基线路径优先级：
 * 1. patch 行 config.resetBaseline
 * 2. 环境变量 DSH_TRI_MODEL_RESET_BASELINE
 * 3. 默认：发布仓内相对路径（仅发布仓有效）
 */
function resolveResetBaseline(config) {
  let resetPath = config?.resetBaseline || process.env.DSH_TRI_MODEL_RESET_BASELINE
  if (!resetPath) {
    try {
      resetPath = fileURLToPath(new URL('../../tri-model-agent-preset/config/tri-model-config.json', import.meta.url))
    } catch {
      return null
    }
  }
  return resolve(process.cwd(), resetPath)
}

/**
 * 读配置文件，返回 {ok:true, ...state} 或 {ok:false, error:{code, message, path?}}
 */
function readConfig(cfgPath) {
  try {
    const content = readFileSync(cfgPath, 'utf8')
    return JSON.parse(content)
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { ok: false, error: { code: 'config-missing', message: 'Config file not found', path: cfgPath } }
    } else if (err instanceof SyntaxError) {
      return { ok: false, error: { code: 'config-invalid', message: 'Config JSON is invalid', path: cfgPath } }
    } else {
      return { ok: false, error: { code: 'read-error', message: err.message, path: cfgPath } }
    }
  }
}

/**
 * 原子写配置文件（dsh-atomic-write 同款模式）
 * 同目录 wx 独占临时文件 + rename
 */
function writeConfig(cfgPath, obj) {
  const dir = dirname(cfgPath)
  mkdirSync(dir, { recursive: true })
  
  const tmpPath = join(dir, `.tri-model-config.json.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`)
  try {
    writeFileSync(tmpPath, JSON.stringify(obj, null, 2) + '\n', { flag: 'wx', mode: 0o644 })
    renameSync(tmpPath, cfgPath)
  } catch (err) {
    try {
      unlinkSync(tmpPath)
    } catch {}
    throw err
  }
}

/**
 * 构造 get-state 响应体
 */
function buildState(config, cfgPath) {
  const billingPolicy = config.billingPolicy || {}
  const billingMatrix = billingPolicy._matrix || {}
  
  // billingTiers 取 _matrix 的 key/label，缺失回退 5 档（fix 8：判空）
  const billingMatrixEntries = Object.entries(billingMatrix)
  const billingTiers = billingMatrixEntries.length > 0 
    ? billingMatrixEntries.map(([key, val]) => ({ key, label: val.label }))
    : DEFAULT_BILLING_TIERS
  
  // merge.options 取 _options（fix 2：恒注入 options，_options 缺失或空时用回退）
  const mergeOptions = (config.merge?._options && config.merge._options.length > 0) ? config.merge._options : [
    'none',
    'architecture+execution',
    'direction+architecture',
    'direction+architecture+execution'
  ]
  
  // review.options 取 _options 的键（fix 2：恒注入 options，_options 缺失或空时用回退）
  const reviewOptions = (config.review?._options && Object.keys(config.review._options).length > 0) ? Object.keys(config.review._options) : ['none', 'low', 'medium', 'high']
  
  // forbiddenRolesByBilling 取 billingPolicy.roleForbidden，缺失回退常量
  const forbiddenRolesByBilling = billingPolicy.roleForbidden || { 'per-call': PER_CALL_FORBIDDEN_ROLES }
  
  // models 仅含已配置模型
  const models = Object.entries(config.models || {}).map(([id, modelCfg]) => ({
    id,
    billing: modelCfg.billing
  }))
  
  return {
    ok: true,
    configPath: cfgPath,
    readonly: false,
    models,
    billingTiers,
    roles: config.roles || { direction: '', architecture: '', execution: '' },
    forbiddenRolesByBilling,
    merge: { ...config.merge, options: mergeOptions },
    review: { ...config.review, options: reviewOptions },
    clarify: config.clarify || { enabled: false },
    bounce: config.bounce || { enabled: false },
    safety: { gitSnapshot: Boolean(config.safety?.gitSnapshot) },
    editableKeys: EDITABLE_KEYS
  }
}

/**
 * 合并更新：仅替换白名单键，其他顶层字段原样保留。
 * safety 特殊：键级合并（保留 current 的 trashDir/_rule 等非面板字段，
 * 面板只编辑 gitSnapshot；整键替换会抹掉静态字段——2026-08-15 复审 P1-1）。
 */
function mergeForWrite(current, updates) {
  const result = { ...current }
  for (const key of EDITABLE_KEYS) {
    if (key in updates) {
      if (key === 'safety' && current.safety && typeof current.safety === 'object') {
        result.safety = { ...current.safety, ...updates.safety }
      } else {
        result[key] = updates[key]
      }
    }
  }
  return result
}

/**
 * 校验 set-config 请求的 updates
 */
function validateUpdates(updates, models) {
  // 键白名单校验
  for (const key of Object.keys(updates)) {
    if (!EDITABLE_KEYS.includes(key)) {
      return { valid: false, error: { code: 'forbidden-key', message: `Forbidden key: ${key}`, key } }
    }
  }
  
  // 如果提交了 models，校验 billing 值
  if (updates.models) {
    for (const [id, modelCfg] of Object.entries(updates.models)) {
      const validBillings = ['cheap', 'low', 'medium', 'high', 'per-call']
      if (!validBillings.includes(modelCfg.billing)) {
        return { valid: false, error: { code: 'invalid-billing', message: `Invalid billing: ${modelCfg.billing}` } }
      }
    }
  }
  
  // 如果提交了 roles，校验模型存在性和 per-call roleForbidden
  if (updates.roles) {
    const mergedModels = Object.assign({}, models, updates.models || {})
    for (const [role, modelId] of Object.entries(updates.roles)) {
      if (modelId && !(modelId in mergedModels)) {
        return { valid: false, error: { code: 'unknown-model', message: `Unknown model: ${modelId}`, role, model: modelId } }
      }
      // 检查 per-call roleForbidden
      if (modelId && mergedModels[modelId]?.billing === 'per-call' && PER_CALL_FORBIDDEN_ROLES.includes(role)) {
        return { valid: false, error: { code: 'per-call-role-forbidden', message: `Per-call model cannot be assigned to ${role} role` } }
      }
    }
  }
  
  // merge.mode 校验
  if (updates.merge) {
    const mergeOptions = ['none', 'architecture+execution', 'direction+architecture', 'direction+architecture+execution']
    if (updates.merge.mode && !mergeOptions.includes(updates.merge.mode)) {
      return { valid: false, error: { code: 'invalid-enum', message: `Invalid merge mode: ${updates.merge.mode}` } }
    }
  }
  
  // review.mode 校验
  if (updates.review) {
    const reviewOptions = ['none', 'low', 'medium', 'high']
    if (updates.review.mode && !reviewOptions.includes(updates.review.mode)) {
      return { valid: false, error: { code: 'invalid-enum', message: `Invalid review mode: ${updates.review.mode}` } }
    }
  }
  
  // 布尔校验
  const booleanFields = ['clarify.enabled', 'bounce.enabled', 'merge.enabled', 'safety.gitSnapshot']
  if (updates.clarify && typeof updates.clarify.enabled !== 'boolean') {
    return { valid: false, error: { code: 'invalid-boolean', message: 'clarify.enabled must be boolean' } }
  }
  if (updates.bounce && typeof updates.bounce.enabled !== 'boolean') {
    return { valid: false, error: { code: 'invalid-boolean', message: 'bounce.enabled must be boolean' } }
  }
  if (updates.merge && 'enabled' in updates.merge && typeof updates.merge.enabled !== 'boolean') {
    return { valid: false, error: { code: 'invalid-boolean', message: 'merge.enabled must be boolean' } }
  }
  if (updates.safety && 'gitSnapshot' in updates.safety && typeof updates.safety.gitSnapshot !== 'boolean') {
    return { valid: false, error: { code: 'invalid-boolean', message: 'safety.gitSnapshot must be boolean' } }
  }
  
  // safety 子键限制：仅允许 gitSnapshot
  if (updates.safety) {
    for (const key of Object.keys(updates.safety)) {
      if (key !== 'gitSnapshot') {
        return { valid: false, error: { code: 'forbidden-key', message: `Forbidden safety key: ${key}`, key } }
      }
    }
  }
  
  return { valid: true }
}

/**
 * GET /tri-model/get-state
 */
function handleGetState(cfgPath) {
  return (req, res) => {
    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: { code: 'method-not-allowed' } }))
      return
    }
    
    try {
      const cfgContent = readFileSync(cfgPath, 'utf8')
      const config = JSON.parse(cfgContent)
      const state = buildState(config, cfgPath)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(state))
    } catch (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: { code: 'config-missing', message: 'Config file not found', path: cfgPath } }))
      } else if (err instanceof SyntaxError) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: { code: 'config-invalid', message: 'Config JSON is invalid', path: cfgPath } }))
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: { code: 'read-error', message: err.message } }))
      }
    }
  }
}

/**
 * POST /tri-model/set-config
 */
function handleSetConfig(cfgPath) {
  return (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: { code: 'method-not-allowed' } }))
      return
    }
    
    let body = ''
    let overflowed = false
    req.on('data', (chunk) => {
      // fix 5：已应答（超限或其它）后不再处理后续 chunk，杜绝二次 writeHead → ERR_HTTP_HEADERS_SENT
      if (res.writableEnded || overflowed) return
      body += chunk
      if (body.length > 1024 * 1024) {
        overflowed = true
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: { code: 'bad-json', message: 'Request body exceeds 1 MiB' } }))
      }
    })
    req.on('end', () => {
      // 超限时已应答，直接返回
      if (res.writableEnded) return

      // 1) 解析请求体（错误 → bad-json）
      let updates
      try {
        const payload = body ? JSON.parse(body) : {}
        updates = payload.updates || {}
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: { code: 'bad-json', message: 'Invalid JSON in request body' } }))
        return
      }

      // fix 1：models 数组→对象映射（在 mergeForWrite 前）
      if (updates.models && Array.isArray(updates.models)) {
        updates.models = updates.models.reduce((acc, item) => {
          if (item.id) acc[item.id] = { billing: item.billing }
          return acc
        }, {})
      }

      // 空更新检查
      if (Object.keys(updates).length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: { code: 'empty-updates', message: 'No updates provided' } }))
        return
      }

      // 2) 读当前配置（错误 → config-missing / config-invalid，与请求体错误区分）
      let current
      try {
        current = JSON.parse(readFileSync(cfgPath, 'utf8'))
      } catch (err) {
        if (err.code === 'ENOENT') {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: { code: 'config-missing', message: 'Config file not found', path: cfgPath } }))
        } else {
          // SyntaxError（JSON 损坏）与其它读错误统一按配置文件问题返回
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: { code: 'config-invalid', message: 'Config JSON is invalid', path: cfgPath } }))
        }
        return
      }

      // 3) 校验 + 合并写回（写失败 → write-error）
      try {
        const validation = validateUpdates(updates, current.models || {})
        if (!validation.valid) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: validation.error }))
          return
        }

        const merged = mergeForWrite(current, updates)
        writeConfig(cfgPath, merged)

        const state = buildState(merged, cfgPath)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(state))
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: { code: 'write-error', message: err.message } }))
      }
    })
  }
}

/**
 * POST /tri-model/reset-config
 */
function handleResetConfig(cfgPath, resetPath) {
  return (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: { code: 'method-not-allowed' } }))
      return
    }
    
    try {
      if (!resetPath) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: { code: 'reset-baseline-missing', message: 'Reset baseline not found. Set DSH_TRI_MODEL_RESET_BASELINE or patch config.resetBaseline' } }))
        return
      }
      
      const baselineContent = readFileSync(resetPath, 'utf8')
      const baseline = JSON.parse(baselineContent)
      
      writeConfig(cfgPath, baseline)
      
      const state = buildState(baseline, cfgPath)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(state))
    } catch (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: { code: 'reset-baseline-missing', message: 'Reset baseline file not found' } }))
      } else if (err instanceof SyntaxError) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: { code: 'baseline-invalid', message: 'Reset baseline JSON is invalid' } }))
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: { code: 'reset-error', message: err.message } }))
      }
    }
  }
}

/**
 * GET /tri-model/build-command
 */
function handleBuildCommand(cfgPath) {
  return (req, res) => {
    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'text/plain' })
      res.end('Method not allowed')
      return
    }
    
    try {
      const cfgContent = readFileSync(cfgPath, 'utf8')
      const config = JSON.parse(cfgContent)
      const roles = config.roles || {}
      
      const command = `tri-model --config "${cfgPath}" --direction ${roles.direction} --architecture ${roles.architecture} --execution ${roles.execution} --merge ${config.merge?.mode || 'none'} --review ${config.review?.mode || 'none'} --clarify ${config.clarify?.enabled ? 'on' : 'off'} --bounce ${config.bounce?.enabled ? 'on' : 'off'} --safety-git ${config.safety?.gitSnapshot ? 'on' : 'off'}`
      
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end(command)
    } catch (err) {
      const msg = err.code === 'ENOENT' ? 'Config file not found' : err instanceof SyntaxError ? 'Config JSON is invalid' : err.message
      res.writeHead(400, { 'Content-Type': 'text/plain' })
      res.end(msg)
    }
  }
}

export function apply(ctx, config) {
  const cfgPath = resolveConfigPath(config)
  const resetPath = resolveResetBaseline(config)
  
  ctx.effect(() => {
    const disposers = [
      ctx.webServer.register({
        kind: 'exact',
        path: '/tri-model/get-state',
        handler: handleGetState(cfgPath)
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: '/tri-model/set-config',
        handler: handleSetConfig(cfgPath)
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: '/tri-model/reset-config',
        handler: handleResetConfig(cfgPath, resetPath)
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: '/tri-model/build-command',
        handler: handleBuildCommand(cfgPath)
      })
    ]
    
    ctx.logger?.info?.(`[tri-model-ui] host: 4 routes registered, configPath=${cfgPath}, resetPath=${resetPath}`)
    
    return () => disposers.forEach(d => d())
  })
}
