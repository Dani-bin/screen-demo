# 02 调研

> 业务调研回答"屏上该有什么"，视觉调研回答"这些东西怎么摆"。每条结论标来源，没有来源的标"假设"。
>
> 业务调研由子代理在阶段 1 期间完成（2026-10-20，检索走百度 + curl 抓正文，正文 [n] 对应文末来源）；场地与公开数据、视觉调研见后文。

## 业务调研

### 1. 规模分档（内蒙古）

**家庭牧场**
- 政策口径：人均草场 3000 亩以上的牧户发展家庭牧场；1000–3000 亩的户搞联户牧场；不足 1000 亩的户以入股方式组建合作社。2024 年试点计划新建家庭牧场 2445 个、智慧牧场 418 个 [4]。
- 鄂温克旗按"基础母羊 ≥300 只或 ≥300 羊单位"统计家庭牧场，全旗共 1038 家 [5]。
- 案例：鄂托克旗一户 600 多只羊、6000 亩草场；同旗另一户 800 多只山羊（含羔）只有 1 人照看 [2]。苏尼特左旗一户年出栏 400 多只羊，以前每年雇羊倌约 5 万元 [3]。东乌旗智慧牧场 42.4 万亩、55 户、3 万头只，折合每户约 7700 亩、约 545 头只 [1]。
- 劳力一般 1–3 人（假设，只有上面个案可佐证）。

**合作社 / 联户**
- 新巴尔虎右旗芒来嘎查股份合作社：65 户 173 人，草场 27.8 万亩，牲畜 5605 头只（羊 5377、牛 228）；暖季划区轮牧，冷季集中舍饲；2024 年营收 440.87 万元 [6]。
- 正蓝旗好牧人合作社：4 户、5 万余亩天然草场，另有 8500 亩饲料地，储草 1.3 万吨 [7]。
- 专职劳力人数没查到（假设）。

**旗县级平台**
- 呼伦贝尔市智慧畜牧业数据平台：2025 年给 20 万只羊打耳标，覆盖牧业四旗 33 个嘎查、422 户；2026 年扩到 100 万只 [8]。
- 鄂温克旗平台：应登记牧户 7123 户，分布在 44 个嘎查 [9]。鄂尔多斯市 80 多个牧场装了北斗放牧系统 [10]。
- 规模参照：锡林郭勒盟春季休牧草原 2.2 亿多亩 [48]；全区牲畜约 1.4 亿头只 [56]。

### 2. 监控对象与指标

**项圈 / 耳标**
- 定位上报默认 1 小时一次、可远程改 [13]；也有产品每 5 分钟采集一次 [18]。Nofence 本机判断越界：靠近边界时每秒定位数次，离边界远时几秒一次 [16]。
- 定位精度 5–10 m [14]，部分产品 5–50 m [54]。
- 电池 3000–20000 mAh，续航 1–3 年，多数带太阳能 [13][14][15]；Nofence 连续阴天靠储电：牛项圈约 120 天、羊项圈约 60 天，App 可看每个项圈电量 [16]。
- 羊多是只给头羊戴项圈、按群管理 [3][10]，所以大屏上羊以"群"为单位显示（推论）。
- 日行走：绵羊、山羊平均 6–9 km/天，最高 11 km（澳洲牧场数据）[17]；牛的数字存疑。

**虚拟围栏 / 走失**
- 先放提示音，不回头才放电脉冲；Nofence 称圈住率 99.7%，牲畜 4–7 天学会 [16]。
- 围栏下发延迟 1 小时到 3 天 [19]；Vence 一个基站覆盖 5000–10000 英亩 [20]。
- 告警：越界、离群、异常活动，App 弹窗，可按轨迹追回 [11][23]。

**饮水点**：光伏提水 [24]；手机远程放水，劳动强度降低 20–30% [23]；棚圈监测水质 [3]。水位、流量阈值无公开标准（假设）。

**称重**：自动称重系统 [1]、AI 称重分群 [12]；鄂尔多斯绒山羊羔羊日增重约 150 g [25]。

**棚圈环境**：温度、湿度、氨气、CO₂ [3][27]；冬季产羔舍 ≥10 ℃，一般羊舍 ≥0 ℃ [26]。

