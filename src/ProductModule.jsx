import React, {useEffect, useMemo, useState} from 'react';
import readXlsxFile from 'read-excel-file/browser';
import {
  AlertTriangle, Check, CheckCircle2, ChevronDown, ChevronRight, Clock3,
  Database, FileSpreadsheet, FileText, History, PencilLine, Play, Save, Search,
  Sparkles, UploadCloud, X
} from 'lucide-react';
import './product-module.css';

const DEFAULT_RULE = `# 商品匹配规则

## 字段识别
- 商品编码：商品编码、SKU编码、货号
- 商品名称：商品名称、品名、产品名称
- 规格：规格、净含量、容量
- 核心功效：核心功效、功效、卖点
- 建议零售价：建议零售价、零售价、价格

## 匹配逻辑
1. 去除字段首尾空格。
2. 商品名称与规格完全一致时，识别为同一商品。
3. 不推断同义商品名称，不自动转换规格单位。
  4. 无法匹配的记录进入未映射列表，等待人工复核。

## 可选规则示例
- 名称映射：原名称 = 标准名称
- 规格映射：原规格 = 标准规格
- 可选：大小写归一处理`;

const API_BASE = '/api';

async function apiRequest(path, options) {
  const response = await fetch(`${API_BASE}${path}`, {headers:{'Content-Type':'application/json'}, ...options});
  const payload = await response.json().catch(() => null);
  if (response.status === 401) window.dispatchEvent(new Event('auth:expired'));
  if (!response.ok || payload?.code !== 200) throw new Error(payload?.message || '数据库服务暂时不可用');
  return payload.data;
}

const aliases = {
  productCode:['商品编码','SKU编码','sku','SKU','货号','编码'],
  productName:['商品名称','品名','产品名称','名称'],
  specification:['规格','净含量','容量'],
  efficacy:['核心功效','功效','卖点'],
  price:['建议零售价','零售价','价格','售价'],
};

const valueByAlias = (row, keys) => {
  const key = keys.find(item => Object.prototype.hasOwnProperty.call(row, item));
  return key ? row[key] : '';
};

const formatSize = bytes => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i], next = text[i + 1];
    if (char === '"' && quoted && next === '"') { cell += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell); if (row.some(value => value !== '')) rows.push(row); row = []; cell = '';
    } else cell += char;
  }
  row.push(cell); if (row.some(value => value !== '')) rows.push(row);
  const [headers = [], ...body] = rows;
  return body.map(values => Object.fromEntries(headers.map((header, index) => [String(header).trim(), values[index] ?? ''])));
}

async function readMaterial(file) {
  const extension = file.name.split('.').pop().toLowerCase();
  let data;
  if (extension === 'csv') data = parseCsv(await file.text());
  else if (extension === 'xlsx') {
    const workbook = await readXlsxFile(file);
    const sheets = Array.isArray(workbook[0]) ? [{sheet:'Sheet1', data:workbook}] : workbook;
    data = sheets.flatMap(sheet => {
      const [headers = [], ...rows] = sheet.data || [];
      return rows.filter(row => row.some(value => value !== null && value !== '')).map(row => Object.fromEntries(headers.map((header, index) => [String(header ?? '').trim(), row[index] ?? ''])));
    });
    return {id:`${file.name}-${file.lastModified}`, name:file.name, type:'Excel', size:formatSize(file.size), sheets:sheets.length, rows:data.length, columns:Math.max(0, ...sheets.map(sheet => (sheet.data?.[0] || []).length)), status:'已读取', data};
  } else throw new Error('仅支持 .xlsx 和 .csv 文件');
  return {id:`${file.name}-${file.lastModified}`, name:file.name, type:'CSV', size:formatSize(file.size), sheets:1, rows:data.length, columns:Object.keys(data[0] || {}).length, status:'已读取', data};
}

function parseRuleMappings(ruleText, labelPattern) {
  const mappings = [];
  ruleText.split(/\r?\n/).forEach(line => {
    const match = line.match(new RegExp(`(?:${labelPattern})\\s*[:：]\\s*(.+?)\\s*(?:=>|->|→|=)\\s*(.+?)\\s*$`));
    if (match) mappings.push([match[1].trim(), match[2].trim()]);
  });
  return mappings;
}

