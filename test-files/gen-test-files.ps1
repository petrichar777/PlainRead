# 生成 M1 人工导入测试语料（test-files/）。
# 运行：pwsh -File test-files/gen-test-files.ps1   （在仓库根目录或任意位置均可，用 $PSScriptRoot 定位）
# 语料是字节敏感的（GBK/GB18030/Big5/UTF-16LE），由脚本生成保证编码正确，不要手工编辑生成物；
# 生成物已通过 test-files/.gitignore 排除出版本库，需要时重新跑本脚本即可。
$ErrorActionPreference = "Stop"
# pwsh 7 (.NET) 需要注册代码页提供程序才有 GBK/GB18030/Big5；Windows PowerShell 5.1 内置，注册失败时忽略
try { [System.Text.Encoding]::RegisterProvider([System.Text.CodePagesEncodingProvider]::Instance) } catch {}

$root = $PSScriptRoot
$encGbk     = [System.Text.Encoding]::GetEncoding(936)     # GBK
$encGb18030 = [System.Text.Encoding]::GetEncoding(54936)   # GB18030
$encBig5    = [System.Text.Encoding]::GetEncoding(950)     # Big5
$encUtf16   = [System.Text.Encoding]::Unicode              # UTF-16LE
$encUtf8    = [System.Text.UTF8Encoding]::new($false)
$encUtf8Bom = [System.Text.UTF8Encoding]::new($true)

# ── 确定性伪随机（LCG）：每次生成的语料字节一致，便于回归对比 ──
$script:Rnd = 1
function Reset-Rand([int]$seed) { $script:Rnd = $seed }
function Next-Rand {
    $script:Rnd = ($script:Rnd * 1103515245 + 12345) -band 0x7FFFFFFF
    return $script:Rnd
}
function Get-RandomItem($list) { $list[(Next-Rand) % $list.Count] }

# ── 阿拉伯数字 → 中文数字（1..9999），如 1206 → 一千二百零六 ──
function ConvertTo-CnNum([int]$n) {
    $d = '零', '一', '二', '三', '四', '五', '六', '七', '八', '九'
    $u = '', '十', '百', '千'
    if ($n -eq 0) { return '零' }
    $out = ''
    $started = $false
    for ($i = 1000; $i -ge 1; $i = [int]($i / 10)) {
        $digit = [math]::Floor($n / $i) % 10
        if ($digit -eq 0) {
            if ($started -and -not $out.EndsWith('零')) { $out += '零' }
        }
        else {
            $out += $d[$digit] + $u[[int][math]::Log10($i)]
            $started = $true
        }
    }
    $out = $out -replace '零+$', ''
    $out = $out -replace '^一十', '十'
    return $out
}

# ── 简体语料池（全部为 GBK 可编码的常用字）──
$script:Sentences = @(
    "夜色像一匹浸了水的黑布，沉沉压在小城的屋脊上。",
    "他推开柴门，院内那株老槐树落了一地碎白。",
    "灶膛里的火还没熄，锅里温着半碗糙米粥。",
    "山道弯弯，挑担的汉子一步一喘，汗珠砸进黄土。",
    "风从北边来，带着麦秸和尘土的气味。",
    "檐下的灯笼晃了晃，光影在墙上摇成一片碎金。",
    "她低头补衣，针脚细密，像要把日子缝得结实些。",
    "远处传来打更声，三长两短，是老周头的手艺。",
    "井台边围了几个人，议论着昨夜山那头的火光。",
    "学堂里书声琅琅，先生背着手的影子映在窗纸上。",
    "雨点先砸在瓦上，噼啪几声，继而连成一片。",
    "狗叫了两声，又趴回门槛，把下巴搁在爪子上。",
    "货郎的拨浪鼓从巷口一路响到巷尾。",
    "账房的算盘响得急，像一场下不完的冰雹。",
    "船家收了篙，竹筏顺水漂进芦苇深处。",
    "老太太数着佛珠，一颗，又一颗，数到天亮。",
    "马蹄声碎，驿道上扬起一线黄尘。",
    "药铺的柜台上摆着一杆小秤，秤砣乌黑发亮。",
    "戏台上的锣鼓停了，看客们还仰着脖子等。",
    "雪下了一夜，清早推门，天地白得晃眼。",
    "铁匠铺的炉火映红半条街，锤声当当作响。",
    "渡口的人渐渐多了，船老大扯着嗓子招呼。",
    "孩子们追着纸鸢跑过田埂，笑声惊起一滩鸥鹭。",
    "他把信折成方胜，塞进贴身的衣袋。",
    "夜航船的灯像一粒豆，浮在墨一样的水面上。",
    "粮行的伙计扛着麻包，踩着跳板咯吱作响。",
    "老槐树的影子一寸寸挪过青石板，日头偏西了。",
    "她把去年的桂花糖封进陶罐，留到来年冬至。",
    "更夫的梆子敲过四更，天边泛起蟹壳青。",
    "长街尽头，卖馄饨的挑子冒着白汽。"
)
$script:Titles = @(
    "风起", "云涌", "夜行", "归途", "断桥", "孤灯", "惊雷", "旧事", "故人", "远山",
    "寒潭", "春汛", "秋决", "雪霁", "渡口", "客栈", "残局", "火种", "暗河", "初雪",
    "蝉鸣", "霜降", "灯市", "棋局", "铁马", "药炉", "雁字", "雨巷", "竹影", "坐忘"
)