**草场遥感**
- 用 NDVI 的对数做线性模型估产草量，精度 86% [36]。
- 锡林郭勒盟 6 月干草产量 26.04 kg/亩、草高 11.58 cm、盖度 30.33% [34]；包头 6 月 82.42 kg/亩 [35]；全区综合植被盖度 46.48% [33]。
- 1 羊单位 = 1 只 45 kg 成年绵羊，日食标准干草 1.8 kg；通行折算 1 牛 = 5 羊单位、1 马 = 6、1 驴 = 3 [28]（未核对 NY/T 635-2015 原表）。
- 载畜能力：赛罕区暖季 25.83 亩/羊单位、冷季 39.17 亩/羊单位 [29]；阿荣旗暖季 5.74 亩/羊单位 [30]。
- 草畜平衡指数 =（实际载畜量 − 合理载畜量）÷ 合理载畜量 × 100% [32]；内蒙古以 ≤10% 为"不过牧"，2025 年全区达标 [33]。
- 罚款：超载每羊单位 100 元；休牧期或禁牧区放牧每羊单位 120 元 [31]。

**灾害**
- 白灾：每年 3 个高峰（11 月、2 月、4 月）；按冬春降雪量达常年同期 120% / 140% / 160% 分轻 / 中 / 重 [37]。
- 黑灾：冬季无雪缺水；连续无积雪 20–40 天轻、41–60 天中、60 天以上重 [38]。
- 防火期 3/15–6/15、9/15–11/15；乌兰察布以西 9/15 到次年 6/15 [39]。
- 旱灾、沙尘、雷电指标没查到（假设）。

**防疫**：春防 3 月到 5 月中下旬，秋防 9 月到 11 月中下旬 [40]；强制免疫口蹄疫（春秋各一次）、小反刍兽疫（春季）、布病、包虫病，应免密度 100%、抗体合格率 ≥70% [40]；种畜禁止布病免疫 [41]；药浴每年两次：7 月初、9 月下旬到 10 月初 [42]。

**繁育**：冬羔 12–2 月出生（7–9 月配种），春羔 3–5 月出生 [43]；察哈尔羊配种 10/1 前结束、接羔次年 3/1 前结束 [42]；冬羔、早春羔比重目标 ≥75%，可提前 2–3 个月出栏 [4]，巴林右旗冬羔售价约高 20% [44]；母牛 16–18 月龄、体重 ≥360 kg 初配，产后 60 天内再发情最理想 [45]。

**无人机 / 视频 / 人员**：无人机识别牲畜数量、对比核定载畜量判断超载 [49]，也用于驱赶转场 [12]；360° 全景摄像头 24 小时监控 [23]；全区护林员、草管员 4.68 万名 [50]。

**出栏与溯源**：一羊一码 [8]；溯源羊肉每公斤贵 2–3 元 [3]；锡林浩特 9 月出栏 [55]。

### 3. 季节作业日历（以锡林郭勒为例）

| 月份 | 作业 |
|---|---|
| 1–2 月 | 接冬羔，舍饲和补饲；2 月是白灾高峰 |
| 3 月 | 3/15 进入防火期，春防开始 |
| 4–5 月 | 春季休牧（不少于 45 天 [31]；锡林浩特 2026 年 4/5–5/19，只限牛羊 [46]；每羊单位每天备草 1.8 kg，活动场地 ≤20 m² [47]）；产春羔；4/1–5/31 防火戒严期 [39] |
| 6 月 | 下旬剪毛 [42]，牧草长势监测 [34] |
| 7–8 月 | 药浴、夏秋放牧抓膘、冬羔母羊配种；打草约 8 月（假设） |
| 9–10 月 | 秋防、秋季药浴、10/1 前配种结束、出栏 |
| 11–12 月 | 转入冬营地，舍饲补饲，开始接冬羔；11 月白灾高峰 |

轮牧模式：暖季划区轮牧，冷季舍饲 [6]。

### 4. 已有产品与项目

