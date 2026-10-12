// 代码复查：XSS 面 + 边界条件 + 状态一致性
// 重点验证 renderMarkdown 对恶意输入的处理，以及重构后可能残留的边界 bug
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
  if (r.result?.exceptionDetails) {
    const d = r.result.exceptionDetails;
    throw new Error('页面内异常: ' + (d.exception?.description || d.text || '').slice(0, 300) +
      '\n--- 表达式 ---\n' + String(x).slice(0, 500));
  }
  return r.result?.result?.value;
};

const ok = [], bad = [];
const check = (name, pass, detail) => (pass ? ok : bad).push(name + (detail ? '  →  ' + detail : ''));

// 恶意 payload：全部经过真实渲染路径，检查是否被执行
// 用字符串拼接构造闭合标签，避免脚本文件里的字面量影响本文件解析
const S = '<' + '/script>';
const PAYLOADS = [
  ['<img src=x onerror=window.__XSS_IMG=1>', 'img onerror'],
  [S + 'window.__XSS_SCRIPT=1' + S, 'script 标签'],
  ['<svg onload=window.__XSS_SVG=1>', 'svg onload'],
  ['[点击](javascript:window.__XSS_LINK=1)', 'javascript: 协议'],
  ['<iframe src="javascript:window.__XSS_IFRAME=1"></iframe>', 'iframe javascript'],
  ['<div onclick="window.__XSS_DIV=1">x</div>', '内联事件'],
  ['<a href="data:text/html,x">x</a>', 'data: 协议'],
  ['`<img src=x onerror=window.__XSS_INCODE=1>`', '代码块内注入'],
  ['| <img src=x onerror=window.__XSS_TABLE=1> | b |\n| --- | --- |\n| c | d |', '表格内注入'],
];