# ── 繁体语料池（Big5 可编码）──
$big5Sentences = @(
    "夜色像一匹浸了水的黑布，沉沉壓在小城的屋脊上。",
    "他推開柴門，院裡那株老槐樹落了一地碎白。",
    "灶膛裡的火還沒熄，鍋裡溫著半碗糙米粥。",
    "山道彎彎，挑擔的漢子一步一喘，汗珠砸進黃土。",
    "風從北邊來，帶著麥秸和塵土的氣味。",
    "簷下的燈籠晃了晃，光影在牆上搖成一片碎金。",
    "她低頭補衣，針腳細密，像要把日子縫得結實些。",
    "遠處傳來打更聲，三長兩短，是老周頭的手藝。",
    "井臺邊圍了幾個人，議論著昨夜山那頭的火光。",
    "學堂裡書聲琅琅，先生背著手的影子映在窗紙上。"
)
$big5Titles = @("風起", "雲湧", "夜行", "歸途", "斷橋", "孤燈", "驚雷", "舊事", "故人", "遠山")

$script:paraSeq = 0
function New-Paragraph {
    $count = 3 + ((Next-Rand) % 3)   # 每段 3-5 句
    $parts = for ($i = 0; $i -lt $count; $i++) { Get-RandomItem $script:Sentences }
    return "　　" + ($parts -join "")
}

# ── 多章长篇正文生成器（仿网文排版：书名/作者行 + 章标题 + 缩进段落）──
function New-NovelText {
    param(
        [string]$Title,
        [string]$Author,
        [int]$Chapters,
        [int]$ParasPerChapter,
        [string]$Newline = "`n",          # 默认 LF；GBK 老书传 "`r`n" 更真实
        [switch]$ArabicNum                # 章号用阿拉伯数字（"第3章"）而非中文数字
    )
    $sb = [System.Text.StringBuilder]::new()
    [void]$sb.Append("书名：$Title").Append($Newline)
    [void]$sb.Append("作者：$Author").Append($Newline).Append($Newline)
    for ($i = 1; $i -le $Chapters; $i++) {
        $num = if ($ArabicNum) { "$i" } else { ConvertTo-CnNum $i }
        # 注意：必须写 ${num}，否则 PowerShell 会把 "$num章" 解析成名为 "num章" 的中文变量
        [void]$sb.Append("第${num}章　$(Get-RandomItem $script:Titles)").Append($Newline)
        for ($p = 0; $p -lt $ParasPerChapter; $p++) {
            [void]$sb.Append((New-Paragraph)).Append($Newline)
            if (($p % 3) -eq 2) { [void]$sb.Append($Newline) }   # 段间偶尔空行
        }
        [void]$sb.Append($Newline)
    }
    return $sb.ToString()
}

