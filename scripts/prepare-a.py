"""将 A 级绘本和测试卡整理为可直接部署的静态资源。"""

import argparse
import importlib.util
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("prepare_aa", ROOT / "scripts/prepare-books.py")
prepare_aa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare_aa)
spec = importlib.util.spec_from_file_location("a_books", ROOT / "scripts/a-books.py")
a_books = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a_books)

# 中文名称只作辅助，逐页英文原文来自对应 PDF。
TITLES = "池塘动物|我的小狗|大猫|森林|妈妈和我|谁住在这里？|动物宝宝|我爱花朵|仓鼠的家|哦，浣熊|小鸟回家|春天的天气|蔬菜|水果的颜色|你好，蝴蝶|自然中的形状|春天和秋天|暴风雨|兔子|蛇的颜色|我看到的颜色|鸟儿的颜色|睡前数数|卡洛斯数小猫|玛丽亚数南瓜|这只昆虫|万圣节南瓜|-|去不同的地方|我们来烘焙|我的复活节彩蛋|我的万圣节|万圣节房子|感恩节的味道|摸起来|去哪里|汽车的部件|水中的乐趣|我画一只兔子|圣代时间|尝起来|我听到了什么？|购物中心|各种各样的纽扣|做一份沙拉|动起来|我们的公寓楼|这是我的小熊|写字！|听起来|吃鸡蛋的时间|看起来|-|我的房间|小鱼看见了|去放风筝|他跑起来|玛丽亚去上学|卡洛斯去上学|我能做到|穿衣服|这些鞋子|我喜欢的东西|我爱海盗|游行|我做梦|干净与不干净|用积木搭建|我的家|微笑|让我笑一笑|我来摆餐桌|我存钱|我的身体|什么让我快乐？|我的头发|运动员|友好与不友好|安全与不安全|你会跳舞|我会滑冰|我的小弟弟|肌肉|爸爸和我|送给妈妈|我的脸|各种各样的脸|祖父母真棒|我们能发出声音|里面和外面|上面和下面|谁拿着它？|闻起来|反义词|热与冷|圣诞饼干|他们躲在哪里|这只蜥蜴|可怕与不可怕|-".split("|")
BENCHMARK_TITLES = {"a-098-benchmark": "水果", "a-099-benchmark": "我出发"}
# 分类由绘本主题决定，不以文件编号推断音频对应关系。
ANIMALS = {1, 2, 3, 5, 6, 7, 9, 10, 11, 15, 19, 20, 22, 24, 26, 55, 98}
NATURE = {4, 8, 12, 13, 14, 16, 17, 18, 27, 31, 38, 56}
COLORS = {21}
NUMBERS = {23, 25}
CONCEPTS = {35, 41, 50, 52, 67, 78, 79, 90, 91, 93, 94, 95, 97, 99}


def category(book):
    """根据主题返回与 AA 书架一致的分类。"""
    if book["id"] == "a-098-benchmark":
        return "nature"
    if book["id"] == "a-099-benchmark":
        return "life"
    number = book["number"]
    if number in ANIMALS:
        return "animals"
    if number in NATURE:
        return "nature"
    if number in COLORS:
        return "colors"
    if number in NUMBERS:
        return "numbers"
    if number in CONCEPTS:
        return "concepts"
    return "life"


def card_paths(book, output, encoder, metadata_only):
    """按编号查找配套测试卡，Benchmark 无匹配卡时不展示。"""
    if book["benchmark"]:
        return []
    cards = list((ROOT / "A-测试卡").glob("A-%02d-*.pdf" % book["number"]))
    if len(cards) != 1:
        return []
    doc = prepare_aa.pdfium.PdfDocument(str(cards[0]))
    text = " ".join(doc[index].get_textpage().get_text_range() for index in range(len(doc)))
    if a_books.normalized(book["title"]) not in a_books.normalized(text):
        doc.close()
        return []
    paths = []
    for index in range(len(doc)):
        page = doc[index]
        width, height = page.get_size()
        # 原版测试卡每页为四宫格，拆开后手机上也能读清文字。
        rects = [(0, height / 2, width / 2, height), (width / 2, height / 2, width, height), (0, 0, width / 2, height / 2), (width / 2, 0, width, height / 2)]
        for part, rect in enumerate(rects, 1):
            target = output / ("card-%02d-%d.jpg" % (index + 1, part))
            prepare_aa.render(page, rect, target, encoder, 900, skip=metadata_only)
            paths.append(target.relative_to(ROOT).as_posix())
    doc.close()
    return paths


