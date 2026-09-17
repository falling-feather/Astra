import type { ExplorationLesson } from './xunpu-exploration-lesson.js';

// These files are immutable teaching originals, separate from scene decoration.
export const fieldMediaAssetsV3: Record<'rongjiang'|'qinglan',NonNullable<ExplorationLesson['mediaAssets']>> = {rongjiang:[
  {
    "assetId": "asset-rongjiang-source-training-v3",
    "title": "训练配合远景（生成教学素材）",
    "publicPath": "/assets/v3/rongjiang-source-training.png",
    "contentHash": "326da2e6118db0b497c84a4d1e17d3806716b20c3e5b9e8b2b27dd013f5fdad1",
    "sourceFactBoundary": "本课生成的训练情境远景，可用于练习画面选择；不能证明现实赛果、人物身份或当前人数。"
  },
  {
    "assetId": "asset-rongjiang-source-maintenance-v3",
    "title": "场地维护细节（生成教学素材）",
    "publicPath": "/assets/v3/rongjiang-source-maintenance.png",
    "contentHash": "ea600ec57162e23b8237fbf4d727d0b916d548b1690cc95818ea7371dd209343",
    "sourceFactBoundary": "本课生成的维护细节，用于讨论具体劳动与镜头范围；不能用一帧图像推算整季场地状态。"
  },
  ],qinglan:[{
    "assetId": "asset-qinglan-source-landscape-v3",
    "title": "晴天资料画面A（生成教学素材）",
    "publicPath": "/assets/v3/qinglan-source-landscape.png",
    "contentHash": "02ddf122b68403d3f4adb52382a72e862a83a36f7af955fa1ef401c24ccaf286",
    "sourceFactBoundary": "用作仿真课程中的历史晴天资料图；原文件由项目生成，不对应真实时点，不能证明当前步道状态。"
  },
  {
    "assetId": "asset-qinglan-source-illustration-v3",
    "title": "山地服务示意（生成插图）",
    "publicPath": "/assets/v3/qinglan-source-illustration.png",
    "contentHash": "3b03a8c81d0ee3397e85564803e5750dbfee1d13ffa960c9b9d73ab17cf3bf6c",
    "sourceFactBoundary": "明确为生成插图，只能作为解释性视觉；不是实拍、精确地图或现实出行指引。"
  }
]};