- 巴林右旗"智慧牧管"App + 苏木指挥中心：牲畜分布、草场状态、气象预警、生成轮牧方案和转场节点、调度越冬饲草配送 [11]。
- 东乌旗"生态云"：远程饮水、自动喂料、自动称重、视频、定位 [1]。
- 呼伦贝尔平台（呼伦贝尔移动技术支撑）：溯源、过境牲畜监管 [8]。
- 中农智联北斗牧寻：项圈 + 太阳能中继站 [54]；视动世纪草原畜牧平台 [51]。
- Halter：太阳能项圈、虚拟围栏和远程赶牛换场、草场长势与质量、健康告警，自称牧场"数字孪生"，按 m²/头或 kgDM/头分配草场 [21]。
- Gallagher eShepherd：Moving Fence、Heatmaps、NBmesh 自组网，称重、水位附加模块 [22]。
- Nofence：牛羊通用，LTE-M + 项圈间组网，放牧热力图 [16]。Vence（Merck）：基站模式，主打划区轮牧 [20]。

### 5. 同类大屏参考（整屏）

- 视动世纪"牧区一张图"：草场生态、牲畜存栏、放牧轨迹、防疫进度、溯源、产业统计 [51]。
- 图扑 HT（舍饲场景）：2D + 3D；左上"身份管理"点一下镜头飞到那头牛并弹详情，右上追溯按钮 [52]。
- 青海河南县平台：生态体检、草畜平衡、生态治理、灾害预警四模块，点地图任意一点查植被和土壤 [53]。
- 苏尼特右旗牧场现场屏：温度、湿度、CO₂、公畜数、母畜数 [27]。
- 三维场景占屏比例没找到截图依据（假设）。

### 6. 使用者每天要做的判断

- **场长 / 生产主管**：哪群该转场、何时转 [11]；草够不够吃、是否超载 [49]；冬季补饲怎么安排 [1]；哪个饮水点没水或该修 [23]；越界、走失的牲畜去哪找 [11]；降温降雪前要做什么准备 [11]；防疫是否漏打（推论）。
- **领导 / 访客**：草畜平衡指数是否 ≤10%、植被盖度 [33]；存栏和出栏；溯源溢价 [3]；牧民增收（芒来合作社社员分红最高 23 万元 [4]）。

### 关键数字速查表

| 指标 | 单位 | 典型值 | 来源 |
|---|---|---|---|
| 1 羊单位 | 日食干草 | 45 kg 绵羊，1.8 kg/天 | [28] |
| 1 牛折算 | 羊单位 | 5 | [28] |
| 暖季 / 冷季载畜能力 | 亩/羊单位 | 25.83 / 39.17（呼市赛罕区）；暖季 5.74（阿荣旗） | [29][30] |
| 6 月干草产量 | kg/亩 | 26（锡盟）～ 82（包头） | [34][35] |
| 草畜平衡指数目标 | % | ≤10 | [33] |
| 休牧期 | 天 | ≥45 | [31] |
| 超载 / 休牧期放牧罚款 | 元/羊单位 | 100 / 120 | [31] |
| 项圈上报间隔 | 分钟 | 5–60 | [13][18] |
| 项圈续航 | 年 | 1–3 | [13][14][15] |
| 定位精度 | m | 5–10 | [14] |
| 羊日行走 | km | 6–9 | [17] |
| 冬羔、早春羔比重目标 | % | ≥75 | [4] |
| 春防 / 秋防 | 月 | 3–5 / 9–11 | [40] |
| 防火期 | 日期 | 3/15–6/15，9/15–11/15 | [39] |
| 家庭牧场门槛 | 亩/人 | ≥3000 | [4] |

### 查不到 / 存疑

1. 牛的日行走距离：1.68 km（山地，百度文库）和"≥5 km"（厂商宣传）两种说法，可信度都低。
2. "1 牛 = 5 羊单位"是百科转述，没核对 NY/T 635-2015 原表（可能按体重细分）。
3. 草畜平衡指数的分级阈值（超载 / 严重超载）没查到原文。
4. 水位、流量告警阈值，旱灾、沙尘、雷电指标，打草日期，合作社劳力人数，均无来源。
5. 羊舍氨气 ≤20 mg/m³ 只有百度文库一个出处。
6. 没找到能用的草原放牧大屏整屏截图。

### 来源

