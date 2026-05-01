import { sampleState } from './src/data/sampleData.js';
import { normalizeState } from './src/logic/engine.js';
import {
  addVariableLoanTopUp,
  cancelVariableLoanTopUp,
  confirmVariableLoanTopUp,
  getLoanTopUpAlerts,
  getLoanTopUpsDueInWindow,
  getTopUpProjectedImpact,
  normalizeLoanForBalances,
} from './src/logic/loanLogic.js';
import { generateWeeklyMoneyCheckIn } from './src/logic/reporting.js';

let passed = 0;
let failed = 0;
function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const today = '2026-04-29';
const base = normalizeState(structuredClone(sampleState), sampleState);
const initialVariable = Number(base.loan.variable.balance || 0);
const initialOffset = Number(base.accounts.offset.balance || 0);

const planned = addVariableLoanTopUp(base, {
  expectedDate: '2026-10-29',
  amount: 50000,
  destinationAccount: 'offset',
  newVariableRate: 6.55,
  newRepaymentAmount: 2350,
  note: 'future top-up test',
}, today);

const topUp = planned.loan.topUps.find((item) => item.note === 'future top-up test');
check('Adds planned top-up', Boolean(topUp));
check('Planned top-up is not income and does not change variable balance immediately', Number(planned.loan.variable.balance) === initialVariable);
check('Planned top-up does not change offset immediately', Number(planned.accounts.offset.balance) === initialOffset);
check('Top-up is marked planned', topUp?.status === 'planned');
check('Top-up targets variable split', topUp?.targetSplit === 'variable');

const impact = getTopUpProjectedImpact(planned, topUp);
check('Projected variable balance includes planned top-up', impact.plannedVariableBalance === initialVariable + 50000);
check('Projected offset balance includes planned top-up when destination is offset', impact.plannedOffsetBalance === initialOffset + 50000);

const alertsEarly = getLoanTopUpAlerts(planned, '2026-07-01');
check('No top-up alert outside 90-day window', !alertsEarly.some((alert) => alert.topUp.id === topUp.id));
const alertsNear = getLoanTopUpAlerts(planned, '2026-09-01');
check('Top-up alert appears within 90 days', alertsNear.some((alert) => alert.topUp.id === topUp.id && alert.type === 'upcoming_top_up'));
const alertsOverdue = getLoanTopUpAlerts(planned, '2026-11-05');
check('Overdue top-up asks for confirmation', alertsOverdue.some((alert) => alert.topUp.id === topUp.id && alert.type === 'overdue_top_up'));

const dueThisWeek = getLoanTopUpsDueInWindow(planned, '2026-10-24', 7);
check('Planned top-up appears in due window', dueThisWeek.some((item) => item.id === topUp.id));

const weekly = generateWeeklyMoneyCheckIn(planned, '2026-10-24');
check('Weekly email shows top-up alert', weekly.mortgageCheck.topUps.some((alert) => alert.topUp.id === topUp.id));
check('Weekly outlook treats top-up funds as borrowed funds', weekly.outlook.borrowedFunds === 50000);
check('Weekly projected offset includes top-up if due this week', weekly.outlook.projectedOffset >= initialOffset + 50000 - 1);

const confirmed = confirmVariableLoanTopUp(planned, topUp.id, {
  confirmedAmount: 52000,
  fundsReceived: 52000,
  destinationAccount: 'offset',
  variableBalance: 473500,
  offsetBalance: 100600,
  newVariableRate: 6.72,
  newRepaymentAmount: 2450,
}, '2026-10-30');
const confirmedTopUp = confirmed.loan.topUps.find((item) => item.id === topUp.id);
check('Confirmed top-up status is confirmed', confirmedTopUp?.status === 'confirmed');
check('Confirmed top-up updates variable balance to bank amount', Number(confirmed.loan.variable.balance) === 473500);
check('Confirmed top-up updates variable confirmed balance', Number(confirmed.loan.variable.confirmedBalance) === 473500);
check('Confirmed top-up updates offset to bank amount', Number(confirmed.accounts.offset.balance) === 100600);
check('Confirmed top-up updates offset confirmed balance', Number(confirmed.accounts.offset.confirmedBalance) === 100600);
check('Confirmed top-up updates rate', Number(confirmed.loan.variable.rate) === 6.72);
check('Confirmed top-up updates repayment', Number(confirmed.loan.variable.repaymentAmount) === 2450);
check('Confirmed top-up recalculates total loan balance', Number(confirmed.loan.totalBalance) === Number(confirmed.loan.fixed.balance) + Number(confirmed.loan.variable.balance));
check('Confirmed top-up moves next balance check forward', confirmed.loan.nextReconciliationDate === '2026-11-06');
check('Confirmed top-up does not touch fixed split balance', Number(confirmed.loan.fixed.balance) === Number(planned.loan.fixed.balance));

const externalPlan = addVariableLoanTopUp(base, {
  expectedDate: '2026-08-01',
  amount: 15000,
  destinationAccount: 'external',
  note: 'external destination test',
}, today);
const externalTopUp = externalPlan.loan.topUps.find((item) => item.note === 'external destination test');
const externalConfirmed = confirmVariableLoanTopUp(externalPlan, externalTopUp.id, {
  confirmedAmount: 15000,
  fundsReceived: 12000,
  destinationAccount: 'external',
  variableBalance: initialVariable + 15000,
  externalBalance: 13000,
}, '2026-08-01');
check('External destination updates bills account not offset', Number(externalConfirmed.accounts.externalBalance) === 13000);
check('External destination leaves offset unchanged when bank offset not supplied', Number(externalConfirmed.accounts.offset.balance) === initialOffset);

const cancelPlan = addVariableLoanTopUp(base, {
  expectedDate: '2026-09-01',
  amount: 9000,
  destinationAccount: 'offset',
  note: 'cancel test',
}, today);
const cancelTarget = cancelPlan.loan.topUps.find((item) => item.note === 'cancel test');
const cancelled = cancelVariableLoanTopUp(cancelPlan, cancelTarget.id, '2026-05-01');
const cancelledTopUp = cancelled.loan.topUps.find((item) => item.id === cancelTarget.id);
check('Cancelled top-up does not change balances', Number(cancelled.loan.variable.balance) === initialVariable && Number(cancelled.accounts.offset.balance) === initialOffset);
check('Cancelled top-up is marked cancelled', cancelledTopUp?.status === 'cancelled');

const normalized = normalizeLoanForBalances({ ...base, loan: { ...base.loan, topUps: [{ amount: '12345', expectedDate: '2026-12-01' }] } }, today);
check('Normaliser keeps top-ups available on older stored data', normalized.loan.topUps.length === 1 && normalized.loan.topUps[0].amount === 12345);

console.log(`Loan top-up test: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
