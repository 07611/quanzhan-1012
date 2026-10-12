/* 第三轮升级的分层验证：jsdom DOM 功能断言 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const FILE = path.resolve(__dirname, "..", "FullStack-Architect.html");
const html = fs.readFileSync(FILE, "utf8");

let pass = 0, fail = 0, errs = [];
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra ? "  → " + extra : "")); }
};
const head = t => console.log("\n=== " + t + " ===");

(async () => {
  /* file:// 是 opaque origin，localStorage 会抛 SecurityError 导致 init 全挂 */
  const dom = new JSDOM(html, {
    url: "http://localhost/fullstack-architect.html",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(w) {
      w.requestAnimationFrame = cb => setTimeout(() => cb(Date.now()), 0);
      w.scrollTo = () => {};
      w.matchMedia = w.matchMedia || (() => ({ matches:false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} }));
    }
  });
  const w = dom.window, d = w.document;
  /* const 声明不挂到 window（只有函数声明会），必须走 eval 才能拿到 */
  const G = k => w.eval(k);
  const err = [];
  w.addEventListener("error", e => err.push("window.error: " + e.message));
  await new Promise(r => setTimeout(r, 400));

  const $ = s => d.querySelector(s);
  const $$ = s => Array.from(d.querySelectorAll(s));
  const click = el => el && el.dispatchEvent(new w.MouseEvent("click", { bubbles:true, cancelable:true }));

  /* ---------- 1. 页面基本可用 ---------- */
  head("1 页面基本可用");
  ok("无运行时错误", err.length === 0, err.join(" | "));
  ok("功能库 60 条", G("FEATURES") && G("FEATURES").length === 60, "实际 " + (G("FEATURES") || []).length);

  /* ---------- 2. 新 tab 存在且可切换 ---------- */
  head("2 七个输出 tab");
  const tabs = $$(".out-tab").map(b => b.dataset.out);
  ok("tab 数量为 7", tabs.length === 7, "实际 " + tabs.length + " → " + tabs.join(","));
  ok("含 roadmap", tabs.includes("roadmap"));
  ok("含 testplan", tabs.includes("testplan"));
  ok("含 schema（建表脚本）", tabs.includes("schema"));

  /* ---------- 3. 生成全流程 ---------- */
  head("3 生成全流程（电商想法）");
  $("#ideaInput").value = "做一个校园二手交易平台，支持商品发布、购物车下单、在线支付、订单管理、站内私信和后台审核";
  $("#ideaInput").dispatchEvent(new w.Event("input", { bubbles:true }));
  await new Promise(r => setTimeout(r, 550));
  click($("#btnGen"));
  await new Promise(r => setTimeout(r, 400));

  ok("状态栏已生成", /项功能/.test($("#outStamp").textContent), $("#outStamp").textContent);
  ok("outStamp 同时显示排期表与测试清单体量",
     /排期表/.test($("#outStamp").textContent) && /测试清单/.test($("#outStamp").textContent),
     $("#outStamp").textContent);
  ok("七类交付物全部非空",
     ["prompt","spec","stack","actions","roadmap","testplan","schema"].every(k => (G("state").out[k] || "").length > 100),
     ["prompt","spec","stack","actions","roadmap","testplan","schema"].map(k => k + "=" + (G("state").out[k] || "").length).join(" "));

  /* ---------- 4. 排期表内容断言 ---------- */
  head("4 开发排期表内容");
  const rm = G("state").out.roadmap;
  ok("含全局节奏表", /## 全局节奏/.test(rm));
  ok("含阶段 0 脚手架", /## 阶段 0 · 脚手架与最小闭环/.test(rm));
  ok("含阶段 5 上线与观测", /## 阶段 5 · 上线与观测/.test(rm));
  ok("含边界（本期不做）", /## 边界（本期不做）/.test(rm));
  ok("每项功能有 4 步施工顺序", (rm.match(/施工顺序：/g) || []).length >= 20, "实际 " + (rm.match(/施工顺序：/g) || []).length);
  ok("施工顺序含数据/接口/界面/自测四步",
     /1\. 数据：/.test(rm) && /2\. 接口：/.test(rm) && /3\. 界面：/.test(rm) && /4\. 自测：/.test(rm));
  ok("排期表引用了测试清单（形成闭环）", /验收测试清单/.test(rm));
  ok("阶段 0 明确禁止做业务功能", /不要\*\*做任何业务功能/.test(rm), rm.slice(0, 0));

  /* ---------- 5. 测试清单内容断言 ---------- */
  head("5 验收测试清单内容");
  const tp = G("state").out.testplan;
  ok("含用例总览表", /## 一、用例总览/.test(tp));
  ok("含逐功能用例", /## 二、逐功能用例/.test(tp));
  ok("含跨功能系统性用例", /## 三、跨功能的系统性用例/.test(tp));
  ok("含上线前最后一遍", /## 四、上线前最后一遍/.test(tp));
  const boxes = (tp.match(/- \[ \]/g) || []).length;
  ok("可勾选用例 ≥ 150 条", boxes >= 150, "实际 " + boxes);
  ok("含越权测试（403 而非 200）", /返回 403 而不是 200/.test(tp));
  ok("含密钥明文扫描用例", /password.*secret.*key|明文凭据/.test(tp));
  ok("含「怎么测」操作提示", /怎么测：/.test(tp));
  ok("覆盖 375px 移动端断言", /375px/.test(tp));

  /* ---------- 6. 排期表与功能清单一致性 ---------- */
  head("6 数字一致性（防界面与数据源脱节）");
  const picked = G("pickedList")().length;
  ok("排期表阶段 2 功能数 = 清单 P0 数", (() => {
    const n = G("pickedList")().filter(f => f.tier === "core").length;
    return new RegExp("\\| 2 \\| P0 核心业务 \\| " + n + " \\|").test(rm);
  })(), "P0 = " + G("pickedList")().filter(f => f.tier === "core").length);
  ok("测试清单总览行数 = 功能数", (() => {
    const rows = (tp.match(/^\| .+ \| P[012] /gm) || []).length;
    return rows === picked;
  })(), "行数 vs 功能数 " + picked);

  /* ---------- 7. 下载扩展名映射 ---------- */
  head("7 下载扩展名与 MIME 映射");
  const EXT = G("OUT_EXT"), MIME = G("OUT_MIME");
  ok("七类产物都有扩展名", ["prompt","spec","stack","actions","roadmap","testplan","schema"].every(k => EXT[k]));
  ok("spec 是 json、schema 是 sql、其余是 md", EXT.spec === ".json" && EXT.schema === ".sql" && EXT.roadmap === ".md" && EXT.testplan === ".md");
  ok("MIME 映射齐全", ["prompt","spec","stack","actions","roadmap","testplan","schema"].every(k => MIME[k]));

  /* ---------- 8. 切到新 tab 渲染 ---------- */
  head("8 切换到新 tab");
  click($('.out-tab[data-out="roadmap"]'));
  await new Promise(r => setTimeout(r, 60));
  ok("roadmap tab 激活", $('.out-tab[data-out="roadmap"]').classList.contains("active"));
  ok("正文渲染了排期表", /开发排期表/.test($("#outBody").textContent));
  click($('.out-tab[data-out="testplan"]'));
  await new Promise(r => setTimeout(r, 60));
  ok("testplan tab 激活", $('.out-tab[data-out="testplan"]').classList.contains("active"));
  ok("正文渲染了测试清单", /验收测试清单/.test($("#outBody").textContent));
  click($('.out-tab[data-out="schema"]'));
  await new Promise(r => setTimeout(r, 60));
  ok("schema tab 激活", $('.out-tab[data-out="schema"]').classList.contains("active"));
  ok("正文渲染了建表脚本", /CREATE TABLE/.test($("#outBody").textContent));

  /* ---------- 9. P0 快速通道 ---------- */
  head("9 P0 快速通道");
  $$(".fcard.on").forEach(c => click(c));           // 先全清
  await new Promise(r => setTimeout(r, 60));
  click($("#btnQuickP0"));
  await new Promise(r => setTimeout(r, 400));
  const after = G("pickedList")();
  ok("清单非空", after.length > 0, "实际 " + after.length);
  ok("全部为 P0", after.every(f => f.tier === "core"), after.map(f => f.tier).join(","));
  ok("已生成交付物", G("state").out.roadmap.length > 100 && G("state").out.testplan.length > 100);
  ok("排期表与测试清单随清单同步变化", G("state").out.testplan.indexOf("用例总览") > 0);

  /* ---------- 10. 自定义功能贯通六份产物 ---------- */
  head("10 自定义功能贯通");
  $("#featCustom").value = "积分商城：用户用积分兑换商品\n数据大屏：实时展示今日订单数";
  $("#featCustom").dispatchEvent(new w.Event("input", { bubbles:true }));
  await new Promise(r => setTimeout(r, 320));
  click($("#btnGen2"));
  await new Promise(r => setTimeout(r, 350));
  ok("提示词含自定义功能", /积分商城/.test(G("state").out.prompt));
  ok("排期表含自定义功能", /积分商城/.test(G("state").out.roadmap));
  ok("测试清单含自定义功能", /数据大屏/.test(G("state").out.testplan));
  ok("spec JSON 含自定义功能", /积分商城/.test(G("state").out.spec));

  /* ---------- 11. 空清单不崩 ---------- */
  head("11 空清单鲁棒性");
  click($("#featClear"));
  await new Promise(r => setTimeout(r, 80));
  click($("#btnGen2"));
  await new Promise(r => setTimeout(r, 300));
  ok("空清单仍能生成（不崩）", G("state").out.roadmap.length > 50 && G("state").out.testplan.length > 50);
  ok("空清单在测试清单中有提示", /未选择任何功能|未选择功能|请先在第/.test(G("state").out.testplan), G("state").out.testplan.slice(400, 600));
  ok("运行时无新增错误", err.length === 0, err.join(" | "));

  /* ---------- 12. 功能库数据完整性 ---------- */
  head("12 功能库数据完整性");
  const F = G("FEATURES");
  ok("条数 60", F.length === 60, "实际 " + F.length);
  ok("id 无重复", new Set(F.map(f => f.id)).size === F.length);
  ok("每条都有 desc", F.every(f => (f.desc || "").length > 4));
  ok("每条都有规则", F.every(f => Array.isArray(f.rules) && f.rules.length > 0));
  ok("每条都有 arch", F.every(f => Array.isArray(f.arch) && f.arch.length > 0));
  ok("tier 取值合法", F.every(f => ["core","plus","ops"].includes(f.tier)));
  const archeIds = G("ARCHETYPES").map(a => a.id);
  ok("arch 引用都是合法原型", F.every(f => f.arch.every(x => x === "*" || archeIds.includes(x))),
     (() => { for (const f of F) for (const x of f.arch) if (x !== "*" && !archeIds.includes(x)) return f.id + " → " + x; return ""; })());
  ok("每条功能至少有一个原型能用到", archeIds.concat(["default"]).every(id =>
     F.filter(f => f.arch.includes("*") || f.arch.includes(id)).length > 0));
  const rulesTotal = F.reduce((s, f) => s + f.rules.length, 0);
  console.log("  统计：规则 " + rulesTotal + " 条 / 实体 " + F.reduce((s,f)=>s+(f.ent||[]).length,0) +
              " 个 / 接口 " + F.reduce((s,f)=>s+(f.apis||[]).length,0) + " 个");

  /* ---------- 13. 关键原型召回 ---------- */
  head("13 关键词召回（功能库缺口是否真被补上）");
  const probe = [
    ["sku", /SKU/], ["规格", /规格/], ["会员", /会员/], ["订阅", /订阅/], ["审批", /审批/],
    ["请假", /审批/], ["预约", /预约/], ["兑换码", /兑换码/], ["埋点", /埋点/],
    ["ab", /AB 实验|实验/], ["推送", /推送/], ["开放平台", /开放平台/], ["租户", /租户/],
    ["支付", /支付/], ["库存", /库存/], ["退款", /退款/], ["物流", /物流/], ["评价", /评价/],
  ];
  probe.forEach(([kw, re]) => {
    const hit = F.filter(f => re.test(f.name + f.desc + (f.rules || []).join(""))).length;
    ok("关键词「" + kw + "」有命中", hit > 0, "命中 0 条");
  });

  /* ---------- 14. 功能卡规则可展开（替代原 title 属性） ---------- */
  head("14 功能卡规则可展开");
  click($("#featRec"));
  await new Promise(r => setTimeout(r, 120));
  const firstCard = $(".fcard");
  ok("卡片是 div 而非 button（避免嵌套按钮）", firstCard && firstCard.tagName === "DIV", firstCard && firstCard.tagName);
  ok("卡片有 role=button", firstCard.getAttribute("role") === "button");
  ok("卡片有 tabindex（键盘可达）", firstCard.getAttribute("tabindex") === "0");
  ok("有「看规则」按钮", !!firstCard.querySelector("[data-exp]"));
  ok("初始未展开", !firstCard.querySelector(".fmore"));
  const expBtn = firstCard.querySelector("[data-exp]");
  click(expBtn);
  await new Promise(r => setTimeout(r, 80));
  const c2 = $(".fcard");
  ok("点击后规则展开", !!c2.querySelector(".fmore"), "未展开");
  const liN = c2.querySelectorAll(".fmore li").length;
  ok("展开后规则条目 > 0", liN > 0, "条目 " + liN);
  ok("展开按钮文案变「收起」", /收起/.test(c2.querySelector("[data-exp]").textContent));
  ok("展开按钮 aria-expanded=true", c2.querySelector("[data-exp]").getAttribute("aria-expanded") === "true");
  ok("点「看规则」不会误切换勾选", (() => {
    const id = c2.dataset.feat;
    return G("state").feat.picked.includes(id);
  })());
  click($(".fcard [data-exp]"));
  await new Promise(r => setTimeout(r, 80));
  ok("可再次收起", !$(".fcard").querySelector(".fmore"));

  /* ---------- 15. 功能清单预设存取 ---------- */
  head("15 功能清单预设");
  try { w.localStorage.removeItem("fsa_presets"); } catch (e) {}
  /* 只用 arch:["*"] 的通用项：此时原型是 default，带原型限定的项会被正确过滤掉（第 16 组专门验证该行为） */
  G("state").feat.picked = ["auth-email","auth-profile","auth-rbac"];
  $("#featCustom").value = "积分商城：用户用积分兑换商品";
  click($("#featSave"));
  await new Promise(r => setTimeout(r, 80));
  ok("弹出保存对话框", !!$("#psName"));
  $("#psName").value = "测试预设";
  click($("#psGo"));
  await new Promise(r => setTimeout(r, 80));
  const ps = G("getPresets")();
  ok("预设已写入存储", ps.length === 1 && ps[0].name === "测试预设", JSON.stringify(ps.map(p => p.name)));
  ok("预设记录了勾选项", ps[0].picked.length === 3, "实际 " + (ps[0] && ps[0].picked.length));
  ok("预设记录了自定义文本", /积分商城/.test(ps[0].custom));

  /* 改乱清单后套用预设，验证能还原 */
  G("state").feat.picked = [];
  $("#featCustom").value = "";
  await new Promise(r => setTimeout(r, 60));
  click($("#featLoadPreset"));
  await new Promise(r => setTimeout(r, 100));
  ok("弹出预设列表", $$("[data-ps]").length === 1, "行数 " + $$("[data-ps]").length);
  click($("[data-ps]"));
  await new Promise(r => setTimeout(r, 120));
  ok("套用后勾选被还原", G("state").feat.picked.length === 3, "实际 " + G("state").feat.picked.length);
  ok("还原的是原本那三项", G("state").feat.picked.slice().sort().join(",") === "auth-email,auth-profile,auth-rbac",
     G("state").feat.picked.join(","));
  ok("套用后自定义文本被还原", /积分商城/.test($("#featCustom").value));
  ok("对话框已关闭", !$("#mask").classList.contains("show"));
  ok("运行时仍无错误", err.length === 0, err.join(" | "));

  /* ---------- 16. 预设与当前原型不匹配时的降级 ---------- */
  head("16 预设跨原型套用降级");
  G("state").feat.picked = ["trade-sku","infra-tenant"];   // infra-tenant 仅 saas 适用
  click($("#featSave"));
  await new Promise(r => setTimeout(r, 80));
  $("#psName").value = "跨原型预设";
  click($("#psGo"));
  await new Promise(r => setTimeout(r, 80));
  G("state").archId = "commerce";                          // 切到电商原型
  G("state").feat.picked = [];
  click($("#featLoadPreset"));
  await new Promise(r => setTimeout(r, 100));
  const crossRow = $$("[data-ps]").find(x => /跨原型预设/.test(x.textContent));
  ok("找到跨原型预设", !!crossRow);
  click(crossRow);
  await new Promise(r => setTimeout(r, 120));
  const pk = G("state").feat.picked;
  ok("commerce 下只保留适用的 trade-sku", pk.includes("trade-sku") && !pk.includes("infra-tenant"), pk.join(","));

  /* ---------- 17. 第四轮：存储封装与链接安全 ---------- */
  head("17 存储封装与链接安全");
  // 模拟隐私模式：localStorage 读写均抛错，验证所有存储访问都走 LS 封装、不会崩溃
  const realLS = w.localStorage;
  try {
    Object.defineProperty(w, "localStorage", { configurable:true, value:{
      getItem(){ throw new Error("SecurityError"); },
      setItem(){ throw new Error("SecurityError"); },
      removeItem(){ throw new Error("SecurityError"); }
    }});
    ok("getModels 在存储被禁时不抛错", (() => { try { G("getModels")(); return true; } catch(e){ return false; } })());
    ok("getGh 在存储被禁时不抛错", (() => { try { G("getGh")(); return true; } catch(e){ return false; } })());
    ok("ensureDefaultModels 在存储被禁时不抛错", (() => { try { G("ensureDefaultModels")(); return true; } catch(e){ return false; } })());
  } finally {
    Object.defineProperty(w, "localStorage", { configurable:true, value: realLS });
  }
  ok("renderMarkdown 过滤 javascript: 链接", (() => {
    const out = G("renderMarkdown")("[点我](javascript:alert(1))");
    return !/javascript:/i.test(out);
  })());
  ok("renderMarkdown 保留 https 链接", (() => {
    const out = G("renderMarkdown")("[官网](https://example.com)");
    return /href="https:\/\/example.com"/.test(out);
  })());

  /* ---------- 18. 第五轮：SQL 建表脚本内容 ---------- */
  head("18 SQL 建表脚本内容");
  // 前面第 9/16 步把清单切成了 P0/单项，这里重置原型强制恢复全量推荐，确保 schema 覆盖完整实体
  G("state").archId = null;
  $("#ideaInput").value = "做一个校园二手交易平台，支持商品发布、购物车下单、在线支付、订单管理、站内私信和后台审核";
  $("#ideaInput").dispatchEvent(new w.Event("input", { bubbles:true }));
  await new Promise(r => setTimeout(r, 550));
  click($("#btnGen"));
  await new Promise(r => setTimeout(r, 400));
  const sc = G("state").out.schema;
  ok("schema 含表头说明", /全栈架构工作台/.test(sc) && /CREATE TABLE/.test(sc));
  ok("用户表已生成且 email 唯一", /CREATE TABLE IF NOT EXISTS users \(/.test(sc) && /email VARCHAR\(255\) UNIQUE/.test(sc));
  ok("金额用分（BIGINT）存储", /price_cents BIGINT NOT NULL DEFAULT 0/.test(sc));
  ok("外键引用 users 表", /seller_id BIGINT REFERENCES users\(id\)/.test(sc));
  ok("时间戳字段非空带默认值", /created_at TIMESTAMPTZ NOT NULL DEFAULT now\(\)/.test(sc));
  ok("订单号唯一约束", /order_no VARCHAR\(255\) UNIQUE/.test(sc));
  ok("软删除 deleted_at 字段存在", /deleted_at TIMESTAMPTZ/.test(sc));
  ok("外键列建了索引", /CREATE INDEX/.test(sc));
  ok("提示词第 4 节内嵌建表脚本", /## 4 · 数据模型/.test(G("state").out.prompt) && /CREATE TABLE IF NOT EXISTS users/.test(G("state").out.prompt));
  ok("行动清单指向 schema.sql", /schema\.sql/.test(G("state").out.actions));

  /* ---------- 19. 第五轮：基础设施文件生成 ---------- */
  head("19 基础设施文件（docker-compose / CI / Dockerfile）");
  const dc = G("buildDockerCompose")();
  ok("compose 含 services 段", /^services:/m.test(dc));
  ok("compose 含 postgres 服务", /postgres:/.test(dc) && /postgres:16-alpine/.test(dc));
  ok("compose 含后端占位与 DATABASE_URL", /backend:/.test(dc) && /DATABASE_URL/.test(dc));
  ok("compose 声明了数据卷", /^volumes:/m.test(dc) && /pgdata:/.test(dc));
  // 缓存选 Redis（首字母大写）也应识别为 redis 服务（回归：曾因大小写敏感漏掉）
  const prevCache = G("state").sel["L2-1"];
  G("state").sel["L2-1"] = "Redis";
  ok("compose 识别 Redis 缓存（大小写不敏感）", /redis:/.test(G("buildDockerCompose")()));
  G("state").sel["L2-1"] = prevCache;
  const ci = G("buildCiYml")();
  ok("CI 含 name 与触发器", /^name: CI/m.test(ci) && /^on:/m.test(ci) && /branches: \[main\]/.test(ci));
  ok("CI 含 jobs 与 checkout", /^jobs:/m.test(ci) && /actions\/checkout@v4/.test(ci));
  ok("CI 含 Node 步骤（默认 TS 栈）", /actions\/setup-node@v4/.test(ci) && /npm ci/.test(ci));
  const df = G("buildDockerfile")();
  ok("Dockerfile 基于 node 镜像", /FROM node:20-alpine/.test(df) && /npm ci/.test(df));
  ok("骨架预览包含新文件", /docker-compose\.yml/.test(G("skeletonPreview")("demo")) && /ci\.yml/.test(G("skeletonPreview")("demo")) && /Dockerfile/.test(G("skeletonPreview")("demo")));

  console.log("\n" + "=".repeat(56));
  console.log("通过 " + pass + " 项，失败 " + fail + " 项，运行时错误 " + err.length + " 条");
  console.log("=".repeat(56));
  if (fail > 0) process.exitCode = 1;
})().catch(e => { console.error("脚本自身异常：", e); process.exitCode = 2; });
