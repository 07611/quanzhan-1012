// 专项验证：聊天区「无法自行滑动到最新一行」的修复
// 关键断言：长对话下 scrollHeight 真正增长、流式追加后自动贴底、用户上滚后不被强拽、跳转按钮可用
const CDP = 'http://127.0.0.1:9223';
const FILE = 'file:///C:/Users/Admin/Desktop/%E7%9F%A5%E8%AF%86%E5%BA%93/FullStack-Architect.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function wsUrl() {
  const l = await (await fetch(CDP + '/json/list')).json();
  const t = l.find(x => x.type === 'page' && x.webSocketDebuggerUrl);
  if (!t) throw new Error('no page');
  return t.webSocketDebuggerUrl;
}
function client(u) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(u); let id = 0; const pend = new Map(); const errs = [];
    ws.addEventListener('message', e => {
      const m = JSON.parse(e.data);
      if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || 'err');
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    });
    ws.addEventListener('error', rej);
    ws.addEventListener('open', () => res({
      send: (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); }),
      close: () => ws.close(), errs
    }));
  });
}
const ev = async (c, x) => {
  const r = await c.send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'JS 异常');
  return r.result?.result?.value;
};

const ok = [], bad = [];
const check = (name, pass, detail) => (pass ? ok : bad).push(name + (detail ? '  →  ' + detail : ''));

