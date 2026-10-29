"""下载分享中的 AA 原音，运行时网站不依赖网盘接口。"""

import http.cookiejar
import json
import pathlib
import re
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
# 使用完整浏览器标识与会话 Cookie，兼容网盘的游客下载校验。
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
API = "https://drive-pc.quark.cn/1/clouddrive/"
SHARE_ID = "e88793d7bd80"
AUDIO_FOLDER = "e4f5502a575543c684d75b6999aa6160"
SESSION = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def opener():
    """在目录访问与下载之间复用同一个游客会话。"""
    return SESSION


def request(path, data=None):
    """请求公开分享接口并验证业务状态。"""
    req = urllib.request.Request(
        API + path,
        data=json.dumps(data).encode("utf-8") if data is not None else None,
        headers={"User-Agent": USER_AGENT, "Referer": "https://pan.quark.cn/", "Content-Type": "application/json"},
    )
    with opener().open(req, timeout=35) as response:
        result = json.load(response)
    if result.get("code") != 0:
        raise RuntimeError(result.get("message", "网盘请求失败"))
    return result


def download(item, token):
    """下载一本绘本的原音，已有完整文件直接复用。"""
    number = int(re.match(r"(?:AA)?(\d+)", item["file_name"], re.I).group(1))
    relative = "assets/audio/aa-%03d.mp3" % number
    target = ROOT / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    record = {"number": number, "sourceName": item["file_name"], "duration": item.get("duration", 0), "path": relative}
    if target.exists() and target.stat().st_size == item["size"]:
        return record
    for attempt in range(3):
        try:
            result = request("file/share/download?pr=ucpro&fr=pc", {
                "pwd_id": SHARE_ID, "stoken": token, "fids": [item["fid"]], "fids_token": [item["share_fid_token"]],
            })
            req = urllib.request.Request(result["data"][0]["download_url"], headers={"User-Agent": USER_AGENT, "Referer": "https://pan.quark.cn/"})
            with opener().open(req, timeout=60) as response:
                content = response.read()
            if len(content) != item["size"]:
                raise RuntimeError("音频长度与源文件不一致")
            target.write_bytes(content)
            print("Audio %03d ready" % number, flush=True)
            return record
        except Exception as error:
            if attempt == 2:
                print("Audio %03d failed: %s" % (number, error), flush=True)
                return dict(record, path=None, error=str(error))
            time.sleep(2 * (attempt + 1))


def main():
    """分页读取 AA 音频并输出可复用的本地清单。"""
    token = request("share/sharepage/token?pr=ucpro&fr=pc", {"pwd_id": SHARE_ID, "passcode": ""})["data"]["stoken"]
    items = []
    for page in (1, 2):
        query = urllib.parse.urlencode({"pr": "ucpro", "fr": "pc", "pwd_id": SHARE_ID, "stoken": token, "pdir_fid": AUDIO_FOLDER, "_page": page, "_size": 100, "_sort": "file_type:asc,file_name:asc"})
        items.extend(request("share/sharepage/detail?" + query)["data"]["list"])
    files = [item for item in items if item.get("file") and re.match(r"(?:AA)?\d+.*\.mp3$", item["file_name"], re.I)]
    files = [item for item in files if int(re.match(r"(?:AA)?(\d+)", item["file_name"], re.I).group(1)) <= 100]
    # 下载必须复用读取目录时取得的游客会话，独立线程会丢失目录校验 Cookie。
    records = sorted((download(item, token) for item in files), key=lambda item: item["number"])
    (ROOT / "data").mkdir(exist_ok=True)
    (ROOT / "data/audio-index.json").write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
    print("Completed %d / %d audio files" % (sum(bool(row["path"]) for row in records), len(records)), flush=True)


if __name__ == "__main__":
    main()
