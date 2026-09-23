import React, {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Home, MessageSquareText, Package, NotebookText, ChartNoAxesCombined, Orbit, Search, Clock3, Star, PenLine, Plus, Upload, Bell, ArrowRight, ArrowLeft, Sparkles, Menu, X, Building2, ChevronDown, FileText, Database, TrendingUp, SlidersHorizontal, UploadCloud, CheckCircle2, AlertTriangle, Settings2, Target, RefreshCw, Link2, Lightbulb, CircleAlert, Save, UserRound, LogOut, Users} from 'lucide-react';
import './styles.css';
import './detail.css';
import './collaboration.css';
import './auth.css';
import {CleaningWizard, TrustedProductLibrary, useTrustedProducts} from './ProductModule';
import {CollaborationWorkflow} from './CollaborationModule';
import {LoginPage, UserManagement, loadCurrentUser, logoutCurrentUser} from './AuthModule';

const coreNav = [
  ['知识工作台', Home], ['AI 智能问答', MessageSquareText], ['商品库', Package],
  ['团队协同', NotebookText], ['经营数据', ChartNoAxesCombined], ['行业情报', Orbit],
];
const personalNav = [['全局搜索', Search], ['最近访问', Clock3], ['我的收藏', Star], ['知识贡献', PenLine], ['新建知识', Plus]];
const domains = [
  {name:'商品库', desc:'可信商品 · 数据清洗', sub:'功效价格 · 素材资源', Icon:Package, tone:'rose'},
  {name:'团队协同', desc:'战略目标 · 飞书周报', sub:'进展拆解 · 风险分析', Icon:NotebookText, tone:'sage'},
  {name:'经营数据', desc:'看懂生意，辅助决策', sub:'销售 · 流量 · 用户', Icon:ChartNoAxesCombined, tone:'amber'},
  {name:'行业情报', desc:'洞察行业趋势', sub:'把握市场机会', Icon:Orbit, tone:'plum'},
];
const updates = [
  ['2026年Q3精华类目竞品分析报告','行业情报','王思雨','今天 10:24'],
  ['商品基础资料与销售价格清洗结果','商品库','林悦','今天 10:26'],
  ['8月电商核心数据周报','经营数据','张子航','昨天 16:05'],
];
const favorites = ['品牌介绍','产品卖点话术库','电商运营 SOP','行业报告合集'];
const domainData = {
  商品库:{summary:'统一多份商品资料，沉淀编码、名称、规格一致的可信商品数据',stats:[['可信商品','1'],['待人工处理','2'],['来源材料','2']],filters:['全部商品','已映射','待人工处理'],columns:['商品名称','商品编码','状态','价格','规格'],rows:[['清洁面膜','PRD-003','已映射','¥129','100g'],['舒缓精华','PRD-001','待人工处理','暂无','30ml'],['保湿面霜','PRD-002','待人工处理','暂无','50g']]},
  团队协同:{summary:'连接战略目标与飞书周报，把团队进展沉淀为可追踪的执行结论',stats:[],filters:[],columns:[],rows:[]},
  经营数据:{summary:'沉淀销售、流量、用户和渠道数据，辅助业务判断与复盘',stats:[['本月 GMV','¥326万'],['环比增长','12.8%'],['数据报表','42']],filters:['经营总览','销售分析','流量分析','用户分析'],columns:['报表名称','数据周期','状态','负责人','更新时间'],rows:[['8月电商核心数据月报','2026年8月','已更新','张子航','昨天 16:05'],['抖音旗舰店渠道周报','09.05–09.11','已更新','王思雨','今天 08:50'],['天猫大促转化漏斗分析','99大促','分析中','林悦','昨天 14:30'],['新品首发用户画像报告','上市首月','已更新','周晴','09-10 17:20'],['库存周转与动销看板','实时','已更新','赵可','10分钟前']]},
  行业情报:{summary:'持续追踪市场趋势、竞品动作、平台政策与消费者洞察',stats:[['本周新增','26'],['重点跟踪','8'],['情报来源','34']],filters:['全部情报','竞品动态','消费趋势','平台政策'],columns:['情报标题','情报类型','重要度','更新人','更新时间'],rows:[['2026年Q3精华类目竞品分析报告','竞品动态','重要','王思雨','今天 10:24'],['抖音美妆个护新规解读','平台政策','重要','张子航','今天 09:18'],['敏感肌人群消费趋势洞察','消费趋势','一般','周晴','昨天 17:35'],['国货美妆新品定价观察','市场趋势','一般','林悦','昨天 15:12'],['秋冬面霜内容关键词趋势','内容趋势','一般','陈美琳','09-10 13:40']]}
};

