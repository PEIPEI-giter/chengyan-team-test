import crypto from 'node:crypto';
import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import Database from 'better-sqlite3';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const workspaceId = 'ws-n9rsdudcc72hg06s';
const knowledgeBaseId = 'ge1t4d7g4o';
const baseUrl = `https://${workspaceId}.cn-beijing.maas.aliyuncs.com`;
const apiKey = process.env.BAILIAN_API_KEY?.trim();

if (!apiKey || /你的.*api.?key/i.test(apiKey)) {
  throw new Error('未检测到有效的 BAILIAN_API_KEY，请配置后重新运行。');
}

const db = new Database(join(root, 'data', 'chengyan.db'), {readonly: true});
const products = db.prepare('SELECT * FROM trusted_products ORDER BY product_code').all();
db.close();

if (!products.length) throw new Error('可信商品库为空，没有可同步的数据。');

const asList = value => {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const displayPrice = value => `¥${Number(value).toFixed(2)}`;
const exportedAt = new Date();
const markdown = [
  '# 澄研可信商品库',
  '',
  `- 业务空间：${workspaceId}`,
  `- 商品数量：${products.length}`,
  `- 导出时间：${exportedAt.toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai'})}`,
  '',
  ...products.flatMap(product => [
    `## ${product.product_code} ${product.product_name}`,
    '',
    `- 商品编码：${product.product_code}`,
    `- 商品名称：${product.product_name}`,
    `- 规格：${product.specification}`,
    `- 核心功效：${product.efficacy}`,
    `- 建议零售价：${displayPrice(product.price)}`,
    `- 商品编码映射：${asList(product.code_mappings_json).join('、') || '无'}`,
    `- 数据来源：${asList(product.sources_json).join('、') || '无'}`,
    `- 清洗规则版本：${product.rule_version}`,
    `- 确认入库时间：${product.confirmed_at}`,
    '',
  ]),
].join('\n');

const timestamp = exportedAt.toISOString().replace(/[:.]/g, '-');
const fileName = `澄研可信商品库-${timestamp}.md`;
const exportDir = join(root, 'data', 'exports');
const exportPath = join(exportDir, fileName);
mkdirSync(exportDir, {recursive: true});
writeFileSync(exportPath, markdown, 'utf8');
const content = Buffer.from(markdown, 'utf8');
const contentMd5 = crypto.createHash('md5').update(content).digest('hex');

const request = async (path, {method = 'GET', body} = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(body ? {'Content-Type': 'application/json'} : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const raw = await response.text();
  let payload;
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = {message: raw}; }
  if (!response.ok || (payload.code && ![200, '200', 'Success'].includes(payload.code))) {
    throw new Error(`${method} ${path} 失败（HTTP ${response.status}）：${payload.message || payload.code || '未知错误'}${payload.requestId ? `，requestId=${payload.requestId}` : ''}`);
  }
  return payload;
};

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

console.log(`准备同步 ${products.length} 条可信商品数据。`);
console.log(`已生成知识文档：${exportPath}`);

const lease = await request('/api/v1/connector/dash/applyFileUploadLease', {
  method: 'POST',
  body: {category: 'default', fileName, sizeBytes: String(content.length), contentMd5},
});
const leaseId = lease.data?.leaseId;
const uploadUrl = lease.data?.param?.url;
const uploadHeaders = lease.data?.param?.headers || {};
if (!leaseId || !uploadUrl) throw new Error('百炼未返回有效的上传凭证。');

const upload = await fetch(uploadUrl, {
  method: 'PUT',
  headers: uploadHeaders,
  body: content,
  signal: AbortSignal.timeout(60_000),
});
if (!upload.ok) throw new Error(`文件上传失败（HTTP ${upload.status}）。`);
console.log('文件已上传，正在注册并解析。');

const registered = await request('/api/v1/connector/dash/addFile', {
  method: 'POST',
  body: {leaseId, category: 'default', categoryType: 'UNSTRUCTURED', parser: 'AUTO_SELECT'},
});
const fileId = registered.data?.fileId;
if (!fileId) throw new Error('百炼未返回有效的 fileId。');
console.log(`文件已注册：fileId=${fileId}`);

let parseStatus = '';
for (let attempt = 0; attempt < 60; attempt += 1) {
  const described = await request('/api/v1/connector/dash/describeFile', {
    method: 'POST', body: {fileId},
  });
  const nextStatus = described.data?.status;
  if (nextStatus !== parseStatus) console.log(`文档解析状态：${nextStatus || '未知'}`);
  parseStatus = nextStatus;
  if (parseStatus === 'PARSE_SUCCESS') break;
  if (parseStatus === 'FAIL' || parseStatus === 'PARSE_FAILED') {
    throw new Error(`文档解析失败：${described.data?.message || '未提供原因'}`);
  }
  await wait(5_000);
}
if (parseStatus !== 'PARSE_SUCCESS') throw new Error('等待文档解析超时。');

const job = await request('/api/v1/indices/rag/index/job/create', {
  method: 'POST',
  body: {
    indexId: knowledgeBaseId,
    sourceType: 'DATA_CENTER_FILE',
    docIds: [fileId],
    chunkMode: 'h2',
    enableHeaders: true,
  },
});
const ingestionId = job.data?.ingestionId;
if (!ingestionId) throw new Error('百炼未返回有效的 ingestionId。');
console.log(`已提交知识库索引任务：ingestionId=${ingestionId}`);

let ingestionStatus = '';
for (let attempt = 0; attempt < 120; attempt += 1) {
  const status = await request(`/api/v1/indices/rag/index_job/status?index_id=${encodeURIComponent(knowledgeBaseId)}&job_id=${encodeURIComponent(ingestionId)}`);
  const nextStatus = status.data?.ingestion_status;
  if (nextStatus !== ingestionStatus) console.log(`知识库索引状态：${nextStatus || '未知'}`);
  ingestionStatus = nextStatus;
  if (ingestionStatus === 'COMPLETED') break;
  if (['FAILED', 'FAIL', 'CANCELLED'].includes(ingestionStatus)) {
    throw new Error(`知识库索引失败：${status.data?.message || '未提供原因'}`);
  }
  await wait(5_000);
}
if (ingestionStatus !== 'COMPLETED') throw new Error('等待知识库索引完成超时。');

const listed = await request(`/api/v1/indices/rag/index/files?index_id=${encodeURIComponent(knowledgeBaseId)}&page_number=1&page_size=100`);
const documents = listed.data?.rows || listed.data?.documents || listed.data?.files || listed.data?.items || [];
const verified = documents.some(document =>
  document.fileId === fileId || document.file_id === fileId || document.doc_id === fileId ||
  document.name === fileName || document.fileName === fileName || `${document.doc_name}.${document.doc_type}` === fileName
);

console.log(`同步完成：knowledgeBaseId=${knowledgeBaseId}`);
console.log(`校验结果：${verified ? '已在知识库文档列表中找到该文件' : '索引已完成，但文档列表返回结构中未匹配到文件名或 fileId'}`);
console.log(JSON.stringify({productCount: products.length, fileName, fileId, ingestionId, ingestionStatus, verified}, null, 2));
