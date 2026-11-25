import json
import sys
from time import perf_counter
from urllib.parse import parse_qs, urlsplit

from server import Handler

ROUTES = {
    "auth-config": "/api/auth-config",
    "guide": "/api/guide",
    "cards": "/api/cards",
    "card-sandbox": "/api/card-sandbox",
    "vehicle-connect": "/api/vehicle-connect",
    "callback": "/vehicle-connect/callback",
}


class EvLogRequestHandler(Handler):
    def dispatch(self, allowed, handle):
        self.request_started_at = perf_counter()
        self.log_route = "unmatched"
        url = urlsplit(self.path)
        path = url.path
        if path == "/api/evlog":
            route = parse_qs(url.query).get("evlog_route", [])
            path = ROUTES.get(route[0]) if len(route) == 1 else None
        if path not in allowed:
            self.send_json(404, {"error": "요청 경로를 찾을 수 없습니다."})
            return
        self.log_route = path
        self.path = path
        handle()

    def do_GET(self):
        self.dispatch({ROUTES["auth-config"], ROUTES["callback"]}, super().do_GET)

    def do_POST(self):
        self.dispatch(
            {ROUTES["guide"], ROUTES["cards"], ROUTES["card-sandbox"], ROUTES["vehicle-connect"]},
            super().do_POST,
        )

    def do_HEAD(self):
        self.send_error(405)

    def log_request(self, code="-", size="-"):
        # Only record the matched route. Callback URLs can contain authorization codes.
        status = int(code) if str(code).isdigit() else None
        started_at = getattr(self, "request_started_at", None)
        event = {
            "event": "http_response",
            "method": self.command if self.command in {"GET", "POST", "HEAD"} else "other",
            "route": getattr(self, "log_route", "unmatched"),
            "status": status,
            "elapsed_ms": round((perf_counter() - started_at) * 1000, 1) if started_at is not None else None,
        }
        stream = sys.stderr if status is not None and status >= 500 else sys.stdout
        print(json.dumps(event), file=stream, flush=True)


# The Vercel Python runtime imports the handler module variable by name.
handler = EvLogRequestHandler
