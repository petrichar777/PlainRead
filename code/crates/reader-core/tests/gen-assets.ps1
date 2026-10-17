# 生成 reader-core 测试语料（tests/assets/）。
# 运行：pwsh -File crates/reader-core/tests/gen-assets.ps1  （在 code/ 目录下）
# 语料是二进制敏感的（GBK/GB18030/Big5/UTF-16LE），用脚本生成保证字节正确，
# 不要用编辑器手工改这些文件。
$ErrorActionPreference = "Stop"
# Windows PowerShell 5.1（.NET Framework）内置 GBK/GB18030/Big5，无需 CodePagesEncodingProvider

$dir = Join-Path $PSScriptRoot "assets"
New-Item -ItemType Directory -Force -Path $dir | Out-Null

# ── 简体多章语料（chapters-* 五份共用同一内容，交叉验证各编码解码一致）──
$chapters = @"
书名：二十四节气
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
"@

$utf8 = [System.Text.UTF8Encoding]::new($false)

# 1. UTF-8 无 BOM（基准语料）
[System.IO.File]::WriteAllBytes((Join-Path $dir "chapters-utf8.txt"), $utf8.GetBytes($chapters))

# 2. UTF-8 带 BOM
[System.IO.File]::WriteAllBytes((Join-Path $dir "chapters-utf8-bom.txt"), $utf8.GetPreamble() + $utf8.GetBytes($chapters))

# 3. GBK（老网文站最常见）
[System.IO.File]::WriteAllBytes((Join-Path $dir "chapters-gbk.txt"), [System.Text.Encoding]::GetEncoding("GBK").GetBytes($chapters))

# 4. UTF-16LE 带 BOM（Windows 记事本"另存为"）
[System.IO.File]::WriteAllBytes((Join-Path $dir "chapters-utf16le.txt"), [System.Text.Encoding]::Unicode.GetPreamble() + [System.Text.Encoding]::Unicode.GetBytes($chapters))

# 5. GB18030（含 4 字节区字符 㐀 U+3400，GBK 编不了它）
$gb18030Text = $chapters.Replace("二十四节气", "节气考㐀")
[System.IO.File]::WriteAllBytes((Join-Path $dir "chapters-gb18030.txt"), [System.Text.Encoding]::GetEncoding("GB18030").GetBytes($gb18030Text))

# ── 6. Big5 繁体多章语料 ──
$big5 = @"
書名：二十四節氣
作者：測試語料

第一章　驚蟄
　　夜裡下起了雨，屋簷滴水到天明。
　　雷聲在遠處滾過，像誰在搬動舊傢俱。

第二章　春分
　　天亮了，院子裡的杏花開了一半。
　　孩子們在田埂上追風箏，線軸轉得飛快。

第三章　清明
　　上墳去，山路濕滑，松針的味道很重。
　　燒過的紙灰打著旋兒飛起來，又落下。

第四章　穀雨
　　種瓜點豆的季節，母親在園子裡彎腰。
　　她說，土地不會騙人，你待它幾分，它還你幾分。

第五章　立夏
　　天熱了，蟬在樹上試嗓子。
　　夜晚變短，夢境變長。
"@
[System.IO.File]::WriteAllBytes((Join-Path $dir "chapters-big5.txt"), [System.Text.Encoding]::GetEncoding("big5").GetBytes($big5))

# ── 7. 无章节长文（含"第一章/数字编号"误判陷阱行）──
$prose = @"
　　镇子的东头有一口老井，没有人说得清它是哪一年凿成的。
第一章的传说在村口流传了很多年，没有人能给出确切的出处，老人们只是反复讲。
1937年春天，镇上来了个说书人，他挑着一副担子，担子两头各挂一盏灯笼。
他说天下的故事本来只有三百个，讲来讲去，不过是换个人名换个地方。
　　听书的人不信，他们说光是本朝的事就够讲三百年。
3.5 毫米厚的账本，记着全镇三十年间的婚丧嫁娶，纸页黄脆，一碰就掉渣。
　　井边的青苔在雨季疯长，冬天又缩回去，像一句没说完的话。
　　我小时候总想把一块石头扔进去，听听最深处的水声。
　　祖母拦住我，说井里住着一位过世的秀才，扔石头会惊动他读书。
　　秀才留下过一部手稿，讲的是二十四节气与人的运数，后来在破四旧那年烧了。
　　烧书的火堆旁站着一圈人，没有一个人说话，火光把每张脸都照成了铜色。
　　从那以后，镇上的孩子识字，先学会的都是"水"和"井"这两个字。
　　我离开那年，老井边装了手压泵，井台用水泥抹平，青苔再也长不出来了。
　　许多年后我回去，泵已经锈死，水泥裂开缝，缝里又有了一线青苔。
　　它到底还是在长。有些东西和节气一样，你以为它结束了，它只是绕了个弯。
"@
[System.IO.File]::WriteAllText((Join-Path $dir "prose-no-chapters.txt"), $prose, $utf8)

Write-Host "generated:"
Get-ChildItem $dir | ForEach-Object { "{0}  {1} bytes" -f $_.Name, $_.Length }