# 繁体多章正文（单独的小生成器，池子不同）
function New-Big5NovelText {
    param([string]$Title, [string]$Author, [int]$Chapters, [int]$ParasPerChapter)
    $sb = [System.Text.StringBuilder]::new()
    [void]$sb.Append("書名：$Title").Append("`n").Append("作者：$Author").Append("`n`n")
    for ($i = 1; $i -le $Chapters; $i++) {
        [void]$sb.Append("第$(ConvertTo-CnNum $i)章　$(Get-RandomItem $big5Titles)").Append("`n")
        for ($p = 0; $p -lt $ParasPerChapter; $p++) {
            $count = 3 + ((Next-Rand) % 3)
            $parts = for ($k = 0; $k -lt $count; $k++) { Get-RandomItem $big5Sentences }
            [void]$sb.Append("　　" + ($parts -join "")).Append("`n")
        }
        [void]$sb.Append("`n")
    }
    return $sb.ToString()
}

function Write-Text([string]$path, [string]$text, [System.Text.Encoding]$enc) {
    [System.IO.File]::WriteAllText($path, $text, $enc)
}

New-Item -ItemType Directory -Force -Path $root | Out-Null

# ══════════════ 一、编码系列（对应验收：GBK 老书无乱码 / 四种编码解码正确）══════════════

# 1. GBK 老书，CRLF 换行 —— 模拟十年前老网文站下载、Windows 记事本转存的典型文件
Reset-Rand 1001
$text = New-NovelText -Title "镖行旧事" -Author "佚名" -Chapters 12 -ParasPerChapter 8 -Newline "`r`n"
Write-Text (Join-Path $root "编码-01-GBK老书-CRLF.txt") $text $encGbk

# 2. GB18030，含 4 字节区生僻字（GBK 编不了 㐀䶵𠀀，能区分 GBK 与 GB18030 探测）
Reset-Rand 1002
$text = New-NovelText -Title "节气考㐀" -Author "测试语料" -Chapters 12 -ParasPerChapter 8
$text = $text -replace '灶膛里的火还没熄', "灶膛里的火还没熄，梁上栖着一只䶵，梦里游过一条𠀀。"
Write-Text (Join-Path $root "编码-02-GB18030生僻字.txt") $text $encGb18030

# 3. Big5 繁体
Reset-Rand 1003
$text = New-Big5NovelText -Title "鏢行舊事" -Author "測試語料" -Chapters 12 -ParasPerChapter 8
Write-Text (Join-Path $root "编码-03-Big5繁体.txt") $text $encBig5

# 4. UTF-16LE 带 BOM（Windows 记事本"另存为 Unicode"）
Reset-Rand 1004
$text = New-NovelText -Title "夜航西行" -Author "测试语料" -Chapters 12 -ParasPerChapter 8
$utf16bytes = $encUtf16.GetPreamble() + $encUtf16.GetBytes($text)
[System.IO.File]::WriteAllBytes((Join-Path $root "编码-04-UTF16LE-BOM.txt"), $utf16bytes)

# 5. UTF-8 带 BOM
Reset-Rand 1005
$text = New-NovelText -Title "夜航东归" -Author "测试语料" -Chapters 12 -ParasPerChapter 8
Write-Text (Join-Path $root "编码-05-UTF8-BOM.txt") $text $encUtf8Bom

# ══════════════ 二、章节切分（对应验收：切分正确 / L4 兜底 / 正文含"第一章"不误判）══════════════

# 6. 混合标记风格 —— 观察用：L1/L2/L3 各类标记混排，看切分器实际行为
$mixed = @"
书名：标记风格图鉴
作者：测试语料

楔子
　　这是楔子里的一段话，用来观察"楔子"这类无编号标记是否被识别为章节。

第一章　风起
　　镇子东头有一口老井，没有人说得清它是哪一年凿成的。
　　井沿的绳痕深了一寸又一寸，像年轮。

第二章　云涌
　　风从北边来，带着麦秸和尘土的气味。
　　货郎的拨浪鼓从巷口一路响到巷尾，又响回去。

第3章　夜行
　　阿拉伯数字章号是网文最常见的写法之一。
　　檐下的灯笼晃了晃，光影在墙上摇成一片碎金。

第四回　灯市
　　"回"是章回体旧小说的单位，混进现代文里考验切分器的兼容性。
　　戏台上的锣鼓停了，看客们还仰着脖子等。

Chapter 5 The Ferry
　　英文章号也应被 L1 认出。
　　渡口的人渐渐多了，船老大扯着嗓子招呼。

