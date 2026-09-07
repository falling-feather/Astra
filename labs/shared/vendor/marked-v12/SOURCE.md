# marked 12.0.0 本地来源清单

- npm 包：`marked@12.0.0`
- 上游压缩包：`https://registry.npmjs.org/marked/-/marked-12.0.0.tgz`
- npm integrity：`sha512-Vkwtq9rLqXryZnWaQc86+FHLC6tr/fycMfYAhiOIXkrNmeGAyhSxjqu0Rs1i0bBqw5u0S7+lV9fdH2ZSVaoa0w==`
- 许可证：MIT；原文保存在同目录 `LICENSE.md`
- 引入方式：只从锁定 npm 包复制根目录 `marked.min.js` 与 `LICENSE.md`，协议页不访问 CDN。

| 本地文件 | SHA-256（上游发布字节） |
| --- | --- |
| `marked.min.js` | `eb1f6b19880bc80a5fe34c6a61885173b60edda455ba7a33c98714db17d39f99` |
| `LICENSE.md` | `8e3a3f82f59a60958f56ca08f445647c32a4733dc7ca6c2c46f6eb898471ab9c` |

同目录 `.gitattributes` 固定上游文件为 LF 暂存字节并排除生成代码的项目级文本 diff。复核时执行 `npm ci --ignore-scripts`，再比较暂存 blob与 `node_modules/marked/` 对应文件；不得手工改写 vendored 文件。
