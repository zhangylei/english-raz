"""按书名核对并下载 A 级原音，音频不在网站运行时请求网盘。"""

import importlib.util
import json
import pathlib
import re
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("audio_aa", ROOT / "scripts/download-audio.py")
audio_aa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audio_aa)
spec = importlib.util.spec_from_file_location("a_books", ROOT / "scripts/a-books.py")
a_books = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a_books)
# 夸克分享内的 A 级音频目录。
AUDIO_FOLDER = "a0ebbe968dd341e3ac9e83c661699067"


def download(item, token, book):
    """使用目录会话下载音频，验证完整大小后写入静态资源。"""
    relative = "assets/audio/%s.mp3" % book["id"]
    target = ROOT / relative
    record = {"id": book["id"], "title": book["title"], "sourceName": item["file_name"], "duration": item.get("duration", 0), "path": relative}
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and target.stat().st_size == item["size"]:
        return record
    for attempt in range(3):
        try:
            result = audio_aa.request("file/share/download?pr=ucpro&fr=pc", {"pwd_id": audio_aa.SHARE_ID, "stoken": token, "fids": [item["fid"]], "fids_token": [item["share_fid_token"]]})
            request = urllib.request.Request(result["data"][0]["download_url"], headers={"User-Agent": audio_aa.USER_AGENT, "Referer": "https://pan.quark.cn/"})
            with audio_aa.opener().open(request, timeout=60) as response:
                content = response.read()
            if len(content) != item["size"]:
                raise ValueError("下载大小与原文件不一致")
            target.write_bytes(content)
            print("Audio %s ready" % book["id"], flush=True)
            return record
        except Exception as error:
            if attempt == 2:
                print("Audio %s failed: %s" % (book["id"], error), flush=True)
                return dict(record, path=None, error=str(error))
            time.sleep(2 * (attempt + 1))


def main():
    """按标题建立一对一匹配，记录缺失或歧义而非猜测。"""
    token = audio_aa.request("share/sharepage/token?pr=ucpro&fr=pc", {"pwd_id": audio_aa.SHARE_ID, "passcode": ""})["data"]["stoken"]
    query = urllib.parse.urlencode({"pr": "ucpro", "fr": "pc", "pwd_id": audio_aa.SHARE_ID, "stoken": token, "pdir_fid": AUDIO_FOLDER, "_page": 1, "_size": 100, "_fetch_total": 1, "_sort": "file_type:asc,file_name:asc"})
    items = audio_aa.request("share/sharepage/detail?" + query)["data"]["list"]
    matches = {}
    for item in items:
        if item.get("file") and re.search(r"\.mp3$", item["file_name"], re.I):
            matches.setdefault(a_books.normalized(a_books.audio_title(item["file_name"])), []).append(item)
    files = sorted((ROOT / "A-书本").glob("*.pdf"), key=lambda file: (a_books.describe(file)["number"], file.name))
    records = []
    for file in files:
        book = a_books.describe(file)
        candidates = matches.get(a_books.normalized(book["title"]), [])
        if len(candidates) != 1:
            records.append({"id": book["id"], "title": book["title"], "path": None, "error": "音频未找到或标题不唯一"})
            continue
        records.append(download(candidates[0], token, book))
    (ROOT / "data/audio-a-index.json").write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
    print("Completed %d / %d audio files" % (sum(bool(row["path"]) for row in records), len(records)), flush=True)


if __name__ == "__main__":
    main()
