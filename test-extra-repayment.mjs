import { sampleState } from './src/data/sampleData.js';
import { ensureMortgageEntry, deepClone } from './src/logic/engine.js';
import { recordExtraLoanRepayment } from './src/logic/loanLogic.js';

let passed = 0;
let failed = 0;
function check(label, cond, detail = '') {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error(`FAIL ${label}${detail ? ': ' + detail : ''}`);
  }
}

const start = ensureMortgageEntry(deepClone(sampleState), '2026-04-29');
const paid = recordExtraLoanRepayment(start, {
  date: '2026-06-01',
  amount: 20000,
  fromAccount: 'offset',
  targetSplit: 'variable',
  bankConfirmed: true,
  note: 'test lump sum',
}, '2026-06-01');

check('Offset reduces by full extra repayment', paid.accounts.offset.balance === start.accounts.offset.balance - 20000);
check('Variable balance reduces by full extra repayment', paid.loan.variable.balance === start.loan.variable.balance - 20000);
check('Fixed balance is unchanged for variable extra repayment', paid.loan.fixed.balance === start.loan.fixed.balance);
check('Confirmed variable balance follows bank-confirmed repayment', paid.loan.variable.confirmedBalance === paid.loan.variable.balance);
check('Loan status remains confirmed when bank confirmed', paid.loan.balanceStatus === 'confirmed');
check('Activity history records extra repayment', paid.loan.activity?.[0]?.type === 'extra_repayment');

const estimated = recordExtraLoanRepayment(start, {
  amount: 10000,
  fromAccount: 'offset',
  targetSplit: 'fixed',
  bankConfirmed: false,
}, '2026-06-02');
check('Fixed extra repayment reduces fixed balance', estimated.loan.fixed.balance === start.loan.fixed.balance - 10000);
check('Unconfirmed fixed repayment leaves confirmed fixed balance unchanged', estimated.loan.fixed.confirmedBalance === start.loan.fixed.confirmedBalance);
check('Unconfirmed repayment sets estimate status', estimated.loan.balanceStatus === 'estimated');
check('Unconfirmed offset becomes estimated', estimated.accounts.offset.balanceStatus === 'estimated');

const split = recordExtraLoanRepayment(start, {
  amount: 10000,
  fromAccount: 'other',
  targetSplit: 'split',
  bankConfirmed: true,
}, '2026-06-03');
check('Split extra repayment reduces total by full amount', Math.abs(split.loan.totalBalance - (start.loan.totalBalance - 10000)) < 0.01, `got ${split.loan.totalBalance}`);
check('Other source does not change offset', split.accounts.offset.balance === start.accounts.offset.balance);

console.log(`Extra repayment test: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
