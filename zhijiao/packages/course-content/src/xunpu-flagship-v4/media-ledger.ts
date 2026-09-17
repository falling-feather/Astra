import type { XunpuMediaAssetV4 } from "./types.js";

function planned(
  assetId: string,
  assetKind: XunpuMediaAssetV4["assetKind"],
  title: string,
  relativePath: string,
  consent: XunpuMediaAssetV4["personConsentMode"] = "not_applicable",
): XunpuMediaAssetV4 {
  return {
    assetId,
    assetKind,
    title,
    plannedRelativePath: relativePath,
    creatorMode: "project_generated",
    productionStatus: "planned",
    usageScope: "teaching_simulation_only",
    personConsentMode: consent,
    aiExplicitLabel: true,
    aiImplicitMetadata: true,
    sourceFactBoundary: "教学仿真视觉或声音，不作为泉州公共事实来源。",
    contentHash: null,
  };
}

function ready(
  assetId: string,
  assetKind: XunpuMediaAssetV4["assetKind"],
  title: string,
  relativePath: string,
  contentHash: string,
  consent: XunpuMediaAssetV4["personConsentMode"] = "not_applicable",
  aiImplicitMetadata = false,
): XunpuMediaAssetV4 {
  return {
    assetId,
    assetKind,
    title,
    plannedRelativePath: relativePath,
    creatorMode: "project_generated",
    productionStatus: "ready",
    usageScope: "teaching_simulation_only",
    personConsentMode: consent,
    aiExplicitLabel: true,
    aiImplicitMetadata,
    sourceFactBoundary: aiImplicitMetadata
      ? "项目原创生成资产；已嵌入仿真来源元数据，不作为泉州公共事实来源。"
      : "项目原创生成资产，不作为泉州公共事实来源；隐式元数据仍待补齐。",
    contentHash,
  };
}

const assetRoot = "apps/web/public/assets/flagship-world/";