五、归途
　　这一行是 L2 风格：数字 + 顿号。
　　马蹄声碎，驿道上扬起一线黄尘。

尾声
　　尾声与楔子一样，考验无编号首尾标记。
　　更夫的梆子敲过四更，天边泛起蟹壳青。

第一章讲了什么已经不重要了，重要的是大家还愿意坐在一起喝茶。
　　上一行以"第一章"开头，但余文有句末标点，不应被误判为新章节。
第二回演出时台下坐满了人，连过道里都站着孩子。
　　上一行同理，"第二回"后面跟的是正文。
"@
Write-Text (Join-Path $root "章节-06-混合标记风格.txt") $mixed $encUtf8

# 7. 无章节散文 —— L4 兜底：切不出任何章节，has_real_chapters 应为 false
Reset-Rand 1007
$prose = [System.Text.StringBuilder]::new()
[void]$prose.Append("书名：井与节气").Append("`n").Append("作者：测试语料").Append("`n`n")
$proseParas = @(
    "　　镇子的东头有一口老井，没有人说得清它是哪一年凿成的。第一章的传说在村口流传了很多年，没有人能给出确切的出处，老人们只是反复讲。",
    "　　1937年春天，镇上来了个说书人，他挑着一副担子，担子两头各挂一盏灯笼。他说天下的故事本来只有三百个，讲来讲去，不过是换个人名换个地方。",
    "　　3.5 毫米厚的账本，记着全镇三十年间的婚丧嫁娶，纸页黄脆，一碰就掉渣。2026.1.1 那天，账本被锁进了樟木箱。",
    "　　井边的青苔在雨季疯长，冬天又缩回去，像一句没说完的话。我小时候总想把一块石头扔进去，听听最深处的水声。",
    "　　祖母拦住我，说井里住着一位过世的秀才，扔石头会惊动他读书。秀才留下过一部手稿，讲的是二十四节气与人的运数，后来在破四旧那年烧了。",
    "　　烧书的火堆旁站着一圈人，没有一个人说话，火光把每张脸都照成了铜色。从那以后，镇上的孩子识字，先学会的都是水和井这两个字。",
    "　　我离开那年，老井边装了手压泵，井台用水泥抹平，青苔再也长不出来了。许多年后我回去，泵已经锈死，水泥裂开缝，缝里又有了一线青苔。",
    "　　它到底还是在长。有些东西和节气一样，你以为它结束了，它只是绕了个弯。"
)
for ($round = 0; $round -lt 8; $round++) {
    foreach ($p in $proseParas) { [void]$prose.Append($p).Append("`n`n") }
}
Write-Text (Join-Path $root "章节-07-无章节散文-L4兜底.txt") ($prose.ToString() -replace '第一章的传说', '开头的传说') $encUtf8

# 8. 正文误判陷阱 —— 有真章节，但正文里散布"第一章/第三章"开头的句子，全部不应被误判
$trap = @"
书名：误判陷阱
作者：测试语料

第一章　惊蛰
　　夜里下起了雨，屋檐滴水到天明。
　　雷声在远处滚过，像谁在搬动旧家具。

第二章　春分
　　天亮了，院子里的杏花开了一半。
　　孩子们在田埂上追风筝，线轴转得飞快。

第三章　清明
　　上坟去，山路湿滑，松针的味道很重。
　　烧过的纸灰打着旋儿飞起来，又落下。

第四章　谷雨
　　种瓜点豆的季节，母亲在园子里弯腰。
　　她说，土地不会骗人，你待它几分，它还你几分。

第五章　立夏
　　天热了，蝉在树上试嗓子。
　　夜晚变短，梦境变长。

第一章讲了什么，其实开篇第一段已经交代清楚了。
　　上一行以"第一章"开头且无句末标点前缀，但余文太长，不应判为标题。
第三章的谜底留到最后才揭晓，这是说书人的规矩。
　　"第三章"后面紧跟"的"字领起的正文，有句末标点，不应判为标题。
第二回演出时台下坐满了人，连过道里都站着孩子，卖瓜子的老汉挤不进来。
　　"第二回"后接长正文，不应判为标题。以上陷阱行都应留在原文所在章节内。
"@
Write-Text (Join-Path $root "章节-08-正文误判陷阱.txt") $trap $encUtf8

