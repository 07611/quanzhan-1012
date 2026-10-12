# -*- coding: utf-8 -*-
"""全栈 AI 工作台 · 本地 CORS 代理（多线程 + HTTP/1.0，流式响应不会挂起）
用法：双击运行 启动代理.bat（或执行 python proxy_server.py），保持窗口开着。
页面会自动检测本代理并优先走它，解决本地 file:// 页面直连大模型 API 被浏览器跨域拦截的问题。
"""
import sys
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SILENT = "--silent" in sys.argv


class Proxy(BaseHTTPRequestHandler):
    # 保持 HTTP/1.0：每个响应结束后关闭连接，浏览器能正确感知流式响应结束（1.1 keep-alive + 无 Content-Length 会永远挂起）
    # protocol_version = "HTTP/1.1"

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        if self.path == "/ping":
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", "2")
            self.end_headers()
            self.wfile.write(b"ok")
            return
        self.do_POST()

    def do_POST(self):
        target = self.headers.get("X-Target-URL", "")
        if not target:
            self.send_response(400)
            self._cors()
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"missing X-Target-URL")
            return
        length = int(self.headers.get("Content-Length", 0) or 0)
        body = self.rfile.read(length) if length else None
        req = urllib.request.Request(
            target,
            data=body,
            method="POST",
            headers={
                "Content-Type": self.headers.get("Content-Type", "application/json"),
                "Authorization": self.headers.get("Authorization", ""),
            },
        )
        if not SILENT:
            print("转发 ->", target.split("/")[2] if "//" in target else target)
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                ctype = r.headers.get("Content-Type", "application/json")
                self.send_response(r.status)
                self._cors()
                self.send_header("Content-Type", ctype)
                cl = r.headers.get("Content-Length")
                if cl:
                    self.send_header("Content-Length", cl)
                self.end_headers()
                while True:
                    chunk = r.read(8192)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    self.wfile.flush()
        except Exception as e:
            try:
                self.send_response(502)
                self._cors()
                self.send_header("Content-Type", "text/plain")
                msg = ("proxy error: %s" % e).encode("utf-8")
                self.send_header("Content-Length", str(len(msg)))
                self.end_headers()
                self.wfile.write(msg)
            except Exception:
                pass

    def log_message(self, *args):
        pass


def main():
    port = 8787
    try:
        server = ThreadingHTTPServer(("127.0.0.1", port), Proxy)
    except OSError as e:
        print("启动失败：端口 %d 已被占用。" % port)
        print("可能另一个代理窗口还在运行。请先关掉旧的代理窗口/VS Code 终端，再重新启动。")
        print("错误信息：%s" % e)
        input("按回车退出...")
        sys.exit(1)
    print("本地代理已启动：http://127.0.0.1:%d" % port)
    print("保持本窗口开着即可，关掉后页面自动回退直连。")
    print("（多线程版 · 流式响应不挂起）")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")


if __name__ == "__main__":
    main()
