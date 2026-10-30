# 登录页衍生素材

视觉基准：`星序/星序-登录页参考图.png`。原图未覆盖，也未作为整页背景使用。

三份衍生位图均使用内置 `image_gen`，不使用外部图片或运行时远程资源。

- `deep-space.png`：从参考图移除登录表单、文字、品牌、主天体、轨道及前景碎石，仅保留深蓝星空、星云、远处星系与右下行星。提示词要求保留冷蓝、银灰和少量香槟金光线，右侧克制留白；无文字、无 UI、无主物体。
- `core-nebula.png`：以参考图核心球体内部的星云为风格依据，生成完整方形平面纹理。提示词要求深蓝空隙、冰蓝星云纤维、细小银白星点和淡金星系核心，不生成玻璃边界、轨道、文字或 UI。该纹理供三维密度云体的调色及玻璃内部透光薄云使用；核心已无不透明贴图球。外层玻璃、1400 个空间星点、金属环、浅刻度与节点独立渲染。
- `brushed-champagne.png`：香槟金缎面拉丝纹理。用于真实曲面金属环的基色和极低强度微凹凸，刻度由连续表面上的角度分度产生，不在图片上绘制环体或光照。

原始生成结果分别为 `exec-8727d325-dacd-40d2-93d3-cac70f7afe0d.png` 和 `exec-a4307f3a-534a-40ee-8ebc-b189f63a6da6.png`，本地副本已归入本目录。

金属纹理原始输出为 `exec-f4055819-e610-4dea-b49d-3763baa46f20.png`，本地副本已归入本目录。

品牌复用项目既有 `public/assets/brand.png`。表单文字、图标、按钮与交互全部由 HTML/CSS/JavaScript 构建。

## 最终生成提示词

### deep-space.png

Use case: precise-object-edit. Asset type: production background plate for an existing accepted Astra login page, 16:9 landscape. Image 1 is the reference/edit target. Keep its cinematic midnight-navy and deep blue star field, delicate dusty nebula wisps, distant tiny galaxies, realistic stars, and the small cropped dark blue planet at the bottom right. REMOVE the entire large armillary sphere and every orbit ring, satellite, gem, beam, orbit trail in the left/upper area; REMOVE all foreground floating rock clusters, ALL text, ALL logo, ALL interface panel, ALL interface borders and all form elements. Fill removed areas with coherent dark deep space. Left half should have delicate scattered nebula structures to support a separate 3D armillary object. Right half stays a little darker and quieter so code-native form text can read. Preserve the subtle cinematic silver, pale champagne and ice-blue stellar lighting, dark black-blue negative space, realistic fine detail. The output is ONLY a starry background with no main objects, no orb, no rings, no graphic overlay, no large white fog or bright blobs, no interface, no watermark. High quality 2560x1440 or larger.

### core-nebula.png

Use case: stylized-concept. Asset type: a production nebula texture for the INTERIOR of the central crystal sphere in a real Three.js 3D armillary device. Image 1 is style and color reference only; do not output another login design. Generate ONLY a square, edge-to-edge detailed cosmic nebula texture, flat image with no visible orb boundary and no perspective sphere. Match the deep midnight navy, luminous ice-blue dust, minute silver stars, delicate champagne highlights and fine filament structure visible INSIDE the reference sphere. A graceful small pale-gold galactic core near the image center with spiraling wisps of ice-blue cosmic dust around it, mixed with large dark navy gaps and tiny sharp stars. Detailed astrophotography and mature cinematic texture, realistic fine granular texture, blue glass visual vocabulary. Mostly dark and semi-transparent-looking space rather than opaque bright clouds. No text, no logo, no UI, no metal rings, no orbit trails, no edges, no geometric shapes, no giant white explosions. This will be wrapped onto a 3D interior sphere and viewed through another glass sphere. Do not render the glass sphere itself. At least 1536x1536.

### brushed-champagne.png

Use case: photorealistic-natural. Asset type: a seamless material base-color texture for real 3D precision armillary rings, not a render of an object. Image 1 is a MATERIAL AND COLOR REFERENCE ONLY. Generate a single rectangular 2:1 image filling every pixel with refined champagne-gold / pale bronze brushed metal. Flat orthographic macro material scan, uniform neutral diffuse illumination, subtle microscopic horizontal machining lines and fine grain, tiny low-contrast surface variation. Warm pale champagne, restrained desaturated sand-gold, subtle silver undertone. The horizontal brushed direction must continue seamlessly at left and right edges for wrapping around a machined circular band. It must feel like aerospace / fine watchmaking metal, polished satin, not plastic. Do not generate an armillary, rings, stars, nebulae, logos, text, numbers, engraved scales, panel seams, dark stripes, rust, grunge, scratches larger than microscopic hairlines, broad gradients, shadows, reflected lights, perspective, object edges, specular streaks or a scene. Just a high-resolution seamless flat PBR-style metal color texture, subtle enough that lighting and geometric machining are supplied by the 3D renderer. Approximately 2048x1024.
