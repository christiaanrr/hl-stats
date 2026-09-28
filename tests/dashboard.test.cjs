const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const vm = require('node:vm');
const html = readFileSync(join(__dirname,'../index.html'),'utf8');
const extract = (a,b) => html.slice(html.indexOf(a),html.indexOf(b));
const c = vm.createContext({});
vm.runInContext(extract('const n =','/* ---------- data ---------- */') + extract('function cashflows(','function roundTrips(') + extract('function accountBalances(','function renderSummary(') + readFileSync(join(__dirname,'../dashboard.js'),'utf8'),c);
const fill = (overrides={}) => ({coin:'BTC',dir:'Open Long',side:'B',startPosition:'0',sz:'2',px:'100',closedPnl:'0',fee:'1',oid:1,tid:1,time:1000,...overrides});

test('exposure weights long and short positions by notional and uses perps equity',()=>{
  const r=c.accountExposure({abstraction:'disabled',state:{marginSummary:{accountValue:'1000',totalMarginUsed:'700'},assetPositions:[{position:{coin:'BTC',szi:'2',positionValue:'1200'}},{position:{coin:'ETH',szi:'-3',positionValue:'800'}},{position:{coin:'ZERO',szi:'0',positionValue:'999'}}]}});
  assert.equal(r.notional,2000);assert.equal(r.leverage,2);assert.equal(r.longShare,.6);
  assert.equal(r.usage,.7);assert.equal(r.free,300);assert.equal(r.positions.length,2);
});
test('zero equity and no positions never produce infinity or invented direction',()=>{
  const r=c.accountExposure({abstraction:'disabled',state:{marginSummary:{accountValue:'0',totalMarginUsed:'10'},assetPositions:[]}});
  assert.equal(r.leverage,null);assert.equal(r.usage,null);assert.equal(r.longShare,null);assert.equal(r.free,0);
});
const unifiedAccount = () => ({
  abstraction:'unifiedAccount',
  state:{marginSummary:{accountValue:'11373',totalMarginUsed:'10850'},withdrawable:'300',assetPositions:[{position:{coin:'BTC',szi:'1',positionValue:'53000',unrealizedPnl:'-500'}}]},
  spotState:{balances:[{coin:'USDC',token:0,total:'25200',hold:'11100'},{coin:'UETH',token:221,total:'0',hold:'0'}]},
  portfolio:{allTime:{accountValueHistory:[[1,'24800']]}}
});
test('unified leverage uses shared USDC equity instead of legacy perps account value',()=>{
  const d=unifiedAccount(),r=c.accountExposure(d),b=c.accountBalances(d);
  assert.equal((53000/11373).toFixed(2),'4.66');
  assert.equal(r.leverage.toFixed(2),'2.10');
  assert.equal(r.equity,25200); // Do not add legacy balance or unrealized PnL again.
  assert.equal(r.used,11100);assert.equal(r.free,14100);assert.equal(r.usage,11100/25200);
  assert.equal(b.total,25200);assert.equal(b.spot,0);assert.equal(b.withdrawable,null);
});
test('standard accounts keep spot balances out of perps leverage and free margin',()=>{
  const d=unifiedAccount();d.abstraction='disabled';
  const r=c.accountExposure(d),b=c.accountBalances(d);
  assert.equal(r.leverage.toFixed(2),'4.66');assert.equal(r.used,10850);assert.equal(r.free,523);
  assert.equal(b.withdrawable,300);assert.equal(b.total,24800);assert.equal(b.spot,13427);
});
test('missing mode, missing unified balances, and portfolio margin never use legacy equity',()=>{
  for(const mode of [null,undefined,'portfolioMargin','unexpected']){
    const d=unifiedAccount();d.abstraction=mode;
    const r=c.accountExposure(d);
    assert.equal(r.leverage,null);assert.equal(r.usage,null);assert.equal(r.free,null);
    assert.equal(r.notional,53000);assert.equal(r.positions.length,1);
  }
  const d=unifiedAccount();d.spotState=null;
  assert.equal(c.accountExposure(d).leverage,null);assert.equal(c.accountBalances(d).spot,null);
});
test('zero or malformed unified balances never fall back to legacy balance',()=>{
  const d=unifiedAccount();d.spotState.balances=[];
  assert.equal(c.accountBalances(d).total,0);assert.equal(c.accountExposure(d).leverage,null);
  for(const value of ['0','','bad',null]){
    d.spotState.balances=[{token:0,total:value,hold:'0'}];
    assert.equal(c.accountExposure(d).leverage,null);
  }
});
test('unified accounts with other assets keep portfolio total without using those assets as USDC collateral',()=>{
  const d=unifiedAccount();d.spotState.balances[1].total='1';d.portfolio.allTime.accountValueHistory=[[1,'28200']];
  const b=c.accountBalances(d);
  assert.equal(b.equity,25200);assert.equal(b.total,28200);assert.equal(b.spot,3000);
  assert.equal(c.accountExposure(d).leverage.toFixed(2),'2.10');
});
test('refresh loads account mode and shared balances, and tolerates endpoint failure without false leverage',async()=>{
  const d=unifiedAccount();
  for(const fail of [false,true]){
    const calls=[];
    const ctx=vm.createContext({user:'0xabc',info:async({type})=>{
      calls.push(type);
      if(fail&&['userAbstraction','spotClearinghouseState'].includes(type))throw new Error('offline');
      return {clearinghouseState:d.state,portfolio:Object.entries(d.portfolio),frontendOpenOrders:[],userAbstraction:d.abstraction,spotClearinghouseState:d.spotState}[type];
    },paged:async()=>[],loadLedger:async()=>[]});
    vm.runInContext(extract('async function loadAll()','/* ---------- analytics ---------- */'),ctx);
    const loaded=await ctx.loadAll();
    assert.ok(calls.includes('userAbstraction'));assert.ok(calls.includes('spotClearinghouseState'));
    assert.equal(c.accountExposure(loaded).leverage?.toFixed(2)??null,fail?null:'2.10');
  }
});
test('consecutive scale-in fills become one activity with weighted price and size',()=>{
  const rows=c.recentActivity([fill(),fill({oid:2,tid:2,time:2000,startPosition:'2',sz:'3',px:'110'})],[],'0xabc');
  assert.equal(rows.length,1);assert.equal(rows[0].quantity,5);assert.equal(rows[0].value,530);
  assert.equal(rows[0].price,106);assert.equal(rows[0].action,'Long opened');
});
test('activity distinguishes partial reductions, full closes, and new positions',()=>{
  const rows=c.recentActivity([
    fill({dir:'Close Long',side:'A',startPosition:'5',sz:'2',closedPnl:'20'}),
    fill({dir:'Close Long',side:'A',startPosition:'3',sz:'3',closedPnl:'30',time:400000,oid:2}),
    fill({time:401000,oid:3})
  ],[],'0xabc');
  assert.equal(rows.length,3);assert.equal(rows[0].action,'Long opened');
  assert.equal(rows[1].action,'Long closed');assert.equal(rows[1].net,29);
  assert.equal(rows[2].action,'Long reduced');
});
test('short closes and deposits appear in descending time order; self transfers stay excluded',()=>{
  const ledger=[{time:5000,delta:{type:'deposit',usdc:'75'}},{time:6000,delta:{type:'send',user:'0xabc',destination:'0xabc',token:'USDC',amount:'99'}}];
  const rows=c.recentActivity([fill({dir:'Close Short',side:'B',startPosition:'-2',closedPnl:'10'})],ledger,'0xabc');
  assert.equal(rows.length,2);assert.equal(rows[0].kind,'transfer');assert.equal(rows[0].quantity,75);
  assert.equal(rows[1].action,'Short closed');assert.equal(rows[1].net,9);
});
test('missing transfer history preserves fills and unsafe coin names are escaped',()=>{
  assert.equal(c.recentActivity([fill()],null,'0xabc').length,1);
  const icon=c.coinIcon('<img src=x onerror=1>');
  assert.ok(!icon.includes('onerror'));assert.ok(!icon.includes('<img'));assert.ok(icon.includes('&lt;'));
});

test('smoothed chart stays within actual snapshot extrema and passes through each snapshot',()=>{
  const points=[{t:0,v:0},{t:1,v:100},{t:3,v:110},{t:4,v:-50},{t:9,v:-50},{t:10,v:80}],m=c.monotoneSlopes(points);
  for(let i=0;i<points.length-1;i++){
    const a=points[i],b=points[i+1];
    assert.equal(c.curveValue(a,b,m[i],m[i+1],a.t),a.v);
    assert.equal(c.curveValue(a,b,m[i],m[i+1],b.t),b.v);
    for(let step=0;step<=100;step++){const v=c.curveValue(a,b,m[i],m[i+1],a.t+(b.t-a.t)*step/100);assert.ok(v>=Math.min(a.v,b.v)-1e-8&&v<=Math.max(a.v,b.v)+1e-8);}
  }
});