[1] https://sdxw.iqilu.com/share/YS0yMS0xNDIyNjQxMQ.html
[2] https://m.thepaper.cn/newsDetail_forward_3881723
[3] http://journal.crnews.net/nmwz/2016n/dsyq/914944_20161101113352.html
[4] http://nmt.nmg.gov.cn/villageDevelopment/DProu/zdgzdt_rou/202501/P020250121552655671385.pdf
[5] https://www.ewenke.gov.cn/OpennessGazette/show/3279.html
[6] http://nmt.nmg.gov.cn/gk/zfxxgk/fdzdgknr/rdjy/202511/t20251111_2815772.html
[7] https://nmj.xlgl.gov.cn/nmj/nmxw/nmdt/2024011616133086933/index.html
[8] https://swt.nmg.gov.cn/tznmg2/tznmg_zwb/xwdt/202509/t20250929_2797994.html ；http://www.nmg.xinhuanet.com/20260717/c41d2b5dfc124e74816c5ae5f3dff407/c.html
[9] https://www.hlbe.gov.cn/News/show/1377846.html
[10] http://www.beidou.gov.cn/yw/xwzx/202512/t20251218_29211.html
[11] http://lcj.nmg.gov.cn/lckj/202512/t20251217_2835713.html
[12] https://www.wulanchabu.gov.cn/zzq1/1963757.html
[13] https://baijiahao.baidu.com/s?id=1747096552796443955
[14] https://wd.nongji360.com/product/view?id=105112&dmname=shop62405230
[15] https://baike.baidu.com/item/%E6%99%BA%E8%83%BD%E9%A1%B9%E5%9C%88/68048252
[16] https://www.nofence.com/en-gb/faq ；https://www.nofence.com/en-gb/how-it-works
[17] https://www.sciencedirect.com/author/34772309000/mark-g-trotter
[18] https://baijiahao.baidu.com/s?id=1833438561840882718
[19] https://extension.arizona.edu/publication/what-virtual-fence-basics-virtual-fencing-system
[20] https://vence.io/
[21] https://www.halterhq.com/beef
[22] https://eshepherd.com/
[23] https://www.szwq.gov.cn/szwqaccb/szwqyw/1828459.html
[24] https://www.nmg.gov.cn/ztzl/tjlswdrw/nxcpsc/202401/t20240102_2435319.html
[25] https://news.sohu.com/a/1087724006_121106854
[26] https://mp.weixin.qq.com/s?__biz=MzU4NzM5MDM0MA==&mid=2247502566&idx=3&sn=c44c1af3df5e2477b87368cb56e60f49
[27] https://baijiahao.baidu.com/s?id=1805167191230637243
[28] https://baike.baidu.com/item/合理载畜量的家畜单位/6017177
[29] http://www.huhhot.gov.cn/hhht_zfgb/shq/2025/202502/202601/t20260105_1965214.html
[30] http://www.arq.gov.cn/News/show/1433948.html
[31] http://lcj.nmg.gov.cn/flfg/zzq/202601/t20260107_2846115.html
[32] https://baike.baidu.com/item/%E8%8D%89%E5%8E%9F%E8%BD%BD%E7%95%9C%E9%87%8F/2368840
[33] https://www.nmg.gov.cn/zwyw/gzdt/bmdt/202606/t20260622_2918268.html
[34] http://lcj.nmg.gov.cn/xxgk/zxzx/202507/t20250707_2754342.html
[35] http://lcj.nmg.gov.cn/ztzl/ztzl_gtlh/gtlh_gzdt/202507/t20250708_2755118.html
[36] https://www.cnki.com.cn/Article/CJFDTotal-SDGC202405006.htm
[37] https://www.cma.gov.cn/kppd/kppdqxyr/kppdnyqx/201211/t20121124_191862.html ；https://www.cma.gov.cn/2011xzt/20120816/2012081601_2_1/201208160101/201210/t20121025_188234.html
[38] https://baike.baidu.com/item/黑灾/6138771
[39] https://www.nmg.gov.cn/zwgk/zfxxgk/zfxxgkml/zdly/aqsc/wj/202603/t20260313_2873830.html ；https://www.nmg.gov.cn/zwgk/zfxxgk/zfxxgkml/zzqzfjbgtwj/202503/t20250303_2675165.html
[40] http://www.wltqq.gov.cn/zfxxgk/fdzdgknrwltqq/zcjd/202604/t20260403_217320.html
[41] http://nmj.huhhot.gov.cn/zwdt/nmdt/202603/t20260306_1981352.html
[42] http://nmt.nmg.gov.cn/yw/nszd/xlgl/202209/t20220928_2142340.html
[43] https://easylearn.baidu.com/edu-page/tiangong/bgkdetail?id=8a40b478a26925c52dc5bf00
[44] https://baijiahao.baidu.com/s?id=1853622287728484162
[45] http://nmt.nmg.gov.cn/zzb/msdt/202506/t20250611_2738391.html
[46] https://nyj.xlgl.gov.cn/eportal/ui?pageId=7dfeba9c50f34f2fa42c1e26da88caeb&articleKey=a8e1ad7de113487894daecd6c9ebd6da&columnId=d8d5653a38ed47e8aa7f19fa3c1dd43d
[47] https://scjgj.xlgl.gov.cn/eportal/ui?pageId=6d4a786c2987477a9497764e53c05a6a&articleKey=8605e7f6574547919a03737b2a69152b&columnId=d6e85a3bf0d54c35b3d183d0c217a21e
[48] https://scjgj.xlgl.gov.cn/eportal/ui?pageId=c649bb70d4034db8b16e66b249ea5c92&articleKey=9238fec295474f25b1842880072a26d6&columnId=70a18865540a4f1ea2986e4a61c1cb69
[49] http://finance.sina.cn/2025-10-20/detail-infupeft5465514.d.html
[50] https://zrzy.nmg.gov.cn/xwdt/zrzybdt/202506/t20250603_2732977.html
[51] https://baijiahao.baidu.com/s?id=1874125097475935997
[52] https://cloud.tencent.com/developer/article/2290442
[53] https://www.qhhnnews.com/wmkhn/2019-05-20/1993.html
[54] https://baijiahao.baidu.com/s?id=1815228336470109390 ；https://news.sohu.com/a/811584153_120953657
[55] http://grassland.china.com.cn/2020-10/06/content_41317546.html
[56] http://slt.nmg.gov.cn/slh/szyw_25460/202408/t20240805_2550983.html

