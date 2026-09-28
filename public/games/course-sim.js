/* 意地悪コースの経路計算(サーバーと画面で共通)。
   同じ手順で「本番の結果」と「計画中の予想」を出すので、食い違いが起きない。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CourseSim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const W = 12;
  const H = 7;
  const START = { x: 0, y: 3 };
  // 上右下左・右上右下左下左上
  const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]];

  const CHARS = {
    jumper: { name: 'ジャンパー', text: '縦横に2マス跳べる(間のマスは無視)' },
    diag: { name: 'ナナメ', text: '斜めにも進める' },
    tough: { name: 'タフ', text: '落とし穴・点滅床を1回だけ耐え、トゲは効かない' },
    runner: { name: '健脚', text: '歩数が3多い' },
    ghost: { name: 'ゴースト', text: '壁と一方通行をすり抜ける。ただしトゲで脱落' },
    feather: { name: 'フェザー', text: '落とし穴・点滅床に落ちない。ただしバネで4マス飛ぶ' },
    skater: { name: 'スケーター', text: '氷の上で滑らない' },
    anchor: { name: 'いかり', text: 'ベルトコンベアに流されない' },
  };

  const ITEMS = {
    wall: { name: '壁', text: '通れない(ジャンパーは跳び越せる)' },
    pit: { name: '落とし穴', text: '踏んだら脱落' },
    spike: { name: 'トゲ', text: '踏むと残り歩数が3減る' },
    spring: { name: 'バネ', text: '踏むと同じ向きに2マス飛ばされる' },
    blink: { name: '点滅床', text: '偶数歩目は穴になる' },
    ice: { name: '氷', text: '踏むと同じ向きに、氷が途切れるまで滑る' },
    conveyor: { name: 'ベルトコンベア', text: '踏むと矢印の向きに1マス流される', dir: true },
    oneway: { name: '一方通行', text: '矢印の向きに進むときしか入れない', dir: true },
    trapdoor: { name: '落とし戸', text: '踏むとスタートに戻される(歩数はそのまま)' },
    decoy: { name: '見せかけ', text: 'ただの床。伏せて置くと罠に見える' },
    eraser: { name: '消しゴム', text: '前のラウンドまでに表向きで置かれた部品を1つ消す' },
  };

  const key = (x, y) => `${x},${y}`;
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;

  // cells: "x,y" → {type, dir} / plan: [{d, jump}] / 戻り値:{steps:[{x,y,t,event}], result, killerCell, triggered}
  function simulate(cells, plan, char, maxSteps) {
    let x = START.x;
    let y = START.y;
    let shield = char === 'tough' ? 1 : 0;
    let budget = maxSteps;
    const steps = [{ x, y, t: 0 }];
    const triggered = [];
    const at = (cx, cy) => cells[key(cx, cy)];
    // (cx,cy) に (dx,dy) の向きで入れないか
    const blocks = (cx, cy, dx, dy) => {
      const c = at(cx, cy);
      if (!c || char === 'ghost') return false;
      if (c.type === 'wall') return true;
      if (c.type === 'oneway') {
        const [ox, oy] = DIRS[c.dir || 0];
        return !(dx === ox && dy === oy);
      }
      return false;
    };
    // 着地したマスの効果を順に処理する(バネ・コンベア・氷は連鎖する)
    const settle = (t, dx, dy) => {
      for (let guard = 0; guard < 16; guard++) {
        const k = key(x, y);
        const c = at(x, y);
        if (!c) return null;
        switch (c.type) {
          case 'spike':
            triggered.push(k);
            if (char === 'tough') return null;
            if (char === 'ghost') return 'dead';
            budget -= 3;
            steps.push({ x, y, t, event: 'spike' });
            return null;
          case 'pit':
          case 'blink':
            if (c.type === 'blink' && t % 2 !== 0) return null;
            triggered.push(k);
            if (char === 'feather') return null;
            if (shield > 0) {
              shield--;
              steps.push({ x, y, t, event: 'endure' });
              return null;
            }
            return 'dead';
          case 'trapdoor':
            triggered.push(k);
            steps.push({ x, y, t, event: 'trapdoor' });
            x = START.x;
            y = START.y;
            return null;
          case 'spring': {
            triggered.push(k);
            steps.push({ x, y, t, event: 'spring' });
            const n = char === 'feather' ? 4 : 2;
            let moved = false;
            for (let i = 0; i < n; i++) {
              const qx = x + dx;
              const qy = y + dy;
              if (!inside(qx, qy) || blocks(qx, qy, dx, dy)) break;
              x = qx;
              y = qy;
              moved = true;
            }
            if (!moved) return null;
            continue;
          }
          case 'conveyor': {
            triggered.push(k);
            if (char === 'anchor') return null;
            const [cx, cy] = DIRS[c.dir || 0];
            const qx = x + cx;
            const qy = y + cy;
            if (!inside(qx, qy) || blocks(qx, qy, cx, cy)) return null;
            steps.push({ x, y, t, event: 'conveyor' });
            x = qx;
            y = qy;
            dx = cx;
            dy = cy;
            continue;
          }
          case 'ice': {
            triggered.push(k);
            if (char === 'skater') return null;
            const qx = x + dx;
            const qy = y + dy;
            if (!inside(qx, qy) || blocks(qx, qy, dx, dy)) return null;
            steps.push({ x, y, t, event: 'slide' });
            x = qx;
            y = qy;
            continue;
          }
          case 'decoy':
            triggered.push(k);
            return null;
          default:
            return null;
        }
      }
      return null;
    };

    for (let t = 1; t <= plan.length && t <= budget; t++) {
      const a = plan[t - 1];
      const [dx, dy] = DIRS[a.d] || [0, 0];
      if (a.d >= 4 && char !== 'diag') return { steps, result: 'invalid', triggered };
      if (a.jump && (char !== 'jumper' || a.d >= 4)) return { steps, result: 'invalid', triggered };
      const len = a.jump ? 2 : 1;
      const nx = x + dx * len;
      const ny = y + dy * len;
      if (!inside(nx, ny)) return { steps: [...steps, { x, y, t, event: 'stuck' }], result: 'stuck', triggered };
      if (blocks(nx, ny, dx, dy)) {
        triggered.push(key(nx, ny));
        return { steps: [...steps, { x, y, t, event: 'wall' }], result: 'wall', killerCell: key(nx, ny), triggered };
      }
      x = nx;
      y = ny;
      const ev = settle(t, dx, dy);
      if (ev === 'dead') return { steps: [...steps, { x, y, t, event: 'dead' }], result: 'dead', killerCell: key(x, y), triggered };
      steps.push({ x, y, t, event: x === W - 1 ? 'goal' : null });
      if (x === W - 1) return { steps, result: 'goal', time: t, triggered };
    }
    return { steps, result: 'timeout', triggered };
  }

  return { W, H, START, DIRS, CHARS, ITEMS, simulate, key, inside };
});