# ══════════════ 三、边界样本（对应 M5 预验收：不崩溃且有提示）══════════════

# 9. 0 字节
[System.IO.File]::WriteAllBytes((Join-Path $root "边界-09-空文件.txt"), [byte[]]::new(0))

# 10. 只有一行、无换行符
Write-Text (Join-Path $root "边界-10-单行无换行.txt") "只有一行，结尾没有换行符，夜里下雨。" $encUtf8

# 11. 全乱码 —— 随机字节（GBK/Big5 引导字节 + ASCII 混杂），编码识别必然失败
$bytes = [byte[]]::new(128KB)
$rng = [System.Random]::new(20261011)
for ($i = 0; $i -lt $bytes.Length; $i++) {
    $r = $rng.NextDouble()
    if ($r -lt 0.45) { $bytes[$i] = $rng.Next(0x81, 0xFF) }   # 双字节引导区，落点随机即乱码
    elseif ($r -lt 0.9) { $bytes[$i] = $rng.Next(0x20, 0x7F) } # 可读 ASCII 夹杂
    else { $bytes[$i] = $rng.Next(0, 256) }
}
[System.IO.File]::WriteAllBytes((Join-Path $root "边界-11-全乱码.txt"), $bytes)

# ══════════════ 四、重复导入对（对应验收：content_hash 命中提示"疑似重复"）══════════════

Reset-Rand 1012
$text = New-NovelText -Title "同一场雨" -Author "测试语料" -Chapters 10 -ParasPerChapter 10
Write-Text (Join-Path $root "重复导入-12-原版.txt") $text $encUtf8
Write-Text (Join-Path $root "重复导入-13-改名重传版.txt") $text $encUtf8   # 字节完全相同，仅文件名不同

# ══════════════ 五、大体量（对应验收：10MB 导入界面不冻结、进度条推进、内存增量 < 100MB）══════════════

# 14. UTF-8 约 10MB，1200 章，中文数字章号
Reset-Rand 1014
$text = New-NovelText -Title "凡人修真录" -Author "测试语料" -Chapters 1200 -ParasPerChapter 34
Write-Text (Join-Path $root "长篇-14-凡人修真录-UTF8.txt") $text $encUtf8

# 15. GBK 约 10MB，1800 章，阿拉伯数字章号（GBK 下 10MB ≈ 500 万字，比 UTF-8 版字数更多）
Reset-Rand 1015
$text = New-NovelText -Title "星海征途" -Author "测试语料" -Chapters 1800 -ParasPerChapter 34 -ArabicNum
Write-Text (Join-Path $root "长篇-15-星海征途-GBK.txt") $text $encGbk

# 16. UTF-16LE 约 2MB，中篇
Reset-Rand 1016
$text = New-NovelText -Title "都市夜行手记" -Author "测试语料" -Chapters 350 -ParasPerChapter 36
$utf16bytes = $encUtf16.GetPreamble() + $encUtf16.GetBytes($text)
[System.IO.File]::WriteAllBytes((Join-Path $root "中篇-16-都市夜行手记-UTF16LE.txt"), $utf16bytes)

# ══════════════ 六、书架规模 200 本（对应验收：200 本规模滚动流畅）══════════════

$shelfDir = Join-Path $root "书架200本"
New-Item -ItemType Directory -Force -Path $shelfDir | Out-Null
for ($b = 1; $b -le 200; $b++) {
    Reset-Rand (9000 + $b)
    $title = "书架测试{0:D3}·{1}" -f $b, (Get-RandomItem $script:Titles)
    $text = New-NovelText -Title $title -Author "批量语料 $b" -Chapters 8 -ParasPerChapter 8
    Write-Text (Join-Path $shelfDir ("{0:D3}-{1}.txt" -f $b, $title)) $text $encUtf8
}

Write-Host "`ngenerated:"
Get-ChildItem $root -File | ForEach-Object { "{0}  {1:N0} bytes" -f $_.Name, $_.Length }
$shelf = Get-ChildItem $shelfDir -File
"书架200本/  {0} 个文件，共 {1:N0} bytes" -f $shelf.Count, ($shelf | Measure-Object Length -Sum).Sum