## 场地与数据

> 场地调研子代理（2026-10-20）：数据覆盖用官方 API / STAC 实测，取景框高差用 Open-Meteo 高程 API（Copernicus 90 m）10×10 采样，放牧痕迹目视判读（中国候选用 Esri 影像只作调研浏览，不进产品）。用户已在阶段 1 选定"真实中国草原"，美国 / 新西兰候选只作记录。

### 中国北方草原的公开数据

| 数据 | 分辨率 | 获取 | 许可 / 署名 | 来源 |
|---|---|---|---|---|
| Copernicus GLO-30（DSM） | 30 m | AWS 公开桶 `s3://copernicus-dem-30m`，COG，免账号；内蒙古瓦片已确认存在 | 可免费分发，署名 "© DLR e.V. 2010-2014 and © Airbus…" | https://registry.opendata.aws/copernicus-dem/ |
| AW3D30 v4.1（DSM） | 30 m | Planetary Computer `alos-dem` 免注册 | 商用、非商用都免费 | https://www.eorc.jaxa.jp/ALOS/en/dataset/aw3d30/aw3d30_e.htm |
| NASADEM | 30 m | Planetary Computer 免登录 | CC0 | https://www.earthdata.nasa.gov/engage/open-data-services-software-policies/data-use-guidance |
| Sentinel-2 L2A | 10 m，约 5 天一景 | Earth Search STAC + COG 免登录 | 允许复制、分发、公开展示、修改，注明 "Contains modified Copernicus Sentinel data [年]" | https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice |
| ESA WorldCover | 10 m 地类 | Planetary Computer | CC BY 4.0 | https://planetarycomputer.microsoft.com/api/stac/v1/collections/esa-worldcover |

