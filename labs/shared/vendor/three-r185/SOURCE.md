# Three.js r185 本地来源清单

- npm 包：`three@0.185.1`
- 上游压缩包：`https://registry.npmjs.org/three/-/three-0.185.1.tgz`
- npm integrity：`sha512-5aojFCXKwnjBRZvUnt3WFfEcvUJgkN5LlijRFN95hMy8WVkG4I0QNcJE+OuWvuJ0bOdStrbfXn0pkd6/QyiAlg==`
- 许可证：MIT；原文保存在同目录 `LICENSE`
- 引入方式：只从锁定 npm 包复制 `build/three.module.js`、其显式依赖 `build/three.core.js` 和 `LICENSE`，页面不使用 CDN。

| 本地文件 | SHA-256（上游发布字节） |
| --- | --- |
| `three.module.js` | `bbf5ed13fe4373f5bd38b14ea8e62e9f157327da5638edc6d3863e08b167c9c7` |
| `three.core.js` | `3718df126d69c125362a03340913204470d8c50238605150e57f808840fb7759` |
| `LICENSE` | `8b378ebe60e2fe500158cb0ac71cb5e8b7d92953c2abcc63a0eb90499653b5bc` |

`.gitattributes` 固定这些上游文件的 LF 暂存字节，并排除生成代码的项目级文本 diff。复核时先执行 `npm ci --ignore-scripts`，再比较暂存 blob 与 `node_modules/three/` 对应文件；不得手工改写 vendored 文件。