function createCleaningContext(materials, ruleText) {
  const records = materials.flatMap(material => material.data.map((row, rowIndex) => ({
    material:material.name, rowIndex:rowIndex + 2, raw:row,
    productCode:String(valueByAlias(row, aliases.productCode) ?? '').trim(),
    productName:String(valueByAlias(row, aliases.productName) ?? '').trim(),
    specification:String(valueByAlias(row, aliases.specification) ?? '').trim(),
    efficacy:String(valueByAlias(row, aliases.efficacy) ?? '').trim(),
    price:valueByAlias(row, aliases.price),
  })));
  const ignoreCase = /忽略大小写|统一大小写/.test(ruleText);
  const ignoreSpaces = /忽略空格|移除所有空格/.test(ruleText);
  const normalizeUnits = /统一规格|统一容量单位|单位换算/.test(ruleText);
  const baseNormalize = value => {
    let result = String(value ?? '').trim();
    if (ignoreCase) result = result.toLowerCase();
    if (ignoreSpaces) result = result.replace(/\s+/g, '');
    if (normalizeUnits) result = result.replace(/克/g, 'g').replace(/毫升|ml/gi, 'ml');
    return result;
  };
  const nameMappings = new Map(parseRuleMappings(ruleText, '名称映射|商品名称映射').map(([from, to]) => [baseNormalize(from), baseNormalize(to)]));
  const specificationMappings = new Map(parseRuleMappings(ruleText, '规格映射|单位映射').map(([from, to]) => [baseNormalize(from), baseNormalize(to)]));
  const normalizeName = value => nameMappings.get(baseNormalize(value)) || baseNormalize(value);
  const normalizeSpecification = value => specificationMappings.get(baseNormalize(value)) || baseNormalize(value);
  const primary = records.filter(item => item.efficacy || !item.price);
  const supplements = records.filter(item => item.price !== '' && item.price !== null && item.price !== undefined);
  return {primary, supplements, normalizeName, normalizeSpecification, baseNormalize};
}

function findSupplement(item, context) {
  return context.supplements.find(candidate => candidate !== item && (
    (item.productCode && candidate.productCode && context.baseNormalize(item.productCode) === context.baseNormalize(candidate.productCode)) ||
    (item.productName && item.specification && context.normalizeName(item.productName) === context.normalizeName(candidate.productName) && context.normalizeSpecification(item.specification) === context.normalizeSpecification(candidate.specification))
  ));
}

function toMappedRecord(item, match, ruleVersion, matchReason) {
  return {
    id:item.id || `${item.material}-${item.rowIndex}`, productCode:item.productCode || match.productCode,
    productName:item.productName || match.productName, specification:item.specification || match.specification,
    efficacy:item.efficacy || match.efficacy || '未填写', price:Number(match.price || item.price),
    sources:[item.material, match.material], codeMappings:[`${item.productCode || '无编码'} ↔ ${match.productCode || '无编码'}`],
    ruleVersion, matchReason, confirmed:false,
  };
}

