"""A 级资料的书名、编号和来源文件匹配规则。"""

import pathlib
import re

# 编号 98、99 分别有普通绘本和 Benchmark 绘本，单独标识以免覆盖。
BENCHMARK_IDS = {"fruits": "a-098-benchmark", "igo": "a-099-benchmark"}
# 这些音频文件名存在可核对的拼写错误，使用原编号与绘本标题双重确认。
AUDIO_NAME_FIXES = {"i see my colprs": "I See My Colors", "go fiy a kite": "Go Fly a Kite", "icn": "I Can", "snile": "Smile"}


def normalized(value):
    """忽略空格和标点后比较英文书名。"""
    return re.sub(r"[^a-z0-9]", "", value.lower())


def describe(path):
    """解析原始文件名，返回稳定编号与书名。"""
    filename = pathlib.Path(path).stem
    match = re.match(r"A-(\d+)-+", filename, re.I)
    if not match:
        raise ValueError("无法识别绘本编号：" + filename)
    number = int(match.group(1))
    name = filename[match.end():].replace("书本-", "").replace("Benchmark Books-", "").replace("\uf025", "?")
    if number == 12:
        name = "Spring Weather"
    is_benchmark = "Benchmark Books" in filename
    book_id = BENCHMARK_IDS.get(normalized(name)) if is_benchmark else "a-%03d" % number
    if not book_id:
        raise ValueError("未识别的 Benchmark 绘本：" + filename)
    return {"id": book_id, "number": number, "title": name, "benchmark": is_benchmark}


def audio_title(filename):
    """解析音频文件名，修正已确认的四处拼写错误。"""
    title = re.sub(r"^\d+\s*", "", pathlib.Path(filename).stem).strip()
    return AUDIO_NAME_FIXES.get(title.lower(), title)