- 都能脚本下载，但没有"按 bbox 一次导出"的服务，要用 rasterio 按窗口读 COG；`scripts/smart-mine/fetch_data.py` 只用 urllib + Pillow，需另写下载器。
- 更高分辨率的中国影像许可都不适合做成沙盘贴图：天地图要 Key，缓存 / 烘焙条款不明（假设：不允许）；Esri World Imagery 不允许导出离线瓦片；Google 禁止预取和缓存；EOX 无云镶嵌 2016 版之后是 CC BY-NC-SA；高分、吉林一号要实名或购买。
- 法规：《公开地图内容表示规范》（2023）规定境内公开地图平面精度不得优于 10 m、高程精度不得优于 15 m、影像分辨率不得优于 0.5 m（https://www.gov.cn/gongbao/content/2023/content_5752310.htm ）。10 m 影像满足；30 m DSM 的标称垂直精度优于 15 m，三维沙盘算不算"公开地图"未确认（假设，记入 openIssues）。

### 中国候选地点

| | 呼伦贝尔·陈巴尔虎旗·莫日格勒河中游 | 锡林郭勒·锡林河流域（白音锡勒） | 鄂尔多斯·鄂托克旗·阿尔巴斯 |
|---|---|---|---|
| 中心 | 49.62°N, 120.00°E | 43.60°N, 116.68°E | 39.50°N, 107.25°E（避开西缘棋盘井工业区） |
| 取景 | 12×10 km | 12×10 km | 14×12 km |
| 海拔 | 625–801 m | 1155–1375 m | 1419–1554 m |
| 地形 | 宽谷缓丘，河道极度蜿蜒 | 河谷湿地，北侧沙地，南侧丘陵 | 荒漠草原，冲沟密布 |
| 影像 | Sentinel-2 T50UQA：2025 年 4–10 月云量 <30% 的 38 景 | Sentinel-2 | Sentinel-2 |
| 放牧痕迹 | 亚米影像能看到牧户、围栏分区色块、土路；10 m 只剩河道、主路和牧户色斑 | 网围栏分区、牧户 | 围栏色块、羊圈点 |
| 观感 | 好：曲水加丘陵，草原辨识度最高 | 中：黄褐，有公路切割；东北有胜利露天煤矿要避开 | 偏弱：荒漠色调；优点是和鄂尔多斯甲方同地 |

### 分辨率在屏上的效果

- 全景：10 km 铺满屏宽约 5 m/像素；按 `/smart-mine` 版式沙盘约占 1100–1400 px，即 7–9 m/像素。10 m 影像接近原生、略软；30 m 网格每格 3–6 px，百米级缓丘够用，小冲沟会丢。
- 近景：拉到 3 km 宽约 2 m/像素，影像放大约 5 倍；牧户只剩 2–4 个色块，围栏和小道消失，地表是软塌的大斜面（对比 `/smart-mine` 近景用 0.5 m 影像 + 2 m 网格）。补救：程序化细节纹理 + 牧户、棚圈、水井等三维模型。

### 真实 NDVI 驱动草场指标

- 可行：Sentinel-2 B04、B08、SCL 都是 COG，可脚本取约 5 天一次的时间序列；多年对比可加 MODIS MOD13Q1（250 m，16 天，Planetary Computer 免登录）。
- 长势、返青、距平可以用真实数据；产草量（kg/亩）需要地面样方回归（国家草原监测按区域和草地类型分别建 MODIS 模型，https://iarrp.caas.cn/ysdt/kydt/52821.htm ），demo 里只能示意。云遮挡和高覆盖草地 NDVI 饱和也要处理。

### 海外候选（只作记录）

- 美国大平原：3DEP 1 m lidar + NAIP（公有领域），`fetch_data.py` 改坐标即可用。Gudmundsen Sandhills Laboratory（42.09°N, 101.47°W，5200 ha 养牛，风车水罐周围放射状牛道清楚）、Konza Prairie（39.09°N, 96.57°W，NAIP 2023 0.3 m）、Central Plains Experimental Range（平坦，观感差）。
- 新西兰：LINZ 1 m DEM + 0.2 m 航拍（CC BY 4.0，AWS `s3://nz-elevation` / `s3://nz-imagery`），Mesopotamia Station（43.64°S, 170.90°E，在营美利奴羊、鹿、牛 13700 多头）观感最佳。
- 顺带发现：TNM 的 NAIP 服务在 West Elk 点位返回 2019 年 0.6 m 影像，`docs/design/smart-mine/README.md` 写的是"原始 0.3 m"，待核对。

