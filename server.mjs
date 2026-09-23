import http from 'node:http';
import {createHash, randomBytes, scryptSync, timingSafeEqual} from 'node:crypto';
import {copyFileSync, existsSync, mkdirSync, readFileSync, statSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import Database from 'better-sqlite3';
import {buildAnalysis, decomposeWeeklyReport, documentTitle} from './collaboration-service.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const dataDir = join(root, 'data');
mkdirSync(dataDir, {recursive:true});
const databasePath = join(dataDir, 'chengyan.db');
const seedDatabasePath = join(dataDir, 'seed', 'chengyan-test.db');
if (!existsSync(databasePath) && existsSync(seedDatabasePath)) copyFileSync(seedDatabasePath, databasePath);
const db = new Database(databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS trusted_products (
    product_code TEXT PRIMARY KEY,
    product_name TEXT NOT NULL,
    specification TEXT NOT NULL,
    efficacy TEXT NOT NULL,
    price REAL NOT NULL,
    sources_json TEXT NOT NULL,
    code_mappings_json TEXT NOT NULL,
    rule_version TEXT NOT NULL,
    confirmed_at TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS import_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    imported_count INTEGER NOT NULL,
    rule_version TEXT NOT NULL,
    source_files_json TEXT NOT NULL,
    confirmed_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS import_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL REFERENCES import_batches(id),
    product_code TEXT NOT NULL,
    product_name TEXT NOT NULL,
    specification TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS collaboration_goals (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    objective TEXT NOT NULL,
    owner TEXT NOT NULL,
    period_end TEXT NOT NULL,
    confirmed_at TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS collaboration_key_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    goal_id INTEGER NOT NULL REFERENCES collaboration_goals(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    sort_order INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS collaboration_sources (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    goal_id INTEGER NOT NULL REFERENCES collaboration_goals(id) ON DELETE CASCADE,
    doc_url TEXT NOT NULL,
    sync_frequency TEXT NOT NULL,
    doc_id TEXT,
    doc_title TEXT,
    revision_id INTEGER,
    synced_at TEXT,
    last_error TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS collaboration_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL REFERENCES collaboration_sources(id) ON DELETE CASCADE,
    doc_id TEXT NOT NULL,
    doc_title TEXT NOT NULL,
    revision_id INTEGER NOT NULL,
    content_markdown TEXT NOT NULL,
    synced_at TEXT NOT NULL,
    UNIQUE(doc_id, revision_id)
  );
  CREATE TABLE IF NOT EXISTS collaboration_progress_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NOT NULL REFERENCES collaboration_reports(id) ON DELETE CASCADE,
    key_result_id INTEGER REFERENCES collaboration_key_results(id) ON DELETE SET NULL,
    goal_label TEXT NOT NULL,
    progress TEXT NOT NULL,
    owner TEXT NOT NULL,
    status TEXT NOT NULL,
    risk TEXT NOT NULL,
    is_highlight INTEGER NOT NULL DEFAULT 0,
    source_order INTEGER NOT NULL,
    confirmed_at TEXT
  );
  CREATE TABLE IF NOT EXISTS collaboration_analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NOT NULL REFERENCES collaboration_reports(id) ON DELETE CASCADE,
    headline TEXT NOT NULL,
    overview TEXT NOT NULL,
    progress_json TEXT NOT NULL,
    risks_json TEXT NOT NULL,
    highlights_json TEXT NOT NULL,
    source_item_ids_json TEXT NOT NULL,
    source_snapshot_json TEXT NOT NULL DEFAULT '[]',
    generated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    department TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

const analysisColumns = new Set(db.prepare('PRAGMA table_info(collaboration_analyses)').all().map(column => column.name));
if (!analysisColumns.has('source_snapshot_json')) {
  db.exec("ALTER TABLE collaboration_analyses ADD COLUMN source_snapshot_json TEXT NOT NULL DEFAULT '[]'");
}

const send = (res, status, payload, extraHeaders = {}) => {
  res.writeHead(status, {
    'Content-Type':'application/json; charset=utf-8',
    'Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Headers':'Content-Type',
    'Access-Control-Allow-Methods':'GET,POST,PUT,OPTIONS',
    ...extraHeaders,
  });
  res.end(JSON.stringify(payload));
};

const passwordDigest = (password, salt) => scryptSync(password, salt, 64).toString('hex');
const passwordRecord = password => {
  const salt = randomBytes(16).toString('hex');
  return {salt, hash:passwordDigest(password, salt)};
};
const verifyPassword = (password, row) => {
  const actual = Buffer.from(passwordDigest(password, row.password_salt), 'hex');
  const expected = Buffer.from(row.password_hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};
const userFromRow = row => ({id:row.id, username:row.username, displayName:row.display_name, department:row.department, role:row.role, active:Boolean(row.active), createdAt:row.created_at});
const seedUsers = [
  {username:'admin', displayName:'测试管理员', department:'项目组', role:'admin', password:'AdminTest#2026'},
  {username:'member', displayName:'测试成员', department:'业务组', role:'member', password:'MemberTest#2026'},
];
if (db.prepare('SELECT COUNT(*) AS count FROM users').get().count === 0) {
  const insert = db.prepare('INSERT INTO users (username, display_name, department, role, password_hash, password_salt, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)');
  const now = new Date().toISOString();
  const transaction = db.transaction(() => seedUsers.forEach(user => {
    const password = passwordRecord(user.password);
    insert.run(user.username, user.displayName, user.department, user.role, password.hash, password.salt, now, now);
  }));
  transaction();
}

const parseCookies = req => Object.fromEntries(String(req.headers.cookie || '').split(';').map(item => item.trim()).filter(Boolean).map(item => {
  const separator = item.indexOf('=');
  return separator < 0 ? [item, ''] : [item.slice(0, separator), decodeURIComponent(item.slice(separator + 1))];
}));
const tokenHash = token => createHash('sha256').update(token).digest('hex');
const sessionUser = req => {
  const token = parseCookies(req).chengyan_session;
  if (!token) return null;
  const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`).get(tokenHash(token), new Date().toISOString());
  return row ? userFromRow(row) : null;
};
const sessionCookie = (token, maxAge) => `chengyan_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
const listUsers = () => db.prepare('SELECT * FROM users ORDER BY role, id').all().map(userFromRow);

const readBody = async req => {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error('请求内容过大');
  }
  return JSON.parse(body || '{}');
};

const parseJsonOutput = output => {
  const value = String(output || '').trim();
  try { return JSON.parse(value); } catch {}
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(value.slice(start, end + 1));
  throw new Error('飞书返回了无法识别的响应');
};

const runLark = (args, timeoutMs = 45_000) => new Promise((resolve, reject) => {
  const isWindows = process.platform === 'win32';
  const command = isWindows ? process.execPath : 'lark-cli';
  const commandArgs = isWindows
    ? [join(dirname(process.execPath), 'node_modules', '@larksuite', 'cli', 'scripts', 'run.js'), ...args]
    : args;
  const child = spawn(command, commandArgs, {
    cwd:root,
    windowsHide:true,
    shell:false,
    env:{...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER:'1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER:'1'},
  });
  let stdout = '';
  let stderr = '';
  const timer = setTimeout(() => child.kill(), timeoutMs);
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('error', error => { clearTimeout(timer); reject(error); });
  child.on('close', code => {
    clearTimeout(timer);
    try {
      const result = parseJsonOutput(code === 0 ? stdout : stderr || stdout);
      if (code === 0 && result.ok !== false) resolve(result);
      else reject(Object.assign(new Error(result?.error?.message || '飞书请求失败'), {lark:result?.error}));
    } catch (error) { reject(error); }
  });
});

const validateDocUrl = value => {
  let parsed;
  try { parsed = new URL(String(value || '')); } catch { throw new Error('请填写有效的飞书文档地址'); }
  if (parsed.protocol !== 'https:' || !/^\/(docx|wiki)\//.test(parsed.pathname)) {
    throw new Error('仅支持 HTTPS 的飞书 Docx 或 Wiki 文档地址');
  }
  return parsed.toString();
};

const progressFromRow = row => ({
  id:row.id, reportId:row.report_id, keyResultId:row.key_result_id, goalLabel:row.goal_label,
  progress:row.progress, owner:row.owner, status:row.status, risk:row.risk,
  isHighlight:Boolean(row.is_highlight), sourceOrder:row.source_order,
  confirmed:Boolean(row.confirmed_at), confirmedAt:row.confirmed_at,
});

const analysisSnapshot = items => items.filter(item => item.confirmed).map(item => ({
  id:item.id,
  goalLabel:item.goalLabel,
  progress:item.progress,
  owner:item.owner,
  status:item.status,
  risk:item.risk,
  isHighlight:item.isHighlight,
}));

const backfillAnalysisSnapshots = db.transaction(() => {
  const legacyRows = db.prepare("SELECT id, report_id FROM collaboration_analyses WHERE source_snapshot_json = '[]'").all();
  const reportItems = db.prepare('SELECT * FROM collaboration_progress_items WHERE report_id = ? AND confirmed_at IS NOT NULL ORDER BY source_order');
  const update = db.prepare('UPDATE collaboration_analyses SET source_snapshot_json = ? WHERE id = ?');
  for (const row of legacyRows) {
    const snapshot = analysisSnapshot(reportItems.all(row.report_id).map(progressFromRow));
    if (snapshot.length) update.run(JSON.stringify(snapshot), row.id);
  }
});

backfillAnalysisSnapshots();

const analysisFromRow = row => ({
  id:row.id,
  reportId:row.report_id,
  reportTitle:row.doc_title,
  revisionId:row.revision_id,
  reportSyncedAt:row.report_synced_at,
  headline:row.headline,
  overview:row.overview,
  progress:JSON.parse(row.progress_json),
  risks:JSON.parse(row.risks_json),
  highlights:JSON.parse(row.highlights_json),
  sourceItemIds:JSON.parse(row.source_item_ids_json),
  sourceSnapshot:JSON.parse(row.source_snapshot_json || '[]'),
  generatedAt:row.generated_at,
});

const createAnalysisDraft = state => {
  if (!state.report) throw new Error('请先同步飞书周报');
  const result = buildAnalysis(state.progressItems, state.goal.objective);
  return {
    ...result,
    reportId:state.report.id,
    reportTitle:state.report.docTitle,
    revisionId:state.report.revisionId,
    reportSyncedAt:state.report.syncedAt,
    sourceSnapshot:analysisSnapshot(state.progressItems),
    generatedAt:new Date().toISOString(),
  };
};

const getCollaborationState = () => {
  const goalRow = db.prepare('SELECT * FROM collaboration_goals WHERE id = 1').get();
  if (!goalRow) return {goal:null, source:null, report:null, progressItems:[], analysis:null, analysisHistory:[]};
  const keyResults = db.prepare('SELECT id, title FROM collaboration_key_results WHERE goal_id = 1 ORDER BY sort_order').all();
  const sourceRow = db.prepare('SELECT * FROM collaboration_sources WHERE id = 1').get();
  const reportRow = sourceRow ? db.prepare('SELECT * FROM collaboration_reports WHERE source_id = 1 ORDER BY id DESC LIMIT 1').get() : null;
  const items = reportRow ? db.prepare('SELECT * FROM collaboration_progress_items WHERE report_id = ? ORDER BY source_order').all(reportRow.id).map(progressFromRow) : [];
  const analysisRows = db.prepare(`SELECT a.*, r.doc_title, r.revision_id, r.synced_at AS report_synced_at
    FROM collaboration_analyses a
    JOIN collaboration_reports r ON r.id = a.report_id
    ORDER BY a.id DESC LIMIT 50`).all();
  const history = analysisRows.map(analysisFromRow);
  const currentSnapshot = JSON.stringify(analysisSnapshot(items));
  const currentAnalysis = reportRow
    ? history.find(entry => entry.reportId === reportRow.id && entry.sourceSnapshot.length > 0 && JSON.stringify(entry.sourceSnapshot) === currentSnapshot) || null
    : null;
  return {
    goal:{objective:goalRow.objective, owner:goalRow.owner, periodEnd:goalRow.period_end, confirmedAt:goalRow.confirmed_at, keyResults},
    source:sourceRow ? {docUrl:sourceRow.doc_url, syncFrequency:sourceRow.sync_frequency, docId:sourceRow.doc_id, docTitle:sourceRow.doc_title, revisionId:sourceRow.revision_id, syncedAt:sourceRow.synced_at, lastError:sourceRow.last_error} : null,
    report:reportRow ? {id:reportRow.id, docTitle:reportRow.doc_title, revisionId:reportRow.revision_id, contentMarkdown:reportRow.content_markdown, syncedAt:reportRow.synced_at} : null,
    progressItems:items,
    analysis:currentAnalysis,
    analysisHistory:history,
  };
};

const saveGoal = db.transaction(payload => {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO collaboration_goals (id, objective, owner, period_end, confirmed_at)
    VALUES (1, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET objective=excluded.objective, owner=excluded.owner,
      period_end=excluded.period_end, confirmed_at=excluded.confirmed_at, updated_at=CURRENT_TIMESTAMP`)
    .run(payload.objective, payload.owner, payload.periodEnd, now);
  db.prepare('DELETE FROM collaboration_key_results WHERE goal_id = 1').run();
  const insertKr = db.prepare('INSERT INTO collaboration_key_results (goal_id, title, sort_order) VALUES (1, ?, ?)');
  payload.keyResults.forEach((title, index) => insertKr.run(title, index));
  db.prepare('DELETE FROM collaboration_progress_items').run();
  return getCollaborationState();
});

const storeReport = db.transaction(({docUrl, syncFrequency, docId, title, revisionId, content, syncedAt, items}) => {
  db.prepare(`INSERT INTO collaboration_sources (id, goal_id, doc_url, sync_frequency, doc_id, doc_title, revision_id, synced_at, last_error)
    VALUES (1, 1, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET doc_url=excluded.doc_url, sync_frequency=excluded.sync_frequency,
      doc_id=excluded.doc_id, doc_title=excluded.doc_title, revision_id=excluded.revision_id,
      synced_at=excluded.synced_at, last_error=NULL, updated_at=CURRENT_TIMESTAMP`)
    .run(docUrl, syncFrequency, docId, title, revisionId, syncedAt);
  db.prepare(`INSERT INTO collaboration_reports (source_id, doc_id, doc_title, revision_id, content_markdown, synced_at)
    VALUES (1, ?, ?, ?, ?, ?)
    ON CONFLICT(doc_id, revision_id) DO UPDATE SET doc_title=excluded.doc_title,
      content_markdown=excluded.content_markdown, synced_at=excluded.synced_at`)
    .run(docId, title, revisionId, content, syncedAt);
  const report = db.prepare('SELECT * FROM collaboration_reports WHERE doc_id = ? AND revision_id = ?').get(docId, revisionId);
  db.prepare('DELETE FROM collaboration_progress_items WHERE report_id = ?').run(report.id);
  const insert = db.prepare(`INSERT INTO collaboration_progress_items
    (report_id, key_result_id, goal_label, progress, owner, status, risk, is_highlight, source_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  items.forEach(item => insert.run(report.id, item.keyResultId, item.goalLabel, item.progress, item.owner, item.status, item.risk, item.isHighlight ? 1 : 0, item.sourceOrder));
  return getCollaborationState();
});

const storeAnalysis = db.transaction(() => {
  const state = getCollaborationState();
  const result = createAnalysisDraft(state);
  db.prepare(`INSERT INTO collaboration_analyses
    (report_id, headline, overview, progress_json, risks_json, highlights_json, source_item_ids_json, source_snapshot_json, generated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`) 
    .run(state.report.id, result.headline, result.overview, JSON.stringify(result.progress), JSON.stringify(result.risks), JSON.stringify(result.highlights), JSON.stringify(result.sourceItemIds), JSON.stringify(result.sourceSnapshot), result.generatedAt);
  return getCollaborationState();
});

const productFromRow = row => ({
  productCode:row.product_code, productName:row.product_name, specification:row.specification,
  efficacy:row.efficacy, price:row.price, sources:JSON.parse(row.sources_json),
  codeMappings:JSON.parse(row.code_mappings_json), ruleVersion:row.rule_version, confirmedAt:row.confirmed_at,
});

const importRecords = db.transaction((records, ruleVersion, confirmedAt) => {
  const sourceFiles = [...new Set(records.flatMap(record => record.sources))];
  const batch = db.prepare('INSERT INTO import_batches (imported_count, rule_version, source_files_json, confirmed_at) VALUES (?, ?, ?, ?)')
    .run(records.length, ruleVersion, JSON.stringify(sourceFiles), confirmedAt);
  const upsert = db.prepare(`INSERT INTO trusted_products
    (product_code, product_name, specification, efficacy, price, sources_json, code_mappings_json, rule_version, confirmed_at)
    VALUES (@productCode, @productName, @specification, @efficacy, @price, @sources, @codeMappings, @ruleVersion, @confirmedAt)
    ON CONFLICT(product_code) DO UPDATE SET
      product_name=excluded.product_name, specification=excluded.specification, efficacy=excluded.efficacy,
      price=excluded.price, sources_json=excluded.sources_json, code_mappings_json=excluded.code_mappings_json,
      rule_version=excluded.rule_version, confirmed_at=excluded.confirmed_at, updated_at=CURRENT_TIMESTAMP`);
  const addItem = db.prepare('INSERT INTO import_items (batch_id, product_code, product_name, specification) VALUES (?, ?, ?, ?)');
  records.forEach(record => {
    upsert.run({...record, sources:JSON.stringify(record.sources), codeMappings:JSON.stringify(record.codeMappings), ruleVersion, confirmedAt});
    addItem.run(batch.lastInsertRowid, record.productCode, record.productName, record.specification);
  });
  return Number(batch.lastInsertRowid);
});

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const requestUrl = new URL(req.url, 'http://127.0.0.1:5175');
  if (req.method === 'GET' && requestUrl.pathname === '/api/health') return send(res, 200, {code:200,message:'ok',data:{database:'ready'}});
  if (req.method === 'POST' && requestUrl.pathname === '/api/auth/login') {
    try {
      const payload = await readBody(req);
      const username = String(payload.username || '').trim().toLowerCase();
      const password = String(payload.password || '');
      const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
      if (!row || !row.active || !verifyPassword(password, row)) return send(res, 401, {code:401,message:'账号或密码不正确',data:null});
      db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
      db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(tokenHash(token), row.id, expiresAt, new Date().toISOString());
      return send(res, 200, {code:200,message:'登录成功',data:userFromRow(row)}, {'Set-Cookie':sessionCookie(token, 12 * 60 * 60)});
    } catch (error) {
      return send(res, 400, {code:400,message:error.message || '登录失败',data:null});
    }
  }
  if (req.method === 'GET' && requestUrl.pathname === '/api/auth/me') {
    const user = sessionUser(req);
    return user ? send(res, 200, {code:200,message:'ok',data:user}) : send(res, 401, {code:401,message:'请先登录',data:null});
  }
  if (req.method === 'POST' && requestUrl.pathname === '/api/auth/logout') {
    const token = parseCookies(req).chengyan_session;
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
    return send(res, 200, {code:200,message:'已退出登录',data:null}, {'Set-Cookie':sessionCookie('', 0)});
  }

  const currentUser = sessionUser(req);
  if (requestUrl.pathname.startsWith('/api/') && !currentUser) return send(res, 401, {code:401,message:'登录已失效，请重新登录',data:null});

  if (req.method === 'GET' && requestUrl.pathname === '/api/users') {
    if (currentUser.role !== 'admin') return send(res, 403, {code:403,message:'仅管理员可以查看用户',data:null});
    return send(res, 200, {code:200,message:'ok',data:listUsers()});
  }
  if (req.method === 'POST' && requestUrl.pathname === '/api/users') {
    if (currentUser.role !== 'admin') return send(res, 403, {code:403,message:'仅管理员可以新增用户',data:null});
    try {
      const payload = await readBody(req);
      const username = String(payload.username || '').trim().toLowerCase();
      const displayName = String(payload.displayName || '').trim();
      const department = String(payload.department || '').trim();
      const role = payload.role === 'admin' ? 'admin' : 'member';
      const password = String(payload.password || '');
      if (!/^[a-z0-9._-]{3,30}$/.test(username)) return send(res, 422, {code:422,message:'账号需为 3–30 位字母、数字、点、横线或下划线',data:null});
      if (displayName.length < 2 || displayName.length > 30 || department.length < 2 || department.length > 30) return send(res, 422, {code:422,message:'请填写有效的姓名和部门',data:null});
      if (password.length < 8 || password.length > 72) return send(res, 422, {code:422,message:'密码需为 8–72 位',data:null});
      const record = passwordRecord(password);
      const now = new Date().toISOString();
      const result = db.prepare('INSERT INTO users (username, display_name, department, role, password_hash, password_salt, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)').run(username, displayName, department, role, record.hash, record.salt, now, now);
      return send(res, 201, {code:200,message:'用户已创建',data:userFromRow(db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid))});
    } catch (error) {
      const message = String(error.message || '').includes('UNIQUE') ? '该账号已存在' : '用户创建失败';
      return send(res, 409, {code:409,message,data:null});
    }
  }
  const userRoute = requestUrl.pathname.match(/^\/api\/users\/(\d+)$/);
  if (req.method === 'PUT' && userRoute) {
    if (currentUser.role !== 'admin') return send(res, 403, {code:403,message:'仅管理员可以修改用户',data:null});
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(userRoute[1]));
    if (!target) return send(res, 404, {code:404,message:'用户不存在',data:null});
    const payload = await readBody(req);
    const displayName = String(payload.displayName ?? target.display_name).trim();
    const department = String(payload.department ?? target.department).trim();
    const role = payload.role === 'admin' ? 'admin' : payload.role === 'member' ? 'member' : target.role;
    const active = payload.active === undefined ? Boolean(target.active) : Boolean(payload.active);
    if (target.id === currentUser.id && (!active || role !== 'admin')) return send(res, 422, {code:422,message:'不能停用当前管理员或移除自己的管理员角色',data:null});
    if (displayName.length < 2 || displayName.length > 30 || department.length < 2 || department.length > 30) return send(res, 422, {code:422,message:'请填写有效的姓名和部门',data:null});
    db.prepare('UPDATE users SET display_name=?, department=?, role=?, active=?, updated_at=? WHERE id=?').run(displayName, department, role, active ? 1 : 0, new Date().toISOString(), target.id);
    if (!active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
    return send(res, 200, {code:200,message:'用户已更新',data:userFromRow(db.prepare('SELECT * FROM users WHERE id = ?').get(target.id))});
  }
  if (req.method === 'GET' && requestUrl.pathname === '/api/collaboration') {
    return send(res, 200, {code:200,message:'ok',data:getCollaborationState()});
  }
  if (req.method === 'GET' && requestUrl.pathname === '/api/collaboration/auth') {
    try {
      const auth = await runLark(['auth', 'status', '--json', '--verify'], 15_000);
      const user = auth.identities?.user || {};
      return send(res, 200, {code:200,message:'ok',data:{
        connected:Boolean(auth.verified && user.available && user.verified),
        userName:user.userName || '',
        status:user.status || 'unknown',
      }});
    } catch (error) {
      return send(res, 503, {code:503,message:'未检测到可用的飞书用户授权',data:{connected:false}});
    }
  }
  if (req.method === 'POST' && requestUrl.pathname === '/api/collaboration/goal') {
    try {
      const payload = await readBody(req);
      const objective = String(payload.objective || '').trim();
      const owner = String(payload.owner || '').trim();
      const periodEnd = String(payload.periodEnd || '').trim();
      const keyResults = [...new Set((Array.isArray(payload.keyResults) ? payload.keyResults : []).map(item => String(item || '').trim()).filter(Boolean))];
      if (objective.length < 4 || objective.length > 200) return send(res, 422, {code:422,message:'战略目标需为 4–200 个字',data:null});
      if (owner.length < 2 || owner.length > 30) return send(res, 422, {code:422,message:'请填写有效的负责人',data:null});
      if (!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) return send(res, 422, {code:422,message:'请选择目标截止日期',data:null});
      if (!keyResults.length || keyResults.length > 8 || keyResults.some(item => item.length < 4 || item.length > 200)) {
        return send(res, 422, {code:422,message:'请填写 1–8 条有效的关键结果',data:null});
      }
      const state = saveGoal({objective, owner, periodEnd, keyResults});
      return send(res, 200, {code:200,message:'目标已保存',data:state});
    } catch (error) {
      return send(res, 400, {code:400,message:error.message || '目标保存失败',data:null});
    }
  }
  if (req.method === 'POST' && requestUrl.pathname === '/api/collaboration/sync') {
    const state = getCollaborationState();
    if (!state.goal) return send(res, 409, {code:409,message:'请先保存并确认目标',data:null});
    let docUrl = '';
    let syncFrequency = '仅手动更新';
    try {
      const payload = await readBody(req);
      docUrl = validateDocUrl(payload.docUrl);
      syncFrequency = '仅手动更新';
      const result = await runLark(['docs', '+fetch', '--doc', docUrl, '--doc-format', 'markdown', '--detail', 'simple', '--as', 'user']);
      const document = result.data?.document;
      if (!document?.content) throw new Error('飞书文档内容为空或当前用户无权访问');
      const docId = String(document.document_id || new URL(docUrl).pathname.split('/').filter(Boolean).at(-1));
      const revisionId = Number(document.revision_id ?? 0);
      const title = documentTitle(document.content);
      const items = decomposeWeeklyReport({
        markdown:document.content,
        objective:state.goal.objective,
        owner:state.goal.owner,
        keyResults:state.goal.keyResults,
      });
      if (!items.length) throw new Error('已读取文档，但未识别出可分析的周报事项，请检查文档是否包含具体进展');
      const nextState = storeReport({docUrl, syncFrequency, docId, title, revisionId, content:document.content, syncedAt:new Date().toISOString(), items});
      return send(res, 200, {code:200,message:`已同步飞书周报，识别 ${items.length} 条事项`,data:nextState});
    } catch (error) {
      if (docUrl && state.goal) {
        db.prepare(`INSERT INTO collaboration_sources (id, goal_id, doc_url, sync_frequency, last_error)
          VALUES (1, 1, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET doc_url=excluded.doc_url, sync_frequency=excluded.sync_frequency,
            last_error=excluded.last_error, updated_at=CURRENT_TIMESTAMP`)
          .run(docUrl, syncFrequency, String(error.message || '同步失败').slice(0, 300));
      }
      const status = error.lark?.subtype === 'missing_scope' ? 403 : 422;
      const message = error.lark?.subtype === 'missing_scope'
        ? '飞书应用缺少文档只读权限，请先在飞书开放平台开通'
        : error.message || '飞书周报同步失败';
      return send(res, status, {code:status,message,data:null});
    }
  }
  if (req.method === 'PUT' && requestUrl.pathname === '/api/collaboration/progress') {
    try {
      const payload = await readBody(req);
      const state = getCollaborationState();
      if (!state.report) return send(res, 409, {code:409,message:'请先同步飞书周报',data:null});
      const items = Array.isArray(payload.items) ? payload.items : [];
      const existingIds = new Set(state.progressItems.map(item => item.id));
      const keyResultMap = new Map(state.goal.keyResults.map(item => [item.id, item.title]));
      if (!items.length || items.some(item => !existingIds.has(Number(item.id)))) {
        return send(res, 422, {code:422,message:'待确认事项与当前周报不匹配',data:null});
      }
      const update = db.prepare(`UPDATE collaboration_progress_items SET key_result_id=?, goal_label=?, progress=?, owner=?, status=?, risk=?, confirmed_at=? WHERE id=? AND report_id=?`);
      const commit = db.transaction(() => {
        for (const item of items) {
          const progress = String(item.progress || '').trim();
          const owner = String(item.owner || '').trim();
          const status = ['推进中', '有风险', '已完成'].includes(item.status) ? item.status : '推进中';
          const keyResultId = keyResultMap.has(Number(item.keyResultId)) ? Number(item.keyResultId) : null;
          const goalLabel = keyResultId ? keyResultMap.get(keyResultId) : state.goal.objective;
          if (progress.length < 4 || progress.length > 500 || !owner) throw new Error('进展内容和负责人不能为空');
          update.run(keyResultId, goalLabel, progress, owner, status, String(item.risk || '无').trim() || '无', item.confirmed ? new Date().toISOString() : null, Number(item.id), state.report.id);
        }
      });
      commit();
      return send(res, 200, {code:200,message:'确认结果已保存',data:getCollaborationState()});
    } catch (error) {
      return send(res, 422, {code:422,message:error.message || '事项保存失败',data:null});
    }
  }
  if (req.method === 'POST' && requestUrl.pathname === '/api/collaboration/analysis/preview') {
    try {
      const draft = createAnalysisDraft(getCollaborationState());
      return send(res, 200, {code:200,message:'真实周报分析草稿已生成',data:draft});
    } catch (error) {
      return send(res, 422, {code:422,message:error.message || '分析生成失败',data:null});
    }
  }
  if (req.method === 'POST' && requestUrl.pathname === '/api/collaboration/analysis') {
    try {
      const state = storeAnalysis();
      return send(res, 200, {code:200,message:'真实周报分析已生成并保存',data:state});
    } catch (error) {
      return send(res, 422, {code:422,message:error.message || '分析生成失败',data:null});
    }
  }
  if (req.method === 'GET' && requestUrl.pathname === '/api/products') {
    const rows = db.prepare('SELECT * FROM trusted_products ORDER BY confirmed_at DESC, product_code').all();
    return send(res, 200, {code:200,message:'ok',data:rows.map(productFromRow)});
  }
  if (req.method === 'GET' && requestUrl.pathname === '/api/imports') {
    const rows = db.prepare('SELECT * FROM import_batches ORDER BY id DESC').all().map(row => ({
      id:row.id, importedCount:row.imported_count, ruleVersion:row.rule_version,
      sourceFiles:JSON.parse(row.source_files_json), confirmedAt:row.confirmed_at,
    }));
    return send(res, 200, {code:200,message:'ok',data:rows});
  }
  if (req.method === 'POST' && requestUrl.pathname === '/api/imports') {
    try {
      const payload = await readBody(req);
      const records = Array.isArray(payload.records) ? payload.records : [];
      if (!records.length) return send(res, 400, {code:400,message:'没有可入库的确认数据',data:null});
      if (records.some(item => !item.productCode || !item.productName || !item.specification || !Number.isFinite(Number(item.price)))) {
        return send(res, 422, {code:422,message:'商品编码、名称、规格和价格均为必填项',data:null});
      }
      const confirmedAt = payload.confirmedAt || new Date().toISOString();
      const batchId = importRecords(records, payload.ruleVersion || 'unknown', confirmedAt);
      return send(res, 201, {code:200,message:'入库成功',data:{batchId,importedCount:records.length}});
    } catch (error) {
      return send(res, 500, {code:500,message:'数据库写入失败',data:null});
    }
  }
  if (req.method === 'GET' && !requestUrl.pathname.startsWith('/api/')) {
    const distDir = join(root, 'dist');
    const requestedPath = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '');
    const candidatePath = join(distDir, requestedPath || 'index.html');
    const filePath = existsSync(candidatePath) && statSync(candidatePath).isFile() ? candidatePath : join(distDir, 'index.html');
    if (existsSync(filePath)) {
      const extension = filePath.split('.').pop()?.toLowerCase();
      const contentTypes = {html:'text/html; charset=utf-8', js:'text/javascript; charset=utf-8', css:'text/css; charset=utf-8', json:'application/json; charset=utf-8', svg:'image/svg+xml', png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', webp:'image/webp'};
      res.writeHead(200, {'Content-Type':contentTypes[extension] || 'application/octet-stream'});
      return res.end(readFileSync(filePath));
    }
  }
  return send(res, 404, {code:404,message:'接口不存在',data:null});
});

const port = Number(process.env.PORT || 5175);
const host = process.env.HOST || '127.0.0.1';
server.listen(port, host, () => console.log(`Chengyan ready at http://${host}:${port}`));
