import React, {useEffect, useMemo, useState} from 'react';
import {
  AlertTriangle, ArrowLeft, CheckCircle2, CircleAlert, FileText, Lightbulb, Link2,
  Plus, RefreshCw, Save, Target, Trash2, TrendingUp, UserRound,
} from 'lucide-react';

const API_BASE = '/api';

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers:{'Content-Type':'application/json', ...(options.headers || {})},
    });
  } catch {
    throw new Error('无法连接本地服务，请确认 API 已启动');
  }
  const payload = await response.json().catch(() => null);
  if (response.status === 401) window.dispatchEvent(new Event('auth:expired'));
  if (!response.ok || payload?.code !== 200) throw new Error(payload?.message || '请求失败，请稍后重试');
  return payload.data;
}

const blankGoal = {objective:'', owner:'', periodEnd:'', keyResults:['']};
const blankSource = {docUrl:'', syncFrequency:'仅手动更新'};

const formatTime = value => value
  ? new Intl.DateTimeFormat('zh-CN', {timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false}).format(new Date(value)).replaceAll('/', '-')
  : '—';

function AnalysisList({items, empty}) {
  return items?.length ? <ul>{items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul> : <p>{empty}</p>;
}

function AnalysisRecordDetail({record, onBack}) {
  const owners = record.sourceSnapshot.filter((item, index, source) => source.findIndex(candidate => candidate.goalLabel === item.goalLabel && candidate.owner === item.owner) === index);
  return <div className="history-detail">
    <button className="history-back" onClick={onBack}><ArrowLeft/>返回记录列表</button>
    <div className="analysis-head"><div><h3>{record.reportTitle} · rev {record.revisionId}</h3><p>记录 #{record.id} · 保存于 {formatTime(record.generatedAt)} · {record.sourceItemIds.length} 条确认事项</p></div><span><CheckCircle2/>已保存分析</span></div>
    <div className="analysis-grid"><article className="analysis-summary"><small>总体判断</small><h3>{record.headline}</h3><p>{record.overview}</p></article><article><TrendingUp/><div><b>核心进展</b><AnalysisList items={record.progress} empty="未识别到明确的正向进展。"/></div></article><article className="warning"><CircleAlert/><div><b>进展偏少 / 风险阻塞</b><AnalysisList items={record.risks} empty="已确认事项中未识别到明确风险。"/></div></article><article className="highlight"><Lightbulb/><div><b>创新亮点</b><AnalysisList items={record.highlights} empty="本期未识别到明确的创新或试点表述。"/></div></article></div>
    <div className="confirmed-source"><b>该记录采用的事项快照 · {record.sourceSnapshot.length} 条</b>{owners.map(item => <span key={`${item.goalLabel}-${item.owner}`}><CheckCircle2/>{item.goalLabel} · {item.owner}</span>)}</div>
    <div className="snapshot-list">{record.sourceSnapshot.map((item, index) => <article key={`${item.id}-${index}`}><div><b>{item.progress}</b><small>{item.goalLabel} · {item.owner || '未填写负责人'}</small></div><span className={item.status === '有风险' ? 'risk' : ''}>{item.status}</span>{item.risk && <p>风险 / 阻塞：{item.risk}</p>}</article>)}</div>
  </div>;
}

export function CollaborationWorkflow({onNotice, createSignal = 0}) {
  const [step, setStep] = useState(() => Math.min(4, Math.max(1, Number(new URLSearchParams(location.search).get('collabStep')) || 1)));
  const [selectedHistoryId, setSelectedHistoryId] = useState(() => Number(new URLSearchParams(location.search).get('analysisId')) || null);
  const [state, setState] = useState(null);
  const [auth, setAuth] = useState(null);
  const [goalForm, setGoalForm] = useState(blankGoal);
  const [sourceForm, setSourceForm] = useState(blankSource);
  const [items, setItems] = useState([]);
  const [analysisDraft, setAnalysisDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [creatingNew, setCreatingNew] = useState(false);

  const confirmedCount = useMemo(() => items.filter(item => item.confirmed).length, [items]);

  const applyState = next => {
    setState(next);
    if (next.goal) setGoalForm({
      objective:next.goal.objective,
      owner:next.goal.owner,
      periodEnd:next.goal.periodEnd,
      keyResults:next.goal.keyResults.map(item => item.title),
    });
    if (next.source) setSourceForm({docUrl:next.source.docUrl, syncFrequency:next.source.syncFrequency});
    setItems(next.progressItems || []);
    setAnalysisDraft(next.analysis || null);
  };

  const load = async () => {
    setLoading(true);
    setError('');
    const [collaborationResult, authResult] = await Promise.allSettled([
      request('/collaboration'), request('/collaboration/auth'),
    ]);
    if (collaborationResult.status === 'fulfilled') applyState(collaborationResult.value);
    else setError(collaborationResult.reason.message);
    setAuth(authResult.status === 'fulfilled' ? authResult.value : {connected:false});
    setLoading(false);
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!createSignal) return;
    setCreatingNew(true);
    setGoalForm({...blankGoal, keyResults:['']});
    setSourceForm({...blankSource});
    setItems([]);
    setAnalysisDraft(null);
    setError('');
    setSelectedHistoryId(null);
    setStep(1);
    const params = new URLSearchParams(location.search);
    params.delete('analysisId');
    history.replaceState(null, '', `${location.pathname}?${params.toString()}`);
    onNotice('已进入新建协同内容，原有分析记录会继续保留');
  }, [createSignal]);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    params.set('section', '团队协同');
    params.set('collabStep', String(step));
    history.replaceState(null, '', `${location.pathname}?${params.toString()}`);
  }, [step]);

  const run = async (label, action, successMessage) => {
    setWorking(label);
    setError('');
    try {
      const next = await action();
      if (next) applyState(next);
      if (successMessage) onNotice(successMessage);
      return true;
    } catch (requestError) {
      setError(requestError.message);
      return false;
    } finally {
      setWorking('');
    }
  };

  const saveGoal = async () => {
    const success = await run('goal', () => request('/collaboration/goal', {
      method:'POST',
      body:JSON.stringify({...goalForm, keyResults:goalForm.keyResults.filter(item => item.trim())}),
    }), '目标与关键结果已真实保存');
    if (success) {
      setCreatingNew(false);
      setStep(2);
    }
  };

  const syncReport = async () => {
    const success = await run('sync', () => request('/collaboration/sync', {
      method:'POST', body:JSON.stringify(sourceForm),
    }));
    if (success) {
      onNotice('飞书周报同步完成，已生成待确认拆解');
      setStep(3);
    }
  };

  const saveProgress = async records => run('progress', () => request('/collaboration/progress', {
    method:'PUT', body:JSON.stringify({items:records}),
  }), '已保存人工确认结果');

  const confirmOne = index => saveProgress([{...items[index], confirmed:true}]);
  const confirmAll = () => saveProgress(items.map(item => ({...item, confirmed:true})));

  const generateAnalysis = async (moveNext = false) => {
    setWorking('analysis');
    setError('');
    try {
      const draft = await request('/collaboration/analysis/preview', {method:'POST'});
      setAnalysisDraft(draft);
      onNotice('已重新生成分析草稿，确认无误后请保存');
      if (moveNext) setStep(4);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setWorking('');
    }
  };

  const saveAnalysis = () => run('saveAnalysis', () => request('/collaboration/analysis', {method:'POST'}), '分析已保存，历史记录已更新');

  const updateGoal = (key, value) => setGoalForm(current => ({...current, [key]:value}));
  const updateKr = (index, value) => setGoalForm(current => ({...current, keyResults:current.keyResults.map((item, itemIndex) => itemIndex === index ? value : item)}));
  const removeKr = index => setGoalForm(current => ({...current, keyResults:current.keyResults.filter((_, itemIndex) => itemIndex !== index)}));
  const updateItem = (index, key, value) => setItems(current => current.map((item, itemIndex) => itemIndex === index ? {...item, [key]:value, confirmed:false} : item));
  const openHistory = id => {
    setSelectedHistoryId(id);
    const params = new URLSearchParams(location.search);
    params.set('analysisId', String(id));
    history.replaceState(null, '', `${location.pathname}?${params.toString()}`);
  };
  const closeHistory = () => {
    setSelectedHistoryId(null);
    const params = new URLSearchParams(location.search);
    params.delete('analysisId');
    history.replaceState(null, '', `${location.pathname}?${params.toString()}`);
  };

  if (loading) return <section className="collab-module collab-loading"><RefreshCw className="spin"/><p>正在读取已保存的目标与飞书同步状态…</p></section>;

  const analysis = analysisDraft;
  const historyRecords = state?.analysisHistory || [];
  const selectedHistory = historyRecords.find(record => record.id === selectedHistoryId) || null;
  const goalValid = goalForm.objective.trim().length >= 4
    && goalForm.owner.trim().length >= 2
    && Boolean(goalForm.periodEnd)
    && goalForm.keyResults.some(item => item.trim().length >= 4);
  const analysisSources = analysis?.sourceSnapshot?.length
    ? analysis.sourceSnapshot
    : items.filter(item => analysis?.sourceItemIds?.includes(item.id));
  const analysisOwners = analysisSources.filter((item, index, source) => source.findIndex(candidate => candidate.goalLabel === item.goalLabel && candidate.owner === item.owner) === index);
  return <section className="collab-module">
    <div className="clean-head"><div><h2>目标与周报协同</h2><p>真实目标落库、飞书原文同步、人工确认后生成可追溯分析</p></div><span>{creatingNew ? '正在新建协同内容' : '分析仅使用已确认事项'}</span></div>
    <div className="collab-stepper">{['目标与战略', '飞书周报同步', '内容与目标拆解', '目标进展分析'].map((label, index) => <button key={label} className={step === index + 1 ? 'current' : step > index + 1 ? 'done' : ''} onClick={() => index + 1 < step && setStep(index + 1)}><i>{step > index + 1 ? <CheckCircle2/> : index + 1}</i><span>{label}</span></button>)}</div>

    {error && <div className="collab-error" role="alert"><AlertTriangle/><span>{error}</span><button onClick={() => setError('')}>知道了</button></div>}

    {step === 1 && <div className="collab-panel">
      <div className="panel-title"><Target/><div><h3>录入本周报对应的真实目标</h3><p>目标和 KR 会保存到业务数据库，并成为飞书周报拆解的唯一依据。</p></div></div>
      <div className="strategy-form">
        <label className="wide"><span>战略目标 *</span><textarea value={goalForm.objective} onChange={event => updateGoal('objective', event.target.value)} placeholder="例如：提升私域用户复购表现" maxLength="200"/></label>
        <label><span>目标截止日期 *</span><input type="date" value={goalForm.periodEnd} onChange={event => updateGoal('periodEnd', event.target.value)}/></label>
        <label><span>负责人 *</span><input value={goalForm.owner} onChange={event => updateGoal('owner', event.target.value)} placeholder="填写真实负责人" maxLength="30"/></label>
        <div className="kr-editor wide"><div><span>关键结果 *</span><button type="button" disabled={goalForm.keyResults.length >= 8} onClick={() => setGoalForm(current => ({...current, keyResults:[...current.keyResults, '']}))}><Plus/>添加 KR</button></div>{goalForm.keyResults.map((kr, index) => <label key={index}><span>KR{index + 1}</span><input value={kr} onChange={event => updateKr(index, event.target.value)} placeholder="填写可验证的关键结果" maxLength="200"/><button type="button" aria-label={`删除 KR${index + 1}`} disabled={goalForm.keyResults.length === 1} onClick={() => removeKr(index)}><Trash2/></button></label>)}</div>
      </div>
      {creatingNew ? <div className="create-proof"><Plus/><span><b>正在创建新的协同内容</b><small>填写并保存新目标后进入飞书同步；下方历史分析记录不会被清除。</small></span></div> : state?.goal && <div className="saved-proof"><CheckCircle2/><span><b>已保存真实目标</b><small>最后确认：{formatTime(state.goal.confirmedAt)}；修改目标后需重新同步周报。</small></span></div>}
    </div>}

    {step === 2 && <div className="collab-panel">
      <div className="panel-title"><Link2/><div><h3>连接真实飞书周报</h3><p>支持你已获权限的 Docx 或 Wiki 地址，同步时实时读取最新版本。</p></div></div>
      <div className={`auth-status ${auth?.connected ? 'connected' : 'disconnected'}`}><span className="connection-icon">{auth?.connected ? <CheckCircle2/> : <CircleAlert/>}</span><div><b>{auth?.connected ? '飞书用户授权已连接' : '飞书用户授权不可用'}</b><p>{auth?.connected ? `当前身份：${auth.userName || '已授权用户'} · 文档只读` : '请先完成 lark-cli 用户授权'}</p></div></div>
      <div className="sync-config"><label><span>飞书周报文档地址 *</span><input value={sourceForm.docUrl} onChange={event => setSourceForm(current => ({...current, docUrl:event.target.value}))} placeholder="https://your-team.feishu.cn/wiki/..."/></label><label><span>同步方式</span><select value={sourceForm.syncFrequency} disabled><option>仅手动更新</option></select></label></div>
      {state?.source?.syncedAt && <div className="connection-card"><span className="connection-icon"><CheckCircle2/></span><div><b>{state.source.docTitle || '已同步飞书周报'}</b><p>文档 ID：{state.source.docId}</p></div><dl><div><dt>同步时间</dt><dd>{formatTime(state.source.syncedAt)}</dd></div><div><dt>真实版本</dt><dd>rev {state.source.revisionId}</dd></div></dl></div>}
      {state?.source?.lastError && <p className="inline-warning">上次同步失败：{state.source.lastError}</p>}
      <div className="sync-action"><button className="primary" disabled={!auth?.connected || !sourceForm.docUrl.trim() || working === 'sync'} onClick={syncReport}><RefreshCw className={working === 'sync' ? 'spin' : ''}/>{working === 'sync' ? '正在读取飞书并拆解…' : state?.report ? '重新同步最新版本' : '同步并拆解周报'}</button></div>
    </div>}

    {step === 3 && <div className="collab-panel split-review">
      <div className="weekly-source"><div className="panel-title"><FileText/><div><h3>飞书周报原文</h3><p>{state?.report ? `${state.report.docTitle} · rev ${state.report.revisionId} · ${formatTime(state.report.syncedAt)}` : '尚未同步'}</p></div></div>{state?.report ? <pre>{state.report.contentMarkdown}</pre> : <div className="collab-empty"><p>还没有真实周报内容。</p><button onClick={() => setStep(2)}>去连接飞书文档</button></div>}</div>
      <div className="decompose"><div className="review-head"><div><h3>目标与进展拆解</h3><p>每条均来自左侧真实原文，调整并确认后才会参与分析。</p></div><button disabled={!items.length || working === 'progress'} onClick={confirmAll}>确认全部</button></div>
        {items.length ? items.map((item, index) => <div className={`progress-item ${item.confirmed ? 'confirmed' : ''}`} key={item.id}><div className="progress-main"><select value={item.keyResultId || ''} onChange={event => updateItem(index, 'keyResultId', Number(event.target.value) || null)}><option value="">{state.goal.objective}</option>{state.goal.keyResults.map(kr => <option value={kr.id} key={kr.id}>{kr.title}</option>)}</select><textarea value={item.progress} onChange={event => updateItem(index, 'progress', event.target.value)} maxLength="500"/></div><div className="progress-fields"><label><span>负责人</span><input value={item.owner} onChange={event => updateItem(index, 'owner', event.target.value)}/></label><label><span>状态</span><select value={item.status} onChange={event => updateItem(index, 'status', event.target.value)}><option>推进中</option><option>有风险</option><option>已完成</option></select></label><label><span>风险 / 阻塞</span><input value={item.risk} onChange={event => updateItem(index, 'risk', event.target.value)}/></label></div><div className="progress-meta"><span><UserRound/>{item.owner}</span><em className={item.status === '有风险' ? 'risk' : ''}>{item.status}</em>{item.isHighlight && <span className="highlight-tag"><Lightbulb/>亮点候选</span>}<button disabled={working === 'progress'} onClick={() => confirmOne(index)}>{item.confirmed ? '更新确认' : '确认该事项'}</button></div></div>) : <div className="collab-empty"><p>这份周报没有可确认的拆解事项。</p><button onClick={() => setStep(2)}>重新同步</button></div>}
      </div>
    </div>}

    {step === 4 && <div className="collab-panel">
      <div className="analysis-head"><div><h3>目标进展真实分析</h3><p>基于 {analysis?.sourceItemIds?.length || 0} 条已确认事项 · 生成于 {formatTime(analysis?.generatedAt)}</p></div>{analysis && <span className={analysis.id ? '' : 'draft-badge'}>{analysis.id ? <CheckCircle2/> : <RefreshCw/>}{analysis.id ? '已保存分析' : '未保存草稿'}</span>}</div>
      {analysis ? <><div className="analysis-context"><FileText/><span>{analysis.reportTitle || state?.report?.docTitle} · rev {analysis.revisionId ?? state?.report?.revisionId}</span></div><div className="analysis-grid"><article className="analysis-summary"><small>总体判断</small><h3>{analysis.headline}</h3><p>{analysis.overview}</p></article><article><TrendingUp/><div><b>核心进展</b><AnalysisList items={analysis.progress} empty="未识别到明确的正向进展。"/></div></article><article className="warning"><CircleAlert/><div><b>进展偏少 / 风险阻塞</b><AnalysisList items={analysis.risks} empty="已确认事项中未识别到明确风险。"/></div></article><article className="highlight"><Lightbulb/><div><b>创新亮点</b><AnalysisList items={analysis.highlights} empty="本期未识别到明确的创新或试点表述。"/></div></article></div><div className="confirmed-source"><b>本次分析采用的已确认事项快照 · {analysisSources.length} 条</b>{analysisOwners.map(item => <span key={`${item.goalLabel}-${item.owner}`}><CheckCircle2/>{item.goalLabel} · {item.owner}</span>)}</div></> : <div className="collab-empty"><p>尚未生成分析，请先确认周报拆解事项。</p><button onClick={() => setStep(3)}>返回确认</button></div>}
    </div>}

    <div className="wizard-actions"><button className="secondary" disabled={step === 1 || Boolean(working)} onClick={() => setStep(current => current - 1)}>上一步</button>{step === 1 ? <button className="primary" disabled={!goalValid || working === 'goal'} onClick={saveGoal}><Save/>{working === 'goal' ? '保存中…' : '保存并确认目标'}</button> : step === 2 ? <button className="primary" disabled={!items.length || Boolean(working)} onClick={() => setStep(3)}>下一步</button> : step === 3 ? <button className="primary" disabled={!confirmedCount || Boolean(working)} onClick={() => generateAnalysis(true)}>{working === 'analysis' ? '分析中…' : `分析 ${confirmedCount} 条已确认事项`}</button> : <div className="analysis-actions"><button className="secondary" disabled={Boolean(working)} onClick={() => generateAnalysis(false)}><RefreshCw className={working === 'analysis' ? 'spin' : ''}/>{working === 'analysis' ? '生成中…' : '重新生成'}</button><button className="primary" disabled={!analysis || Boolean(analysis.id) || Boolean(working)} onClick={saveAnalysis}><Save/>{working === 'saveAnalysis' ? '保存中…' : analysis?.id ? '已保存' : '保存'}</button></div>}</div>

    <div className="collab-panel history-panel">
      <div className="history-head"><div><h3>周报分析记录</h3><p>在任一步骤都可查看；每次保存新增记录，旧周报与旧版本不会被覆盖。</p></div><span>{historyRecords.length} 条</span></div>
      {selectedHistory ? <AnalysisRecordDetail record={selectedHistory} onBack={closeHistory}/> : historyRecords.length ? <div className="history-list">{historyRecords.map(record => <button key={record.id} onClick={() => openHistory(record.id)} aria-label={`查看记录 ${record.id} 详情`}><span><b>{record.reportTitle} · rev {record.revisionId} · 记录 #{record.id}</b><small>{formatTime(record.generatedAt)} · {record.sourceItemIds.length} 条确认事项</small></span><em>{record.headline}</em></button>)}</div> : <div className="history-empty"><FileText/><div><b>还没有周报分析记录</b><p>完成周报拆解并保存分析后，记录会显示在这里。</p></div></div>}
    </div>
  </section>;
}
