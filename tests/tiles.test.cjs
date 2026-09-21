const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const html = readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const extract = (start, end) => html.slice(html.indexOf(start), html.indexOf(end));
const source = extract('const n =', '/* ---------- data ---------- */')
  + extract('function cashflows(', 'function roundTrips(')
  + extract('const tile =', 'function render()');
function setup(overrides={}) {
  const elements={};
  const d={
    ledger:[{time:1,delta:{type:'deposit',usdc:'1000'}},{time:5,delta:{type:'deposit',usdc:'400'}},{time:9,delta:{type:'deposit',usdc:'100'}},{time:19,delta:{type:'withdraw',usdc:'200'}}],
    portfolio:Object.fromEntries(Object.entries({
      perpAllTime:[[0,'0'],[10,'100'],[20,'200']],
      perpMonth:[[5,'0'],[10,'50'],[20,'150']],
      perpWeek:[[10,'0'],[15,'50'],[20,'100']],
      perpDay:[[18,'0'],[20,'20']]
    }).map(([key,pnlHistory])=>[key,{pnlHistory}])),
    fills:[],funding:[],state:{marginSummary:{totalMarginUsed:'50'},assetPositions:[{}]},...overrides
  };
  const c=vm.createContext({user:'0xabc',$:selector=>elements[selector] ||= {}});
  vm.runInContext(source,c);
  const render=(from=5,to=20,realized=80)=>{
    c.renderSummary(d,{realizedNet:realized+10,fundNet:-10,unrealized:40,winRate:0.5,count:2},{from,to,label:'Test range'},500,1000);
    return {tiles:elements['#tiles'].innerHTML.split('<div class="card tile">').slice(1),now:elements['#now-tiles'].innerHTML,note:elements['#period-note'].textContent};
  };
  return {c,d,render};
}
test('uses one covering history, never mixing different portfolio baselines',()=>{
  const {c,d}=setup();
  const p=c.periodPerformance(d,{from:5,to:20});
  assert.equal(p.total,150); // month baseline, not the all-time value of 200
  assert.equal(p.points.at(-1).v,150);
  assert.equal(p.interpolated,false);
});
test('interpolates both historical boundaries and keeps chart endpoint equal to total',()=>{
  const {c,d}=setup();
  const p=c.periodPerformance(d,{from:11,to:17});
  assert.equal(p.total,60);
  assert.equal(p.from,11);
  assert.equal(p.to,17);
  assert.equal(p.points.at(-1).v,60);
  assert.equal(p.interpolated,true);
});
test('all time uses the lifetime history; ranges before coverage never assume zero',()=>{
  const {c,d}=setup();
  assert.equal(c.periodPerformance(d,{from:-Infinity,to:Infinity}).total,200);
  for (const bounds of [{from:-10,to:20},{from:21,to:30},{from:15,to:10}]) {
    assert.equal(c.periodPerformance(d,bounds).total,null);
  }
  assert.equal(setup({portfolio:{}}).render().tiles[1].includes('Unavailable'),true);
});
test('four period tiles reconcile and share the selected net-deposit denominator',()=>{
  const {render}=setup();
  const {tiles,now}=render();
  assert.equal(tiles.length,4);
  assert.ok(tiles[0].includes('+$80.00'));
  assert.ok(tiles[1].includes('≈ +$70.00'));
  assert.ok(tiles[2].includes('+$150.00'));
  assert.ok(tiles[3].includes('+$300.00'));
  assert.ok(tiles[0].includes('+26.7%'));
  assert.ok(tiles[1].includes('+23.3%'));
  assert.ok(tiles[2].includes('+50.0%'));
  assert.ok(now.includes('Account value · now'));
  assert.ok(now.includes('+$40.00'));
  assert.ok(!now.includes('%'));
});
test('changing dates updates period totals and deposits while live balances stay unchanged',()=>{
  const {render}=setup();
  const before=render(),after=render(10,20,30);
  assert.ok(after.tiles[0].includes('+$30.00'));
  assert.ok(after.tiles[1].includes('≈ +$70.00'));
  assert.ok(after.tiles[2].includes('+$100.00'));
  assert.ok(after.tiles[3].includes('−$200.00'));
  assert.ok(after.tiles[0].includes('N/A'));
  assert.equal(after.now,before.now);
});
test('closing a profitable position can reduce unrealized PnL without being a loss',()=>{
  const {render}=setup();
  const {tiles}=render(10,20,180);
  assert.ok(tiles[0].includes('+$180.00'));
  assert.ok(tiles[1].includes('≈ −$80.00'));
  assert.ok(tiles[2].includes('+$100.00'));
});
test('missing/unpriced deposits suppress percentages, not profit amounts',()=>{
  for (const ledger of [null,[],[{time:9,delta:{type:'send',user:'other',destination:'0xabc',token:'HYPE',amount:'2'}}]]) {
    const {tiles}=setup({ledger}).render();
    assert.ok(tiles.slice(0,3).every(tile=>tile.includes('N/A')));
    assert.ok(tiles[0].includes('+$80.00'));
  }
});
test('incomplete fills or activity newer than snapshots cannot produce unrealized change',()=>{
  for (const overrides of [{fills:Array.from({length:10000},()=>({time:1}))},{funding:[{time:21}]}]) {
    const {tiles}=setup(overrides).render(5,Infinity);
    assert.ok(tiles[1].includes('Unavailable'));
    assert.ok(tiles[2].includes('+$150.00'));
  }
});
