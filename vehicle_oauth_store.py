import json
import os
from urllib.parse import urlencode
from urllib.request import Request, urlopen


class SupabaseOAuthStore:
    def __init__(self, user_id, brand):
        self.url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/vehicle_oauth_sessions"
        secret = os.environ["SUPABASE_SECRET_KEY"]
        self.headers = {"apikey": secret, "Content-Type": "application/json"}
        if not secret.startswith("sb_secret_"):
            self.headers["Authorization"] = "Bearer " + secret
        self.identity = {"user_id": user_id, "brand": brand}

    def request(self, method, filters, *, data=None, prefer=None):
        headers = dict(self.headers)
        if prefer:
            headers["Prefer"] = prefer
        body = json.dumps(data).encode() if data is not None else None
        request = Request(self.url + "?" + urlencode(filters), body, headers, method=method)
        with urlopen(request, timeout=5) as response:
            result = response.read()
        return json.loads(result) if result else []

    def filters(self, **fields):
        return {key: f"eq.{value}" for key, value in (self.identity | fields).items()}

    def save(self, kind, value, expires_at):
        self.request("POST", {"on_conflict": "user_id,brand,kind"},
                     data=self.identity | {"kind": kind, "value": value, "expires_at": expires_at},
                     prefer="resolution=merge-duplicates")

    def token(self, now):
        rows = self.request("GET", self.filters(kind="token") | {"expires_at": f"gt.{now}", "select": "value"})
        return (rows[0]["value"],) if rows else None

    def consume(self, state, now):
        rows = self.request("DELETE", self.filters(kind="state", value=state) | {"expires_at": f"gt.{now}", "select": "kind"},
                            prefer="return=representation")
        return bool(rows)

    def disconnect(self):
        self.request("DELETE", self.filters())
