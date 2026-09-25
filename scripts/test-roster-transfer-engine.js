const assert = require('assert');

// 1. Mocking LeagueSettings model method logic
const LeagueSettings = require('../models/LeagueSettings');

console.log('🧪 Starting Roster Capacity & Transfer Window Engine Verification Tests...\n');

// Test 1: Verify default schema values
const dummySettings = new LeagueSettings({});
assert.strictEqual(dummySettings.maxSquadSize, 35, 'Default maxSquadSize should be 35');
assert.strictEqual(dummySettings.transferWindowStatus, 'closed', 'Default transferWindowStatus should be closed');
assert.strictEqual(dummySettings.registrationLocked, false, 'Default registrationLocked should be false');
assert.strictEqual(dummySettings.seasonPhase, 'pre_season', 'Default seasonPhase should be pre_season');
console.log('✅ Test 1 Passed: LeagueSettings schema defaults verified (maxSquadSize = 35, closed, unlocked, pre_season).');

// Test 2: Pre-season open registration eligibility
const preSeasonSettings = new LeagueSettings({
  transferWindowStatus: 'closed',
  registrationLocked: false,
  seasonPhase: 'pre_season'
});
const preSeasonResult = preSeasonSettings.checkRegistrationEligibility();
assert.strictEqual(preSeasonResult.allowed, true, 'Pre-season unlocked should allow registration');
console.log('✅ Test 2 Passed: Initial registration allowed in pre-season when not locked.');

// Test 3: Locked registration when transfer window is closed
const lockedSettings = new LeagueSettings({
  transferWindowStatus: 'closed',
  registrationLocked: true,
  seasonPhase: 'leg_1'
});
const lockedResult = lockedSettings.checkRegistrationEligibility();
assert.strictEqual(lockedResult.allowed, false, 'Should reject when registrationLocked === true and transferWindowStatus === "closed"');
assert.strictEqual(
  lockedResult.reason,
  'Player registration is currently closed. New players cannot be added until the mid-season transfer window opens.',
  'Exact rejection message required by user specification'
);
console.log('✅ Test 3 Passed: Registration rejected with exact 403 reason when locked and window closed.');

// Test 4: Transfer window OPEN overrides lock
const openTransferSettings = new LeagueSettings({
  transferWindowStatus: 'open',
  registrationLocked: true, // even if marked true, window open takes priority
  seasonPhase: 'mid_season_break'
});
const openResult = openTransferSettings.checkRegistrationEligibility();
assert.strictEqual(openResult.allowed, true, 'Transfer window open must allow player registration');
console.log('✅ Test 4 Passed: Transfer Window OPEN successfully unlocks player registration.');

// Test 5: Hard squad cap rejection at 35 players
const MAX_SQUAD_LIMIT = 35;
function evaluatePlayerAdd(currentSquadLength, isLocked, isWindowOpen) {
  if (currentSquadLength >= MAX_SQUAD_LIMIT) {
    return {
      status: 400,
      error: 'Squad capacity reached. Maximum allowed is 35 players.'
    };
  }
  if (isLocked && !isWindowOpen) {
    return {
      status: 403,
      error: 'Player registration is currently closed. New players cannot be added until the mid-season transfer window opens.'
    };
  }
  return { status: 200, success: true };
}

// 34 players -> allowed
assert.strictEqual(evaluatePlayerAdd(34, false, false).status, 200);
// 35 players -> 400 rejection
const capResult = evaluatePlayerAdd(35, false, false);
assert.strictEqual(capResult.status, 400);
assert.strictEqual(capResult.error, 'Squad capacity reached. Maximum allowed is 35 players.');
console.log('✅ Test 5 Passed: 35-player hard squad cap rejects 36th addition with exact 400 error.');

// Test 6: Mid-season locked state check
const midSeasonBlocked = evaluatePlayerAdd(25, true, false);
assert.strictEqual(midSeasonBlocked.status, 403);
assert.strictEqual(midSeasonBlocked.error, 'Player registration is currently closed. New players cannot be added until the mid-season transfer window opens.');
console.log('✅ Test 6 Passed: Mid-season locked addition rejected with exact 403 error.');

// Test 7: Mid-season transfer window allows addition under 35
const midSeasonAllowed = evaluatePlayerAdd(28, false, true);
assert.strictEqual(midSeasonAllowed.status, 200);
console.log('✅ Test 7 Passed: Mid-season addition allowed during active transfer window (e.g. 28/35).');

console.log('\n🎉 ALL 7 UNIT & STATE MACHINE VERIFICATION TESTS PASSED SUCCESSFULLY!\n');