export const xunpuV4MediaAssets: XunpuMediaAssetV4[] = [
  ready("asset-env-editor-desk-wide-01", "environment_image", "移动编辑台", assetRoot + "v4/env-editor-desk-wide-01.png", "9042944f15efd5a93aba5c56d9e11b40c3eb66d340127cd4142de3ab84e2f347", "not_applicable", true),
  ready("asset-env-oyster-alley-wide-01", "environment_image", "蚵壳厝质感巷口", assetRoot + "v4/env-oyster-alley-wide-01.png", "903195e399e0d0127b887ae684ff161e76e36046a91df500c8a0578accc5b32c", "not_applicable", true),
  ready("asset-env-community-courtyard-01", "environment_image", "社区公共院落", assetRoot + "v4/env-community-courtyard-01.png", "e8b6db4229535640fa6044559300b4eb89ad7c3bcb3a59260ba4efcc747d7ae7", "not_applicable", true),
  ready("asset-env-workshop-close-01", "environment_image", "手部技艺工作台", assetRoot + "v4/env-workshop-close-01.png", "2347fa31e913961fe01fde11bb8882095e0227f8402b08abb27b9ba65fc5fd94", "not_applicable", true),
  ready("asset-env-storefront-wide-01", "environment_image", "仿真旅拍门店外", assetRoot + "v4/env-storefront-wide-01.png", "0a328db135e3e979b1d211eff6a5500419223a87e4f375719288b93b0553533b", "not_applicable", true),
  ready("asset-env-service-point-01", "environment_image", "公共服务联络点", assetRoot + "v4/env-service-point-01.png", "7a768cd597d38affbc18adf1aee7566e672eaece1bf73d1dda409f5bb4258d22", "not_applicable", true),
  ready("asset-npc-editor-chen-01", "npc_portrait", "陈编辑", assetRoot + "v4/npc-editor-chen-01.png", "69d4ef321b6cfc1276327e830a6977efd45270136939e938e24276385debe32b", "simulated_character", true),
  ready("asset-npc-gatekeeper-lin-01", "npc_portrait", "林师傅", assetRoot + "v4/npc-gatekeeper-lin-01.png", "9c9694923d72460821fd76b830114ff5d952bc8a7a95c2442ca95c57affcf142", "simulated_character", true),
  ready("asset-npc-community-ahuan-01", "npc_portrait", "阿环", assetRoot + "v4/npc-community-ahuan-01.png", "3c7f4dee46fc1e750ebbbb419deb66030d909d77ca6d1c9e176fa4144fdee064", "simulated_character", true),
  ready("asset-npc-inheritor-huang-01", "npc_portrait", "黄老师", assetRoot + "v4/npc-inheritor-huang-01.png", "0e0e1ef394c10ba9089615ef94edbd1becdfa4a6abcdaa784e3bb9dd90a1e91a", "simulated_character", true),
  ready("asset-npc-researcher-chen-01", "npc_portrait", "陈老师", assetRoot + "v4/npc-researcher-chen-01.png", "3debc258f0232febaedba7cdbacc5e75b38cf533ba84f3f3202d1e348439cc79", "simulated_character", true),
  ready("asset-npc-shopkeeper-wu-01", "npc_portrait", "吴姐", assetRoot + "v4/npc-shopkeeper-wu-01.png", "806d2ef11c7feca74dde82aad77d7b38531d4cdecf449945e3ecfc18205c42aa", "simulated_character", true),
  ready("asset-npc-liaison-cai-01", "npc_portrait", "蔡主任", assetRoot + "v4/npc-liaison-cai-01.png", "17e1282d1d2ec3b035ff2f72950dac0a195a423199547522ea7a32bab9998068", "simulated_character", true),
  ready("asset-npc-rights-xu-01", "npc_portrait", "许老师", assetRoot + "v4/npc-rights-xu-01.png", "a4808957d33dee874dccc0c893ed747ae2fb9b58c3a9708ad43604fd4ba70811", "simulated_character", true),
  ready("asset-npc-tourist-zhou-01", "npc_portrait", "周女士", assetRoot + "v4/npc-tourist-zhou-01.png", "11fe23a52f4321d58752c7ebd690cc66f4b847bae79b85b9d72605835d985519", "simulated_character", true),
  ready("asset-npc-platform-qiao-01", "npc_portrait", "乔安", assetRoot + "v4/npc-platform-qiao-01.png", "aa2039f182627f772dcf994c347c894e22df6ee3959bd69a8c74d9ea1edd22d0", "simulated_character", true),
  ready("asset-photo-alley-overview-01", "source_image", "巷口安全宽景", assetRoot + "v4/source-photo-alley-overview-01.png", "430ad8a0829098d625407c7e14e6a9667b2be7c1c2407246cedc6a47a61023b7", "not_applicable", true),
  ready("asset-photo-hands-work-01", "source_image", "手部技艺替换图", assetRoot + "v4/source-photo-hands-work-01.png", "75ef24612b41c847c86f468b524b665332e8415b9deea0d6ab923287b25cf251", "not_applicable", true),
  ready("asset-photo-tourist-close-01", "source_image", "周女士近景仿真图", assetRoot + "v4/source-photo-tourist-close-01.png", "c765624c413fb586ae7a33f3cd3af2edbce467ac9ec68b0f7594f9f08d7232ad", "simulated_character", true),
  ready("asset-photo-shop-sample-01", "source_image", "商户高吸引样片", assetRoot + "v4/source-photo-shop-sample-01.png", "b6c6051146e83b4b7bd9659d5d99e8ba563071f45895470409e5f2ff5d26dfb1", "simulated_character", true),
  ready("asset-audio-ahuan-interview-01", "audio", "阿环仿真采访录音", assetRoot + "v4/audio-ahuan-interview-01.wav", "a703d05c909d7bd2e36d782fa65d2bc2101701cb81d507bf2bb4b0fdaca55b73", "simulated_character", true),
  ready("asset-audio-researcher-source-01", "audio", "研究者来源层级录音", assetRoot + "v4/audio-researcher-source-01.wav", "56f947d01e32c2da54fa96b1ae8b2466fafe803198fa592b8b9c7b6192b3ba83", "simulated_character", true),
  ready("asset-audio-ambience-01", "audio", "项目生成环境声", assetRoot + "v4/audio-ambience-01.wav", "50203614a77000cb025002942c4c0ac2a2c413ec3543b2a20fc8fe4e945bf297", "not_applicable", true),
  ready("asset-video-alley-broll-01", "video", "巷口竖屏宽景", assetRoot + "v4/video-alley-broll-01.mp4", "2a2e588c6bbdc04b6d3519f1eda750060ed45589e9594ca60648ba930bd74e48", "not_applicable", true),
  ready("asset-video-hands-demo-01", "video", "手部技艺竖屏演示", assetRoot + "v4/video-hands-demo-01.mp4", "cb8b7f25c6ce77fc5001723eb5c111fc7570c2ab67b12086b1bf6723c680f571", "not_applicable", true),
  ready("asset-video-tourist-close-01", "video", "周女士近景竖屏素材", assetRoot + "v4/video-tourist-close-01.mp4", "cf49f89f089fe71eb85f80a252760ba509da1b2f9b9383335517b7b8e7c84d7a", "simulated_character", true),
  ready("asset-rumor-closure-chat-01", "synthetic_capture", "巷口封闭群聊截图", assetRoot + "v4/rumor-closure-chat-01.svg", "bd61429719215b02da8480ad3a2b081c94bd73c1b8ac47163c5939d001abd537", "not_applicable", true),
];
