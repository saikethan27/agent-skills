#!/usr/bin/env python3
"""Search Unsplash, Pixabay, and Openverse using only Python's standard library."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen


USER_AGENT = "image-search-skill/1.0 (standard-library CLI)"
TIMEOUT = 15
PROVIDERS = ("unsplash", "pixabay", "openverse")
CACHE_TTL = 24 * 60 * 60


class SearchError(Exception):
    """An error safe to show without exposing request credentials."""


def _request(url, *, method="GET", headers=None, data=None):
    request_headers = {"User-Agent": USER_AGENT}
    if headers:
        request_headers.update(headers)
    request = Request(url, data=data, headers=request_headers, method=method)
    try:
        with urlopen(request, timeout=TIMEOUT) as response:
            return response.read(), response.headers
    except HTTPError as exc:
        if exc.code == 429:
            raise SearchError("HTTP 429 rate limit; try again later") from None
        raise SearchError("HTTP error {}".format(exc.code)) from None
    except URLError as exc:
        reason = getattr(exc, "reason", None)
        if isinstance(reason, TimeoutError):
            raise SearchError("request timed out after 15 seconds") from None
        raise SearchError("network request failed") from None
    except TimeoutError:
        raise SearchError("request timed out after 15 seconds") from None


def _json_request(url, *, headers=None, data=None, method="GET"):
    body, _ = _request(url, method=method, headers=headers, data=data)
    try:
        return json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise SearchError("provider returned invalid JSON") from None


def _result(provider, *, image_id, title, thumb_url, full_url, width, height,
            creator, creator_url, license_name, source_page, attribution,
            download_location=None):
    return {
        "provider": provider,
        "id": image_id,
        "title": title or "",
        "thumb_url": thumb_url,
        "full_url": full_url,
        "width": width,
        "height": height,
        "creator": creator or "Unknown creator",
        "creator_url": creator_url,
        "license": license_name or "License not provided",
        "source_page": source_page,
        "attribution": attribution or "",
        "download_location": download_location,
    }


def _unsplash(query, limit):
    key = os.environ.get("UNSPLASH_ACCESS_KEY")
    if not key:
        raise SearchError("missing UNSPLASH_ACCESS_KEY")
    params = urlencode({"query": query, "per_page": limit})
    data = _json_request(
        "https://api.unsplash.com/search/photos?" + params,
        headers={"Authorization": "Client-ID " + key},
    )
    results = []
    for photo in data.get("results", []):
        user = photo.get("user") or {}
        links = photo.get("links") or {}
        urls = photo.get("urls") or {}
        name = user.get("name") or "Unknown creator"
        results.append(_result(
            "unsplash",
            image_id=photo.get("id"),
            title=photo.get("alt_description") or photo.get("description"),
            thumb_url=urls.get("small") or urls.get("thumb"),
            full_url=urls.get("full") or urls.get("regular"),
            width=photo.get("width"),
            height=photo.get("height"),
            creator=name,
            creator_url=(user.get("links") or {}).get("html"),
            license_name="Unsplash License",
            source_page=links.get("html"),
            attribution="Photo by {} on Unsplash".format(name),
            download_location=links.get("download_location"),
        ))
    return results


def _cache_path(provider, query, params):
    # Cache identity contains only public search parameters, never credentials.
    cache_key = hashlib.sha256(
        json.dumps([provider, query, params], sort_keys=True).encode("utf-8")
    ).hexdigest()
    return Path.home() / ".cache" / "image-search" / (cache_key + ".json")


def _pixabay(query, limit):
    key = os.environ.get("PIXABAY_API_KEY")
    if not key:
        raise SearchError("missing PIXABAY_API_KEY")
    params_for_cache = {"image_type": "photo", "safesearch": "true", "per_page": limit}
    cache_file = _cache_path("pixabay", query, params_for_cache)
    payload = None
    try:
        cached = json.loads(cache_file.read_text(encoding="utf-8"))
        if time.time() - cached.get("cached_at", 0) < CACHE_TTL:
            payload = cached.get("response")
    except (OSError, ValueError, TypeError):
        pass
    if payload is None:
        params = dict(params_for_cache)
        params.update({"key": key, "q": query})
        payload = _json_request("https://pixabay.com/api/?" + urlencode(params))
        try:
            cache_file.parent.mkdir(parents=True, exist_ok=True)
            cache_file.write_text(json.dumps({
                "cached_at": time.time(),
                "response": payload,
            }), encoding="utf-8")
        except OSError:
            # A cache write failure should not turn a successful search into an error.
            pass
    results = []
    for hit in payload.get("hits", []):
        creator = hit.get("user") or "Unknown creator"
        creator_id = hit.get("user_id")
        profile = ("https://pixabay.com/users/{}-{}/".format(creator, creator_id)
                   if creator_id is not None else None)
        results.append(_result(
            "pixabay",
            image_id=hit.get("id"),
            title=hit.get("tags") or "",
            thumb_url=hit.get("previewURL") or hit.get("webformatURL"),
            full_url=hit.get("largeImageURL") or hit.get("webformatURL"),
            width=hit.get("imageWidth"),
            height=hit.get("imageHeight"),
            creator=creator,
            creator_url=profile,
            license_name="Pixabay Content License",
            source_page=hit.get("pageURL"),
            attribution="Image by {} from Pixabay".format(creator),
        ))
    return results


def _openverse_token():
    client_id = os.environ.get("OPENVERSE_CLIENT_ID")
    client_secret = os.environ.get("OPENVERSE_CLIENT_SECRET")
    if not client_id or not client_secret:
        return None
    body = urlencode({
        "grant_type": "client_credentials",
        "client_id": client_id,
        "client_secret": client_secret,
    }).encode("utf-8")
    token_data = _json_request(
        "https://api.openverse.org/v1/auth_tokens/token/",
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        data=body,
    )
    token = token_data.get("access_token")
    if not token:
        raise SearchError("Openverse authentication returned no access token")
    return token


def _openverse(query, limit):
    params = urlencode({
        "q": query,
        "license_type": "commercial",
        "mature": "false",
        "page_size": limit,
    })
    headers = {}
    token = _openverse_token()
    if token:
        headers["Authorization"] = "Bearer " + token
    data = _json_request("https://api.openverse.org/v1/images/?" + params, headers=headers)
    results = []
    for image in data.get("results", []):
        creator = image.get("creator") or "Unknown creator"
        results.append(_result(
            "openverse",
            image_id=image.get("id"),
            title=image.get("title") or "",
            thumb_url=image.get("thumbnail") or image.get("thumbnail_url"),
            full_url=image.get("url"),
            width=image.get("width"),
            height=image.get("height"),
            creator=creator,
            creator_url=image.get("creator_url"),
            license_name=image.get("license") or image.get("license_version"),
            source_page=image.get("foreign_landing_url") or image.get("detail_url"),
            attribution=image.get("attribution") or "{} — {}".format(creator, image.get("license") or "license not provided"),
        ))
    return results


def do_search(args):
    selected = args.provider.split(",") if args.provider else list(PROVIDERS)
    selected = [name.strip().lower() for name in selected if name.strip()]
    unknown = [name for name in selected if name not in PROVIDERS]
    if unknown:
        raise SearchError("unknown provider: {}".format(", ".join(unknown)))
    results = []
    errors = []
    searchers = {"unsplash": _unsplash, "pixabay": _pixabay, "openverse": _openverse}
    for provider in selected:
        try:
            results.extend(searchers[provider](args.query, args.limit))
        except SearchError as exc:
            errors.append({"provider": provider, "error": str(exc)})
        except Exception:
            # Keep provider failures isolated and never expose URLs or credentials.
            errors.append({"provider": provider, "error": "unexpected provider error"})
    payload = {"results": results, "errors": errors}
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        for result in results:
            print("{} | {} | {}".format(result["provider"], result["title"], result["source_page"]))
        for error in errors:
            print("{}: {}".format(error["provider"], error["error"]), file=sys.stderr)
    return 0


def do_providers(_args):
    data = {
        "providers": [
            {"provider": "unsplash", "configured": bool(os.environ.get("UNSPLASH_ACCESS_KEY")), "key_env": "UNSPLASH_ACCESS_KEY"},
            {"provider": "pixabay", "configured": bool(os.environ.get("PIXABAY_API_KEY")), "key_env": "PIXABAY_API_KEY"},
            {"provider": "openverse", "configured": True, "key_env": None},
        ]
    }
    print(json.dumps(data, indent=2))
    return 0


def do_download(args):
    try:
        body, headers = _request(args.url)
        content_type = headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if content_type and not content_type.startswith("image/"):
            raise SearchError("URL did not return an image")
        suffix = Path(urlparse(args.url).path).suffix.lower()
        if suffix not in (".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".tif", ".tiff", ".bmp"):
            suffix = {"image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif",
                      "image/webp": ".webp", "image/avif": ".avif"}.get(content_type, ".img")
        digest = hashlib.sha256(args.url.encode("utf-8")).hexdigest()[:16]
        out_dir = Path(args.out).expanduser()
        out_dir.mkdir(parents=True, exist_ok=True)
        output_file = out_dir / (digest + suffix)
        output_file.write_bytes(body)
        print(str(output_file.resolve()))
        return 0
    except SearchError as exc:
        print("download: {}".format(exc), file=sys.stderr)
        return 1
    except (OSError, URLError, HTTPError):
        print("download: could not save image", file=sys.stderr)
        return 1


def do_track_download(args):
    if not os.environ.get("UNSPLASH_ACCESS_KEY"):
        print("track-download: missing UNSPLASH_ACCESS_KEY", file=sys.stderr)
        return 1
    parsed = urlparse(args.download_location)
    if parsed.scheme != "https" or parsed.hostname not in ("api.unsplash.com", "unsplash.com", "images.unsplash.com"):
        print("track-download: expected an Unsplash HTTPS download_location", file=sys.stderr)
        return 1
    try:
        _request(args.download_location, headers={
            "Authorization": "Client-ID " + os.environ["UNSPLASH_ACCESS_KEY"]
        })
        print("Unsplash download tracked")
        return 0
    except SearchError as exc:
        print("track-download: {}".format(exc), file=sys.stderr)
        return 1


def build_parser():
    parser = argparse.ArgumentParser(description="Search image providers and download images.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    search = subparsers.add_parser("search", help="search image providers")
    search.add_argument("query")
    search.add_argument("--provider", help="comma-separated provider list (default: all)")
    search.add_argument("--limit", type=int, default=5)
    search.add_argument("--json", action="store_true", help="print normalized JSON")
    search.set_defaults(func=do_search)

    providers = subparsers.add_parser("providers", help="show provider configuration")
    providers.set_defaults(func=do_providers)

    download = subparsers.add_parser("download", help="download an image for local hosting")
    download.add_argument("url")
    download.add_argument("--out", required=True)
    download.set_defaults(func=do_download)

    track = subparsers.add_parser("track-download", help="track a selected Unsplash image download")
    track.add_argument("download_location")
    track.set_defaults(func=do_track_download)
    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()
    if getattr(args, "limit", 1) < 1 or getattr(args, "limit", 1) > 200:
        parser.error("--limit must be between 1 and 200")
    try:
        return args.func(args)
    except SearchError as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
