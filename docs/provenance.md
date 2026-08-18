# Provenance and license boundary

本项目是针对 Pi 的 clean-room adapter。纯路由逻辑参考：

- [`yjh051108/dsh-router-standard`](https://github.com/yjh051108/dsh-router-standard)
- [`router-core.mjs`](https://github.com/yjh051108/dsh-router-standard/blob/main/preset/router-standard/router-core.mjs)
- [`router-bootstrap.mjs`](https://github.com/yjh051108/dsh-router-standard/blob/main/preset/router-standard/router-bootstrap.mjs)

参考项目页面标示为 MIT，并在其 `NOTICE` 中说明：

- 三段 behavior band、任务词典分类、persona 选择和 first-tool promotion 是参考算法来源；
- DeepSeek Harness Standard 的 derived preset content 和 `xiaobright` 项目分别有原始归属；
- DeepSeek 商标归其所有者，本项目不代表 DeepSeek。

本扩展没有复制 Cordis runtime、DSH schema、`system-prompt/assemble` 实现或 `ctx.llm.stream`。
`router-core.ts` 重新组织为 Pi-independent TypeScript 纯函数；Pi-specific 行为只在
`src/index.ts` 中实现。

本项目自身采用 MIT，见根目录 `LICENSE`。算法参考、behavior 名称以及 guidance 语义仍在此处
明确归属，便于后续发布时保留 attribution。
