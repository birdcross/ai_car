"""Read-only CODEF integration for the provider's documented sandbox account."""

import base64
import json
import os
import re
from datetime import date
from urllib.parse import quote, unquote_plus
from urllib.request import Request, urlopen

TOKEN_URL = "https://oauth.codef.io/oauth/token"
CARD_API = "https://sandbox.codef.io/v1/kr/card/p/account/"
SANDBOX_ACCOUNT = {"connectedId": "sandbox_connectedId", "organization": "0309"}


class UnavailableError(Exception):
    """Sandbox configuration or upstream request failed."""


def post(url, body, headers):
    with urlopen(Request(url, data=body, headers=headers), timeout=8) as response:
        raw = response.read(500_001)
    if len(raw) > 500_000:
        raise UnavailableError()
    try:
        text = raw.decode("utf-8")
        return json.loads(text if text.lstrip().startswith("{") else unquote_plus(text))
    except ValueError as error:
        raise UnavailableError() from error


def get_token():
    client_id = os.getenv("CODEF_SANDBOX_CLIENT_ID")
    client_secret = os.getenv("CODEF_SANDBOX_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise UnavailableError("서버에 CODEF 샌드박스 키를 설정하면 테스트 카드를 조회할 수 있어요.")
    credentials = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    return post(TOKEN_URL, b"grant_type=client_credentials&scope=read", {
        "Authorization": "Basic " + credentials,
        "Content-Type": "application/x-www-form-urlencoded",
    })["access_token"]


def request_cards(endpoint, token, attributes):
    payload = quote(json.dumps({**SANDBOX_ACCOUNT, **attributes})).encode("ascii")
    result = post(CARD_API + endpoint, payload, {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
    })
    if result["result"]["code"] != "CF-00000":
        raise UnavailableError()
    return result["data"]


def sandbox_cards(token):
    cards = request_cards("card-list", token, {})
    if not isinstance(cards, list):
        raise UnavailableError()
    return [
        card for card in cards
        if re.fullmatch(r"[0-9]{4}\*{8}[0-9]{4}", card.get("resCardNo", ""))
    ]


def approval_preview(response):
    rows = [response] if isinstance(response, dict) and "resApprovalNo" in response else response
    if not isinstance(rows, list):
        raise UnavailableError()
    transactions = []
    for row in rows:
        date_text = row.get("resUsedDate", "")
        merchant = row.get("resMemberStoreName", "")
        amount_text = str(row.get("resUsedAmount", "")).replace(",", "")
        try:
            transaction_date = date.fromisoformat(date_text).isoformat() if re.fullmatch(r"[0-9]{8}", date_text) else None
        except ValueError:
            transaction_date = None
        transactions.append({
            "date": transaction_date,
            "merchant": merchant[:100] if merchant.strip("* ") else None,
            "amount": int(amount_text) if re.fullmatch(r"[0-9]{1,9}", amount_text) else None,
            "cancelled": row.get("resCancelYN") == "1",
        })
    return transactions


def handle(request):
    action = request.get("action") if isinstance(request, dict) else None
    if action not in ("cards", "approvals"):
        raise ValueError("카드 테스트 요청을 확인해주세요.")
    index = request.get("card")
    if action == "approvals" and (type(index) is not int or index < 0 or index > 49):
        raise ValueError("테스트 카드를 선택해주세요.")
    token = get_token()
    cards = sandbox_cards(token)[:50]
    if action == "cards":
        return {"cards": [
            {"id": i, "name": card["resCardName"][:80], "lastFour": card["resCardNo"][-4:]}
            for i, card in enumerate(cards)
        ]}
    if index >= len(cards):
        raise ValueError("테스트 카드 목록을 새로 불러와주세요.")
    number = cards[index]["resCardNo"]
    try:
        rows = request_cards("approval-list", token, {
            "birthDate": "", "startDate": "20190601", "endDate": "20190619",
            "orderBy": "0", "inquiryType": "1",
            "cardNo": f"{number[:4]}-****-****-{number[-4:]}",
            "cardName": "", "duplicateCardSelect": "", "duplicateCardIdx": "", "memberStoreInfoType": "0",
        })
        return {"transactions": approval_preview(rows)}
    except (ValueError, TypeError) as error:
        raise UnavailableError() from error