function Logo(){return <div className="logo"><span>澄</span><div><b>澄研智库</b><small>让知识成为美的生产力</small></div></div>}
function Sidebar({active,setActive,open,setOpen,currentUser}){const visiblePersonalNav=currentUser.role==='admin'?[...personalNav,['用户管理',Users]]:personalNav;return <aside className={open?'sidebar open':'sidebar'}>
  <div className="mobile-close"><button onClick={()=>setOpen(false)}><X/></button></div><Logo/>
  <nav>{coreNav.map(([label,Icon])=><button key={label} className={active===label?'active':''} onClick={()=>{setActive(label);setOpen(false)}}><Icon/><span>{label}</span></button>)}</nav>
  <div className="nav-divider" />
  <nav>{visiblePersonalNav.map(([label,Icon])=><button key={label} className={active===label?'active':''} onClick={()=>{setActive(label);setOpen(false)}}><Icon/><span>{label}</span></button>)}</nav>
  <div className="org"><Building2/><div><b>美予美妆</b><small>80 人的美妆电商团队</small></div><ArrowRight/></div>
</aside>}

function DetailPage({name,onBack,onNotice}){const data=domainData[name]; const Icon=domains.find(x=>x.name===name)?.Icon||FileText; const [filter,setFilter]=useState(data.filters[0]); const [keyword,setKeyword]=useState(''); const [productView,setProductView]=useState(()=>new URLSearchParams(location.search).get('view')||'library'); const [collaborationCreateSignal,setCollaborationCreateSignal]=useState(0); const {records:trustedProducts,imports:importBatches,loading:productsLoading,error:productsError,reload:reloadProducts,addRecords:addTrustedProducts}=useTrustedProducts(); const rows=data.rows.filter(r=>!keyword||r.join('').includes(keyword)); const changeProductView=view=>{setProductView(view);const params=new URLSearchParams(location.search);params.set('section','商品库');params.set('view',view);history.replaceState(null,'',`${location.pathname}?${params.toString()}`)}; const createContent=()=>{if(name==='团队协同')setCollaborationCreateSignal(value=>value+1);else onNotice(`准备新建${name}内容`)}; return <div className="detail-page">
  <button className="back-link" onClick={onBack}><ArrowLeft/>返回知识工作台</button>
  <section className="detail-hero"><div className="detail-title"><span><Icon/></span><div><h1>{name}</h1><p>{data.summary}</p></div></div><button className="upload" onClick={createContent}><Plus/>新建内容</button></section>
  {name==='商品库'&&<div className="module-tabs"><button className={productView==='library'?'active':''} onClick={()=>changeProductView('library')}><Database/>可信商品库</button><button className={productView==='cleaning'?'active':''} onClick={()=>changeProductView('cleaning')}><Sparkles/>数据清洗</button></div>}
  {name==='团队协同'?<CollaborationWorkflow onNotice={onNotice} createSignal={collaborationCreateSignal}/>:name==='商品库'&&productView==='cleaning'?<CleaningWizard onNotice={onNotice} onAddTrusted={addTrustedProducts} imports={importBatches}/>:name==='商品库'?<TrustedProductLibrary records={trustedProducts} loading={productsLoading} error={productsError} onRetry={reloadProducts}/>:<>
  <section className="stat-strip">{data.stats.map(([label,value],i)=><div key={label}><small>{label}</small><strong>{value}</strong>{i===1&&name==='经营数据'?<em><TrendingUp/>表现良好</em>:null}</div>)}</section>
  <section className="library"><div className="library-tools"><div className="detail-search"><Search/><input value={keyword} onChange={e=>setKeyword(e.target.value)} placeholder={`搜索${name}...`}/></div><button className="filter-btn"><SlidersHorizontal/>筛选</button></div><div className="filter-tabs">{data.filters.map(f=><button key={f} className={filter===f?'selected':''} onClick={()=>setFilter(f)}>{f}</button>)}</div>
    <div className="knowledge-table"><div className="knowledge-row header-row">{data.columns.map(c=><span key={c}>{c}</span>)}</div>{rows.map((r,i)=><button className="knowledge-row" key={r[0]} onClick={()=>onNotice(`已打开：${r[0]}`)}><span className="doc-name">{i%2?<Database/>:<FileText/>}<b>{r[0]}</b></span><span>{r[1]}</span><span><em className={`status ${r[2].includes('待')||r[2]==='分析中'?'pending':''}`}>{r[2]}</em></span><span>{r[3]}</span><span>{r[4]}<ArrowRight/></span></button>)}{!rows.length&&<div className="empty">未找到匹配内容</div>}</div>
  </section></>}
 </div>}