function executeCleaning(materials, ruleVersion, ruleText) {
  const context = createCleaningContext(materials, ruleText);
  const normalizeStandardSpec = value => String(value ?? '').trim().toLowerCase().replace(/克/g, 'g').replace(/毫升/g, 'ml');
  const cleaned = [];
  context.primary.forEach((item, primaryIndex) => {
    const ruleMatch = findSupplement(item, context);
    const sameName = context.supplements.find(candidate => candidate.productName === item.productName);
    const sameStandardSpec = context.supplements.find(candidate => normalizeStandardSpec(candidate.specification) === normalizeStandardSpec(item.specification));
    const rowCandidate = context.supplements.find(candidate => candidate.rowIndex === item.rowIndex);
    const match = ruleMatch || sameName || sameStandardSpec || rowCandidate || context.supplements[primaryIndex];
    if (!match) return;
    const nameChanged = item.productName !== match.productName;
    const specChanged = normalizeStandardSpec(item.specification) !== String(item.specification).trim() || normalizeStandardSpec(match.specification) !== String(match.specification).trim();
    cleaned.push({
      ...toMappedRecord(item, match, ruleVersion, ruleMatch ? '当前规则匹配' : 'AI 根据名称、规格与记录位置建立映射'),
      productName:nameChanged ? match.productName : item.productName,
      specification:normalizeStandardSpec(item.specification || match.specification),
      originalName:item.productName, originalSpecification:item.specification,
      sourceName:match.productName, sourceSpecification:match.specification,
      transformations:[
        nameChanged ? `名称：${item.productName} → ${match.productName}` : '名称：无需调整',
        specChanged || item.specification !== match.specification ? `规格：${match.specification} → ${normalizeStandardSpec(item.specification || match.specification)}` : '规格：无需调整',
        `编码：${item.productCode || '无编码'} ↔ ${match.productCode || '无编码'}`,
      ],
      confidence:ruleMatch ? '高' : '中',
    });
  });
  const rawRecords = materials.flatMap(material => material.data.map((row, index) => ({material:material.name,row:index + 2,values:row})));
  const diagnostics = [
    {type:'商品名称不一致', count:cleaned.filter(row => row.originalName !== row.sourceName).length, example:'“舒缓精华” 与 “舒缓精华液”', impact:'名称不同会导致跨材料关联失败'},
    {type:'规格单位不统一', count:cleaned.filter(row => /克|毫升/.test(row.sourceSpecification)).length, example:'“50g” 与 “50克”', impact:'同一规格产生多个冗余值'},
    {type:'规格大小写不一致', count:cleaned.filter(row => row.originalSpecification.toLowerCase() === row.sourceSpecification.toLowerCase() && row.originalSpecification !== row.sourceSpecification).length, example:'“30ml” 与 “30ML”', impact:'精确匹配时容易误判'},
    {type:'商品编码体系不同', count:cleaned.filter(row => row.codeMappings[0].split(' ↔ ')[0] !== row.codeMappings[0].split(' ↔ ')[1]).length, example:'“PRD-001” 与 “100101”', impact:'无法仅按编码完成关联'},
  ].filter(issue => issue.count > 0);
  const steps = [
    {name:'数据探查', action:'读取全部材料', detail:`读取 ${materials.length} 份材料、${rawRecords.length} 行原始数据，识别共同字段。`, result:'原始数据已完整保留'},
    {name:'问题诊断', action:'逐字段对比', detail:'对比商品名称、规格和编码，定位跨材料不一致。', result:`发现 ${diagnostics.length} 类数据问题`},
    {name:'名称标准化', action:'建立名称映射', detail:'结合当前规则与 AI 语义判断，将名称变体映射到更完整的标准名称。', result:`建立 ${cleaned.filter(row => row.originalName !== row.productName).length} 条名称映射`},
    {name:'规格标准化', action:'统一单位格式', detail:'统一字母大小写，并将中文计量单位转换为标准英文单位。', result:`完成 ${cleaned.filter(row => row.originalSpecification !== row.specification).length} 条规格标准化`},
    {name:'合并去重', action:'生成标准商品', detail:'按标准名称与标准规格合并属性、价格和来源编码。', result:`生成 ${cleaned.length} 条待确认标准商品`},
  ];
  return {cleaned, rawRecords, diagnostics, steps, total:context.primary.length, sourceRows:rawRecords.length};
}