(async () => {
  const c = await client(await wsUrl());
  await c.send('Page.enable'); await c.send('Runtime.enable');
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await c.send('Page.navigate', { url: FILE });
  await sleep(2000);
  // 每次验证从干净状态开始，避免读到上一轮跑剩的会话存档
  await ev(c, `localStorage.removeItem('fsa_chat_sessions_v1'); localStorage.removeItem('fsa_chat_cur');`);
  await c.send('Page.navigate', { url: FILE });
  await sleep(2800);

  // ---- 0. 页面无 JS 报错 ----
  check('页面加载无 JS 异常', c.errs.length === 0, c.errs.slice(0, 3).join(' | '));

  // ---- 1. 切到对话视图 ----
  await ev(c, `document.querySelector('[data-nav="chat"]').click()`);
  await sleep(600);

  // ---- 2. flex 收缩是否已修复（根因验证）----
  // 先造一条消息，确保能取到计算样式
  await ev(c, `addMsg('user', '根因验证用消息')`);
  await sleep(300);
  const shrink = await ev(c, `(() => {
    const m = document.querySelector('.msg'); if (!m) return null;
    return getComputedStyle(m).flexShrink;
  })()`);
  check('消息项 flex-shrink = 0（根因修复）', shrink === '0', '实测 ' + shrink);

  // ---- 3. 灌入大量内容，验证 scrollHeight 真的增长 ----
  const g1 = await ev(c, `(async () => {
    const box = document.querySelector('#msgs');
    const before = box.scrollHeight;
    for (let i = 0; i < 12; i++) {
      addMsg('user', '测试提问 ' + i + '：这是一段用于撑开滚动区域的长文本，'.repeat(6));
      addMsg('ai', '### 第 ' + i + ' 轮回答\\n\\n- 要点一：说明内容\\n- 要点二：说明内容\\n\\n\`\`\`bash\\nnpm install test-package-' + i + '\\n\`\`\`\\n\\n结论：可行。');
    }
    await new Promise(r => setTimeout(r, 900));
    const after = box.scrollHeight;
    return JSON.stringify({ before, after, clientH: box.clientHeight,
      scrollable: box.scrollHeight > box.clientHeight,
      msgCount: box.querySelectorAll('.msg').length });
  })()`);
  const s1 = JSON.parse(g1);
  check('scrollHeight 随内容增长（不再被压扁）', s1.after > s1.before * 1.8, `${s1.before} → ${s1.after}px，共 ${s1.msgCount} 条`);
  check('滚动区确实可滚动', s1.scrollable, `scrollHeight=${s1.after} clientHeight=${s1.clientH}`);

  // ---- 4. 自动贴底：最后一条是否完整可见 ----
  const atBottom = await ev(c, `(() => {
    const b = document.querySelector('#msgs');
    const gap = b.scrollHeight - b.scrollTop - b.clientHeight;
    const last = b.querySelector('.msg:last-child');
    const lb = last.querySelector('.bubble').getBoundingClientRect(), bb = b.getBoundingClientRect();
    return JSON.stringify({ gap: Math.round(b.scrollHeight - b.scrollTop - b.clientHeight),
      lastBottom: Math.round(lb.bottom), boxBottom: Math.round(bb.bottom),
      // 同理：末条可能高于视口，只要求其底部已进入可视区
      lastFullyVisible: lb.bottom <= bb.bottom + 1 && lb.bottom > bb.top });
  })()`);
  const b1 = JSON.parse(atBottom);
  check('新消息后自动贴底（无残留间隙）', b1.gap <= 2, '距底部 ' + b1.gap + 'px');
  check('最后一条消息在视口内', b1.lastFullyVisible, `消息底=${b1.lastBottom} 容器底=${b1.boxBottom}（差值为设计留白）`);

  // ---- 5. 用户主动上滚后，不应被强行拽回底部 ----
  const notStuck = await ev(c, `(async () => {
    const b = document.querySelector('#msgs');
    b.scrollTop = 0; b.dispatchEvent(new Event('scroll'));
    await new Promise(r => setTimeout(r, 200));
    // 模拟流式持续追加
    for (let i = 0; i < 5; i++) {
      addMsg('ai', '流式片段 ' + i + '\\n\\n内容'.repeat(40));
      await new Promise(r => setTimeout(r, 60));
    }
    await new Promise(r => setTimeout(r, 500));
    return JSON.stringify({ scrollTop: Math.round(b.scrollTop),
      gap: Math.round(b.scrollHeight - b.scrollTop - b.clientHeight),
      jumpVisible: document.querySelector('#btnJump').classList.contains('show'),
      unseen: document.querySelector('#jumpCount').hidden ? 0 : document.querySelector('#jumpCount').textContent });
  })()`);
  const n1 = JSON.parse(notStuck);
  check('上滚后不被强拽回底部（不打断阅读）', n1.scrollTop < 60 && n1.gap > 100, `scrollTop=${n1.scrollTop} 距底=${n1.gap}px`);
  check('上滚时「回到底部」按钮出现', n1.jumpVisible, 'show=' + n1.jumpVisible);
  check('未读新消息计数生效', Number(n1.unseen) > 0, '计数=' + n1.unseen);

  // ---- 6. 点击跳转按钮，回到最新（平滑滚动需要时间，等它真的停） ----
  const jumped = await ev(c, `(async () => {
    document.querySelector('#btnJump').click();
    // 平滑滚动的时长与距离相关，最多等 3.5s 再判定
    const b = document.querySelector('#msgs');
    for (let i = 0; i < 35; i++) {
      await new Promise(r => setTimeout(r, 100));
      if ((b.scrollHeight - b.scrollTop - b.clientHeight) <= 2) break;
    }
    const last = b.querySelector('.msg:last-child');
    const lb = last.getBoundingClientRect(), bb = b.getBoundingClientRect();
    const gap = b.scrollHeight - b.scrollTop - b.clientHeight;
    // 末条消息的 margin-bottom 是刻意留的视觉留白，贴底时它就在容器底之外，
    // 所以判据是「滚动剩余量 ≈ 0」且「消息主体已在视口内」，而不是盒子底 == 容器底。
    const visual = last.querySelector('.bubble').getBoundingClientRect();
    return JSON.stringify({ gap: Math.round(gap),
      jumpVisible: document.querySelector('#btnJump').classList.contains('show'),
      // 末条消息可能比视口还高（长表格/长代码块），滚动到底时它必然溢出上方，
      // 这是正常现象。真正的判据是：滚动量归零 + 末条消息底部进入视口。
      scrolledToEnd: gap <= 3 && visual.bottom <= bb.bottom + 1 && visual.bottom > bb.top,
      dbg: { g: gap, vBot: Math.round(visual.bottom), bBot: Math.round(bb.bottom), bTop: Math.round(bb.top) },
      lastBottom: Math.round(visual.bottom), boxBottom: Math.round(bb.bottom) });
  })()`);
  const j1 = JSON.parse(jumped);
  // 判据说明：容器有 20px 视觉留白（最后一条的 margin-bottom），
  // 所以「最后一条消息底」到「容器底」天然差约 20px，不代表没滚到位。
  // 真正的贴底判据是 gap（scrollHeight 剩余量）≈ 0。
  check('点按钮后贴合底部（容差 3px）', j1.gap <= 3, `距底=${j1.gap}px`);
  check('回到底部后按钮自动隐藏', j1.jumpVisible === false, 'show=' + j1.jumpVisible);
  check('滚动后已到容器底部', j1.scrolledToEnd === true, 'scrolledToEnd=' + j1.scrolledToEnd + ' dbg=' + JSON.stringify(j1.dbg));

  // ---- 7. Markdown 渲染增强 ----
  const mdSrc = '| 方案 | 难度 |\n| --- | --- |\n| Vercel | 低 |\n| 自建 | 高 |\n\n> 注意：这是引用\n\n---\n\n1. 第一步\n2. 第二步\n\n行内 `code` 与 **粗体**';
  const md = await ev(c, `(() => {
    const b = addMsg('ai', ${JSON.stringify(mdSrc)});
    const h = b.innerHTML;
    return JSON.stringify({ table: h.includes('<table'), th: h.includes('<th>'), td: h.includes('<td>'),
      ol: h.includes('<ol>'), quote: h.includes('<blockquote'), hr: h.includes('<hr>'),
      strong: h.includes('<strong>'), inlineCode: h.includes('<code') });
  })()`);
  const m1 = JSON.parse(md);
  check('Markdown 表格渲染', m1.table && m1.th && m1.td, `table=${m1.table} th=${m1.th} td=${m1.td}`);
  check('Markdown 有序列表 / 引用 / 分隔线', m1.ol && m1.quote && m1.hr, `ol=${m1.ol} quote=${m1.quote} hr=${m1.hr}`);
  check('行内代码与粗体', m1.strong && m1.inlineCode);

  // ---- 8. 代码块内容不被 Markdown 规则破坏（占位符还原正确） ----
  const cbSrc = '前置\n\n```js\nconst a = **not bold**;\nconst url = "[x](y)";\n```\n\n后置';
  const cb = await ev(c, `(() => {
    const b = addMsg('ai', ${JSON.stringify(cbSrc)});
    const pre = b.querySelector('pre');
    return JSON.stringify({ hasPre: !!pre,
      keptAsterisk: pre ? pre.innerHTML.includes('**not bold**') : false,
      keptLink: pre ? pre.innerHTML.includes('[x](y)') : false,
      hasCopyBtn: !!(pre && pre.querySelector('.code-copy')),
      afterOk: b.innerHTML.includes('后置') });
  })()`);
  const c1 = JSON.parse(cb);
  check('代码块内 Markdown 语法不被破坏', c1.keptAsterisk && c1.keptLink, `粗体保留=${c1.keptAsterisk} 链接保留=${c1.keptLink}`);
  check('代码块带复制按钮', c1.hasCopyBtn);
  check('占位符还原后正文完整', c1.afterOk);

  // ---- 9. 会话持久化（先清空再重新生成，确保比对的是同一批消息）----
  const sess = await ev(c, `(async () => {
    // 删掉渲染测试留下的零散消息，只保留结构一致的问答对
    document.querySelector('#msgs').innerHTML = '';
    await new Promise(r => setTimeout(r, 200));
    for (let i = 0; i < 6; i++){ addMsg('user', '持久化验证提问 ' + i); addMsg('ai', '持久化验证回答 ' + i); }
    await new Promise(r => setTimeout(r, 400));
    flushSession();
    const n = document.querySelectorAll('#msgs .msg').length;
    const parsed = JSON.parse(localStorage.getItem('fsa_chat_sessions_v1'));
    const cur = parsed.find(s => s.id === localStorage.getItem('fsa_chat_cur'));
    return JSON.stringify({ sessions: parsed.length, saved: cur ? cur.msgs.length : 0, domMsgs: n,
      titles: parsed.map(s => s.title).slice(0, 3) });
  })()`);
  const s2 = JSON.parse(sess);
  check('对话持久化到 localStorage', s2.saved > 0 && s2.saved === s2.domMsgs, `存档 ${s2.saved} 条 / DOM ${s2.domMsgs} 条`);

  // ---- 10. 会话切换（要点：新建会话后切回「别的」会话，验证历史真的回来了）----
  const sw = await ev(c, `(async () => {
    const before = document.querySelectorAll('#msgs .msg').length;
    const oldSid = curSid;
    newSession();
    await new Promise(r => setTimeout(r, 500));
    const empty = document.querySelectorAll('#msgs .msg').length;
    const hasEmptyState = !!document.querySelector('.chat-empty');
    // 必须挑一个「不是当前会话」的行，否则 switchSession 的同名短路会让我们误判
    const other = Array.from(document.querySelectorAll('[data-sid]')).find(r => r.dataset.sid !== curSid);
    if (!other) return JSON.stringify({ err: 'no other session', before, empty, hasEmptyState });
    const targetSid = other.dataset.sid;
    other.click();
    await new Promise(r => setTimeout(r, 800));
    const b = document.querySelector('#msgs');
    return JSON.stringify({ before, empty, hasEmptyState, oldSid, targetSid, cur: curSid,
      restored: document.querySelectorAll('#msgs .msg').length,
      gap: Math.round(b.scrollHeight - b.scrollTop - b.clientHeight) });
  })()`);
  const w1 = JSON.parse(sw);
  check('新建会话显示空状态引导', w1.hasEmptyState && w1.empty === 0, `空状态=${w1.hasEmptyState}`);
  check('切换会话后历史完整恢复', w1.cur === w1.targetSid && w1.restored === w1.before,
    `切到 ${String(w1.targetSid).slice(-5)}：恢复 ${w1.restored} / 原有 ${w1.before}`);
  check('恢复后自动贴底', w1.gap <= 2, '距底=' + w1.gap + 'px');

  // ---- 10b. 刷新后对话仍在（持久化的真正意义）----
  await c.send('Page.navigate', { url: FILE });
  await sleep(2600);
  const persisted = await ev(c, `(async () => {
    document.querySelector('[data-nav="chat"]').click();
    await new Promise(r => setTimeout(r, 600));
    return JSON.stringify({ msgs: document.querySelectorAll('#msgs .msg').length,
      sessions: document.querySelectorAll('[data-sid]').length });
  })()`);
  const p1 = JSON.parse(persisted);
  check('刷新页面后对话仍然保留', p1.msgs === w1.before && p1.sessions >= 2,
    `刷新后 ${p1.msgs} 条 / ${p1.sessions} 个会话`);

  // ---- 11. 移动端视口不塌陷 ----
  await c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(700);
  const mob = await ev(c, `(() => {
    const b = document.querySelector('#msgs');
    const jump = document.querySelector('#btnJump').getBoundingClientRect();
    const bb = b.getBoundingClientRect();
    return JSON.stringify({ hOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      scrollW: document.documentElement.scrollWidth, win: window.innerWidth,
      msgsH: Math.round(b.clientHeight),
      jumpInBox: jump.bottom <= bb.bottom + 60 && jump.width > 0 });
  })()`);
  const mb = JSON.parse(mob);
  check('移动端无横向溢出', !mb.hOverflow, `scrollWidth=${mb.scrollW} vw=${mb.win}`);
  check('跳转按钮在可视区内', mb.jumpInBox);

  // ---- 12. 全程无 JS 报错 ----
  check('交互全程无 JS 异常', c.errs.length === 0, c.errs.slice(0, 3).join(' | '));

  console.log('\n通过 ' + ok.length + ' 项：');
  ok.forEach(s => console.log('  ✓ ' + s));
  if (bad.length) { console.log('\n未通过 ' + bad.length + ' 项：'); bad.forEach(s => console.log('  ✗ ' + s)); }
  const shot = await c.send('Page.captureScreenshot', { format: 'png' });
  require('fs').writeFileSync('C:/Users/Admin/Desktop/知识库/_verify.png', Buffer.from(shot.result.data, 'base64'));
  c.close();
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); process.exit(2); });
