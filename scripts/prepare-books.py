"""将原版双页 PDF 整理为静态绘本数据与 JPEG 页面。"""

import argparse
import ctypes
import ctypes.wintypes
import json
import os
import pathlib
import re
import sys
import uuid

ROOT = pathlib.Path(__file__).resolve().parent.parent
# 优先使用本地安装的依赖；Codex 环境中的 PDFium 也可直接复用。
sys.path.insert(0, str(ROOT / ".tools/python"))
try:
    import pypdfium2 as pdfium
except ImportError:
    bundled = pathlib.Path(os.environ.get("USERPROFILE", "")) / ".cache/codex-runtimes/codex-primary-runtime/dependencies/python/Lib/site-packages"
    sys.path.append(str(bundled))
    import pypdfium2 as pdfium

# 中文书名用于家长辅助与搜索，英文正文始终取自原版 PDF。
CHINESE_TITLES = "农场动物|出发，出发！|跳过去|宠物|草原动物|雨林动物|海岸|水|春天|夏天|秋天到了|冬天|海洋|植物|小鸡|这些鸟儿|童话王国下雨了|丛林朋友|动物打盹|彩色的蛋|紫色|黄色|蓝色|绿色|橙色|红色|白色|黑色|一|二|三|四|五|六|七|八|九|十|十一|十二|数虫子|一只昆虫|数字母|街道|城市街道|城市|游乐场|平安夜|我的光明节|太多糖果|学校午餐|情人节礼物|意大利面|送给妈妈的礼物|花园|玩球吧|棒球比赛|旅行|超市|动物园|学校|教室|夏令营|夏日野餐|邮局|书店|坐飞机|地铁|在湖边|后院|我的校车|菲多穿衣服|摘苹果|我的衣柜|生日派对|表达爱|这间厨房|我的浴室|玩具|我们来建造|我们去露营|堡垒|我的花园|这本书|我的复活节|妈妈|看电影|我的家人|晚安|有趣的猫|大的|小的|在下面|在上面|在里面|在外面|离开|越过|市场|这些是反义词".split("|")
# 只收录适合启蒙的常用词义，避免将词典中的生僻或不适龄释义展示给孩子。
WORDS = dict(item.split(":", 1) for item in """
dog:小狗|pig:小猪|chicken:小鸡|goat:山羊|cow:奶牛|horse:马|sheep:绵羊|duck:鸭子|cat:小猫|bird:鸟|rabbit:兔子|fish:鱼|frog:青蛙|turtle:乌龟|mouse:老鼠|hamster:仓鼠|snake:蛇|fox:狐狸|elephant:大象|giraffe:长颈鹿|lion:狮子|zebra:斑马|crocodile:鳄鱼|ostrich:鸵鸟|monkey:猴子|parrot:鹦鹉|tiger:老虎|bear:熊|wolf:狼|bug:小虫|insect:昆虫|butterfly:蝴蝶|bee:蜜蜂|ant:蚂蚁|spider:蜘蛛|ladybug:瓢虫|beetle:甲虫|dragonfly:蜻蜓|caterpillar:毛毛虫|animal:动物|pet:宠物|bunny:兔子|puppy:小狗|kitten:小猫|nap:打盹|sleep:睡觉|jump:跳|go:去；出发|run:跑|swim:游泳|fly:飞|walk:走|hop:蹦跳|climb:爬|play:玩|build:建造|rain:雨|water:水|ocean:海洋|sea:大海|coast:海岸|beach:沙滩|sand:沙子|shell:贝壳|rock:石头|wave:海浪|boat:小船|lake:湖|river:河流|pond:池塘|stream:小溪|snow:雪|ice:冰|sled:雪橇|snowman:雪人|winter:冬天|summer:夏天|spring:春天|fall:秋天|sun:太阳|sky:天空|cloud:云|wind:风|tree:树|leaf:树叶|leaves:树叶|flower:花|grass:草|plant:植物|seed:种子|root:根|stem:茎|fruit:水果|apple:苹果|orange:橙色；橙子|pear:梨|banana:香蕉|grape:葡萄|egg:蛋|red:红色|yellow:黄色|blue:蓝色|green:绿色|purple:紫色|white:白色|black:黑色|pink:粉色|brown:棕色|color:颜色|one:一|two:二|three:三|four:四|five:五|six:六|seven:七|eight:八|nine:九|ten:十|eleven:十一|twelve:十二|count:数数|letter:字母|bed:床|pillow:枕头|window:窗户|book:书|chair:椅子|table:桌子|desk:书桌|door:门|room:房间|house:房子|roof:屋顶|floor:地板|wall:墙|car:汽车|bus:公交车|truck:卡车|bike:自行车|bicycle:自行车|train:火车|airplane:飞机|plane:飞机|subway:地铁|street:街道|city:城市|building:建筑|bridge:桥|school:学校|classroom:教室|playground:游乐场|slide:滑梯|swing:秋千|park:公园|garden:花园|zoo:动物园|store:商店|supermarket:超市|market:市场|bookstore:书店|post:邮寄|office:办公室|mail:邮件|letter:字母；信|box:盒子|bag:袋子|basket:篮子|ball:球|bat:球棒|baseball:棒球|game:游戏|toy:玩具|doll:娃娃|block:积木|kite:风筝|gift:礼物|present:礼物|party:派对|birthday:生日|cake:蛋糕|candle:蜡烛|sweet:糖果|candy:糖果|cookie:饼干|lunch:午餐|food:食物|pasta:意大利面|bread:面包|milk:牛奶|juice:果汁|cup:杯子|plate:盘子|bowl:碗|spoon:勺子|fork:叉子|pot:锅|pan:平底锅|sink:水槽|stove:炉灶|kitchen:厨房|bath:洗澡|tub:浴缸|soap:肥皂|towel:毛巾|brush:刷子|comb:梳子|toothbrush:牙刷|closet:衣柜|hat:帽子|shirt:衬衫|pants:裤子|shoe:鞋子|sock:袜子|dress:连衣裙|coat:外套|jacket:夹克|scarf:围巾|mitten:连指手套|boot:靴子|tie:领带|bow:蝴蝶结|belt:腰带|mom:妈妈|mother:妈妈|dad:爸爸|father:爸爸|sister:姐妹|brother:兄弟|baby:宝宝|family:家人|grandma:奶奶；外婆|grandpa:爷爷；外公|love:爱|hug:拥抱|kiss:亲吻|friend:朋友|hand:手|face:脸|eye:眼睛|ear:耳朵|nose:鼻子|mouth:嘴巴|foot:脚|feet:脚|big:大的|little:小的|small:小的|funny:有趣的|happy:快乐的|night:夜晚|moon:月亮|star:星星|under:在下面|over:越过|on:在上面|in:在里面|out:在外面|off:离开|up:向上|down:向下|tent:帐篷|camp:露营|camping:露营|picnic:野餐|fire:火|log:原木|stick:树枝|fort:堡垒|movie:电影|ticket:票|popcorn:爆米花|screen:屏幕|seat:座位|fairy:仙子|fairies:仙子|rainbow:彩虹|snail:蜗牛|mushroom:蘑菇|bush:灌木|fence:栅栏|gate:大门|bench:长椅|path:小路|computer:电脑|couch:长沙发|step:台阶|sofa:沙发|rug:地毯|mat:垫子|clock:钟|lamp:灯|light:灯光|rabbit:兔子|duckling:小鸭|chick:小鸡|nest:鸟巢|feather:羽毛|wing:翅膀|beak:鸟嘴|tail:尾巴|web:蜘蛛网|shark:鲨鱼|whale:鲸鱼|dolphin:海豚|crab:螃蟹|seal:海豹|octopus:章鱼|starfish:海星|seahorse:海马|jellyfish:水母|penguin:企鹅|deer:鹿|squirrel:松鼠|raccoon:浣熊|bat:蝙蝠；球棒|owl:猫头鹰|eagle:鹰|flamingo:火烈鸟|peacock:孔雀|toucan:巨嘴鸟|sloth:树懒|gorilla:大猩猩|hippo:河马|hippopotamus:河马|rhino:犀牛|rhinoceros:犀牛|camel:骆驼|lizard:蜥蜴|alligator:短吻鳄|puppies:小狗|children:孩子们|people:人们|man:男人|woman:女人|boy:男孩|girl:女孩|teacher:老师|student:学生|line:队伍；线|number:数字|heart:爱心|valentine:情人节礼物|christmas:圣诞节|easter:复活节|hanukkah:光明节|menorah:光明节烛台|dreidel:陀螺|latke:土豆饼|stocking:长袜|wreath:花环|santa:圣诞老人|snowflake:雪花|skate:溜冰鞋|swimsuit:泳衣|umbrella:雨伞|raincoat:雨衣|puddle:水坑|pool:泳池|hose:水管|sunscreen:防晒霜|shorts:短裤|sandals:凉鞋|acorn:橡子|pumpkin:南瓜|corn:玉米|carrot:胡萝卜|tomato:番茄|potato:土豆|lettuce:生菜|pea:豌豆|bean:豆子|pizza:披萨|sandwich:三明治|cheese:奶酪|salad:沙拉|soup:汤|meat:肉|rice:米饭|noodle:面条|pencil:铅笔|pen:钢笔|paper:纸|crayon:蜡笔|paint:颜料|backpack:书包|ruler:尺子|glue:胶水|scissors:剪刀|eraser:橡皮|board:黑板|flag:旗子|drum:鼓|guitar:吉他|bell:铃铛|rope:绳子|net:网|wheel:轮子|engine:发动机|pilot:飞行员|wing:翅膀；机翼|station:车站|track:轨道|tunnel:隧道|escalator:自动扶梯|map:地图|suitcase:行李箱|trip:旅行|backyard:后院|lemon:柠檬|grapefruit:西柚|peach:桃子|plum:李子|cherry:樱桃|strawberry:草莓|melon:甜瓜|watermelon:西瓜|donut:甜甜圈|lollipop:棒棒糖|chocolate:巧克力|jelly:果冻|frosting:糖霜|bubble:泡泡|duck:鸭子|robe:浴袍|pajama:睡衣|blanket:毯子|quilt:被子|teddy:泰迪熊|bear:熊|dinosaur:恐龙|robot:机器人|puzzle:拼图|wagon:小推车|scooter:滑板车|skateboard:滑板|shelf:架子|shelves:架子|bottle:瓶子|refrigerator:冰箱|oven:烤箱|dishwasher:洗碗机|microwave:微波炉|cabinet:橱柜|drawer:抽屉|counter:台面|shower:淋浴|bathtub:浴缸|mirror:镜子|toilet:马桶|faucet:水龙头|sponge:海绵|washcloth:小毛巾|hair:头发|toothpaste:牙膏|shampoo:洗发水|bread:面包|money:钱|cashier:收银员|cart:购物车|checkout:收银台|stamp:邮票|package:包裹|mailbox:信箱|envelope:信封|mailman:邮递员|mailbox:信箱|author:作者|page:页|cover:封面|picture:图片|story:故事|word:单词|read:读|reading:阅读|smile:微笑|help:帮助|share:分享|thank:感谢|give:给|show:展示|some:一些|many:许多|more:更多|good:好的|new:新的|old:旧的|long:长的|short:短的|tall:高的|hot:热的|cold:冷的|wet:湿的|dry:干的|fast:快的|slow:慢的|open:打开|closed:关着的
""".strip().split("|"))
# 这些功能词不作为独立词卡；它们仍完整保留在绘本原句中。
STOP_WORDS = set("the a an my your his her their our its is are am be this that these those to of and at it we i he she they you us me for with has have get gets do does not can see look here there all s t".split())
# 补齐原书中实际出现的生活词汇，全部采用适合当前启蒙场景的简明释义。
WORDS.update(dict(item.split(":", 1) for item in "leg:腿|balloon:气球|sunshine:阳光|dirt:泥土|shovel:铲子|hole:洞|geese:鹅|goose:鹅|helmet:头盔|field:田野；球场|cape:披风|kid:孩子|sidewalk:人行道|ladder:梯子|vegetable:蔬菜|art:美术|mud:泥巴|goldfish:金鱼|rainforest:雨林|cliff:悬崖|lighthouse:灯塔|rake:耙子|coral:珊瑚|seaweed:海草|dove:鸽子|hawk:鹰|crow:乌鸦|turkey:火鸡|jungle:丛林|colorful:五颜六色的|bucket:水桶|cab:出租车|sign:标志牌|vest:背心|moss:苔藓|forest:森林|sunset:日落|pepper:甜椒|radish:萝卜|igloo:冰屋|stage:舞台|sheet:床单|suit:套装|wand:魔杖|panda:熊猫|van:小型客车|glove:手套|worm:虫子|bull:公牛|cupcake:纸杯蛋糕|bar:条状糖果|apron:围裙|so:这么|head:头|body:身体|great:很棒的|taxi:出租车|noise:声音|sandbox:沙坑|meal:餐点|eggnog:蛋奶饮料|cream:奶油|pie:馅饼|napkin:餐巾|wide:宽的|thin:细的|curly:卷曲的|yummy:好吃的|day:一天|onion:洋葱|basketball:篮球|football:橄榄球|tennis:网球|soccer:足球|volleyball:排球|base:垒包|uniform:队服|team:球队|clothes:衣服|grandparent:祖父母；外祖父母|cereal:麦片|music:音乐|lunchroom:餐厅|library:图书馆|gym:体育馆|song:歌曲|fun:乐趣|worker:工作人员|scale:秤|helper:帮手|snack:小零食|stair:楼梯|time:时间|dock:码头|sweater:毛衣|sunglasses:太阳镜|mask:面具|farmer:农民|tractor:拖拉机|hanger:衣架|guest:客人|singing:唱歌|pat:轻拍|wink:眨眼|lick:舔|fridge:冰箱|cupboard:橱柜|toaster:烤面包机|jar:罐子|trash:垃圾|draw:画|saw:锯子|hammer:锤子|hang:悬挂|spot:位置|hoe:锄头|row:一排|front:前面的|back:后面的|title:标题|voice:声音|tuck:掖好被子|dark:黑暗|grandfather:爷爷；外公|grandmother:奶奶；外婆|glasses:眼镜|jam:果酱".split("|")))
# 固定搭配优先整体解释，避免把 ice cream 等词组拆成不符合画面的单词释义。
PHRASES = {"flip-flop": "人字拖", "ice pop": "冰棒", "ice cream": "冰淇淋", "ice skates": "溜冰鞋", "seat belt": "安全带", "page number": "页码", "post office": "邮局", "front cover": "封面", "back cover": "封底", "music room": "音乐教室", "art room": "美术教室"}
# A 级绘本新增的动作与方位词，释义按启蒙语境编写。
WORDS.update(dict(item.split(":", 1) for item in "shop:购物|mix:搅拌|pour:倒入|bake:烘焙|wait:等待|frost:涂糖霜|serve:端上|eat:吃|push:推|kick:踢|hit:打|pull:拉|nice:友好的|clap:拍手|snap:打响指|pop:发出砰声|tap:轻敲|rap:敲击|slap:拍打|stomp:跺脚|make:制造|sound:声音|hid:躲藏|inside:在里面|outside:在外面|below:在下方|above:在上方|between:在中间|behind:在后面|far:远|near:近|eyebrow:眉毛|cheek:脸颊|chin:下巴|knife:刀|quiet:安静的|loud:大声的|squeaky:吱吱响的|calm:平静的|silly:滑稽的|boring:无聊的".split("|")))