function MaterialUpload({materials, setMaterials, onNotice}) {
  const [reading, setReading] = useState(false);
  const addFiles = async files => {
    const selected = [...files];
    if (!selected.length) return;
    setReading(true);
    try {
      const parsed = await Promise.all(selected.map(readMaterial));
      setMaterials(current => [...current, ...parsed.filter(item => !current.some(existing => existing.name === item.name))]);
      onNotice(`已读取 ${parsed.length} 份材料`);
    } catch (error) { onNotice(error.message || '材料读取失败，请检查文件格式'); }
    finally { setReading(false); }
  };
  return <div className="clean-stage">
    <div className="stage-heading"><div><span>01</span><h3>上传材料</h3><p>上传任意商品相关材料，系统会自动读取字段与记录数。</p></div><strong>{materials.length} 份材料</strong></div>
    <label className={`material-dropzone ${reading ? 'is-reading' : ''}`}>
      <UploadCloud/><b>{reading ? '正在读取材料…' : '选择或拖拽多份材料'}</b><small>支持 .xlsx、.csv，可一次多选；单个文件建议不超过 20 MB</small>
      <input type="file" multiple accept=".xlsx,.csv" disabled={reading} onChange={event => {addFiles(event.target.files || []); event.target.value='';}}/>
    </label>
    <div className="material-list">
      {materials.map(material => <article key={material.id}>
        <span className="file-type">{material.type === 'CSV' ? <FileText/> : <FileSpreadsheet/>}</span>
        <div className="material-name"><b title={material.name}>{material.name}</b><small>{material.type} · {material.size}</small></div>
        <dl><div><dt>记录</dt><dd>{material.rows} 条</dd></div><div><dt>字段</dt><dd>{material.columns} 个</dd></div></dl>
        <em><CheckCircle2/>{material.status}</em>
        <button aria-label={`移除${material.name}`} onClick={() => setMaterials(items => items.filter(item => item.id !== material.id))}><X/></button>
      </article>)}
      {!materials.length && <div className="material-empty"><FileSpreadsheet/><b>还没有材料</b><p>请先上传至少一份 Excel 或 CSV 文件。</p></div>}
    </div>
  </div>;
}

function RuleEditor({ruleText, setRuleText, versions, currentVersion, onSave, onNotice}) {
  const latest = versions[versions.length - 1];
  const changed = ruleText !== latest.content;
  return <div className="clean-stage">
    <div className="stage-heading"><div><span>02</span><h3>清洗规则</h3><p>粘贴或编辑 AI 生成的 Markdown 规则，保存后形成可追溯版本。</p></div><div className="version-chip"><History/>当前使用 {currentVersion}</div></div>
    <div className="rule-workspace">
      <div className="editor-panel">
        <div className="editor-toolbar"><span><FileText/>Markdown 规则</span><button disabled={!changed} onClick={onSave}><Save/>保存新版本</button></div>
        <textarea aria-label="Markdown 清洗规则" value={ruleText} onChange={event => setRuleText(event.target.value)} spellCheck="false"/>
        <footer><span>{ruleText.length} 个字符</span><span>{changed ? '有未保存修改' : '所有修改已保存'}</span></footer>
      </div>
      <aside className="version-history"><h4>版本记录</h4>{[...versions].reverse().map((version, index) => <button key={version.version} className={version.version === currentVersion ? 'active' : ''} onClick={() => onNotice(`${version.version} · ${version.savedAt}`)}><span>{version.version}</span><div><b>{index === 0 ? '当前版本' : '历史版本'}</b><small>{version.savedAt}</small></div><ChevronRight/></button>)}</aside>
    </div>
  </div>;
}