## 视觉调研

> 子代理调研（2026-10-20）。截图存在会话临时目录，没有入库（版权归原作者）；下面只记来源链接和结论。站酷弹出滑块验证码，没有绕过，所以没看。

**总判断**：国内"智慧牧场大屏"几乎都是深蓝科技风，场景是牛舍、挤奶厅；"真实地形 + 放牧草原"的三维大屏没有找到现成样板。放牧的成熟画法来自国外虚拟围栏 / 草场 App（Halter、eShepherd、Nofence、CiboLabs、MaiaGrazing），它们都是 2D 卫星图：符号语言能借，版式借不了。

### 同类大屏与版式

| 参考 | 布局 | 地图 / 三维占屏（目测） |
|---|---|---|
| 图扑·农林牧平台 https://cloud.tencent.com/developer/article/2356294 | 倾斜卫星图铺满，地块填色加编号，左右窄面板 | 全屏，面板挡约 30% |
| 图扑·智慧畜牧 https://cloud.tencent.com/developer/article/2290442 | 草地染蓝 + 三维牦牛，点选弹环形菜单 | 约 60% |
| Halter https://www.halterhq.com/new-features?tab=beef | 卫星图全屏，顶部胶囊页签，无数据面板 | 约 95% |
| eShepherd https://www.eshepherd.com/platform/apps | 卫星图全屏，右侧浮动畜群列表 | 约 85% |
| CiboLabs https://www.cibolabs.com.au/ | 像素级草量铺满，底部月份滑条 | 约 95% |
| 农业大屏合集（CSDN）https://blog.csdn.net/2401_82881178/article/details/136415340 | 卫星图压暗 + 两侧无底色面板 / 月份播放滑条 / 地形铺满 + 红色告警弹窗 | 45–74% |
| /smart-mine（仓库内） | 沙盘居中，两侧面板各约 22% | 约 55% |

结论：放牧类产品的地图占比都在 70% 以上、面板浮在地图上；用"中央沙盘 + 两侧满高面板"的话沙盘只剩 1100–1400 px 宽。

### 真实地形沙盘

- 参考：
  - 泰瑞 SmartEarth（浅底块状图、侧壁剖面，https://www.bilibili.com/video/BV1bB84eoEJu）
  - 水系流域沙盘（青色发光侧壁，https://baijiahao.baidu.com/s?id=1830354540129071657）
  - 数字孪生灌区（不切边延伸到地平线，https://news.sohu.com/a/768343408_121838017）
  - rayshader（实心底座、地面阴影、低角度暖光、景深，https://www.rayshader.com/）
- 本项目沙盘高差只有约 270 m / 12 km。需要竖向夸张 2–3 倍（假设），再配低太阳角的掠射光，缓丘才看得出来。
- 边缘不要重复 smart-mine 的地层侧壁加青光。三种选择：
  - 薄侧壁画"草皮 + 黑钙土 + 黄土"三层。陈巴尔虎旗多为黑钙土、栗钙土，地表覆盖黄土物质（https://nmj.hlbe.gov.cn/News/show/1354160.html）。
  - 四边羽化进雾。
  - 实心底座加阴影。
- 远边加薄雾、轻景深。全景标签最多约 8 个，用竖向引线落地。

### 畜群、长势、告警的画法