class WindowsJpeg:
    """使用系统 GDI+ 编码，避免当前环境必须额外安装 Pillow。"""

    def __init__(self):
        self.dll = ctypes.WinDLL("gdiplus")

        class Startup(ctypes.Structure):
            _fields_ = [("version", ctypes.c_uint32), ("callback", ctypes.c_void_p), ("no_thread", ctypes.c_int), ("no_codecs", ctypes.c_int)]

        self.token = ctypes.c_size_t()
        if self.dll.GdiplusStartup(ctypes.byref(self.token), ctypes.byref(Startup(1, None, 0, 0)), None):
            raise RuntimeError("GDI+ 初始化失败")
        self.encoder = (ctypes.c_ubyte * 16).from_buffer_copy(uuid.UUID("557cf401-1a04-11d3-9a73-0000f81ef32e").bytes_le)
        self.dll.GdipCreateBitmapFromScan0.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p)]
        self.dll.GdipSaveImageToFile.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p, ctypes.c_void_p, ctypes.c_void_p]
        self.dll.GdipDisposeImage.argtypes = [ctypes.c_void_p]

    def save(self, bitmap, path):
        """将 PDFium 的 BGRX 像素保存为浏览器兼容的 JPEG。"""
        image = ctypes.c_void_p()
        # PixelFormat32bppRGB 对应 PDFium 的 BGRX 排列。
        status = self.dll.GdipCreateBitmapFromScan0(bitmap.width, bitmap.height, bitmap.stride, 139273, ctypes.cast(bitmap.buffer, ctypes.c_void_p), ctypes.byref(image))
        if status:
            raise RuntimeError("创建位图失败：%d" % status)
        try:
            if self.dll.GdipSaveImageToFile(image, str(path.resolve()), ctypes.byref(self.encoder), None):
                raise RuntimeError("保存 JPEG 失败")
        finally:
            self.dll.GdipDisposeImage(image)


