/* 真机视口审计：CDP 设备指标覆盖，检查横向溢出与触摸目标尺寸 */
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const FILE = path.resolve(__dirname, "..", "FullStack-Architect.html");
const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find(p => fs.existsSync(p));

const DEVICES = [
  { name:"移动 375×812",  w:375,  h:812,  mobile:true,  scale:3 },
  { name:"移动 390×844",  w:390,  h:844,  mobile:true,  scale:3 },
  { name:"平板 768×1024", w:768,  h:1024, mobile:true,  scale:2 },
  { name:"桌面 1280×800", w:1280, h:800,  mobile:false, scale:1 },
  { name:"宽屏 1920×1080",w:1920, h:1080, mobile:false, scale:1 },
];

(async () => {
  if (!CHROME) { console.error("找不到 Chrome/Edge"); process.exit(2); }
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  let bad = 0;

  for (const dv of DEVICES) {
    const page = await browser.newPage();
    const cdp = await page.target().createCDPSession();
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: dv.w, height: dv.h, deviceScaleFactor: dv.scale, mobile: dv.mobile,
    });
    await page.setViewport({ width: dv.w, height: dv.h, deviceScaleFactor: dv.scale, isMobile: dv.mobile, hasTouch: dv.mobile });
    const errs = [];
    page.on("pageerror", e => errs.push(e.message));
    await page.goto("file:///" + FILE.replace(/\\/g, "/"), { waitUntil: "domcontentloaded" });
    await new Promise(r => setTimeout(r, 700));

    // 生成一次，让功能清单与输出栏都有内容
    await page.evaluate(() => {
      const i = document.querySelector("#ideaInput");
      i.value = "校园二手交易平台，支持商品发布、购物车、在线支付、订单管理、审批与会员";
      i.dispatchEvent(new Event("input", { bubbles:true }));
    });
    await new Promise(r => setTimeout(r, 600));
    await page.evaluate(() => document.querySelector("#btnGen").click());
    await new Promise(r => setTimeout(r, 600));

    const r = await page.evaluate(() => {
      const de = document.documentElement;
      const out = { sw: de.scrollWidth, cw: de.clientWidth, overflow: [], smallTargets: [], tabsWrapped: null };

      // 横向溢出元素（排除设计上离屏的元素）
      document.querySelectorAll("*").forEach(el => {
        const s = getComputedStyle(el);
        if (s.display === "none" || s.visibility === "hidden") return;
        if (el.closest(".rail") || el.classList.contains("rail")) return;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0) return;
        if (rect.right > de.clientWidth + 1.5) {
          /* 若某个祖先设了 overflow 裁切，则该元素不会撑出文档滚动条，属设计性离屏（横向滚动容器） */
          let clipped = false, a = el.parentElement;
          while (a && a !== document.body) {
            const ov = getComputedStyle(a).overflowX;
            if (ov === "hidden" || ov === "auto" || ov === "scroll") { clipped = true; break; }
            a = a.parentElement;
          }
          if (!clipped) out.overflow.push({ tag: el.tagName, cls: (el.className || "").toString().slice(0, 46), right: Math.round(rect.right) });
        }
      });
      out.overflow = out.overflow.slice(0, 8);

      // 触摸目标 < 36px（只审计可见的交互元素）
      document.querySelectorAll("button, a, select, input, textarea, [role=button]").forEach(el => {
        const s = getComputedStyle(el);
        if (s.display === "none" || s.visibility === "hidden") return;
        const rect = el.getBoundingClientRect();
        if (rect.height === 0 || rect.width === 0) return;
        /* 用 elementFromPoint 探测真实命中区：单纯量 getBoundingClientRect 会漏掉
           用 ::before 伪元素扩展过点击区的按钮，也会误判视觉紧凑但可点区域合格的控件 */
        const cx = Math.min(Math.max(rect.left + rect.width / 2, 2), de.clientWidth - 2);
        const cy = Math.min(Math.max(rect.top + rect.height / 2, 2), de.clientHeight - 2);
        const hit = document.elementFromPoint(cx, cy);
        const reachable = hit && (el.contains(hit) || hit.contains(el) || hit === el);
        const effH = (() => {
          // 探测上下各能延伸到多远（上限 60px），得到有效垂直命中高度
          let up = 0, down = 0;
          for (let d = 2; d <= 60; d += 2) {
            const t = document.elementFromPoint(cx, cy - d);
            if (t && (el.contains(t) || t.contains(el) || t === el)) up = d; else break;
          }
          for (let d = 2; d <= 60; d += 2) {
            const t = document.elementFromPoint(cx, cy + d);
            if (t && (el.contains(t) || t.contains(el) || t === el)) down = d; else break;
          }
          return up + down + rect.height;
        })();
        if (effH < 36) {
          out.smallTargets.push({ tag: el.tagName, id: el.id || "", cls: (el.className||"").toString().slice(0,30),
                                  txt: (el.textContent||"").trim().slice(0,16),
                                  h: Math.round(rect.height), eff: Math.round(effH), reach: reachable });
        }
      });
      out.smallTargets = out.smallTargets.slice(0, 10);

      const tabs = document.querySelector("#outTabs");
      out.tabsWrapped = tabs ? Math.round(tabs.getBoundingClientRect().height) : null;
      out.featBarH = Math.round((document.querySelector(".feat-bar") || {}).getBoundingClientRect ? document.querySelector(".feat-bar").getBoundingClientRect().height : 0);
      out.featCards = document.querySelectorAll(".fcard").length;
      out.tabCount = document.querySelectorAll(".out-tab").length;
      return out;
    });

    const overflowOk = r.sw <= r.cw + 1;
    if (!overflowOk || r.overflow.length || r.smallTargets.length || errs.length) bad++;
    console.log("\n── " + dv.name + " ──");
    console.log("  scrollWidth " + r.sw + " / clientWidth " + r.cw + "  → " + (overflowOk ? "无横向溢出" : "**有横向溢出**"));
    console.log("  输出 tab " + r.tabCount + " 个，tabs 栏高 " + r.tabsWrapped + "px");
    console.log("  功能栏高 " + r.featBarH + "px，功能卡 " + r.featCards + " 张");
    if (r.overflow.length) console.log("  越界元素(无裁切祖先)：" + r.overflow.map(o => o.tag + "." + o.cls + "(right=" + o.right + ")").join(" | "));
    else console.log("  越界元素(无裁切祖先)：无");
    if (r.smallTargets.length) console.log("  触摸目标 <36px：" + r.smallTargets.map(o => o.tag + "#" + o.id + "." + o.cls + " 视觉h=" + o.h + " 有效h=" + o.eff).join(" | "));
    else console.log("  触摸目标：全部 ≥36px");
    if (errs.length) console.log("  页面错误：" + errs.join(" | "));
    else console.log("  页面错误：无");

    await page.close();
  }

  await browser.close();
  console.log("\n" + "=".repeat(52));
  console.log(bad === 0 ? "视口审计全部通过" : bad + " 个视口有问题");
  console.log("=".repeat(52));
  if (bad) process.exitCode = 1;
})().catch(e => { console.error("脚本异常：", e); process.exitCode = 2; });