| 对象 | 全景（约 7–9 m/px） | 拉近（约 2 m/px） | 参考 |
|---|---|---|---|
| 畜群 | 群徽标（胶囊 + 头数）最清楚；放牧压力用 200–300 m 六边形热力 | 选中群：软边凸包 + 近 6 h 轨迹（尾部渐隐）；牛显示单头；500 m 内出小模型 | Halter 徽标、eShepherd Heatmaps（https://www.eshepherd.com/features/heatmaps）、deck.gl TripsLayer |
| 长势 NDVI | 牧场内叠 50–60% 像素级 NDVI，牧场外降饱和压暗约 30% | 同左 | 色带用 Sentinel Hub：0.1 #CCC682 / 0.2 #91BF51 / 0.3 #70A33F / 0.4 #4F892D / 0.5 #306D1C / 0.6 #0F540A（https://custom-scripts.sentinel-hub.com/sentinel-2/ndvi/）；CiboLabs 的红 → 品红会和告警色冲突，不取 |
| 分区 | 普通细线；在牧分区强调色实线；下一转场区虚线；休牧区斜线填充；分区中心"4d"剩余天数徽标 | 同左 | eShepherd、Nofence、MaiaGrazing（https://www.maiagrazing.com/） |
| 长势历史 | 底部 4–10 月滑条 + 播放 | — | CiboLabs、美丽后营 |
| 告警 | 全屏只用一种告警色；顶部横幅 → 镜头飞到现场 → 地面扩散环 → 回到巡游（沿用 /waiting 的打断节奏） | 越界：只升起被越过的那段围栏光墙，越界方向箭头；走失：畜群到个体的虚线 + 最后定位时间 + 搜索圈；饮水点：水位环变橙、水流动效停下 | eShepherd 告警徽标；光墙参考 https://article.juejin.cn/post/7457409568348880922 |
| 电子围栏 | 默认贴地描边（按屏幕像素定线宽） | 白色半透明矮带 + 节点圆点 | Nofence |

光柱国内大屏用滥了、会挡地形，只给告警用。

### 三个风格方向（设计稿用）

现有 demo 已经占掉的色系：深蓝 + 青（/smart-mine 等）、夜景蓝紫（/energy）、暖米纸感傍晚（/hometown）、糖果紫（/waiting）、浅色插画（/home 作品墙）。

| 方向 | 配色与质感 | 观众 | 最接近的参考 |
|---|---|---|---|
| A 晴空牧场（白天写实） | 天空渐变 #CFE2F1 → #F3F6F1，沙盘带接触阴影；草原绿 #2F8F4E、天蓝 #2B7BD6、告警 #E5484D；白色磨砂玻璃面板 | 集团领导、访客，也适合作品墙 | Halter + rayshader 浅底沙盘 |
| B 墨绿遥感（深色克制） | 背景 #0B1511 → #132219，影像压暗降饱和；苔绿 #3F7D5A、青柠 #C6F25B、畜群暖白 #F3EEDF、告警 #FF6B3D；深墨绿玻璃 + 1 px 细线，不发光 | 场长 / 生产主管日常值守 | 大连智慧农业平台 |
| C 金色牧歌（黄昏低光） | 太阳高度角 8–12°，天空 #F4C795 → #8C88A6；麦金 #E6B54A、河水青 #5DB3AC、告警 #F0502E；深橄榄棕玻璃 + 金线，标题思源宋体 | 访客、宣传视频 | rayshader 暖光渲染；注意和 /hometown 撞暖色，靠写实影像 + 深色面板区分 |

### 可借鉴 / 不适合

| 参考 | 可借鉴 | 不适合 |
|---|---|---|
| Halter | 畜群徽标、草量色带、牧场外压暗、剩余天数环 | 手机 UI 的信息密度 |
| eShepherd | 实线 / 虚线区分当前和计划围栏、六边形热力 | 黄橙配色和告警冲突 |
| Nofence | 斜纹禁入区、白色围栏带 | 营销插画 |
| CiboLabs / MaiaGrazing | 月度滑条、"4d"天数徽标 | 红 → 品红色带 |
| 图扑两例 | 地块填色、点选单头 | 卡通浮岛、草地染蓝 |
| 国内光墙 / 光柱 | 只高亮告警段 | 全量使用糊屏，也和 smart-mine 撞风格 |
| rayshader / SmartEarth | 实心底座、低角度光、侧壁叙事 | 地质剖面和牧场关系弱 |

## 缺失资料

- 见业务调研"查不到 / 存疑"。
- OSM 矢量（河道、道路、建筑）没下到：Overpass 主站和两个镜像都连不上或超时。河道改用地形谷底线 + 影像水体，道路暂不画。
- 没有找到"真实地形 + 放牧草原"的三维大屏整屏样板，版式靠推断（见视觉调研）。