def clean(text):
    """合并原文换行，清理 PDF 中的软连字符与多余空格。"""
    collapsed = re.sub(r"\s+", " ", text.replace("\u00ad", "")).strip()
    return re.sub(r"\s+([.!?,;:])", r"\1", collapsed)


def characters(textpage):
    """读取真实字形坐标与字号，分开正文、页码和版权页脚。"""
    result = []
    heights = {}
    for index in range(textpage.count_chars()):
        char = textpage.get_text_range(index, 1)
        if char:
            box = textpage.get_charbox(index)
            x, y = ctypes.c_double(), ctypes.c_double()
            pdfium.raw.FPDFText_GetCharOrigin(textpage.raw, index, ctypes.byref(x), ctypes.byref(y))
            baseline = round(y.value, 1)
            if char.isalpha():
                heights[baseline] = max(heights.get(baseline, 0), box[3] - box[1])
            result.append((char, box, baseline))
    # 部分 PDF 用字号 1 配合变换矩阵排版，按实际字形高度识别正文更可靠。
    return [(char, box, heights.get(baseline, 0), baseline) for char, box, baseline in result]


def inside(box, rect):
    """按字形中心判断文字所属半页。"""
    x, y = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    return rect[0] <= x < rect[2] and rect[1] <= y < rect[3]


