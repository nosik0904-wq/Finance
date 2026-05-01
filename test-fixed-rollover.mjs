import { sampleState } from './src/data/sampleData.js';
import { calculateLoanMetrics } from './src/logic/financeCalculations.js';
import { deepClone, ensureMortgageEntry } from './src/logic/engine.js';
import { applyEstimatedMortgageRepayment, applyFixedRateRollover, getFixedRolloverInfo, reconcileMortgageBalances } from './src/logic/loanLogic.js';

let passed = 0;
let failed = 0;
const fail = [];
function check(label, cond, detail = '') {
  if (cond) passed += 1;
  else { failed += 1; fail.push(`${label}${detail ? ': ' + detail : ''}`); }
}

const before = ensureMortgageEntry(deepClone(sampleState), '2027-04-28');
const beforeMetrics = calculateLoanMetrics(before);
check('Before fixed end, fixed split remains active', before.loan.fixed.status === 'active', before.loan.fixed.status);
check('Before fixed end, fixed balance remains separate', before.loan.fixed.balance > 0 && before.loan.variable.balance > 0);
check('Before fixed end, offset applies to variable only', beforeMetrics.offsetCredit > 0 && beforeMetrics.offsetCredit < beforeMetrics.dailyGrossInterest);

const soon = ensureMortgageEntry(deepClone(sampleState), '2028-03-01');
const soonInfo = getFixedRolloverInfo(soon.loan, '2028-03-01');
check('Fixed ending soon warning triggers inside 90 days', soonInfo.status === 'ending_soon', soonInfo.status);

const maturedInput = deepClone(sampleState);
const matured = applyFixedRateRollover(ensureMortgageEntry(maturedInput, '2028-04-27'), '2028-04-29');
check('On or after fixed end, fixed balance rolls to zero', Math.round(matured.loan.fixed.balance) === 0, matured.loan.fixed.balance);
check('On or after fixed end, variable balance receives fixed balance', Math.round(matured.loan.variable.balance) === 782000, matured.loan.variable.balance);
check('After rollover, status needs bank check', matured.loan.balanceStatus === 'needs_check', matured.loan.balanceStatus);
check('After rollover, repayment amount is preserved in variable split', Math.round(matured.loan.variable.repaymentAmount) === 3920, matured.loan.variable.repaymentAmount);

const afterPayment = applyEstimatedMortgageRepayment(matured, '2028-05-12').state;
check('After rollover payment, fixed remains zero', Math.round(afterPayment.loan.fixed.balance) === 0, afterPayment.loan.fixed.balance);
check('After rollover payment, variable principal reduces', afterPayment.loan.variable.balance < matured.loan.variable.balance, `${afterPayment.loan.variable.balance} >= ${matured.loan.variable.balance}`);

const reconciled = reconcileMortgageBalances(afterPayment, {
  fixedBalance: 0,
  variableBalance: 775000,
  offsetBalance: 52000,
  fixedRate: afterPayment.loan.fixed.rate,
  fixedEndDate: afterPayment.loan.fixed.fixedEndDate,
  variableRate: 6.55,
}, '2028-05-13');
check('Manual check confirms new variable balance', reconciled.loan.variable.confirmedBalance === 775000);
check('Manual check updates variable rate', reconciled.loan.variable.rate === 6.55);
check('Manual check marks rollover reviewed', reconciled.loan.fixedRollover.reviewed === true);

console.log(`Fixed rollover test: ${passed} passed, ${failed} failed`);
if (failed) {
  console.error(fail.join('\n'));
  process.exit(1);
}
