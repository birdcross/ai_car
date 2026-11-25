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


class handler(Handler):
    def dispatch(self, allowed, handle):
        url = urlsplit(self.path)
        path = url.path
        if path == "/api/evlog":
            route = parse_qs(url.query).get("evlog_route", [])
            path = ROUTES.get(route[0]) if len(route) == 1 else None
        if path not in allowed:
            self.send_json(404, {"error": "요청 경로를 찾을 수 없습니다."})
            return
        self.path = path
        handle()

    def do_GET(self):
        self.dispatch({ROUTES["auth-config"], ROUTES["callback"]}, super().do_GET)

    def do_POST(self):
        self.dispatch({ROUTES["guide"], ROUTES["cards"], ROUTES["card-sandbox"], ROUTES["vehicle-connect"]}, super().do_POST)

    def do_HEAD(self):
        self.send_error(405)

    def log_request(self, code="-", size="-"):
        # Provider callbacks can carry an authorization code in the URL.
        pass
