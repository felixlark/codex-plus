import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSnakeGame} from '../Sources/CodexPlus/Resources/snake.mjs';

test('snake pauses, resumes, collides with wall and resets the whole round',()=>{
  const game=createSnakeGame(5,()=>0);game.reset();
  const before=game.snapshot();assert.equal(before.phase,'ready');assert.deepEqual(game.step(),before);
  game.start();game.pause();assert.equal(game.step().phase,'paused');assert.deepEqual(game.snapshot().body,before.body);
  game.start();game.step();game.step();assert.equal(game.step().phase,'over');
  game.reset();assert.deepEqual(game.snapshot(),before);
});
test('snake grows on food, rejects reversal and accepts one turn per movement',()=>{
  const game=createSnakeGame(5,()=>0);game.reset();game.start();
  game.turn('left');assert.equal(game.step().direction,'right');
  game.turn('up');game.turn('left');assert.equal(game.step().direction,'up');game.step();
  game.turn('left');game.step();game.step();const s=game.step();
  assert.equal(s.score,1);assert.equal(s.body.length,4);assert.deepEqual(s.body[0],[0,0]);
  assert.ok(!s.body.some(p=>p[0]===s.food[0]&&p[1]===s.food[1]));
});
test('snake detects its body and does not advance after a finished game',()=>{
  const game=createSnakeGame(5,()=>0);game.reset();game.start();
  game.turn('up');game.step();game.step();game.turn('left');game.step();const grown=game.step();
  assert.equal(grown.score,1);
  game.turn('down');game.step();game.turn('right');game.step();game.step();game.step();game.turn('up');game.step();
  game.turn('left');game.step();game.turn('down');const s=game.step();
  assert.equal(s.phase,'over');assert.deepEqual(game.step(),s);
});
test('snake may enter its vacated tail and wins when the board is filled',()=>{
  const values=[2.5/6,1.5/5,.5/4,.5/3,.5/2,.5];
  const game=createSnakeGame(3,()=>values.shift());game.reset();game.start();
  game.turn('up');game.step();game.turn('left');game.step();game.step();
  game.turn('down');assert.equal(game.step().phase,'running');game.step();
  game.turn('right');game.step();const final=game.step();
  assert.equal(final.phase,'won');assert.equal(final.body.length,9);assert.equal(final.food,null);assert.equal(final.score,6);
});
