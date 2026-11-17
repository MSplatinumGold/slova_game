import assert from 'node:assert/strict';
import { RoomManager, sanitizeText } from '../server/rooms.ts';
import { getDictionary } from '../server/dictionary.ts';

function runRoomTests(): void {
  const dict = getDictionary();
  const rm = new RoomManager();

  // 1. Create room
  const state1 = rm.createRoom({
    socketId: 'sock-1',
    playerId: 'p1',
    nickname: '<b>Анна</b>',
    personalScore: 200,
    difficulty: 'easy',
  });
  assert.equal(state1.code.length, 4);
  assert.ok(!/[0O1I]/.test(state1.code), `Code must exclude 0/O/1/I: ${state1.code}`);
  assert.equal(state1.players.length, 1);
  assert.equal(state1.players[0].nickname, 'bАнна/b'); // angle brackets stripped
  assert.equal(state1.players[0].isHost, true);
  assert.equal(state1.sharedHints, 3);

  // 2. Join room (player 2, 3, 4) and reject 5th
  const j2 = rm.joinRoom({
    code: state1.code,
    socketId: 'sock-2',
    playerId: 'p2',
    nickname: 'Борис',
    personalScore: 30,
  });
  assert.ok(j2.ok);
  assert.equal(j2.state.players.length, 2);

  const j3 = rm.joinRoom({
    code: state1.code,
    socketId: 'sock-3',
    playerId: 'p3',
    nickname: 'Вера',
    personalScore: 0,
  });
  assert.ok(j3.ok);

  const j4 = rm.joinRoom({
    code: state1.code,
    socketId: 'sock-4',
    playerId: 'p4',
    nickname: 'Глеб',
    personalScore: 0,
  });
  assert.ok(j4.ok);

  const j5 = rm.joinRoom({
    code: state1.code,
    socketId: 'sock-5',
    playerId: 'p5',
    nickname: 'Лишний',
    personalScore: 0,
  });
  assert.equal(j5.ok, false);

  // 3. Host leaves -> host transfers automatically to next player
  const leaveRes = rm.leaveRoomBySocket('sock-1');
  assert.ok(leaveRes?.state);
  assert.equal(leaveRes.state.players.length, 3);
  assert.equal(leaveRes.state.players[0].playerId, 'p2');
  assert.equal(leaveRes.state.players[0].isHost, true);

  // 4. Non-host cannot trigger next level
  const denied = rm.nextLevel('sock-3', 'medium');
  assert.equal(denied.ok, false);

  // 5. Hint edge-case: open cells with hints until round completes!
  let loops = 0;
  let completedByHint = false;
  while (loops < 100) {
    loops++;
    const ctx = rm.getPlayerContext('sock-2');
    assert.ok(ctx);
    if (ctx.room.roundComplete) {
      completedByHint = true;
      break;
    }
    const hintRes = rm.useHint('sock-2', { type: 'lightbulb' });
    if (!hintRes.result.ok) {
      // Give p2 enough personal score once free hints run out
      ctx.player.personalScore += 100;
      const retry = rm.useHint('sock-2', { type: 'lightbulb' });
      assert.ok(retry.result.ok, retry.result.error);
      if (retry.result.roundComplete) {
        completedByHint = true;
        break;
      }
    } else if (hintRes.result.roundComplete) {
      completedByHint = true;
      break;
    }
  }
  assert.ok(completedByHint, 'Hints must auto-complete words and finish round');

  // 6. Host launches next level
  const nextRes = rm.nextLevel('sock-2', 'hard');
  assert.ok(nextRes.ok);
  assert.equal(nextRes.state.levelNumber, 2);
  assert.equal(nextRes.state.difficulty, 'hard');
  assert.equal(nextRes.state.sharedHints, 3);
  assert.equal(nextRes.state.roundComplete, false);

  // 7. Chat sanitization
  assert.equal(sanitizeText('  <script>alert(1)</script>Привет  ', 240), 'scriptalert(1)/scriptПривет');
  assert.ok(dict.entries.length > 10000);

  console.log('ALL ROOM & MULTIPLAYER LOGIC TESTS PASSED');
}

runRoomTests();
