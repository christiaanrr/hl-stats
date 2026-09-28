/* Dashboard presentation. Account analytics remain in index.html. */
let CHART_VIEW = 'perps', CHART_METRIC = 'pnl', TABLE_VIEW = 'positions';
let POSITION_SORT = {key:'value', direction:-1}, SHOW_ALL_FILLS = false, ACTIVITY_LIMIT = 60;
let toastTimer;
const clampPercent = value => Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));

function accountExposure(d) {
  const state = d.state, balances = accountBalances(d);
  const positions = (state.assetPositions || []).map(p => p.position).filter(p => n(p.szi) !== 0);
  const {equity, used, free} = balances;
  let long = 0, short = 0;
  for (const p of positions) { const value = Math.abs(n(p.positionValue)); if (n(p.szi) > 0) long += value; else short += value; }
  const notional = long + short;
  return {positions, equity, used, free, long, short, notional,
    leverage:equity > 0 ? notional/equity : null, usage:equity > 0 && used != null ? used/equity : null,
    longShare:notional > 0 ? long/notional : null};
}
function compactSize(value) {
  const a = Math.abs(value);
  return a >= 1e6 ? fmtNum(value/1e6,2)+'M' : a >= 1e3 ? fmtNum(value/1e3,2)+'K' : fmtNum(value,4);
}
function briefUsd(value, sign = false) {
  if(value == null) return '–';
  const scale = Math.abs(value) >= 1e6 ? 1e6 : Math.abs(value) >= 1e3 ? 1e3 : 1;
  return fmtUsd(value/scale,{sign,dec:2})+(scale===1e6?'M':scale===1e3?'K':'');
}
// Shape-preserving interpolation rounds the line without creating false extrema.
function monotoneSlopes(points) {
  const len=points.length;
  if(len<2) return [0];
  const h=[],d=[],m=new Array(len).fill(0);
  for(let i=0;i<len-1;i++){h[i]=points[i+1].t-points[i].t;d[i]=h[i]>0?(points[i+1].v-points[i].v)/h[i]:0;}
  m[0]=d[0];m[len-1]=d[len-2];
  for(let i=1;i<len-1;i++)if(d[i-1]*d[i]>0){const w1=2*h[i]+h[i-1],w2=h[i]+2*h[i-1];m[i]=(w1+w2)/(w1/d[i-1]+w2/d[i]);}
  for(let i=0;i<len-1;i++){if(d[i]===0){m[i]=m[i+1]=0;continue;}const a=m[i]/d[i],b=m[i+1]/d[i],r=a*a+b*b;if(r>9){const tau=3/Math.sqrt(r);m[i]=tau*a*d[i];m[i+1]=tau*b*d[i];}}
  return m;
}
function curveValue(a,b,ma,mb,time) {
  const h=b.t-a.t;if(!h)return b.v;
  const t=Math.max(0,Math.min(1,(time-a.t)/h)),t2=t*t,t3=t2*t;
  return (2*t3-3*t2+1)*a.v+(t3-2*t2+t)*h*ma+(-2*t3+3*t2)*b.v+(t3-t2)*h*mb;
}
function coinIcon(coin) {
  const symbol = String(coin), hue = [...symbol].reduce((s,c)=>s+c.charCodeAt(0)*7,0)%360;
  const known = /^[A-Za-z0-9_-]+$/.test(symbol);
  return `<span class="coin-icon" aria-hidden="true" style="--coin-color:hsl(${hue} 38% 36%)">${esc(symbol.slice(0,2))}${known ? `<img src="https://app.hyperliquid.xyz/coins/${encodeURIComponent(symbol)}.svg" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}</span>`;
}
function sideRow(key, value, color = '', title = '') {
  return `<div class="side-row"${title ? ` title="${esc(title)}"` : ''}><span class="key">${key}</span><span class="val ${color}">${value}</span></div>`;
}
function renderDashboard(d, a, rb, acct, total) {
  const ex = accountExposure(d), balances = accountBalances(d), all = analyze(d), lifetime = periodPerformance(d,{from:-Infinity,to:Infinity});
  const lev = ex.leverage == null ? 'N/A' : ex.leverage.toFixed(2)+'×';
  const margin = ex.usage == null ? 'N/A' : fmtPct(ex.usage,2);
  const equityLabel = balances.unified ? 'Unified USDC' : 'Perps equity';
  const leverageNote = `Open Hyperliquid perps notional / ${equityLabel.toLowerCase()}. Bar scale: 0–5×.`;
  $('#leverage-card').innerHTML = `<div class="metric-value warn">${lev}</div><div class="meter gold" title="${leverageNote}"><span style="width:${clampPercent(ex.leverage/5*100)}%"></span></div><div class="metric-caption"><span class="warn">${fmtUsd(ex.notional,{compact:true,dec:0})} Notional</span> · ${fmtUsd(acct,{compact:true,dec:0})} ${equityLabel}</div>`;
  $('#margin-card').innerHTML = `<div class="metric-value ${ex.usage == null ? '' : ex.usage >= .8 ? 'neg' : 'pos'}">${margin}</div><div class="meter" title="${balances.usedLabel} / ${equityLabel.toLowerCase()}. ${balances.usedNote}"><span style="width:${clampPercent(ex.usage*100)}%;background:var(--${ex.usage >= .8 ? 'bad' : 'good'})"></span></div><div class="metric-caption"><span class="${ex.usage == null ? '' : ex.usage >= .8 ? 'neg' : 'pos'}">${fmtUsd(ex.free)} Free</span> · ${fmtUsd(ex.used,{compact:true,dec:0})} ${balances.unified ? 'held' : 'in use'}</div>`;
  const ls = ex.longShare, ss = ls == null ? null : 1-ls;
  const bias = ls == null ? 'No open exposure' : ls === 1 ? 'Long only ↗' : ls === 0 ? 'Short only ↘' : ls > .6 ? 'Long biased ↗' : ls < .4 ? 'Short biased ↘' : 'Balanced ⇄';
  $('#direction-card').innerHTML = `<div class="metric-value ${ls == null ? '' : ls >= .5 ? 'pos' : 'neg'}" title="Direction of open positions, weighted by notional value">${bias}</div><div class="meter direction"><span style="width:${clampPercent(ls*100)}%"></span><span style="width:${clampPercent(ss*100)}%"></span></div><div class="metric-caption split"><span><span class="pos">${ls == null ? '–' : fmtPct(ls,0)}</span> · Long ${fmtUsd(ex.long,{compact:true,dec:0})}</span><span>${fmtUsd(ex.short,{compact:true,dec:0})} Short · <span class="neg">${ss == null ? '–' : fmtPct(ss,0)}</span></span></div>`;
  $('#side-margin').innerHTML = margin;
  $('#side-margin-bar').style.width = clampPercent(ex.usage*100)+'%';
  $('#sidebar-overview').innerHTML = [
    sideRow('Account leverage',lev,'',leverageNote),sideRow('Margin usage',margin,ex.usage >= .8 ? 'neg' : '',balances.usedNote),
    sideRow('All-time PnL',fmtUsd(lifetime.total,{sign:true,compact:true}),cls(lifetime.total),'Perps PnL from portfolio history, net of transfers'),
    sideRow('Volume',fmtUsd(all.totalVol)),sideRow('Open notional',fmtUsd(ex.notional,{compact:true,dec:0})),
  ].join('');
  const durations = all.trades.filter(t=>!t.partial).map(t=>t.close-t.open).sort((a,b)=>a-b), mid = Math.floor(durations.length/2);
  const median = durations.length ? (durations[mid]+durations[Math.floor((durations.length-1)/2)])/2 : null;
  $('#sidebar-analysis').innerHTML = [sideRow('Longest win streak',all.maxW+' trades'),sideRow('Avg trade duration',all.avgHold == null ? '–' : fmtDur(all.avgHold)),sideRow('Median duration',median == null ? '–' : fmtDur(median),'','Median of fully observed closed trades'),sideRow('Profit factor',all.profitFactor == null ? '–' : all.profitFactor === Infinity ? '∞' : all.profitFactor.toFixed(2),all.profitFactor >= 1 ? 'pos' : ''),sideRow('Expectancy',fmtUsd(all.expectancy,{sign:true}),cls(all.expectancy))].join('');
  $('#sidebar-period').textContent = rb.label;
  $('#sidebar-performance').innerHTML = [sideRow('Drawdown',fmtUsd(-a.mdd),'neg','Maximum drawdown on the realized PnL curve in this period'),sideRow('Win rate',a.winRate == null ? '–' : fmtPct(a.winRate),'pos'),sideRow('Largest win',fmtUsd(a.largestWin,{sign:true}),'pos'),sideRow('Largest loss',fmtUsd(a.largestLoss,{sign:true}),'neg'),sideRow('Closed trades',a.count)].join('');
  renderPerformanceCard();
  renderPortfolioChart();
  renderAccountTables(d,acct,total);
  renderActivity(d);
}
function renderPerformanceCard() {
  if (!DATA) return;
  const key = $('#performance-range').value, bounds = key === 'all' ? {from:-Infinity,to:Infinity} : key === 'since' ? {from:new Date(SINCE+'T00:00').getTime(),to:Infinity} : {from:startOfDay(Date.now())-(Number(key)-1)*864e5,to:Infinity};
  const a = analyze(DATA,bounds.from,bounds.to), p = periodPerformance(DATA,bounds), recent = a.trades.slice(-40);
  const ticks = recent.map(t=>`<span class="trade-tick ${t.net > 0 ? 'win' : ''}" title="${esc(t.coin)} · ${esc(fmtDateTime(t.close))} · ${esc(fmtUsd(t.net,{sign:true}))}"></span>`).join('');
  $('#performance-card').innerHTML = `<div class="metric-value ${cls(p.total)}">${fmtUsd(p.total,{sign:true})} <small>PnL</small></div><div class="trade-strip" role="img" aria-label="Last ${recent.length} closed trades: ${recent.filter(t=>t.net>0).length} wins, ${recent.filter(t=>t.net<=0).length} losses">${ticks}</div><div class="metric-caption"><span class="pos">${a.winRate == null ? '–' : fmtPct(a.winRate)} Win Rate</span> · ${a.count} Trades</div>`;
}
function renderPortfolioChart() {
  if (!DATA) return;
  const calendarView = CHART_VIEW === 'calendar';
  $('#chart-plot').hidden = calendarView; $('#chart-calendar').hidden = !calendarView;
  document.querySelectorAll('[data-metric]').forEach(b=>{b.disabled=calendarView;b.classList.toggle('on',b.dataset.metric===CHART_METRIC);b.setAttribute('aria-pressed',String(b.dataset.metric===CHART_METRIC));});
  const rb=rangeBounds();
  if (calendarView) {calendar($('#hero-calendar'),A.trades,Math.max(rb.from,DATA.fills[0]?.time ?? Date.now()),Math.min(rb.to,Date.now()));return;}
  $('#chart-plot').setAttribute('aria-labelledby','chart-tab-'+CHART_VIEW);
  const p=periodPerformance(DATA,rb,CHART_VIEW==='combined'?'combined':'perps',CHART_METRIC);
  $('#chart-title').textContent = `${rb.label} · ${CHART_VIEW === 'combined' ? 'Combined' : 'Perps'} ${CHART_METRIC === 'pnl' ? 'PnL' : 'account value'}`;
  $('#chart-value').textContent=fmtUsd(p.total,{sign:CHART_METRIC==='pnl'});
  $('#chart-value').className='chart-value '+(CHART_METRIC==='pnl'?cls(p.total):'');
  $('#chart-note').textContent=CHART_METRIC==='pnl'?'PnL excludes deposits and withdrawals.':'Account value includes deposits, withdrawals, and PnL.';
  if(p.total==null){$('#acct').innerHTML=`<div class="empty" style="min-height:380px">${esc(p.reason)}</div>`;return;}
  drawPortfolioChart($('#acct'),p,CHART_METRIC==='pnl');
}
function drawPortfolioChart(container, history, signed) {
  const height=container.clientWidth<500?300:380;
  const f=frame(container,height,{l:8,r:58,t:14,b:27}), pts=history.points.filter((p,i,all)=>i===0||p.t>all[i-1].t), slopes=monotoneSlopes(pts);
  f.svg.setAttribute('role','img');f.svg.setAttribute('aria-label',`${$('#chart-title').textContent}: ${fmtUsd(history.total,{sign:signed})}`);
  const minT=pts[0].t,maxT=pts.at(-1).t;
  let lo=Math.min(...pts.map(p=>p.v)),hi=Math.max(...pts.map(p=>p.v));
  if(signed){lo=Math.min(0,lo);hi=Math.max(0,hi);}
  const span=hi-lo||Math.max(1,Math.abs(hi)*.05);lo-=span*.08;hi+=span*.08;
  const X=t=>f.x0+(t-minT)/(maxT-minT||1)*(f.x1-f.x0),Y=v=>f.y1-(v-lo)/(hi-lo)*(f.y1-f.y0);
  const zero=signed?Math.max(f.y0,Math.min(f.y1,Y(0))):f.y1;
  const ticks=niceTicks(lo,hi,5);
  for(const value of ticks){const y=Y(value);S('line',{x1:f.x0,x2:f.x1,y1:y,y2:y,stroke:'var(--grid)','stroke-dasharray':'1 7'},f.svg);S('text',{x:f.W-5,y:y+4,'text-anchor':'end'},f.svg).textContent=tickLabel(value);}
  const hourly=maxT-minT<=864e5;
  const labels=Math.max(1,Math.min(7,Math.floor((f.x1-f.x0)/90),hourly?6:Math.floor((maxT-minT)/864e5)));
  for(let i=0;i<=labels;i++){const t=minT+(maxT-minT)*i/labels;S('text',{x:X(t),y:f.H-7,'text-anchor':i===0?'start':i===labels?'end':'middle'},f.svg).textContent=hourly?new Date(t).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}):fmtDate(t);}
  const defs=S('defs',{},f.svg);
  for(const [key,color,y,h] of [['up','var(--good)',0,zero],['down','var(--bad)',zero,f.H-zero]]){
    const clip=S('clipPath',{id:`pnl-${key}`},defs);S('rect',{x:0,y,width:f.W,height:h},clip);
    const pattern=S('pattern',{id:`pnl-hatch-${key}`,width:4,height:4,patternUnits:'userSpaceOnUse',patternTransform:'rotate(32)'},defs);
    S('rect',{width:4,height:4,fill:color,opacity:.065},pattern);S('line',{x1:0,y1:0,x2:0,y2:4,stroke:color,'stroke-width':1,opacity:.28},pattern);
  }
  const path=pts.map((p,i)=>{if(!i)return `M${X(p.t)},${Y(p.v)}`;const a=pts[i-1],dt=(p.t-a.t)/3;return `C${X(a.t+dt)},${Y(a.v+slopes[i-1]*dt)} ${X(p.t-dt)},${Y(p.v-slopes[i]*dt)} ${X(p.t)},${Y(p.v)}`;}).join('');
  const area=path+`L${X(maxT)},${zero}L${X(minT)},${zero}Z`;
  for(const [key,color] of [['up','var(--good)'],['down','var(--bad)']]){S('path',{d:area,fill:`url(#pnl-hatch-${key})`,'clip-path':`url(#pnl-${key})`},f.svg);S('path',{d:path,fill:'none',stroke:color,'stroke-width':2,'stroke-linejoin':'round','stroke-linecap':'round','clip-path':`url(#pnl-${key})`},f.svg);}
  const watermark=S('text',{x:(f.x0+f.x1)/2,y:(f.y0+f.y1)/2,'text-anchor':'middle',class:'chart-watermark'},f.svg);watermark.textContent='HYPERLIQUID';
  const last=pts.at(-1);S('circle',{cx:X(last.t),cy:Y(last.v),r:3,fill:!signed||last.v>=0?'var(--good)':'var(--bad)'},f.svg);
  const cross=S('line',{y1:f.y0,y2:f.y1,stroke:'var(--muted)','stroke-dasharray':'3 4',opacity:0},f.svg),dot=S('circle',{r:4,fill:'var(--ink)',opacity:0},f.svg);
  const hit=S('rect',{x:0,y:0,width:f.W,height:f.H,fill:'transparent'},f.svg);
  hit.addEventListener('pointermove',e=>{const box=f.svg.getBoundingClientRect(),x=Math.max(f.x0,Math.min(f.x1,(e.clientX-box.left)*f.W/box.width)),time=minT+(x-f.x0)/(f.x1-f.x0)*(maxT-minT);let i=pts.findIndex(p=>p.t>=time);if(i<0)i=pts.length-1;const b=pts[i],a=pts[Math.max(0,i-1)],value=curveValue(a,b,slopes[Math.max(0,i-1)],slopes[i],time);cross.setAttribute('x1',x);cross.setAttribute('x2',x);cross.setAttribute('opacity',.65);dot.setAttribute('cx',x);dot.setAttribute('cy',Y(value));dot.setAttribute('opacity',1);showTip(`<b>${fmtDateTime(time)}</b><br>${signed?'PnL':'Account value'}: ${fmtUsd(value,{sign:signed})}`,e);});
  hit.addEventListener('pointerleave',()=>{cross.setAttribute('opacity',0);dot.setAttribute('opacity',0);hideTip();});
}
function renderOpenPositions() {
  const ex=accountExposure(DATA);
  const ps=ex.positions.map(p=>({...p,size:Math.abs(n(p.szi)),value:Math.abs(n(p.positionValue)),entry:n(p.entryPx),mark:Math.abs(n(p.szi))?Math.abs(n(p.positionValue)/n(p.szi)):0,pnl:n(p.unrealizedPnl),liq:p.liquidationPx==null?null:n(p.liquidationPx),margin:n(p.marginUsed),funding:-n(p.cumFunding?.sinceOpen)}));
  ps.sort((a,b)=>{const av=a[POSITION_SORT.key],bv=b[POSITION_SORT.key];if(av==null)return 1;if(bv==null)return -1;return(typeof av==='string'?av.localeCompare(bv):av-bv)*POSITION_SORT.direction;});
  $('#position-count').textContent=ps.length;
  $('#pos-sub').textContent=ps.length?`${fmtUsd(ex.notional,{compact:true,dec:0})} notional`:'';
  if(!ps.length){$('#positions').innerHTML='<div class="empty">No open positions.</div>';return;}
  const cols=[['coin','Asset'],['size','Size'],['value','Value'],['entry','Entry'],['mark','Mark'],['pnl','PnL (ROE)'],['liq','Liquidation'],['margin','Margin'],['funding','Funding'],[null,'Mode']];
  const head=cols.map(([key,label])=>`<th${key===POSITION_SORT.key?` aria-sort="${POSITION_SORT.direction>0?'ascending':'descending'}"`:''}>${key?`<button class="sort-button" data-sort="${key}">${label} <span aria-hidden="true">${key===POSITION_SORT.key?(POSITION_SORT.direction>0?'↑':'↓'):'⌃'}</span></button>`:label}</th>`).join('');
  const rows=ps.map(p=>`<tr><td class="coin"><span class="asset-cell">${coinIcon(p.coin)}${esc(p.coin)} <span class="leverage-tag">${esc(p.leverage?.value??'–')}×</span></span><span class="position-side ${n(p.szi)<0?'short':''}">${n(p.szi)>0?'Long':'Short'}</span></td><td title="${fmtNum(p.size,8)} ${esc(p.coin)}">${compactSize(p.size)} ${esc(p.coin)}</td><td>${fmtUsd(p.value)}</td><td>$${fmtNum(p.entry,5)}</td><td>$${fmtNum(p.mark,5)}</td><td class="${cls(p.pnl)}">${fmtUsd(p.pnl,{sign:true})} (${n(p.returnOnEquity)>0?'+':''}${fmtPct(n(p.returnOnEquity))})</td><td>${p.liq==null?'N/A':fmtNum(p.liq,5)}</td><td>${fmtUsd(p.margin)}</td><td class="${cls(p.funding)}">${fmtUsd(p.funding,{sign:true})}</td><td>${esc(p.leverage?.type??'–')}</td></tr>`).join('');
  $('#positions').innerHTML=`<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
  $('#positions').querySelectorAll('[data-sort]').forEach(b=>b.onclick=()=>{if(POSITION_SORT.key===b.dataset.sort)POSITION_SORT.direction*=-1;else POSITION_SORT={key:b.dataset.sort,direction:b.dataset.sort==='coin'?1:-1};renderOpenPositions();});
}
function renderAccountTables(d,acct,total) {
  const b=accountBalances(d);
  $('#balances').innerHTML=`<div class="stats">${stat(b.equityLabel,fmtUsd(acct),b.equityNote)}${stat(b.spotLabel,fmtUsd(b.spot),b.spotNote)}${stat('Total account value',fmtUsd(total))}${stat(b.usedLabel,fmtUsd(b.used),b.usedNote)}${stat('Available margin',fmtUsd(b.free))}${stat('Withdrawable',b.withdrawable==null?'Unavailable':fmtUsd(b.withdrawable),b.unified?'Not provided for unified accounts':'')}</div>`;
  $('#order-count').textContent=Array.isArray(d.orders)?d.orders.length:'–';
  $('#orders').innerHTML=!Array.isArray(d.orders)?'<div class="empty">Open orders are unavailable. Refresh to try again.</div>':!d.orders.length?'<div class="empty">No open orders.</div>':`<table><thead><tr><th>Asset</th><th>Side</th><th>Size</th><th>Limit price</th><th>Type</th><th>Trigger</th><th>Reduce only</th></tr></thead><tbody>${d.orders.map(o=>`<tr><td><span class="asset-cell">${coinIcon(o.coin)}${esc(o.coin)}</span></td><td class="${o.side==='B'?'pos':'neg'}">${o.side==='B'?'Buy':'Sell'}</td><td>${o.isPositionTpsl && n(o.sz)===0 ? 'Full position' : fmtNum(n(o.sz),6)}</td><td>${fmtNum(n(o.limitPx),6)}</td><td>${esc(o.orderType||'Limit')}</td><td>${esc(o.triggerCondition||'–')}</td><td>${o.reduceOnly?'Yes':'No'}</td></tr>`).join('')}</tbody></table>`;
  const rb=rangeBounds(),fills=d.fills.filter(f=>f.time>=rb.from&&f.time<=rb.to).slice().reverse(),shown=SHOW_ALL_FILLS?fills:fills.slice(0,40);
  $('#fills-table').innerHTML=!fills.length?'<div class="empty">No fills in this date range.</div>':`<table><thead><tr><th>Time</th><th>Asset</th><th>Action</th><th>Size</th><th>Price</th><th>Fee</th><th>Closed PnL</th></tr></thead><tbody>${shown.map(f=>`<tr><td>${fmtDateTime(f.time)}</td><td>${esc(f.coin)}</td><td>${esc(f.dir||f.side)}</td><td>${fmtNum(n(f.sz),6)}</td><td>${fmtNum(n(f.px),6)}</td><td>${fmtUsd(n(f.fee))}</td><td class="${cls(n(f.closedPnl))}">${fmtUsd(n(f.closedPnl),{sign:true})}</td></tr>`).join('')}</tbody></table>${fills.length>40?`<div class="more"><button id="fills-more">${SHOW_ALL_FILLS?'Show fewer':`Show all ${fills.length} fills`}</button></div>`:''}`;
  const more=$('#fills-more');if(more)more.onclick=()=>{SHOW_ALL_FILLS=!SHOW_ALL_FILLS;renderAccountTables(d,acct,total);};
  try {if(!Array.isArray(d.ledger))throw new Error();const flows=cashflows(d.ledger,user,rb.from,rb.to);$('#transfer-table').innerHTML=flows.rows.length?`<div class="tbl"><table><thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>USD value</th></tr></thead><tbody>${flows.rows.map(r=>`<tr><td>${fmtDateTime(r.time)}</td><td>${esc(r.label)}</td><td>${fmtNum(r.quantity,6)} ${esc(r.token)}</td><td class="${r.incoming?'pos':''}">${r.usd==null?'Unavailable':fmtUsd(r.incoming?r.usd:-r.usd,{sign:true})}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">No transfers in this date range.</div>';}catch{$('#transfer-table').innerHTML='<div class="empty">Transfer history is unavailable. Refresh to try again.</div>';}
}

// Combine consecutive executions into activity; never label a partial reduction as a full close.
function recentActivity(fills, ledger, address) {
  const groups=[], active=new Map();
  for(const f of [...fills].sort((a,b)=>a.time-b.time)) {
    const key=JSON.stringify([f.coin,f.dir]);
    let g=active.get(key);
    const contiguous=g && Math.abs(g.end-n(f.startPosition))<1e-7;
    if(!g || !contiguous || f.time-g.time>300000 || (/^Open /.test(f.dir||'') && Math.abs(n(f.startPosition))<1e-8)){g={kind:'fill',coin:f.coin,dir:f.dir||'',time:f.time,quantity:0,value:0,pnl:0,fee:0,start:n(f.startPosition),end:0};groups.push(g);active.set(key,g);}
    g.time=Math.max(g.time,f.time);g.quantity+=n(f.sz);g.value+=n(f.sz)*n(f.px);g.pnl+=n(f.closedPnl);g.fee+=n(f.fee);g.end=n(f.startPosition)+(f.side==='B'?1:-1)*n(f.sz);
  }
  const rows=groups.map(g=>{const closing=/close/i.test(g.dir),side=/short/i.test(g.dir)?'Short':'Long';let action=g.dir;
    if(/^Open (Long|Short)$/i.test(g.dir))action=`${side} ${Math.abs(g.start)<1e-8?'opened':'increased'}`;
    else if(closing)action=`${side} ${Math.abs(g.end)<1e-8?'closed':'reduced'}`;
    return {...g,action,closing,price:g.quantity?g.value/g.quantity:0,net:g.pnl-g.fee};
  });
  try{if(Array.isArray(ledger))for(const r of cashflows(ledger,address).rows)rows.push({...r,coin:r.token,kind:'transfer',value:r.usd,action:r.label});}catch{}
  return rows.sort((a,b)=>b.time-a.time);
}
function renderActivity(d) {
  const rows=recentActivity(d.fills,d.ledger,user),shown=rows.slice(0,ACTIVITY_LIMIT);
  $('#activity-feed').innerHTML=shown.length?shown.map(r=>`<article class="activity-item">${coinIcon(r.coin)}<div class="activity-copy"><div class="activity-top"><span class="activity-title" title="${esc(r.kind==='fill'?`${fmtUsd(r.value,{compact:true})} ${r.coin} ${r.action}`:`${r.coin} ${r.action}`)}">${r.kind==='fill'?`${briefUsd(r.value)} ${esc(r.coin)} ${esc(r.action)}`:`${esc(r.coin)} ${esc(r.action)}`}</span><time class="activity-time" datetime="${new Date(r.time).toISOString()}">${fmtDateTime(r.time)}</time></div><div class="activity-detail">${compactSize(r.quantity)} ${esc(r.coin)}${r.kind==='fill'?` @ ${fmtUsd(r.price,{dec:r.price<1?5:2})}${r.closing?` · <span class="${cls(r.net)}">${briefUsd(r.net,true)}</span>`:''}`:''}</div></div></article>`).join('')+(rows.length>shown.length?'<div class="more"><button id="activity-more">Show more activity</button></div>':''):'<div class="empty">No recent activity.</div>';
  const more=$('#activity-more');if(more)more.onclick=()=>{ACTIVITY_LIMIT+=60;renderActivity(DATA);};
  updateActivityStatus();
}
function updateActivityStatus() {
  const fresh=DATA&&Date.now()-DATA.ts<120000,el=$('#activity-status');
  el.textContent=DATA?(fresh?'UPDATED':'CACHED'):'LOADING';el.classList.toggle('fresh',Boolean(fresh));
  $('#activity-footer').textContent=DATA?`Updated ${ago(DATA.ts)} · refreshes every minute · local time`:'Latest fills and transfers · local time';
}
function selectTable(name) {
  TABLE_VIEW=name;
  document.querySelectorAll('[data-table]').forEach(b=>{const selected=b.dataset.table===name;b.setAttribute('aria-selected',String(selected));b.tabIndex=selected?0:-1;$('#panel-'+b.dataset.table).hidden=!selected;});
}
function notifyUser(message) {const el=$('#toast');el.textContent=message;el.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.hidden=true,3500);}
async function copyText(text,label) {
  try{await navigator.clipboard.writeText(text);notifyUser(label+' copied');}
  catch{notifyUser('Copy is unavailable in this browser. '+(label==='Address'?'Use the wallet address in the page URL.':'Copy the page URL from your address bar.'));}
}
function initDashboard() {
  $('#wallet-short').textContent=user?user.slice(0,6)+'…'+user.slice(-4):'Public wallet tracker';
  $('#copy-wallet').onclick=()=>copyText(user,'Address');$('#copy-wallet').disabled=!user;
  $('#share-dashboard').onclick=()=>copyText(location.href,'Dashboard link');
  if(/^0x[0-9a-fA-F]{40}$/.test(user))$('#explorer-link').href='https://app.hyperliquid.xyz/explorer/address/'+user;
  $('#performance-range').onchange=renderPerformanceCard;
  if(!SINCE)$('#performance-range option[value="since"]').remove();
  $('#table-tabs').onclick=e=>{const b=e.target.closest('[data-table]');if(b)selectTable(b.dataset.table);};
  $('#view-positions').onclick=()=>selectTable('positions');
  $('#chart-tabs').onclick=e=>{const b=e.target.closest('[data-chart]');if(!b)return;CHART_VIEW=b.dataset.chart;document.querySelectorAll('[data-chart]').forEach(t=>{const selected=t===b;t.setAttribute('aria-selected',String(selected));t.tabIndex=selected?0:-1;});renderPortfolioChart();};
  document.querySelectorAll('[data-metric]').forEach(b=>b.onclick=()=>{CHART_METRIC=b.dataset.metric;renderPortfolioChart();});
  document.querySelectorAll('[role="tablist"]').forEach(list=>list.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;const tabs=[...list.querySelectorAll('[role="tab"]')],i=tabs.indexOf(document.activeElement);if(i<0)return;e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;tabs[next].click();tabs[next].focus();}));
  document.addEventListener('error',e=>{if(e.target instanceof HTMLImageElement&&e.target.closest('.coin-icon'))e.target.hidden=true;},true);
}
