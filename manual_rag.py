import argparse
import json
import os
import re
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from manual_embeddings import embed

PROJECT_ROOT = Path(__file__).resolve().parent
SEED = PROJECT_ROOT / "data" / "manual_chunks.json"


def load_local_env(path=PROJECT_ROOT / ".env"):
    """Read local KEY=VALUE settings, with process environment taking priority."""
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        name, sep, value = line.strip().partition("=")
        name, value = name.strip(), value.strip()
        if not sep or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name):
            continue
        if len(value) >= 2 and value[0] in ("'", '"') and value[-1] == value[0]:
            value = value[1:-1]
        if value:
            os.environ.setdefault(name, value)


def normalize(value):
    return re.sub(r"[^a-z0-9가-힣]", "", value.lower())


def post_json(url, headers, payload):
    request = Request(url, data=json.dumps(payload).encode(), headers={
        "Content-Type": "application/json", **headers,
    })
    with urlopen(request, timeout=15) as response:
        body = response.read()
        return json.loads(body) if body else None


def supabase_request(path, payload, extra_headers=None):
    origin = os.environ["SUPABASE_URL"].rstrip("/")
    address = urlparse(origin)
    if address.scheme != "https" or not address.hostname or address.path or address.query or address.fragment:
        raise ValueError("SUPABASE_URL must be an HTTPS project origin.")
    key = os.environ["SUPABASE_SECRET_KEY"]
    headers = {"apikey": key, **(extra_headers or {})}
    if key.startswith("eyJ"):
        headers["Authorization"] = "Bearer " + key
    return post_json(origin + "/rest/v1/" + path, headers, payload)


def has_supabase_config():
    return all(os.getenv(key) for key in ("SUPABASE_URL", "SUPABASE_SECRET_KEY"))


def require_config():
    required = ("SUPABASE_URL", "SUPABASE_SECRET_KEY")
    missing = [key for key in required if not os.getenv(key)]
    if missing:
        raise RuntimeError("Missing environment variables: " + ", ".join(missing))


def search(question, vehicle):
    require_config()
    make, model, year = vehicle
    result = supabase_request("rpc/match_e5_manual_chunks", {
        "vehicle_make": make,
        "vehicle_model": model,
        "vehicle_year": year,
        "query_embedding": json.dumps(embed([question], query=True)[0]),
    })
    return {**result, "matches": [match for match in result["matches"] if match["similarity"] >= 0.83]}


def read_seed(path=SEED):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def ingest(path):
    require_config()
    chunks = read_seed(path)
    rows = []
    for chunk in chunks:
        rows.append({
            "id": chunk["id"], "make_key": normalize(chunk["make"]),
            "model_key": normalize(chunk["model"]), "model_year": chunk["year"],
            "title": chunk["title"], "content": chunk["content"], "source_url": chunk["source"],
        })
    for start in range(0, len(rows), 32):
        batch = rows[start:start + 32]
        vectors = embed([row["title"] + "\n" + row["content"] for row in batch])
        for row, vector in zip(batch, vectors):
            row["e5_embedding"] = json.dumps(vector)
        supabase_request("manual_chunks?on_conflict=id", batch, {
            "Prefer": "resolution=merge-duplicates,return=minimal",
        })
    return len(rows)


if __name__ == "__main__":
    load_local_env()
    parser = argparse.ArgumentParser(description="Embed manual chunks and upsert them into Supabase.")
    parser.add_argument("path", nargs="?", type=Path, default=SEED)
    args = parser.parse_args()
    print(f"Indexed {ingest(args.path)} manual chunks.")
