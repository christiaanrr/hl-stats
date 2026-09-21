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
  {time:2,delta:{type:'withdraw',usdc:'200'}}
];
function render(ledgerValue=ledger, selectedPnl=80) {
  const elements = {};
  const context = vm.createContext({
    DATA: {
      ledger:ledgerValue,
      state:{marginSummary:{accountValue:'500',totalMarginUsed:'50'},assetPositions:[{}]},
      portfolio:Object.fromEntries(Object.entries({allTime:1000,perpAllTime:60,perpDay:8,perpWeek:16,perpMonth:-40}).map(([key,pnl])=>[key,{pnlHistory:[[1,String(pnl)]],accountValueHistory:[[1,'1000']],vlm:'100'}])),
      fills:[{closedPnl:'120',fee:'10'}],funding:[{delta:{type:'funding',usdc:'-10'}}]
    },
    A:{realizedNet:selectedPnl+10,fundNet:-10,unrealized:40,winRate:0.5,count:2},
    user:'0xabc',syncFilters:()=>{},rangeBounds:()=>({label:'Test range'}),
    $:selector=>elements[selector] ||= {}
  });
  vm.runInContext(source + '\nrender();', context);
  return elements['#tiles'].innerHTML.split('<div class="card tile">').slice(1);
}
test('all seven PnL tiles use actual net deposits, excluding account value', () => {
  const tiles = render();
  assert.equal(tiles.length,8);
  assert.ok(!tiles[0].includes('net deposits'));
  const expected=['+12.5%','+5.0%','+7.5%','+10.0%','+1.0%','+2.0%','−5.0%'];
  tiles.slice(1).forEach((tile,i)=>{
    assert.ok(tile.includes(expected[i]), `Tile ${i+1} has expected ratio`);
    assert.ok(tile.includes('of all-time net deposits'));
    assert.ok(!tile.includes('on capital'));
  });
});
test('changing selected-range PnL updates its ratio without changing fixed-period tiles', () => {
  const before=render(), after=render(ledger,-160);
  assert.ok(after[4].includes('−20.0%'));
  before.forEach((tile,i)=>{if(i!==4) assert.equal(after[i],tile);});
});
test('missing, unpriced, zero and negative net deposits never display misleading ratios', () => {
  for (const value of [null,[],[{time:1,delta:{type:'withdraw',usdc:'50'}}],
    [...ledger,{time:3,delta:{type:'send',user:'other',destination:'0xabc',token:'HYPE',amount:'2'}}]]) {
    const tiles=render(value);
    assert.ok(tiles.every(tile=>!tile.includes('of all-time net deposits')));
    assert.ok(tiles[4].includes('+$80.00'));
    assert.ok(tiles[4].includes('50% win rate'));
  }
});