def prepare(metadata_only=False):
    """核验级别、裁切原版图文并输出独立 A 级书目。"""
    encoder = prepare_aa.WindowsJpeg() if prepare_aa.os.name == "nt" else None
    audio_file = ROOT / "data/audio-a-index.json"
    audio = {row["id"]: row for row in json.loads(audio_file.read_text(encoding="utf-8"))} if audio_file.exists() else {}
    files = sorted((ROOT / "A-书本").glob("*.pdf"), key=lambda file: (a_books.describe(file)["number"], file.name))
    books = []
    issues = []
    for file in files:
        info = a_books.describe(file)
        doc = prepare_aa.pdfium.PdfDocument(str(file))
        first_text = "\n".join(doc[index].get_textpage().get_text_range() for index in range(min(2, len(doc))))
        levels = re.findall(r"Level\s+([a-z0-9]+)\s+(?:Leveled|Benchmark)", first_text, re.I)
        if not levels or any(level.lower() != "a" for level in levels):
            issues.append({"id": info["id"], "source": file.name, "reason": "原文不是可核验的 A 级绘本"})
            doc.close()
            continue
        output = ROOT / "assets/books" / info["id"]
        output.mkdir(parents=True, exist_ok=True)
        cover_page = doc[0]
        width, height = cover_page.get_size()
        cover_rect = (width / 2, 0, width, height) if width > height else (0, height / 2, width, height)
        prepare_aa.render(cover_page, cover_rect, output / "cover.jpg", encoder, 540, skip=metadata_only)
        pages = []
        source_pages = []
        for index in range(len(doc)):
            page = doc[index]
            width, height = page.get_size()
            if index < 2:
                target = output / ("source-%d.jpg" % (index + 1))
                prepare_aa.render(page, (0, 0, width, height), target, encoder, 1200, skip=metadata_only)
                source_pages.append(target.relative_to(ROOT).as_posix())
                continue
            rects = [(0, 0, width / 2, height), (width / 2, 0, width, height)] if width > height else [(0, height / 2, width, height), (0, 0, width, height / 2)]
            textpage = page.get_textpage()
            chars = prepare_aa.characters(textpage)
            for rect in rects:
                rotation = 180 if width < height and rect[1] == 0 else 0
                caption_chars = chars
                if info["id"] in ("a-086", "a-095"):
                    # 正文在页面底部，插图内部的文字标注不应混入句子或裁切范围。
                    fraction = 0.20 if info["id"] == "a-086" else 0.40
                    boundary = rect[3] - (rect[3] - rect[1]) * fraction if rotation else rect[1] + (rect[3] - rect[1]) * fraction
                    caption_chars = [item for item in chars if item[3] >= boundary] if rotation else [item for item in chars if item[3] <= boundary]
                caption = prepare_aa.page_caption(caption_chars, rect, rotation)
                if not caption:
                    issues.append({"id": info["id"], "sourcePage": index + 1, "reason": "半页无可提取正文"})
                    continue
                current = len(pages) + 1
                image_path = output / ("page-%02d.jpg" % current)
                prepare_aa.render(page, rect, image_path, encoder, rotation=rotation, skip=metadata_only)
                boxes = [box for char, box, size, baseline in caption_chars if prepare_aa.inside(box, rect) and size >= 9 and char.strip()]
                top = max((box[3] for box in boxes), default=rect[1])
                bottom = min((box[1] for box in boxes), default=rect[3])
                art_rect = (rect[0] + 12, rect[1] + 12, rect[2] - 12, min(rect[3] - 12, bottom - 12)) if rotation else (rect[0] + 12, max(rect[1] + 12, top + 12), rect[2] - 12, rect[3] - 12)
                if info["id"] == "a-094":
                    # 这本书的正文直接标注在图片中，保留完整图片供阅读。
                    art_rect = (rect[0] + 12, rect[1] + 36, rect[2] - 12, rect[3] - 12) if not rotation else (rect[0] + 12, rect[1] + 12, rect[2] - 12, rect[3] - 36)
                if art_rect[3] - art_rect[1] < (rect[3] - rect[1]) * 0.30:
                    issues.append({"id": info["id"], "sourcePage": index + 1, "reason": "正文位置特殊，练习图需核对"})
                art_path = output / ("art-%02d.jpg" % current)
                prepare_aa.render(page, art_rect, art_path, encoder, 720, rotation=rotation, skip=metadata_only)
                pages.append({"number": current, "text": caption, "image": image_path.relative_to(ROOT).as_posix(), "art": art_path.relative_to(ROOT).as_posix(), "words": prepare_aa.vocabulary(caption), "sourcePage": index + 1})
            textpage.close()
        words = []
        for page in pages:
            for word in page["words"]:
                if not any(item["word"].lower() == word["word"].lower() for item in words):
                    words.append(word)
        entry = audio.get(info["id"], {})
        audio_path = entry.get("path") or ("assets/audio/%s.mp3" % info["id"] if (ROOT / ("assets/audio/%s.mp3" % info["id"])).exists() else None)
        cards = card_paths(info, output, encoder, metadata_only)
        # 这两本的插图标注直接包含答案，使用原版测试卡进行亲子交流。
        books.append({"id": info["id"], "number": info["number"], "title": info["title"], "chineseTitle": BENCHMARK_TITLES.get(info["id"], TITLES[info["number"] - 1]), "category": category(info), "level": "A", "cover": (output / "cover.jpg").relative_to(ROOT).as_posix(), "pages": pages, "words": words, "audio": audio_path, "duration": entry.get("duration", 0), "sourceName": file.name, "sourcePages": source_pages, "parentCards": cards, "quizEnabled": info["id"] not in ("a-086", "a-094"), "credits": "© Learning A–Z · www.readinga-z.com"})
        if not cards:
            issues.append({"id": info["id"], "reason": "没有与本书对应的原版测试卡"})
        print("Book %s: %d pages" % (info["id"], len(pages)), flush=True)
        doc.close()
    ids = [book["id"] for book in books]
    if len(ids) != len(set(ids)):
        raise RuntimeError("A 级绘本 ID 重复，已停止写入书目")
    js = "window.RAZ_LIBRARY.books = window.RAZ_LIBRARY.books.concat(" + json.dumps(books, ensure_ascii=False, separators=(",", ":")) + ");\n"
    (ROOT / "data/catalog-a.js").write_text(js, encoding="utf-8")
    missing_numbers = [number for number in range(1, 101) if not any(book["number"] == number for book in books)]
    # 两本 Benchmark 绘本在 PDF 和音频中使用不同编号，必须按标题识别。
    numbering_notes = [{"audioNumber": 28, "bookId": "a-098-benchmark", "title": "Fruits"}, {"audioNumber": 53, "bookId": "a-099-benchmark", "title": "I Go"}]
    report = {"sourceFiles": len(files), "bookCount": len(books), "readingPages": sum(len(book["pages"]) for book in books), "audioAvailable": sum(bool(book["audio"]) for book in books), "cardsAvailable": sum(bool(book["parentCards"]) for book in books), "missingNumberedSources": missing_numbers, "numberingNotes": numbering_notes, "missingBookTitles": ["I Push"], "issues": issues}
    (ROOT / "data/source-a-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print("Prepared %d books; %d issues" % (len(books), len(issues)), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--metadata-only", action="store_true", help="复用已生成的图片，仅更新数据")
    parser.add_argument("--cards-only", action="store_true", help="仅重新生成测试卡图片，不覆盖书目")
    args = parser.parse_args()
    if args.cards_only:
        encoder = prepare_aa.WindowsJpeg() if prepare_aa.os.name == "nt" else None
        for file in sorted((ROOT / "A-书本").glob("*.pdf")):
            info = a_books.describe(file)
            output = ROOT / "assets/books" / info["id"]
            output.mkdir(parents=True, exist_ok=True)
            paths = card_paths(info, output, encoder, False)
            if paths:
                print("Cards %s: %d" % (info["id"], len(paths)), flush=True)
    else:
        prepare(args.metadata_only)