def page_caption(chars, rect, rotation=0):
    """只提取大字号原文，避免把页脚与页码带入学习句子。"""
    lines = {}
    for char, box, size, baseline in chars:
        if inside(box, rect) and size >= 9 and not char.isdigit() and char not in "\r\n":
            # PDFium 推测的零宽空格可能落在单词内部，原稿的真实空格仍保留。
            if char.isspace() and box[2] - box[0] < 0.5:
                continue
            lines.setdefault(baseline, []).append((char, (box[0] + box[2]) / 2))
    # 倒置拼版中的 PDF 文本对象不一定按阅读顺序存储，按转正后的实际位置排序。
    ordered = []
    for baseline in sorted(lines, reverse=rotation == 0):
        ordered.append("".join(char for char, x in sorted(lines[baseline], key=lambda item: item[1], reverse=rotation == 180)))
    return clean(" ".join(ordered))


def render(page, rect, target, encoder, width=800, rotation=0, skip=False):
    """按 PDF 坐标裁切真实页面并生成适合移动端的图片。"""
    if skip:
        if not target.exists():
            raise FileNotFoundError("仅更新数据时缺少既有图片：%s" % target)
        return
    page_width, page_height = page.get_size()
    view_rect = (page_width - rect[2], page_height - rect[3], page_width - rect[0], page_height - rect[1]) if rotation == 180 else rect
    crop = (view_rect[0], view_rect[1], page_width - view_rect[2], page_height - view_rect[3])
    bitmap = page.render(scale=width / (rect[2] - rect[0]), rotation=rotation, crop=crop, force_bitmap_format=pdfium.raw.FPDFBitmap_BGRx)
    if encoder:
        encoder.save(bitmap, target)
    else:
        bitmap.to_pil().save(target, quality=84, optimize=True)
    bitmap.close()