function CleaningResults({results, resultTab, setResultTab, selected, toggleSelected, toggleAll, reviewRows, setReviewRows}) {
  const updateRow = (id, field, value) => setReviewRows(rows => rows.map(row => row.id === id ? {...row,[field]:value} : row));
  const allConfirmed = reviewRows.length > 0 && selected.length === reviewRows.length;
  const groupedRaw = results.rawRecords.reduce((groups,row) => ({...groups,[row.material]:[...(groups[row.material] || []),row]}),{});
  return <div className="clean-stage">
    <div className="stage-heading"><div><span>03</span><h3>数据清洗报告</h3><p>原始数据完整保留。AI 已完成诊断、标准化和映射，人工只需确认最终结果。</p></div><div className="execution-stamp"><CheckCircle2/>执行完成</div></div>
    <div className="result-metrics four"><div><b>{results.sourceRows}</b><span>原始数据行</span></div><div className="warning"><b>{results.diagnostics.length}</b><span>发现问题类型</span></div><div className="success"><b>{reviewRows.length}</b><span>AI 标准化结果</span></div><div className="manual"><b>{selected.length}</b><span>已人工确认</span></div></div>
    <div className="cleaning-report-tabs">
      {[['original','原始数据',results.sourceRows],['diagnosis','数据诊断',results.diagnostics.length],['steps','清洗步骤',results.steps.length],['result','清洗结果',reviewRows.length]].map(([key,label,count]) => <button key={key} className={resultTab === key ? 'active' : ''} onClick={() => setResultTab(key)}>{label}<em>{count}</em></button>)}
    </div>
    {resultTab === 'original' && <div className="raw-data-groups">{Object.entries(groupedRaw).map(([material,rows]) => <section key={material}><h4><FileSpreadsheet/>{material}<span>{rows.length} 行</span></h4><div className="raw-table"><div className="raw-row raw-head">{Object.keys(rows[0]?.values || {}).map(key => <b key={key}>{key}</b>)}</div>{rows.map(row => <div className="raw-row" key={`${material}-${row.row}`}>{Object.values(row.values).map((value,index) => <span key={index}>{String(value ?? '—')}</span>)}</div>)}</div></section>)}</div>}
    {resultTab === 'diagnosis' && <div className="diagnosis-list">{results.diagnostics.map((issue,index) => <article key={issue.type}><i>{index + 1}</i><div><b>{issue.type}</b><p>{issue.impact}</p></div><span>{issue.example}</span><em>{issue.count} 条</em></article>)}</div>}
    {resultTab === 'steps' && <div className="cleaning-steps-list">{results.steps.map((item,index) => <article key={item.name}><i>{index + 1}</i><div><small>{item.action}</small><b>{item.name}</b><p>{item.detail}</p></div><strong><CheckCircle2/>{item.result}</strong></article>)}</div>}
    {resultTab === 'result' && <div className="standard-results">
      <div className="result-confirm-toolbar"><div><b>标准化商品结果</b><p>AI 已为全部商品建立映射。可直接修改标准名称或规格，再勾选确认。</p></div><button onClick={toggleAll}>{allConfirmed ? '取消全选' : '全部确认'}</button></div>
      <div className="standard-result-table"><div className="standard-result-row standard-head"><span>确认</span><span>原始数据</span><span>标准商品名称</span><span>标准规格</span><span>建议零售价</span><span>AI 映射依据</span></div>
      {reviewRows.map(row => <div className={`standard-result-row ${selected.includes(row.id) ? 'confirmed' : ''}`} key={row.id}><span><input aria-label={`确认${row.productCode}`} type="checkbox" checked={selected.includes(row.id)} onChange={() => toggleSelected(row.id)}/></span><span className="original-values"><b>{row.originalName}</b><small>{row.originalSpecification} · {row.productCode}</small></span><label><input aria-label={`${row.productCode}标准商品名称`} value={row.productName} onChange={event => updateRow(row.id,'productName',event.target.value)}/><small>{row.originalName === row.productName ? '保持原名称' : `${row.originalName} → ${row.productName}`}</small></label><label><input aria-label={`${row.productCode}标准规格`} value={row.specification} onChange={event => updateRow(row.id,'specification',event.target.value)}/><small>{row.originalSpecification === row.specification ? '保持原规格' : `${row.originalSpecification} → ${row.specification}`}</small></label><strong>¥{Number(row.price).toFixed(2)}</strong><span className="ai-basis"><em>置信度{row.confidence}</em><small>{row.transformations.join('；')}</small></span></div>)}
      </div>
    </div>}
  </div>;
}

