# Provenance and license boundary

本项目是针对 Pi 的 **independent port/adaptation**（独立移植/改编），不是 clean-room
实现：`router-core.ts` 明确参考并移植了上游的以下逻辑：

- keyword classifier：任务关键词分类（build / fix / inspect 任务带）；
- behavior bands：spec / mixed / react / weak 行为带模型；
- persona / guidance semantics：各行为带对应的人设与近场 guidance 语义。

参考来源：

- [`yjh051108/dsh-router-standard`](https://github.com/yjh051108/dsh-router-standard)
- [`router-core.mjs`](https://github.com/yjh051108/dsh-router-standard/blob/main/preset/router-standard/router-core.mjs)
- [`router-bootstrap.mjs`](https://github.com/yjh051108/dsh-router-standard/blob/main/preset/router-standard/router-bootstrap.mjs)

上游 LICENSE 为 MIT，版权声明为 `Copyright (c) 2026 yjh051108`。按照 MIT 许可的
“上述版权声明与许可声明须包含在软件的所有副本或实质部分中”的要求，根目录 `NOTICE`
完整保留了上游版权与许可声明。

参考项目自身的 `NOTICE` 还说明：

- DeepSeek Harness Standard 的 derived preset content 与 `xiaobright` 项目
  （`dsh-anchored-standard`、`modeltest`）分别有原始归属；
- DeepSeek 商标归其所有者，本项目不代表 DeepSeek。

本扩展没有复制 Cordis runtime、DSH schema、`system-prompt/assemble` 实现或
`ctx.llm.stream`。`router-core.ts` 将上游算法重新组织为 Pi-independent 的
TypeScript 纯函数；Pi-specific 行为只在 `src/index.ts` 中实现。

本项目自身采用 MIT，见根目录 `LICENSE`（Copyright (c) 2026 pi-deepseek-router
contributors）。算法参考、behavior 名称以及 guidance 语义仍在 `NOTICE` 与本文中
明确归属，便于后续发布时保留 attribution。