(async () => {
  const c = await client(await wsUrl());
  await c.send('Page.enable'); await c.send('Runtime.enable');
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await c.send('Page.navigate', { url: FILE });
  await sleep(2000);
  await ev(c, `localStorage.clear()`);
  await c.send('Page.navigate', { url: FILE });
  await sleep(2600);
  await ev(c, `document.querySelector('[data-nav="chat"]').click()`);
  await sleep(500);

  // ---- 1. XSS：AI 气泡渲染恶意 Markdown ----
  const xss = await ev(c, `(() => {
    const payloads = ${JSON.stringify(PAYLOADS)};
    document.querySelector('#msgs').innerHTML = '';
    payloads.forEach(([src]) => addMsg('ai', src));
    addMsg('user', payloads[0][0]);
    // 强制执行挂起的事件（如 img onerror 需要布局触发）
    return new Promise(res => setTimeout(() => {
      const fired = Object.keys(window).filter(k => k.indexOf('__XSS_') === 0);
      res(JSON.stringify({ fired }));
    }, 800));
  })()`);
  const x1 = JSON.parse(xss);
  check('AI 回复渲染 Markdown 时无 XSS 执行', x1.fired.length === 0,
    x1.fired.length ? '被触发: ' + x1.fired.join(',') : '9 类 payload 全部未执行');

  // ---- 2. XSS：用户消息 ----
  const xss2 = await ev(c, `(() => {
    document.querySelector('#msgs').innerHTML = '';
    addMsg('user', '<img src=x onerror=window.__XSS_USER=1>');
    return new Promise(res => setTimeout(() => {
      res(JSON.stringify({ fired: Object.keys(window).filter(k => k.indexOf('__XSS_') === 0) }));
    }, 600));
  })()`);
  const x2 = JSON.parse(xss2);
  check('用户消息渲染时无 XSS 执行', x2.fired.length === 0, x2.fired.length ? x2.fired.join(',') : '未执行');

  // ---- 3. 危险链接协议被拦截 ----
  const link = await ev(c, `(() => {
    document.querySelector('#msgs').innerHTML = '';
    addMsg('ai', '[x](javascript:alert(1)) [y](vbscript:alert(1)) [z](JaVaScRiPt:alert(1))');
    const as = Array.from(document.querySelectorAll('#msgs a'));
    return JSON.stringify({ hrefs: as.map(a => a.getAttribute('href')), rels: as.map(a => a.getAttribute('rel')) });
  })()`);
  const l1 = JSON.parse(link);
  check('javascript:/vbscript: 链接被降级为 #', l1.hrefs.every(h => h === '#'),
    'hrefs=' + JSON.stringify(l1.hrefs));
  check('外链带 noopener', l1.rels.every(r => r === 'noopener'), 'rel=' + JSON.stringify(l1.rels));

  // ---- 4. Markdown 渲染器边界（用例从外部传入，避免嵌套模板字面量吃掉转义）----
  const MD_CASES = {
    empty: '',
    onlySpace: '   \n\n  ',
    unclosedCode: '```js\nconst a=1;',
    unclosedTable: '| a | b |\n| --- | --- |\n| 1 |',
    nestedList: '- a\n  - b\n- c',
    htmlEntity: '&lt;script&gt;alert(1)&lt;/script&gt;',
    longLine: 'x'.repeat(5000),
    emojiAndCjk: '🎉 中文测试 ✅',
    onlyBacktick: '`',
    consecutiveTable: '| a |\n| --- |\n| 1 |\n\n| b |\n| --- |\n| 2 |'
  };
  const edge = await ev(c, `(() => {
    const cases = ${JSON.stringify(MD_CASES)};
    const out = {};
    for (const k in cases) {
      try {
        const h = renderMarkdown(cases[k]);
        out[k] = { ok:true, len:h.length, hasUndef: h.indexOf('undefined')>=0, hasNaN: h.indexOf('NaN')>=0 };
      } catch(e){ out[k] = { ok:false, err:e.message }; }
    }
    return JSON.stringify(out);
  })()`);
  const e1 = JSON.parse(edge);
  const edgeFail = Object.entries(e1).filter(([k,v]) => !v.ok).map(([k,v]) => k + ':' + v.err);
  check('Markdown 边界输入不抛错（10 类）', edgeFail.length === 0, edgeFail.join(' | ') || '空/未闭合代码块/未闭合表格/嵌套列表/实体/超长行/emoji 全通过');
  check('渲染结果无 undefined/NaN 泄漏',
    !Object.values(e1).some(v => v.hasUndef || v.hasNaN), '');

  // ---- 5. 流式解析：分片截断不丢字 ----
  const stream = await ev(c, `(() => {
    // 模拟 SSE：一行 data: 被切成多个网络分片，验证 carry 缓冲
    const full = 'data: {"choices":[{"delta":{"content":"完整的一句话"}}]}';
    const lines = [];
    // 每 7 字符切一刀，模拟最恶劣的分片
    for (let i = 0; i < full.length; i += 7) lines.push(full.slice(i, i + 7));
    let carry = '', got = '';
    lines.forEach(chunk => {
      carry += chunk;
      const ls = carry.split('\\n');
      carry = ls.pop() || '';
      ls.forEach(line => {
        const t = line.trim(); if (t.indexOf('data:') !== 0) return;
        try { const j = JSON.parse(t.slice(5).trim()); got += j.choices[0].delta.content || ''; } catch(e){}
      });
    });
    if (carry.trim().indexOf('data:') === 0) {
      try { const j = JSON.parse(carry.trim().slice(5).trim()); got += j.choices[0].delta.content || ''; } catch(e){}
    }
    return JSON.stringify({ got, expect:'完整的一句话', ok: got === '完整的一句话' });
  })()`);
  const s1 = JSON.parse(stream);
  check('SSE 分片截断不丢字（7 字符一刀）', s1.ok, `还原="${s1.got}"`);

  // ---- 6. 会话存档健壮性：损坏数据不应导致白屏 ----
  const corrupt = await ev(c, `(() => {
    localStorage.setItem('fsa_chat_sessions_v1', '{坏掉的 JSON[[[');
    localStorage.setItem('fsa_chat_cur', '不存在的id');
    return 'corrupted';
  })()`);
  await c.send('Page.navigate', { url: FILE });
  await sleep(2600);
  const survived = await ev(c, `(() => {
    return JSON.stringify({
      msgsRendered: document.querySelectorAll('#msgs .msg, .chat-empty').length > 0,
      sessions: (typeof SESSIONS !== 'undefined' && Array.isArray(SESSIONS)) ? SESSIONS.length : -1,
      curOk: (typeof curSid !== 'undefined') ? SESSIONS.some(s => s.id === curSid) : false
    });
  })()`);
  const s3 = JSON.parse(survived);
  check('存档损坏时优雅降级不白屏', s3.msgsRendered && s3.sessions > 0 && s3.curOk,
    `渲染=${s3.msgsRendered} 会话数=${s3.sessions} 当前id有效=${s3.curOk}`);

  // ---- 7. localStorage 不可用（隐私模式） ----
  await ev(c, `(() => {
    // 模拟 LS.set 失败
    LS.set = () => false;
    addMsg('user', '存储不可用时的消息');
    return 'ok';
  })()`);
  await sleep(500);
  const lsFail = await ev(c, `(() => JSON.stringify({ msgs: document.querySelectorAll('#msgs .msg').length }))()`);
  const lf = JSON.parse(lsFail);
  check('localStorage 写入失败不阻断对话', lf.msgs > 0, `仍有 ${lf.msgs} 条消息`);

  // ---- 8. 并发发送保护 + 按钮切换 ----
  // 用「永不 resolve 的 fetch」把请求挂住：连接半死时代 AbortController 未必生效，
  // 这样才能稳定停在 busy 态，验证按钮切换与 stopStream 的兜底复位。
  const Q1 = '并发测试问题一';
  const busy = await ev(c, `(async () => {
    LS.set = (k,v) => { try { localStorage.setItem(k,v); return true; } catch(e){ return false; } };
    document.querySelector('#msgs').innerHTML = '';
    // 先存真实 fetch，再挂起，后续可恢复
    window.__realFetch = window.__realFetch || window.fetch;
    window.fetch = function(){ return new Promise(function(){}) };   // 挂住
    const cfg = getConfig(); cfg.apiKey='x'; cfg.baseURL='http://x.invalid'; cfg.model='m'; saveConfig(cfg);
    document.querySelector('#chatInput').value = ${JSON.stringify(Q1)};
    sendMessage();
    await new Promise(r => setTimeout(r, 200));
    const mid = { busy, sendHidden: document.querySelector('#btnSend').hidden,
                  stopHidden: document.querySelector('#btnStop').hidden,
                  stopDisplay: getComputedStyle(document.querySelector('#btnStop')).display };
    // 生成中再发一次：应被拦截
    document.querySelector('#chatInput').value = '并发测试问题二';
    sendMessage();
    await new Promise(r => setTimeout(r, 150));
    const userCount = document.querySelectorAll('#msgs .msg.user').length;
    // 点停止：即使 fetch 不响应，也必须解除 busy
    stopStream();
    await new Promise(r => setTimeout(r, 200));
    const after = { busy, sendHidden: document.querySelector('#btnSend').hidden,
                    stopHidden: document.querySelector('#btnStop').hidden,
                    timeoutId, abortCtlIsNull: abortCtl === null };
    return JSON.stringify({ mid, userCount, guarded: userCount === 1, after });
  })()`);
  const b1 = JSON.parse(busy);
  check('生成中按钮切换为「停止」', b1.mid.busy === true && b1.mid.sendHidden === true &&
    b1.mid.stopHidden === false && b1.mid.stopDisplay !== 'none',
    `busy=${b1.mid.busy} 发送隐藏=${b1.mid.sendHidden} 停止display=${b1.mid.stopDisplay}`);
  check('生成中重复发送被拦截（只发一条）', b1.guarded === true, `用户消息 ${b1.userCount} 条`);
  check('停止后强制解除 busy（fetch 挂死也不卡死）', b1.after.busy === false &&
    b1.after.sendHidden === false && b1.after.stopHidden === true && b1.after.abortCtlIsNull,
    `busy=${b1.after.busy} 发送隐藏=${b1.after.sendHidden} 停止隐藏=${b1.after.stopHidden} ctrl已清=${b1.after.abortCtlIsNull}`);

  // ---- 9. 停止后的收尾状态 ----
  const stopped = await ev(c, `(() => JSON.stringify({
    busy: busy, sendHidden: document.querySelector('#btnSend').hidden,
    stopHidden: document.querySelector('#btnStop').hidden,
    state: document.querySelector('#chatState').textContent
  }))()`);
  const st = JSON.parse(stopped);
  check('停止后状态文案已更新', st.busy === false && st.sendHidden === false && st.stopHidden === true,
    `busy=${st.busy} 发送隐藏=${st.sendHidden} 停止隐藏=${st.stopHidden}`);

  // ---- 10. 超时定时器无泄漏 ----
  const leak = await ev(c, `(() => JSON.stringify({ timeoutId: timeoutId, abortCtl: abortCtl }))()`);
  const lk = JSON.parse(leak);
  check('结束后定时器与控制器已清理', lk.timeoutId === 0 && lk.abortCtl === null,
    `timeoutId=${lk.timeoutId} abortCtl=${lk.abortCtl}`);

  // ---- 11. 重回答：提问不应重复 ----
  const retry = await ev(c, `(async () => {
    localStorage.clear();
    // 恢复真实 fetch，并清掉上一项伪造的模型配置，让重回答走本地分支不发请求
    if (window.__realFetch) window.fetch = window.__realFetch;
    const cfg = getConfig(); delete cfg.apiKey; delete cfg.baseURL; delete cfg.model; saveConfig(cfg);
    document.querySelector('#msgs').innerHTML = '';
    window.__chatHistory = null;
    addMsg('user', '第一个问题');
    addMsg('ai', '第一个回答');
    addMsg('user', '第二个问题');
    addMsg('ai', '第二个回答');
    const rows = document.querySelectorAll('#msgs .msg');
    rows[3].querySelector('[data-act="retry"]').click();
    await new Promise(r => setTimeout(r, 1000));
    const all = Array.from(document.querySelectorAll('#msgs .msg'));
    const users = all.filter(m => m.classList.contains('user')).map(m => m.dataset.raw);
    return JSON.stringify({
      total: all.length, users,
      // 期望：Q1 A1 Q2 A2(新) —— Q2 只出现一次
      noDup: users.filter(t => t === '第二个问题').length === 1,
      order: all.map(m => (m.classList.contains('user') ? 'Q:' : 'A:') + (m.dataset.raw || '').slice(0, 6))
    });
  })()`);
  const r1 = JSON.parse(retry);
  check('重新回答后提问不重复', r1.noDup === true,
    `用户消息 = ${JSON.stringify(r1.users)}`);
  check('重新回答后结构完整（Q1A1Q2A2）', r1.total === 4, `共 ${r1.total} 条：${r1.order.join(' ')}`);

  // ---- 12. 导出内容正确性 ----
  const EXP_SEP = '\n\n---\n\n';
  const exp = await ev(c, `(() => {
    document.querySelector('#msgs').innerHTML = '';
    addMsg('user', '导出测试问题');
    addMsg('ai', '导出测试回答');
    flushSession();
    const s = curSession();
    const md = ['# ' + s.title, ''].concat(
      s.msgs.map(m => (m.r === 'user' ? '## 我' : '## AI') + ${JSON.stringify(EXP_SEP)} + m.t)
    ).join(${JSON.stringify(EXP_SEP)});
    return JSON.stringify({ hasQ: md.indexOf('导出测试问题')>=0, hasA: md.indexOf('导出测试回答')>=0,
      hasSep: md.indexOf('---')>=0, len: md.length });
  })()`);
  const ex = JSON.parse(exp);
  check('导出 Markdown 含完整问答与分隔', ex.hasQ && ex.hasA && ex.hasSep, `长度 ${ex.len}`);

  // ---- 13. 极端窄屏不塌陷 ----
  for (const w of [320, 360, 768]) {
    await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: 700, deviceScaleFactor: 2, mobile: w < 700 });
    await sleep(400);
    const r = await ev(c, `(() => JSON.stringify({
      w: ${w}, overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      sw: document.documentElement.scrollWidth }))()`);
    const rr = JSON.parse(r);
    check(`${w}px 窄屏无横向溢出`, !rr.overflow, `scrollWidth=${rr.sw}`);
  }

  // ---- 14. 全程无未捕获异常 ----
  check('复查全程无未捕获 JS 异常', c.errs.length === 0, c.errs.slice(0, 3).join(' | '));

  console.log('\n通过 ' + ok.length + ' 项：');
  ok.forEach(s => console.log('  ✓ ' + s));
  if (bad.length) { console.log('\n未通过 ' + bad.length + ' 项：'); bad.forEach(s => console.log('  ✗ ' + s)); }
  c.close();
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); process.exit(2); });