def vocabulary(text):
    """从正文提取可解释的关键词，保留原有拼写。"""
    found = []
    remaining = text
    for phrase, meaning in PHRASES.items():
        match = re.search(r"\b" + re.escape(phrase) + r"\b", remaining, re.I)
        if match:
            found.append({"word": match.group(), "meaning": meaning})
            remaining = remaining[:match.start()] + " " * len(match.group()) + remaining[match.end():]
    for word in re.findall(r"[A-Za-z]+(?:'[A-Za-z]+)?", remaining):
        lower = word.lower()
        if lower in STOP_WORDS:
            continue
        base = lower
        if base not in WORDS:
            for candidate in (lower[:-1], lower[:-2], lower[:-3] + "y"):
                if candidate in WORDS:
                    base = candidate
                    break
        if base in WORDS and not any(item["word"].lower() == lower for item in found):
            found.append({"word": word, "meaning": WORDS[base]})
    return found


def category(number):
    """按启蒙主题组织书架，不将阅读级别换算成年级。"""
    if 21 <= number <= 28:
        return "colors"
    if 29 <= number <= 43:
        return "numbers"
    if number in list(range(1, 7)) + [15, 16, 18, 19, 60, 90]:
        return "animals"
    if number in list(range(7, 15)) + [17, 20, 55, 69, 70, 73, 83]:
        return "nature"
    if 91 <= number <= 98:
        return "concepts"
    return "life"


