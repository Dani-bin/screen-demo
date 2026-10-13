# 效果图 v2：以图生图提示词

底图是模型的 Cycles 渲染图，合成在傍晚天空上，布局与真实地形一致：
- `img2img-base-overview.png`：全景沙盘
- `img2img-base-home.png`：我家近景，照片机位

要求 AI **只重绘质感和光影，不改变构图和布局**：房屋的位置、数量、朝向，梯田的走向，池塘、厂区、回家路线都保持底图原样。风格参照 `01-ai-overview.png` / `02-ai-my-house.png`（效果图 v1）。

## 全景沙盘

Re-render this image as a photorealistic high-end physical scale model (architectural diorama, tilt-shift macro photography) of a hillside village in rural northeastern Sichuan, China, summer 2017, warm golden-hour evening light from the left. KEEP THE EXACT COMPOSITION AND LAYOUT of the input image: every building stays in the same place with the same size, roof colour and orientation; the terraced rice paddies, the pond, the brown dry fields, the factory compound with blue steel roofs, the glowing warm-yellow path line, the cypress and bamboo woods, the curved concrete road and the layered red-brown soil cross-section at the plot edge all stay where they are. Only upgrade materials and detail: lush green rice paddies with fine rows and thin water reflections along the terrace edges, grassy earth bunds, realistic cypress trees and feathery bamboo clumps instead of low-poly shapes, glossy white ceramic wall tiles, terracotta and dark grey roof tiles, corrugated blue steel roofs, weathered concrete yards, layered purple-red Sichuan soil on the cut edge, soft long shadows, thin wisps of cooking smoke, a few chickens. Soft out-of-focus warm grey-blue misty background. No text, no labels, no people.

## 我家近景

Re-render this image as a photorealistic macro photograph of a miniature diorama of a rural self-built house in northeastern Sichuan, summer 2017 evening, warm golden sunlight. KEEP THE EXACT COMPOSITION, camera angle and building geometry of the input image. The main house: three-storey, three-bay flat-roof house fully clad in small white rectangular ceramic tiles in running bond with grey grout, recessed centre bay with white vase-shaped baluster balconies on the 2nd and 3rd floors, aluminium sliding windows with light green curtains, ground-floor windows with white steel security bars, dark entrance with red Spring Festival couplets on both sides, a small dark plaque above the door, two round red Chinese lanterns with gold tassels, concrete steps up from a grey concrete courtyard, a big loquat tree with large dark green leaves on the left, and a one-storey side house with red clay tile roof on the right. Realistic tile texture, slightly weathered, soft shadows, shallow depth of field, nostalgic warm colour grade, blue-to-peach evening sky. No text, no people.
