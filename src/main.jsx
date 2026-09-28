import React, {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Home, Package, NotebookText, Plus, ArrowRight, ArrowLeft, Sparkles, Menu, X, Building2, Database, RefreshCw, LogOut, Users} from 'lucide-react';
import './styles.css';
import './detail.css';
import './collaboration.css';
import './auth.css';
import {CleaningWizard, TrustedProductLibrary, useTrustedProducts} from './ProductModule';
import {CollaborationWorkflow} from './CollaborationModule';
import {LoginPage, UserManagement, loadCurrentUser, logoutCurrentUser} from './AuthModule';

const coreNav = [
  ['知识工作台', Home], ['商品库', Package], ['团队协同', NotebookText],
];
const domains = [
  {name:'商品库', desc:'可信商品 · 数据清洗', sub:'功效价格 · 素材资源', Icon:Package, tone:'rose'},
  {name:'团队协同', desc:'战略目标 · 飞书周报', sub:'进展拆解 · 风险分析', Icon:NotebookText, tone:'sage'},
];
const domainData = {
  商品库:{summary:'统一多份商品资料，沉淀编码、名称、规格一致的可信商品数据',stats:[['可信商品','1'],['待人工处理','2'],['来源材料','2']],filters:['全部商品','已映射','待人工处理'],columns:['商品名称','商品编码','状态','价格','规格'],rows:[['清洁面膜','PRD-003','已映射','¥129','100g'],['舒缓精华','PRD-001','待人工处理','暂无','30ml'],['保湿面霜','PRD-002','待人工处理','暂无','50g']]},
  团队协同:{summary:'连接战略目标与飞书周报，把团队进展沉淀为可追踪的执行结论',stats:[],filters:[],columns:[],rows:[]},
};

function Logo(){return <div className="logo"><span>澄</span><div><b>澄研智库</b><small>让知识成为美的生产力</small></div></div>}
function Sidebar({active,setActive,open,setOpen,currentUser}){const visiblePersonalNav=currentUser.role==='admin'?[['用户管理',Users]]:[];return <aside className={open?'sidebar open':'sidebar'}>
  <div className="mobile-close"><button onClick={()=>setOpen(false)}><X/></button></div><Logo/>
  <nav>{coreNav.map(([label,Icon])=><button key={label} className={active===label?'active':''} onClick={()=>{setActive(label);setOpen(false)}}><Icon/><span>{label}</span></button>)}</nav>
  {visiblePersonalNav.length>0&&<><div className="nav-divider" /><nav>{visiblePersonalNav.map(([label,Icon])=><button key={label} className={active===label?'active':''} onClick={()=>{setActive(label);setOpen(false)}}><Icon/><span>{label}</span></button>)}</nav></>}
  <div className="org"><Building2/><div><b>美予美妆</b><small>80 人的美妆电商团队</small></div><ArrowRight/></div>
</aside>}

function DetailPage({name,onBack,onNotice}){const data=domainData[name]; const Icon=domains.find(x=>x.name===name)?.Icon||Home; const [productView,setProductView]=useState(()=>new URLSearchParams(location.search).get('view')||'library'); const [collaborationCreateSignal,setCollaborationCreateSignal]=useState(0); const {records:trustedProducts,imports:importBatches,loading:productsLoading,error:productsError,reload:reloadProducts,addRecords:addTrustedProducts}=useTrustedProducts(); const changeProductView=view=>{setProductView(view);const params=new URLSearchParams(location.search);params.set('section','商品库');params.set('view',view);history.replaceState(null,'',`${location.pathname}?${params.toString()}`)}; return <div className="detail-page">
  <button className="back-link" onClick={onBack}><ArrowLeft/>返回知识工作台</button>
  <section className="detail-hero"><div className="detail-title"><span><Icon/></span><div><h1>{name}</h1><p>{data.summary}</p></div></div>{name==='团队协同'&&<button className="upload" onClick={()=>setCollaborationCreateSignal(value=>value+1)}><Plus/>新建内容</button>}</section>
  {name==='商品库'&&<div className="module-tabs"><button className={productView==='library'?'active':''} onClick={()=>changeProductView('library')}><Database/>可信商品库</button><button className={productView==='cleaning'?'active':''} onClick={()=>changeProductView('cleaning')}><Sparkles/>数据清洗</button></div>}
  {name==='团队协同'
    ? <CollaborationWorkflow onNotice={onNotice} createSignal={collaborationCreateSignal}/>
    : productView==='cleaning'
      ? <CleaningWizard onNotice={onNotice} onAddTrusted={addTrustedProducts} imports={importBatches}/>
      : <TrustedProductLibrary records={trustedProducts} loading={productsLoading} error={productsError} onRetry={reloadProducts}/>}
 </div>}

function App(){const [active,setActive]=useState(()=>new URLSearchParams(location.search).get('section')||'知识工作台'); const [menu,setMenu]=useState(false); const [notice,setNotice]=useState(''); const [currentUser,setCurrentUser]=useState(null); const [authLoading,setAuthLoading]=useState(true); const noticeTimer=useRef(null); const isDomain=Boolean(domainData[active]);
 useEffect(()=>{loadCurrentUser().then(setCurrentUser).catch(()=>setCurrentUser(null)).finally(()=>setAuthLoading(false))},[]);
 useEffect(()=>{const expire=()=>setCurrentUser(null);window.addEventListener('auth:expired',expire);return()=>window.removeEventListener('auth:expired',expire)},[]);
 const showNotice=text=>{setNotice(text);if(noticeTimer.current)clearTimeout(noticeTimer.current);noticeTimer.current=setTimeout(()=>setNotice(''),2600)};
 const signOut=async()=>{try{await logoutCurrentUser()}finally{setCurrentUser(null);setActive('知识工作台')}};
 if(authLoading)return <main className="login-page"><section className="login-card"><div className="admin-loading"><RefreshCw className="spin"/>正在验证登录状态…</div></section></main>;
 if(!currentUser)return <LoginPage onLogin={user=>{setCurrentUser(user);setActive('知识工作台')}}/>;
 return <div className="app"><Sidebar active={active} setActive={setActive} open={menu} setOpen={setMenu} currentUser={currentUser}/>{menu&&<button className="backdrop" onClick={()=>setMenu(false)}/>}<main>
  <header><button className="menu" onClick={()=>setMenu(true)}><Menu/></button><div className="header-actions"><div className="user"><span>{currentUser.displayName.slice(0,1)}</span><div><b>{currentUser.displayName}</b><small>{currentUser.department} · {currentUser.role==='admin'?'管理员':'成员'}</small></div></div><button className="logout-button" onClick={signOut}><LogOut/>退出</button></div></header>
  <div className="content">{active==='用户管理'?<UserManagement currentUser={currentUser} onNotice={showNotice}/>:isDomain?<DetailPage name={active} onBack={()=>setActive('知识工作台')} onNotice={showNotice}/>:<><section className="intro"><div><h1>{active}</h1><p>你好，{currentUser.displayName}！</p><small>让好产品被更多人看见，让专业知识持续沉淀。</small></div><blockquote>美，不止于产品<br/>也源于每一次认真的思考</blockquote></section>
  <section className="domains">{domains.map(({name,desc,sub,Icon,tone})=><article className={tone} key={name} onClick={()=>setActive(name)} tabIndex="0"><Icon/><div><h3>{name}</h3><p>{desc}<br/>{sub}</p><button>进入 <ArrowRight/></button></div></article>)}</section>
  </>}
  </div>{notice&&<div className="toast">{notice}</div>}</main></div>}

createRoot(document.getElementById('root')).render(<App/>);