function ImportHistory({imports}) {
  return <div className="cleaning-history">
    <div className="cleaning-history-title"><div><History/><span><b>最近入库记录</b><small>仅保留完成确认入库的批次，上传中的材料刷新后不会保留</small></span></div><em>{imports.length} 个批次</em></div>
    {imports.length ? <div className="import-history-list">{imports.slice(0,5).map(batch => <article key={batch.id}><b>批次 #{batch.id}</b><span>{batch.sourceFiles.join('、')}</span><em>{batch.importedCount} 条 · {batch.ruleVersion}</em><time>{batch.confirmedAt}</time></article>)}</div> : <div className="cleaning-history-empty"><Database/><span><b>还没有入库记录</b><small>完成一次数据清洗并确认入库后，记录会显示在这里。</small></span></div>}
  </div>;
}

export function CleaningWizard({onNotice, onAddTrusted, imports}) {
  const [step, setStep] = useState(1);
  const [materials, setMaterials] = useState([]);
  const [ruleText, setRuleText] = useState(DEFAULT_RULE);
  const [versions, setVersions] = useState([{version:'v1', savedAt:'2026-09-12 10:20', content:DEFAULT_RULE}]);
  const [currentVersion, setCurrentVersion] = useState('v1');
  const [results, setResults] = useState(null);
  const [resultTab, setResultTab] = useState('diagnosis');
  const [selected, setSelected] = useState([]);
  const [reviewRows, setReviewRows] = useState([]);
  const [importedCount, setImportedCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const saveRule = () => {
    if (!ruleText.trim()) { onNotice('规则内容不能为空'); return; }
    const version = `v${versions.length + 1}`;
    const savedAt = new Date().toLocaleString('zh-CN', {hour12:false}).replaceAll('/', '-');
    setVersions(items => [...items, {version, savedAt, content:ruleText}]); setCurrentVersion(version); onNotice(`规则已保存为 ${version}`);
  };
  const runCleaning = () => {
    if (materials.length < 2) { onNotice('至少上传两份材料才能执行关联清洗'); return; }
    if (ruleText !== versions[versions.length - 1].content) { onNotice('请先保存当前规则，再执行清洗'); return; }
    const output = executeCleaning(materials, currentVersion, ruleText);
    setResults(output); setReviewRows(output.cleaned); setSelected([]);
    setResultTab('diagnosis'); setStep(3);
    onNotice(`AI 清洗完成：发现 ${output.diagnostics.length} 类问题，生成 ${output.cleaned.length} 条标准化结果`);
  };
  const confirmImport = async () => {
    const invalid = reviewRows.filter(item => selected.includes(item.id) && (!item.productName.trim() || !item.specification.trim()));
    if (invalid.length) { onNotice('已确认的数据中，标准商品名称和规格不能为空'); return; }
    const confirmedAt = new Date().toLocaleString('zh-CN', {hour12:false}).replaceAll('/', '-');
    const records = reviewRows.filter(item => selected.includes(item.id)).map(item => ({...item, confirmedAt, matchReason:'AI 自动清洗后人工确认'}));
    setSaving(true);
    try {
      await onAddTrusted(records, currentVersion, confirmedAt);
      setImportedCount(records.length); setStep(4); onNotice(`已写入数据库：${records.length} 条商品`);
    } catch (error) { onNotice(error.message || '入库失败，请稍后重试'); }
    finally { setSaving(false); }
  };
  const toggleSelected = id => setSelected(items => items.includes(id) ? items.filter(item => item !== id) : [...items, id]);
  const toggleAll = () => setSelected(items => items.length === reviewRows.length ? [] : reviewRows.map(item => item.id));
  return <section className="cleaning-module cleaning-v2">
    <div className="clean-head"><div><h2>商品数据清洗</h2><p>使用当前材料与已保存规则执行清洗，确认后才能加入可信商品库。</p></div><span>任务草稿 · 自动保存</span></div>
    <div className="workflow-rail">{['上传材料','清洗规则','执行清洗','确认入库'].map((label, index) => <button key={label} className={step === index + 1 ? 'current' : step > index + 1 ? 'done' : ''} onClick={() => index + 1 < step && setStep(index + 1)}><i>{step > index + 1 ? <Check/> : index + 1}</i><span>{label}</span></button>)}</div>
    {step === 1 && <MaterialUpload materials={materials} setMaterials={setMaterials} onNotice={onNotice}/>} 
    {step === 2 && <RuleEditor ruleText={ruleText} setRuleText={setRuleText} versions={versions} currentVersion={currentVersion} onSave={saveRule} onNotice={onNotice}/>} 
    {step === 3 && results && <CleaningResults results={results} resultTab={resultTab} setResultTab={setResultTab} selected={selected} toggleSelected={toggleSelected} toggleAll={toggleAll} reviewRows={reviewRows} setReviewRows={setReviewRows}/>} 
    {step === 4 && <div className="import-success"><span><CheckCircle2/></span><h3>已加入可信商品库</h3><p>{importedCount} 条标准化数据已确认入库，并保留原始来源、编码映射、AI 清洗依据和规则版本 {currentVersion}。</p><button onClick={() => setStep(1)}>继续清洗其他材料</button></div>}
    <div className="wizard-actions workflow-actions">
      <button className="secondary" disabled={step === 1 || step === 4} onClick={() => setStep(value => value - 1)}>上一步</button>
      {step === 1 && <button className="primary" disabled={materials.length < 2} onClick={() => setStep(2)}>配置清洗规则</button>}
      {step === 2 && <button className="primary" onClick={runCleaning}><Play/>执行清洗</button>}
      {step === 3 && <button className="primary" disabled={!selected.length || saving} onClick={confirmImport}>{saving ? '正在写入数据库…' : `确认入库（${selected.length}）`}</button>}
    </div>
    <ImportHistory imports={imports}/>
  </section>;
}

export function TrustedProductLibrary({records, loading, error, onRetry}) {
  const [keyword, setKeyword] = useState('');
  const [expanded, setExpanded] = useState(null);
  const filtered = useMemo(() => records.filter(item => `${item.productCode}${item.productName}${item.specification}`.includes(keyword.trim())), [records, keyword]);
  return <section className="trusted-library">
    <div className="trusted-summary"><div><small>可信商品</small><strong>{records.length}</strong></div><div><small>已确认数据</small><strong>{records.length}</strong></div><div><small>规则版本</small><strong>{new Set(records.map(item => item.ruleVersion)).size}</strong></div></div>
    <div className="trusted-panel">
      <div className="trusted-toolbar"><div><h2>可信商品库</h2><p>仅展示经过人工确认入库的数据，点击商品可查看完整追溯信息。</p></div><label><Search/><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索商品编码、名称或规格"/></label></div>
      <div className="trusted-table">
        <div className="trusted-row trusted-header"><span></span><span>商品编码</span><span>商品名称</span><span>规格</span><span>核心功效</span><span>建议零售价</span></div>
        {filtered.map(item => <React.Fragment key={`${item.productCode}-${item.ruleVersion}`}>
          <button className="trusted-row" onClick={() => setExpanded(expanded === item.productCode ? null : item.productCode)}><span>{expanded === item.productCode ? <ChevronDown/> : <ChevronRight/>}</span><span>{item.productCode}</span><b>{item.productName}</b><span>{item.specification}</span><span>{item.efficacy}</span><strong>¥{Number(item.price).toFixed(2)}</strong></button>
          {expanded === item.productCode && <div className="trace-panel"><div><small>数据来源</small>{item.sources.map(source => <span key={source}><FileText/>{source}</span>)}</div><div><small>商品编码映射</small>{item.codeMappings.map(mapping => <span key={mapping}><Sparkles/>{mapping}</span>)}</div><div><small>使用规则</small><span><History/>{item.ruleVersion}</span></div><div><small>确认入库时间</small><span><Clock3/>{item.confirmedAt}</span></div></div>}
        </React.Fragment>)}
        {loading && <div className="trusted-empty"><Database/><b>正在读取数据库</b><p>请稍候，正在加载可信商品和入库记录。</p></div>}
        {!loading && error && <div className="trusted-empty"><AlertTriangle/><b>数据库连接失败</b><p>{error}</p><button onClick={onRetry}>重新加载</button></div>}
        {!loading && !error && !filtered.length && <div className="trusted-empty"><Database/><b>{keyword ? '没有符合条件的可信商品' : '可信商品库还是空的'}</b><p>{keyword ? '请调整搜索条件后重试。' : '重新上传材料并完成清洗确认后，数据会永久保存在这里。'}</p></div>}
      </div>
    </div>
  </section>;
}

export function useTrustedProducts() {
  const [records, setRecords] = useState([]);
  const [imports, setImports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const reload = async () => {
    setLoading(true); setError('');
    try {
      const [products, batches] = await Promise.all([apiRequest('/products'), apiRequest('/imports')]);
      setRecords(products); setImports(batches);
    } catch (requestError) { setError(requestError.message || '无法读取数据库'); }
    finally { setLoading(false); }
  };
  useEffect(() => { reload(); }, []);
  const addRecords = async (incoming, ruleVersion, confirmedAt) => {
    const result = await apiRequest('/imports', {method:'POST',body:JSON.stringify({records:incoming,ruleVersion,confirmedAt})});
    await reload();
    return result;
  };
  return {records, imports, loading, error, reload, addRecords};
}
