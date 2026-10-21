# 智慧港口沙盘：场地与公开数据调研

## 一、候选码头

| 码头 | 中心坐标 | 尺寸 | 自动化工艺 | 取景（16:9 视野宽） |
|---|---|---|---|---|
| 鹿特丹 APMT MVII | 51.948N, 3.999E | 一期 86 ha、深水岸线 1000 m + 驳船岸线 500 m；二期再加 81 ha，岸线到 2000 m，2026 年完成 | 远程操控岸桥 8 台、ASC 26 台、Lift-AGV 36 台（一期）[nl.wiki](https://nl.wikipedia.org/wiki/APM_Terminals_MV2) | 单独取约 3.5 km；与 RWG 同框约 4.5–5 km（两者合起来约 2.9 × 2.9 km） |
| 鹿特丹 RWG（与 APMT 相邻） | 51.953N, 3.985E | 108 ha、深水岸线 1150 m + 驳船岸线 550 m | 岸桥 11 台、ASC 50 台、Lift-AGV 59 台 [nl.wiki](https://nl.wikipedia.org/wiki/Rotterdam_World_Gateway) | 同上 |
| 汉堡 CTA | 53.504N, 9.931E | 岸线 1400 m、4 个泊位、98 ha | 双小车岸桥 14 台；26 个箱区，每区一对可互相穿越的轨道吊；AGV [en.wiki](https://en.wikipedia.org/wiki/Container_Terminal_Altenwerder) | 约 2.2 km（OSM 范围 1.6 × 0.9 km） |
| 长滩 LBCT | 约 33.76N, 118.21W | **假设**：约 126 ha（311 acre） | 美国首个全自动化码头 [en.wiki](https://en.wikipedia.org/wiki/The_Age_of_A.I.)；ASC + 电池 AGV（**假设**） | 约 2 km |
| 上海洋山四期 | 30.6545N, 122.025E（[OSM](https://www.openstreetmap.org/way/822111020)） | 223 万 m²、岸线 2350 m、7 个泊位 | 规划岸桥 26 台、双箱轨道吊 120 台、换电 AGV 130 台，振华整套供货 [新华网存档](https://web.archive.org/web/20201026223613/http://www.xinhuanet.com/tech/2017-12/11/c_1122087856.htm) | 约 4 km（OSM 范围 3.0 × 1.2 km） |
| 天津北疆 C 段 | **假设** 约 39.03N, 117.78E | 岸线 1100 m、3 个 20 万吨级泊位、陆域 75 万 m² | 单小车岸桥 12 台、轨道桥 42 台、ART 76 台；堆场与岸线平行（8 条 24 个垛区）[百科](https://baike.baidu.com/item/天津港北疆港区C段智能化集装箱码头) | 约 1.6 km |
| 广州南沙四期（备选） | 22.660N, 113.661E（[OSM](https://www.openstreetmap.org/way/1028516090)） | OSM 范围 1.9 × 1.1 km | "全球最大水平布局全自动化码头" [zh.wiki](https://zh.wikipedia.org/wiki/2023扬帆远航大湾区音乐会)；IGV 等细节为**假设** | 约 2.6 km |

另外三个只做备注：
- **青岛前湾**：2017 年只有 2 个泊位，厦门远海只有 1 个（同一篇新华网报道）。青岛的位置大约在 36.00N, 120.23E，是从 OSM 上青岛新前湾集装箱码头公司的点位推定的（**假设**），后续几期的规模没有核实。
- **洛杉矶 TraPac**（33.764N, 118.272W）：自动跨运车 + ASC，属于**假设**，没有核实。
- **安特卫普**：没有纳入，原因是以跨运车为主、不是全自动（**假设**）。

## 二、公开数据

### 2.1 国外数据源

| 数据 | 分辨率 / 年份 | 许可要点 | 获取方式 |
|---|---|---|---|
| PDOK 航拍 RGB | 每年 25 cm（2016 年起）；HR 版 8 cm（2021 年起），2026 年部分区域 5 cm | CC BY：任何用途都可以，包括烘焙贴图公开展示；须署名 "Samenwerkingsverband Beeldmateriaal" 并注明 CC BY [PDOK](https://www.pdok.nl/-/hoge-resolutie-luchtfoto-2026-nu-beschikbaar-bij-pdok) | WMTS 免 Key，有 `Actueel_orthoHR` 和各年份图层，3857 投影最高 21 级 [Capabilities](https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0?request=GetCapabilities&service=WMTS)；WMS 用量大会被限速 |
| AHN4 DTM / DSM | 0.5 m，2020–2022 年采集；AHN5 只覆盖部分地区 | **CC0** [ATOM](https://service.pdok.nl/rws/ahn/atom/index.xml) | COG 按 5 × 6.25 km 图幅下载，免登录 [AHN](https://www.ahn.nl/dataroom) |
| 荷兰 BGT 大比例尺矢量 | 现势 | **CC0** | OGC API，可按 bbox 取 [API](https://api.pdok.nl/lv/bgt/ogc/v1)。APMT 范围内实测：起重机轨道 141 段（"(haven)kraan"）、铁路 75 段、建筑 74 栋、围栏 554 段，可直接还原箱区排布 |
| 汉堡 DOP | 20–30 cm；无叶期有 2022 / 2025 / 2026（Harburg 区），有叶期有 2024 | dl-de/by-2.0，署名 "Freie und Hansestadt Hamburg, LGV" [Transparenzportal](https://suche.transparenz.hamburg.de/dataset/luftbilder-hamburg-dop-zeitreihe-unbelaubt7)。**注意**：这个时间序列里混有 Maxar 卫星年份，采用封闭许可（© 2023 Maxar），不能用，只能选航拍年份 | 按区下载 GeoTIFF 压缩包（多 GB）；WMS 无访问限制，单张最大 4096 px [Capabilities](https://geodienste.hamburg.de/wms_dop_zeitreihe_unbelaubt?SERVICE=WMS&REQUEST=GetCapabilities) |
| 汉堡 DGM1 / bDOM / LoD2 | DGM 1 m（激光扫描，2022）；bDOM 1 m（影像匹配的表面模型）；LoD2 建筑（CityGML，2026） | dl-de/by-2.0 | 直链 zip 下载 [DGM](https://suche.transparenz.hamburg.de/dataset/gelaendemodelle-hamburg-dgm2) |
| NAIP（长滩） | 0.6 m，2022 年（服务里能查到的最新一期） | 联邦数据，公有领域（智慧矿山已在用） | USGS NAIPImagery ImageServer 的 exportImage，和 smart-mine 是同一套流程 [服务](https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer)；也可以走 Planetary Computer STAC |
| 3DEP（长滩） | 1 m DEM，项目 CA_LosAngeles_B23（2025-08 发布）；另有 LAZ 点云（2016 年和 B23 两批） | 公有领域 | TNM API、S3，免登录 [ScienceBase](https://www.sciencebase.gov/catalog/item/689bf420d4be0276bfcb20b5) |

有一点对布局还原很有用：AHN 的 DSM 和 LBCT 的点云都包含地物，用 DSM 减 DTM 能直接看出箱垛块和岸桥。

### 2.2 OSM 覆盖（2026-10-20 用 Overpass 按码头范围统计）

| 码头 | 要素总数 | 起重机 | 道路 | 建筑 | 铁路 |
|---|---|---|---|---|---|
| APMT MVII | 8041 | 79 | 419 | 71 | 40 |
| RWG | 2108 | 43 | 170 | 22 | 26 |
| CTA | 3235 | 55 | 363 | 45 | 34 |
| LBCT（近似范围，含周边设施） | 10942 | 3 | 567 | 318 | 95 |
| TraPac | 3358 | 4 | 168 | 135 | 25 |
| 洋山四期 | 1118 | 0 | 64 | 16 | 0 |
| 南沙四期 | 270 | 1 | 27 | 6 | 9 |
| 厦门远海 | 66 | 0 | 12 | 0 | 0 |

- 天津 C 段和青岛在 OSM 里找不到码头面要素。
- 各码头基本都没有 `man_made=quay` 和泊位要素，岸线要靠海岸线或影像来定。

### 2.3 国内码头

**比 10 m 更清晰、又允许公开展示的开放数据，没有找到。** 能用的有：

| 数据 | 分辨率 | 许可 |
|---|---|---|
| Sentinel-2 L2A | 10 m | 署名 "Contains modified Copernicus Sentinel data [年]" [法律声明](https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice) |
| SEN2SR 超分 | 把 Sentinel-2 提到 2.5 m | 代码 CC0（README 上标的是 MIT，两处不一致）[GitHub](https://github.com/ESAOpenSR/sen2sr)；输出仍按 Copernicus 条款署名；细节是模型"编"出来的，不能当布局依据 |
| Satlas 全球超分 | — | 代码 Apache-2.0 [GitHub](https://github.com/allenai/satlas-super-resolution)；输出数据的许可**未核实** |
| ESA WorldCover | 10 m 地类 | CC BY 4.0 [ESA](https://esa-worldcover.org/en/data-access) |
| Copernicus GLO-30 | 30 m | 同牧场 demo [AWS](https://registry.opendata.aws/copernicus-dem/) |

不可用的：
- EOxCloudless 是非商业许可，而且只有 10 m [EOX](https://s2maps.eu/license-non-commercial)。
- 高分、吉林一号是商业数据，要买授权（**假设**）。

**法规**（《公开地图内容表示规范》2023 [原文](https://zh.wikisource.org/wiki/公开地图内容表示规范)）：
- 港口本身不在禁止表示之列。不得表示的只有两类：军用港口码头（第二十条第一项），以及军民合用港口码头的重要设施（第二十条第五项）。
- 江河的通航能力、水深不得表示（第二十一条第五项），所以国内码头不要显示前沿水深。
- 平面精度不得优于 10 m，高程精度不得优于 15 m（第十九条）；遥感影像分辨率不得优于 0.5 m（第二十二条）。

另外，按《地图管理条例》第十五、十六条，向社会公开展示的地图要由展示者送审 [原文](https://zh.wikisource.org/wiki/地图管理条例)。一个按真实地理还原的国内港口沙盘有可能被认定为"地图"。这一点属于**假设**，不是法律意见。降低风险的做法：不显示经纬度、比例尺和行政界线，几何精度做粗化。

## 三、三维模型（Sketchfab，均可下载，CC BY）

| 模型 | 面数 | 风格 |
|---|---|---|
| [Ship To Shore Crane](https://sketchfab.com/3d-models/ship-to-shore-crane-401069fccf814da7a4f9ce5a51487548) | 9.8k | 低模；唯一找到的岸桥，没有写实版 |
| [Rubber Tired Gantry](https://sketchfab.com/3d-models/rubber-tired-gantry-d7f4656b6beb40afb1a8c2b4b4a181c8) | 20k | 低模，可改成 ASC |
| [Straddle Carrier](https://sketchfab.com/3d-models/straddle-carrier-63f733b8d7784ad095849cb60d4df374) | 10k | 低模 |
| [AGV](https://sketchfab.com/3d-models/agv-816d3ac15f254bafb9d595851d5370c4) | 325k | 写实，码头 AGV，需要减面 |
| [ITV with 40ft container](https://sketchfab.com/3d-models/itv-with-40ft-container-661e8655f7634e0685e2a77b1e783609) | 296k | 写实 |
| [Container Ship (RM02)](https://sketchfab.com/3d-models/container-ship-aaa41cca946b4a08bc08cf692b7757be) | 189k | 写实，带满载箱 |
| [Container Ship (lavawave)](https://sketchfab.com/3d-models/container-ship-4f7cf10593824061bfe2e36ffd823cde) | 20k | 低模船体，不带箱 |
| [40ft ISO Container Pack](https://sketchfab.com/3d-models/40ft-iso-general-container-free-asset-pack-92bf3d3d7ebc45ada55d46637b9b7586) | 主体 5k，LOD 832 | 写实 PBR |
| [DAV Container Truck](https://sketchfab.com/3d-models/dav-container-truck-realistic-model-94e20c1da2ed48a895a8dc4d8c86cfd9) | 39k | 写实集卡 |
| [Very Low Poly Containers](https://sketchfab.com/3d-models/cargo--containers-very-low-poly-4579520c83694ba18b3573192265276c) | 1.3k | 低模 |

- 写实的岸桥、ASC 都没有找到，结论和原计划一致：自己在 Blender 里建。
- 带 Maersk、Evergreen 等真实船公司标志的涂装，商标权不在 CC 授权范围内，只用素色的。

## 四、结论

**推荐顺序**：
1. **鹿特丹 Maasvlakte II（以 APMT 为主，RWG 同框）**：数据最好。8 cm 影像（CC BY）+ 0.5 m 高程（CC0）+ BGT 起重机轨道矢量（CC0），全部免登录、可以脚本化获取；两个自动化码头同框，展示效果最强。
2. **汉堡 CTA**：20 cm 影像 + 1 m 高程 + LoD2 建筑，OSM 也完整；要避开 Maxar 年份。
3. **长滩 LBCT**：公有领域，可以直接复用智慧矿山的下载脚本；缺点是 OSM 很弱。
4. **上海洋山四期**：国内首选。
5. **天津 C 段**：国内备选。平行岸线的水平布置加 ART 无人集卡，画面上和洋山区别明显。

**如果用户要国内码头，选洋山四期**，代价如下：
- **底图会糊**：全景视野约 4 km 宽时，一个屏幕像素约 2 m，Sentinel-2 的 1 个像素占约 5 个屏幕像素；拉到 500 m 宽的近景，1 个像素要占约 38 个屏幕像素，只剩色块。相比之下 PDOK 在近景下仍接近原始清晰度。SEN2SR 能让全景接近清晰，但细节是模型编的。
- **布局只能靠公开参数加 10 m 影像量测**：用 2350 m 岸线、7 个泊位、26 / 120 / 130 台设备这些公开数字，加上在 10 m 影像上量出的岸线和箱区条带走向（**假设**：10 m 下看得出），程序化生成箱区。地面车道和箱位标线在 Blender 里自己画再烘焙；卫星影像只用来铺海面、岛屿和东海大桥这些周边。
- **精度和法规**：布局精度大约 ±10 m，正好和公开地图的精度要求一致；不显示水深；送审风险需要用户自己判断。