function App(){const [active,setActive]=useState(()=>new URLSearchParams(location.search).get('section')||'知识工作台'); const [menu,setMenu]=useState(false); const [query,setQuery]=useState(''); const [notice,setNotice]=useState(''); const [currentUser,setCurrentUser]=useState(null); const [authLoading,setAuthLoading]=useState(true); const noticeTimer=useRef(null); const isDomain=Boolean(domainData[active]);
 useEffect(()=>{loadCurrentUser().then(setCurrentUser).catch(()=>setCurrentUser(null)).finally(()=>setAuthLoading(false))},[]);
 useEffect(()=>{const expire=()=>setCurrentUser(null);window.addEventListener('auth:expired',expire);return()=>window.removeEventListener('auth:expired',expire)},[]);
 const showNotice=text=>{setNotice(text);if(noticeTimer.current)clearTimeout(noticeTimer.current);noticeTimer.current=setTimeout(()=>setNotice(''),2600)};
 const submit=(text=query)=>{if(!text.trim())return;setQuery(text);showNotice(`已为你检索：“${text}”`)};
 const signOut=async()=>{try{await logoutCurrentUser()}finally{setCurrentUser(null);setActive('知识工作台')}};
 if(authLoading)return <main className="login-page"><section className="login-card"><div className="admin-loading"><RefreshCw className="spin"/>正在验证登录状态…</div></section></main>;
 if(!currentUser)return <LoginPage onLogin={user=>{setCurrentUser(user);setActive('知识工作台')}}/>;
 return <div className="app"><Sidebar active={active} setActive={setActive} open={menu} setOpen={setMenu} currentUser={currentUser}/>{menu&&<button className="backdrop" onClick={()=>setMenu(false)}/>}<main>
  <header><button className="menu" onClick={()=>setMenu(true)}><Menu/></button><div className="header-actions"><button className="icon-btn" aria-label="通知"><Bell/></button><button className="upload" onClick={()=>showNotice('上传入口已就绪')}><Upload/>上传知识</button><div className="user"><span>{currentUser.displayName.slice(0,1)}</span><div><b>{currentUser.displayName}</b><small>{currentUser.department} · {currentUser.role==='admin'?'管理员':'成员'}</small></div></div><button className="logout-button" onClick={signOut}><LogOut/>退出</button></div></header>
  <div className="content">{active==='用户管理'?<UserManagement currentUser={currentUser} onNotice={showNotice}/>:isDomain?<DetailPage name={active} onBack={()=>setActive('知识工作台')} onNotice={showNotice}/>:<><section className="intro"><div><h1>{active}</h1><p>你好，{currentUser.displayName}！</p><small>让好产品被更多人看见，让专业知识持续沉淀。</small></div><blockquote>美，不止于产品<br/>也源于每一次认真的思考</blockquote></section>
  <section className="ask"><div className="ask-title"><Sparkles/><div><h2>向澄研智库提问</h2><p>基于公司知识，获得专业、准确、可落地的答案</p></div></div><div className="searchbox"><Search/><input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==='Enter'&&submit()} placeholder="请输入你的问题，例如：这款精华的核心成分和卖点是什么？"/><kbd>Ctrl K</kbd><button onClick={()=>submit()}>提问</button></div><div className="prompts">{['这款产品有哪些用户反馈？','帮我总结上周的运营亮点','近期美妆行业有哪些新趋势？'].map(x=><button key={x} onClick={()=>submit(x)}>{x}<ArrowRight/></button>)}</div></section>
  <section className="domains">{domains.map(({name,desc,sub,Icon,tone})=><article className={tone} key={name} onClick={()=>setActive(name)} tabIndex="0"><Icon/><div><h3>{name}</h3><p>{desc}<br/>{sub}</p><button>进入 <ArrowRight/></button></div></article>)}</section>
  <section className="lower"><div className="updates"><div className="section-head"><h2>最新更新</h2><button>查看全部 <ArrowRight/></button></div><div className="table"><div className="tr labels"><span>标题</span><span>所属分类</span><span>更新人</span><span>更新时间</span></div>{updates.map((r,i)=><div className="tr" key={r[0]}><span className="title"><NotebookText/> {r[0]}</span><span><em className={`tag t${i}`}>{r[1]}</em></span><span>{r[2]}</span><span>{r[3]}</span></div>)}</div></div>
  <aside className="favorites"><div className="section-head"><h2>常用知识</h2><button>查看全部</button></div>{favorites.map((f,i)=><div className="fav" key={f}><NotebookText/><div><b>{f}</b><small>{i===0?'公司概况 · 品牌理念':i===1?'全系产品 · 场景化话术':i===2?'日常运营 · 活动执行':'美妆行业 · 消费趋势'}</small></div><Star className={i!==2?'filled':''}/></div>)}</aside></section></>}
  </div>{notice&&<div className="toast">{notice}</div>}</main></div>}

createRoot(document.getElementById('root')).render(<App/>);
