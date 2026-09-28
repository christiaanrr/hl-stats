const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const vm = require('node:vm');
const html = readFileSync(join(__dirname,'../index.html'),'utf8');
const extract = (a,b) => html.slice(html.indexOf(a),html.indexOf(b));
const c = vm.createContext({});
vm.runInContext(extract('const n =','/* ---------- data ---------- */') + extract('function cashflows(','function roundTrips(') + readFileSync(join(__dirname,'../dashboard.js'),'utf8'),c);
const fill = (overrides={}) => ({coin:'BTC',dir:'Open Long',side:'B',startPosition:'0',sz:'2',px:'100',closedPnl:'0',fee:'1',oid:1,tid:1,time:1000,...overrides});

test('exposure weights long and short positions by notional and uses perps equity',()=>{
  const r=c.accountExposure({marginSummary:{accountValue:'1000',totalMarginUsed:'700'},assetPositions:[{position:{coin:'BTC',szi:'2',positionValue:'1200'}},{position:{coin:'ETH',szi:'-3',positionValue:'800'}},{position:{coin:'ZERO',szi:'0',positionValue:'999'}}]});
  assert.equal(r.notional,2000);assert.equal(r.leverage,2);assert.equal(r.longShare,.6);
  assert.equal(r.usage,.7);assert.equal(r.free,300);assert.equal(r.positions.length,2);
});
test('zero equity and no positions never produce infinity or invented direction',()=>{
  const r=c.accountExposure({marginSummary:{accountValue:'0',totalMarginUsed:'10'},assetPositions:[]});
  assert.equal(r.leverage,null);assert.equal(r.usage,null);assert.equal(r.longShare,null);assert.equal(r.free,0);
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
