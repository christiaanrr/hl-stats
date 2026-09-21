const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const html = readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const extract = (start, end) => html.slice(html.indexOf(start), html.indexOf(end));
const context = vm.createContext({user:'0xabc', Date});
vm.runInContext(extract('function cashflows(', 'function roundTrips(') + extract('async function loadLedger(', 'async function loadAll('), context);
const event = (delta, time=10, hash='tx') => ({delta,time,hash});

test('counts external funds and excludes self transfers, vaults, and funding', () => {
  const result = context.cashflows([
    event({type:'deposit',usdc:'100'}), event({type:'withdraw',usdc:'20',fee:'1'}),
    event({type:'send',user:'0xother',destination:'0xABC',token:'USDC',amount:'50'}),
    event({type:'internalTransfer',user:'0xABC',destination:'0xother',usdc:'10'}),
    event({type:'send',user:'0xabc',destination:'0xABC',token:'USDC',amount:'999'}),
    event({type:'send',user:'0xother',destination:'0xelse',token:'USDC',amount:'999'}),
    event({type:'accountClassTransfer',usdc:'999'}), event({type:'vaultDeposit',usdc:'999'}),
    event({type:'funding',usdc:'999'})
  ], '0xAbC');
  assert.equal(result.rows.length, 4);
  assert.equal(result.deposits, 150);
  assert.equal(result.withdrawals, 30);
  assert.equal(result.net, 120);
});
test('uses historical USD values for tokens and flags unavailable prices', () => {
  const result = context.cashflows([
    event({type:'spotTransfer',user:'0xother',destination:'0xabc',token:'UETH',amount:'0.5',usdcValue:'1000'}),
    event({type:'send',user:'0xabc',destination:'0xother',token:'HYPE',amount:'2'})
  ], '0xabc');
  assert.equal(result.deposits, 1000);
  assert.equal(result.unpriced, true);
  assert.equal(result.rows[1].usd, null);
});
test('filters inclusively and orders newest first; empty ranges have zero totals', () => {
  const ledger = [1,2,3,4].map(t => event({type:'deposit',usdc:'10'},t));
  const result = context.cashflows(ledger, '0xabc', 2,3);
  assert.equal(result.rows.map(x=>x.time).join(','), '3,2');
  assert.equal(result.deposits, 20);
  assert.equal(context.cashflows(ledger, '0xabc', 5,6).net, 0);
});
test('rejects malformed amounts instead of displaying zero', () => {
  assert.throws(() => context.cashflows([event({type:'deposit',usdc:'oops'})], '0xabc'));
});
test('paginates inclusive boundaries and deduplicates overlap', async () => {
  const first = Array.from({length:500}, (_,i) => event({type:'deposit',usdc:'1'}, i+1, `tx${i}`));
  const calls=[];
  context.info = async body => { calls.push(body); return calls.length===1 ? first : [first[499],event({type:'withdraw',usdc:'2'},501)]; };
  const rows = await context.loadLedger();
  assert.equal(rows.length,501);
  assert.equal(calls[1].startTime,500);
  assert.equal(calls[0].endTime,calls[1].endTime);
});
test('fails visibly if a full ledger page stops advancing', async () => {
  context.info = async () => Array.from({length:500},()=>event({type:'deposit',usdc:'1'},1));
  await assert.rejects(context.loadLedger(), /did not advance/);
});