def prepare(source, only=None, metadata_only=False):
    """生成已核实为 AA 级的绘本、页面与素材检查报告。"""
    encoder = WindowsJpeg() if os.name == "nt" else None
    books, issues = [], []
    audio_file = ROOT / "data/audio-index.json"
    audio = {row["number"]: row for row in json.loads(audio_file.read_text(encoding="utf-8"))} if audio_file.exists() else {}
    files = sorted(source.rglob("*.pdf"), key=lambda path: int(re.search(r"AA-(\d+)", path.name).group(1)))
    for file in files:
        number = int(re.search(r"AA-(\d+)", file.name).group(1))
        if only and number not in only:
            continue
        doc = pdfium.PdfDocument(str(file))
        first_text = "\n".join(doc[index].get_textpage().get_text_range() for index in range(min(2, len(doc))))
        levels = re.findall(r"Level\s+([a-z0-9]+)\s+(?:Leveled|Benchmark)", first_text, re.I)
        if not levels or any(level.lower() != "aa" for level in levels):
            issues.append({"number": number, "source": file.name, "reason": "源文件实际为 %s 级，未纳入 AA 绘本" % "/".join(sorted(set(levels))), "expectedTitle": CHINESE_TITLES[number - 1]})
            doc.close()
            continue
        book_id = "aa-%03d" % number
        output = ROOT / "assets/books" / book_id
        output.mkdir(parents=True, exist_ok=True)
        name = re.sub(r"^AA-\d+-\s*书本-", "", file.stem, flags=re.I)
        if number == 97:
            name = "Off"
        name = name[:1].upper() + name[1:]
        cover_page = doc[0]
        width, height = cover_page.get_size()
        # 横版 PDF 的封面位于右半页，竖版拼版的封面位于上半页。
        cover_rect = (width / 2, 0, width, height) if width > height else (0, height / 2, width, height)
        render(cover_page, cover_rect, output / "cover.jpg", encoder, 540, skip=metadata_only)
        pages = []
        source_pages = []
        for index in range(len(doc)):
            page = doc[index]
            width, height = page.get_size()
            if index < 2:
                target = output / ("source-%d.jpg" % (index + 1))
                render(page, (0, 0, width, height), target, encoder, 1200, skip=metadata_only)
                source_pages.append(target.relative_to(ROOT).as_posix())
                continue
            rects = [(0, 0, width / 2, height), (width / 2, 0, width, height)] if width > height else [(0, height / 2, width, height), (0, 0, width, height / 2)]
            textpage = page.get_textpage()
            chars = characters(textpage)
            for rect in rects:
                rotation = 180 if width < height and rect[1] == 0 else 0
                caption = page_caption(chars, rect, rotation)
                if not caption:
                    issues.append({"number": number, "sourcePage": index + 1, "reason": "半页无可提取正文，需核对"})
                    continue
                current = len(pages) + 1
                image_path = output / ("page-%02d.jpg" % current)
                # 竖版小册子的下半页倒置印刷，阅读时需要旋转 180 度。
                render(page, rect, image_path, encoder, rotation=rotation, skip=metadata_only)
                # 练习图裁掉原句和页脚，避免图片本身泄露选项答案。
                caption_boxes = [box for char, box, size, baseline in chars if inside(box, rect) and size >= 9 and char.strip()]
                caption_top = max((box[3] for box in caption_boxes), default=rect[1])
                caption_bottom = min((box[1] for box in caption_boxes), default=rect[3])
                art_rect = (rect[0] + 12, rect[1] + 12, rect[2] - 12, min(rect[3] - 12, caption_bottom - 12)) if rotation else (rect[0] + 12, max(rect[1] + 12, caption_top + 12), rect[2] - 12, rect[3] - 12)
                if art_rect[3] - art_rect[1] < (rect[3] - rect[1]) * 0.30:
                    issues.append({"number": number, "sourcePage": index + 1, "reason": "正文位置特殊，练习图需核对"})
                art_path = output / ("art-%02d.jpg" % current)
                render(page, art_rect, art_path, encoder, 720, rotation=rotation, skip=metadata_only)
                pages.append({"number": current, "text": caption, "image": image_path.relative_to(ROOT).as_posix(), "art": art_path.relative_to(ROOT).as_posix(), "words": vocabulary(caption), "sourcePage": index + 1})
            textpage.close()
        words = []
        for page in pages:
            for word in page["words"]:
                if not any(item["word"].lower() == word["word"].lower() for item in words):
                    words.append(word)
        raw_audio = audio.get(number, {})
        audio_path = raw_audio.get("path") or ("assets/audio/%s.mp3" % book_id if (ROOT / ("assets/audio/%s.mp3" % book_id)).exists() else None)
        books.append({"id": book_id, "number": number, "title": name, "chineseTitle": CHINESE_TITLES[number - 1], "category": category(number), "level": "AA", "cover": (output / "cover.jpg").relative_to(ROOT).as_posix(), "pages": pages, "words": words, "audio": audio_path, "duration": raw_audio.get("duration", 0), "sourceName": file.name, "sourcePages": source_pages, "credits": "© Learning A–Z · www.readinga-z.com"})
        print("Book %03d: %d reading pages" % (number, len(pages)), flush=True)
        doc.close()
    data = {"version": 1, "level": "AA", "books": books, "issues": issues}
    (ROOT / "data").mkdir(exist_ok=True)
    (ROOT / "data/catalog.js").write_text("window.RAZ_LIBRARY = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    (ROOT / "data/source-report.json").write_text(json.dumps({"sourceFiles": len(files), "bookCount": len(books), "readingPages": sum(len(book["pages"]) for book in books), "issues": issues}, ensure_ascii=False, indent=2), encoding="utf-8")
    print("Prepared %d books; %d issues" % (len(books), len(issues)), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", default="AA-书本", help="解压后的原始绘本目录")
    parser.add_argument("--only", help="仅处理指定编号，例如 1,2,97；完整发布时不要传入")
    parser.add_argument("--metadata-only", action="store_true", help="复用已有图片，仅更新正文与书目数据")
    args = parser.parse_args()
    prepare((ROOT / args.source).resolve(), [int(value) for value in args.only.split(",")] if args.only else None, args.metadata_only)
