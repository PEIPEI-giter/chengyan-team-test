const RISK_WORDS = ['风险', '阻塞', '延迟', '未完成', '低于', '不足', '异常', '缺失', '偏低', '下降', '落后', '待解决'];
const DONE_WORDS = ['已完成', '完成了', '已上线', '已交付', '已验收', '达成', '结项'];
const HIGHLIGHT_WORDS = ['首次', '创新', '试点', 'AB测试', 'A/B测试', '实验', '自动化', '标准化', '新策略', '新方案'];
const STOP_WORDS = new Set(['目标', '本周', '进展', '完成', '实现', '提升', '推进', '达到', '进行', '一个', '与及']);

const cleanMarkdown = value => String(value || '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
  .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
  .replace(/[`*_~>]/g, '')
  .replace(/\r/g, '')
  .replace(/[ \t]+/g, ' ')
  .trim();

export function documentTitle(markdown, fallback = '飞书周报') {
  const heading = String(markdown || '').split(/\r?\n/).find(line => /^#{1,3}\s+\S/.test(line));
  return heading ? cleanMarkdown(heading.replace(/^#{1,3}\s+/, '')).slice(0, 120) : fallback;
}

export function extractReportEntries(markdown) {
  const normalized = String(markdown || '')
    .replace(/\r/g, '')
    .replace(/([^。！？\n])\n(?=\d+[.、)）]\s*)/g, '$1\n')
    .replace(/\n{3,}/g, '\n\n');
  const raw = normalized.split(/\n|(?<=[。！？])\s+(?=\d+[.、)）]\s*)/);
  const entries = [];
  for (const line of raw) {
    if (/^\s*#{1,6}\s+/.test(line)) continue;
    let text = cleanMarkdown(line)
      .replace(/^#{1,6}\s*/, '')
      .replace(/^[-+•]\s+/, '')
      .replace(/^\d+[.、)）]\s*/, '')
      .replace(/^\|/, '').replace(/\|$/, '').replace(/\|/g, '；')
      .trim();
    if (!text || text.length < 6 || /^[-:—|\s]+$/.test(text)) continue;
    if (/^(本周进展|重点进展|下周计划|风险问题|周报|工作总结)$/.test(text)) continue;
    if (!entries.includes(text)) entries.push(text.slice(0, 500));
  }
  return entries.slice(0, 30);
}

const terms = text => {
  const value = cleanMarkdown(text).toLowerCase();
  const result = new Set();
  for (const match of value.matchAll(/[a-z]+\d*|\d+(?:\.\d+)?%?|[一-鿿]{2,8}/g)) {
    const token = match[0];
    if (!STOP_WORDS.has(token)) result.add(token);
    if (/[一-鿿]{4,}/.test(token)) {
      for (let i = 0; i < token.length - 1; i += 1) result.add(token.slice(i, i + 2));
    }
  }
  return result;
};

const matchScore = (entry, target) => {
  const sourceTerms = terms(entry);
  const targetTerms = terms(target);
  let score = 0;
  for (const token of sourceTerms) if (targetTerms.has(token)) score += token.length > 2 ? 3 : 1;
  return score;
};

const includesAny = (text, words) => words.some(word => text.includes(word));

const detectOwner = (text, fallback) => {
  const match = text.match(/(?:负责人|负责|所有者|owner)\s*[:：]\s*([\u4e00-\u9fffA-Za-z·]{2,20})/i)
    || text.match(/@([\u4e00-\u9fffA-Za-z·]{2,20})/);
  return match?.[1] || fallback || '待确认';
};

const detectRisk = text => {
  const keyword = RISK_WORDS.find(word => text.includes(word));
  if (!keyword) return '无';
  const index = text.indexOf(keyword);
  return text.slice(Math.max(0, index - 18), Math.min(text.length, index + 42)).replace(/[;；]​?.*$/, '').trim();
};

export function decomposeWeeklyReport({markdown, objective, owner, keyResults}) {
  const targets = (keyResults || []).length
    ? keyResults.map(item => ({id:item.id, title:item.title}))
    : [{id:null, title:objective}];
  return extractReportEntries(markdown).map((progress, index) => {
    const ranked = targets
      .map(target => ({...target, score:matchScore(progress, target.title)}))
      .sort((a, b) => b.score - a.score);
    const matched = ranked[0] || targets[0];
    const risk = detectRisk(progress);
    return {
      keyResultId: matched?.id || null,
      goalLabel: matched?.title || objective,
      progress,
      owner: detectOwner(progress, owner),
      status: risk !== '无' ? '有风险' : includesAny(progress, DONE_WORDS) ? '已完成' : '推进中',
      risk,
      isHighlight: includesAny(progress, HIGHLIGHT_WORDS),
      sourceOrder: index + 1,
    };
  });
}

const shorten = (text, max = 90) => text.length > max ? `${text.slice(0, max)}…` : text;

export function buildAnalysis(items, objective) {
  const confirmed = items.filter(item => item.confirmed);
  if (!confirmed.length) throw new Error('请先确认至少一条周报事项');
  const risks = confirmed.filter(item => item.status === '有风险' || item.risk !== '无');
  const completed = confirmed.filter(item => item.status === '已完成');
  const highlights = confirmed.filter(item => item.isHighlight);
  const covered = new Set(confirmed.map(item => item.goalLabel)).size;
  const headline = risks.length
    ? `${confirmed.length} 项进展已确认，${risks.length} 项风险需要重点介入`
    : completed.length === confirmed.length
      ? `${confirmed.length} 项已确认工作均已完成`
      : `${confirmed.length} 项进展正常推进，暂未识别明确阻塞`;
  const overview = `围绕「${objective}」，本次分析覆盖 ${covered} 个目标或关键结果；${completed.length} 项已完成，${risks.length} 项存在风险。`;
  return {
    headline,
    overview,
    progress: confirmed.filter(item => item.status !== '有风险').slice(0, 4).map(item => shorten(item.progress)),
    risks: risks.slice(0, 4).map(item => `${shorten(item.progress, 70)}（${item.risk}）`),
    highlights: highlights.slice(0, 4).map(item => shorten(item.progress)),
    sourceItemIds: confirmed.map(item => item.id),
  };
}
