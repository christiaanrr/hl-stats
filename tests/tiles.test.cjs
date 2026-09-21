const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const html = readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const extract = (start, end) => html.slice(html.indexOf(start), html.indexOf(end));
const source = extract('const n =', '/* ---------- data ---------- */')
  + extract('function cashflows(', 'function roundTrips(')
  + extract('const tile =', 'function render()')
  + extract('function render() {', "  // Hyperliquid's pnlHistory") + '\n}';
const ledger = [
  {time:1,delta:{type:'deposit',usdc:'1000'}},
  {time:2,delta:{type:'withdraw',usdc:'200'}},
  {time:5,delta:{type:'deposit',usdc:'400'}},
  {time:9,delta:{type:'deposit',usdc:'100'}}
];
function render(ledgerValue=ledger, selectedPnl=80, from=4, to=10) {
  const elements = {};
  const context = vm.createContext({
    DATA: {
      ledger:ledgerValue,
      state:{marginSummary:{accountValue:'500',totalMarginUsed:'50'},assetPositions:[{}]},
      portfolio:Object.fromEntries(Object.entries({allTime:1000,perpAllTime:60,perpDay:8,perpWeek:16,perpMonth:-40}).map(([key,pnl])=>[key,{pnlHistory:[[{perpDay:8,perpWeek:4}[key] || 1,'0'],[10,String(pnl)]],accountValueHistory:[[1,'1000']],vlm:'100'}])),
      fills:[{closedPnl:'120',fee:'10'}],funding:[{delta:{type:'funding',usdc:'-10'}}]
    },
    A:{realizedNet:selectedPnl+10,fundNet:-10,unrealized:40,winRate:0.5,count:2},
    user:'0xabc',RANGE:{key:'custom'},syncFilters:()=>{},rangeBounds:()=>({from,to,label:'Test range'}),
    $:selector=>elements[selector] ||= {}
  });
  vm.runInContext(source + '\nrender();', context);
  return elements['#tiles'].innerHTML.split('<div class="card tile">').slice(1);
}
test('all seven PnL tiles use actual net deposits, excluding account value', () => {
  const tiles = render();
  assert.equal(tiles.length,8);
  assert.ok(!tiles[0].includes('net deposits'));
  const expected=['+7.7%','+3.1%','+4.6%','+16.0%','+8.0%','+3.2%','−3.1%'];
  tiles.slice(1).forEach((tile,i)=>{
    assert.ok(tile.includes(expected[i]), `Tile ${i+1} has expected ratio`);
    assert.ok(tile.includes(i < 3 ? 'of all-time net deposits' : 'of net deposits in this period'));
    assert.ok(!tile.includes('on capital'));
  });
});
test('changing selected-range PnL updates its ratio without changing fixed-period tiles', () => {
  const before=render(), after=render(ledger,-160);
  assert.ok(after[4].includes('−32.0%'));
  before.forEach((tile,i)=>{if(i!==4) assert.equal(after[i],tile);});
});
test('missing, unpriced, zero and negative net deposits never display misleading ratios', () => {
  for (const value of [null,[],[{time:9,delta:{type:'withdraw',usdc:'50'}}],
    [...ledger,{time:10,delta:{type:'send',user:'other',destination:'0xabc',token:'HYPE',amount:'2'}}]]) {
    const tiles=render(value);
    assert.ok(tiles.slice(1).every(tile=>tile.includes(': N/A')));
    assert.ok(tiles[4].includes('+$80.00'));
    assert.ok(tiles[4].includes('50% win rate'));
  }
});

test('changing only the selected dates updates its net-deposit denominator', () => {
  const before=render(), after=render(ledger,80,9,10);
  assert.ok(before[4].includes('+16.0%'));
  assert.ok(after[4].includes('+80.0%'));
  before.forEach((tile,i)=>{if(i!==4) assert.equal(after[i],tile);});
});
test('a period without deposits shows N/A while keeping its PnL and trade stats', () => {
  const tiles=render(ledger,80,6,8);
  assert.ok(tiles[4].includes(': N/A'));
  assert.ok(tiles[4].includes('+$80.00'));
  assert.ok(tiles[4].includes('50% win rate'));
});
