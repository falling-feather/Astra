from urllib.parse import urlsplit
from starlette.requests import Request


def rejects_cookie_mutation(request: Request, cookie_name: str, trusted_origins: list[str]) -> bool:
    """Cookie writes must originate at this service or an explicitly configured UI."""
    if request.method in {"GET", "HEAD", "OPTIONS"} or not request.cookies.get(cookie_name):
        return False
    origin = request.headers.get("origin")
    if not origin:
        return request.headers.get("sec-fetch-site") == "cross-site"
    parsed = urlsplit(str(request.base_url))
    own_origin = f"{parsed.scheme}://{parsed.netloc}"
    return origin != own_origin and origin not in trusted_origins
