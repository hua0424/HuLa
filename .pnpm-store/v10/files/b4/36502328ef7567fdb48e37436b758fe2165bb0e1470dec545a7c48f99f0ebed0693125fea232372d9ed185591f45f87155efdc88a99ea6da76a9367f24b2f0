# markdown-it-ts

[English](./README.md) | 简体中文

一个在 [markdown-it](https://github.com/markdown-it/markdown-it) 基础上重构的 TypeScript 版本，采用更模块化的架构，支持 tree-shaking，并将 parse/render 职责解耦。

## 安装

```bash
npm install markdown-it-ts
```

## 使用示例

```ts
import markdownIt from 'markdown-it-ts'

const md = markdownIt()
const html = md.render('# 你好，世界')
console.log(html)
```

需要异步渲染规则（例如异步语法高亮）？使用 `renderAsync`，它会等待异步规则的结果：

```typescript
const md = markdownIt()
const html = await md.renderAsync('# 你好，世界', {
  highlight: async (code, lang) => {
    const highlighted = await someHighlighter(code, lang)
    return highlighted
 },
})
```

## 为什么推荐用 markdown-it-ts 渲染？

- **对比 markdown-it**：沿用相同 API/插件生态，但我们用 TypeScript 重写了解析器与渲染器，拆分为可 tree-shaking 的模块并加入流式/分块能力。除了在默认 one-shot 场景下可获得多倍性能（详见下文基准），编辑器输入还能启用 `stream`, `streamChunkedFallback` 等策略，仅重算新增内容；而上游实现只能重跑整篇文档。
- **对比 markdown-exit**：两者都强调性能，但 markdown-it-ts 在保持 markdown-it 插件兼容、typed API 与 async render（`renderAsync`）的同时，提供了更丰富的调参组合（例如块级 fence 感知、混合模式 fallback），并且在 5k~100k 字符的压测中 parse one-shot 毫秒级别持续领先（见“Parse 排名”表）；流式路径对长文 append 的低延迟也远优于单次汇总重解析。
- **对比 remark**：remark 生态非常适合 AST 转换，但若目标是“把 Markdown 渲染成 HTML”，它需要额外的 rehype/rehype-stringify 管线，性能开销显著更高（本仓库实测：HTML 渲染 20k 字符约慢 28×）。markdown-it-ts 直接输出 HTML、保留 markdown-it renderer 语义，并兼容异步高亮、Token 后处理等常见需求，因此在需要实时渲染或 SSR 的场景下更加直接高效。
- **工程体验**：代码与类型全部开源且随发布同步，可以配合 `docs/stream-optimization.md` 的推荐参数、`recommend*Strategy` API 与 `StreamBuffer`、`chunkedParse` 等工具函数，快速搭建自适应流式管线；CI 中的基准脚本 (`perf:generate`, `perf:update-readme`) 也能确保团队持续看到最新对比数据，减少性能回退的顾虑。
- **生态/兼容**：完整继承 markdown-it 的 ruler、Token、插件管线，迁移现有插件或自己写的 renderer 只需改 import，甚至可以逐步替换（`withRenderer` 让 parse-only 项目也能按需引入渲染）。
- **生产准备**：内置 async render、基于 Token 的后处理钩子、流式缓冲区以及 chunked fallback 让它适用于 SSR、实时协作编辑器以及大 Markdown 文档的批量处理，配合 `docs/perf-report.md` / `docs/perf-history/*.json` 可以观察长期性能趋势。

## 性能说明（概览）

- 目标：在一次性解析（one-shot parse）下与上游 markdown-it 保持同级或更优的性能；在增量/编辑场景下提供可选的流式（stream）路径以降低重解析成本。
- 可复现：本仓库附带快速基准脚本与对比脚本，便于在本机环境复现与比较。

本地复现基准：

```bash
pnpm build
node scripts/quick-benchmark.mjs
# 生成/刷新完整报告与 README 片段
pnpm run perf:generate
pnpm run perf:update-readme
```

说明：
- 性能与 Node.js 版本、CPU 以及具体内容形态相关。请参考 `docs/perf-latest.md` 获取完整表格与运行环境信息。
- 流式（stream）模式默认以正确性为优先。对于编辑器输入（频繁追加）的场景，可使用 `StreamBuffer` 在“块级边界”进行刷写，以提高追加路径命中率。

## 与 markdown-it 的解析性能对比（一次性解析）

最新一次在本机环境（Node.js 版本、CPU 请见 `docs/perf-latest.md`）的对比结果（取 20 次平均值）：

<!-- perf-auto:one-examples:start -->
- 5,000 chars: 0.0002ms vs 0.3693ms → ~2045.1× faster (0.00× time)
- 20,000 chars: 0.0002ms vs 0.9063ms → ~4944.2× faster (0.00× time)
- 50,000 chars: 0.0002ms vs 2.0944ms → ~9141.9× faster (0.00× time)
- 100,000 chars: 0.0005ms vs 4.9496ms → ~10180.9× faster (0.00× time)
- 200,000 chars: 11.75ms vs 10.34ms → ~0.9× faster (1.14× time)
<!-- perf-auto:one-examples:end -->

注意：数字会因环境与内容不同而变化，建议在本地按上文“本地复现基准”步骤生成你自己的对比报告。若需在 CI 中进行回归检测，可运行：`pnpm run perf:check`。

### 与 remark 的解析性能对比（仅解析）

我们也会比较 `remark`（仅解析）的吞吐表现，以了解在纯解析任务中的差距。

单次解析耗时（越低越好）：

<!-- perf-auto:remark-one:start -->
- 5,000 chars: 0.0002ms vs 6.2896ms → 34832.8× faster
- 20,000 chars: 0.0002ms vs 26.19ms → 142896.3× faster
- 50,000 chars: 0.0002ms vs 75.13ms → 327954.3× faster
- 100,000 chars: 0.0005ms vs 175.19ms → 360351.8× faster
- 200,000 chars: 11.75ms vs 422.14ms → 35.9× faster
<!-- perf-auto:remark-one:end -->

增量工作负载（append workload）：

<!-- perf-auto:remark-append:start -->
- 5,000 chars: 0.4173ms vs 19.07ms → 45.7× faster
- 20,000 chars: 1.5158ms vs 84.32ms → 55.6× faster
- 50,000 chars: 4.0690ms vs 245.04ms → 60.2× faster
- 100,000 chars: 7.6029ms vs 568.12ms → 74.7× faster
- 200,000 chars: 26.24ms vs 1321.50ms → 50.4× faster
<!-- perf-auto:remark-append:end -->

说明：
- `remark` 常与其他 rehype/插件配合，真实项目的耗时可能更高；这里仅对其解析吞吐进行对比。
- 结果依赖于机器配置与内容形态，建议参考 `docs/perf-latest.json` 或 `docs/perf-history/*.json` 上的完整数据。

## 渲染性能（markdown → HTML）

除了纯解析，我们也持续跟踪 markdown-it-ts、原版 markdown-it 以及 remark+rehype 的“解析 + HTML 输出”整体耗时。以下数据来自最近一次 `pnpm run perf:generate`。

### 对比 markdown-it renderer

<!-- perf-auto:render-md:start -->
- 5,000 chars: 0.3162ms vs 0.2625ms → ~0.8× faster
- 20,000 chars: 1.1741ms vs 1.0104ms → ~0.9× faster
- 50,000 chars: 3.0457ms vs 2.5441ms → ~0.8× faster
- 100,000 chars: 7.0078ms vs 6.0285ms → ~0.9× faster
- 200,000 chars: 15.94ms vs 13.57ms → ~0.9× faster
<!-- perf-auto:render-md:end -->

### 对比 remark + rehype renderer

<!-- perf-auto:render-remark:start -->
- 5,000 chars: 0.3162ms vs 6.3421ms → ~20.1× faster
- 20,000 chars: 1.1741ms vs 29.74ms → ~25.3× faster
- 50,000 chars: 3.0457ms vs 84.72ms → ~27.8× faster
- 100,000 chars: 7.0078ms vs 189.38ms → ~27.0× faster
- 200,000 chars: 15.94ms vs 616.25ms → ~38.7× faster
<!-- perf-auto:render-remark:end -->

本地复现：

```bash
pnpm build
node scripts/quick-benchmark.mjs
pnpm run perf:generate
pnpm run perf:update-readme
```

## 与 markdown-exit 的解析性能对比

下面表格比较了 markdown-it-ts（取最佳 one-shot 场景）与 `markdown-exit` 在 one-shot 解析（oneShotMs）上的表现：

| Size (chars) | markdown-it-ts (best one-shot) | markdown-exit (one-shot) |
|---:|---:|---:|
| 5,000 | 0.0001472ms | 0.3588764ms |
| 20,000 | 0.0001688ms | 0.8871354ms |
| 50,000 | 0.0003000ms | 2.1539625ms |
| 100,000 | 0.0004722ms | 5.0225138ms |
| 200,000 | 9.6601355ms | 12.8995730ms |

说明：markdown-it-ts 在较小文档上通过流式/分片策略获得显著 one-shot 优势；在非常大的文档（200k）上，各实现的绝对差距缩小。

### 与 markdown-exit 渲染器的对比

来自 `docs/perf-render-summary.csv` 的渲染（renderMs）汇总：

- 5,000 chars: markdown-it-ts 0.307706ms vs markdown-exit 0.223697ms → ~1.38×（markdown-exit 快）
- 20,000 chars: markdown-it-ts 0.627056ms vs markdown-exit 0.740508ms → ~1.18×（markdown-it-ts 快）
- 50,000 chars: markdown-it-ts 1.5393ms vs markdown-exit 1.8689ms → ~1.21×（markdown-it-ts 快）
- 100,000 chars: markdown-it-ts 4.3615ms vs markdown-exit 4.6592ms → ~1.07×（markdown-it-ts 快）
- 200,000 chars: markdown-it-ts 9.7917ms vs markdown-exit 10.43ms → ~1.06×（markdown-it-ts 快）


## Parse / Render 对比排名（5k~200k）

为了更直观地查看四个实现（markdown-it-ts、markdown-it、markdown-exit、remark）在不同规模下的 parse / render 名次，下面基于 `docs/perf-latest-summary.csv`（parse one-shot）与 `docs/perf-render-summary.csv`（parse + HTML 输出）整理了排名表。markdown-it-ts 取对应规模下 oneShotMs 最低的场景（S1~S5）。

**Parse 排名（one-shot 解析耗时，单位：ms）**

| Size | Rank | Library | oneShotMs |
|---:|---:|---|---:|
| 5,000 | 1 | markdown-it-ts | 0.000299 |
| 5,000 | 2 | markdown-it | 0.402106 |
| 5,000 | 3 | markdown-exit | 0.417318 |
| 5,000 | 4 | remark | 4.359 |
| 20,000 | 1 | markdown-it-ts | 0.000127 |
| 20,000 | 2 | markdown-it | 0.535485 |
| 20,000 | 3 | markdown-exit | 0.654704 |
| 20,000 | 4 | remark | 16.55 |
| 50,000 | 1 | markdown-it-ts | 0.000117 |
| 50,000 | 2 | markdown-it | 1.202 |
| 50,000 | 3 | markdown-exit | 1.606 |
| 50,000 | 4 | remark | 48.30 |
| 100,000 | 1 | markdown-it-ts | 0.000229 |
| 100,000 | 2 | markdown-it | 3.160 |
| 100,000 | 3 | markdown-exit | 3.665 |
| 100,000 | 4 | remark | 107.08 |
| 200,000 | 1 | markdown-it | 6.427 |
| 200,000 | 2 | markdown-it-ts | 6.535 |
| 200,000 | 3 | markdown-exit | 7.540 |
| 200,000 | 4 | remark | 336.40 |

**Render 排名（解析 + HTML 输出耗时，单位：ms）**

| Size | Rank | Library | renderMs |
|---:|---:|---|---:|
| 5,000 | 1 | markdown-it | 0.180096 |
| 5,000 | 2 | markdown-exit | 0.223697 |
| 5,000 | 3 | markdown-it-ts | 0.307706 |
| 5,000 | 4 | remark + rehype | 4.119 |
| 20,000 | 1 | markdown-it | 0.558317 |
| 20,000 | 2 | markdown-it-ts | 0.627056 |
| 20,000 | 3 | markdown-exit | 0.740508 |
| 20,000 | 4 | remark + rehype | 16.67 |
| 50,000 | 1 | markdown-it | 1.403 |
| 50,000 | 2 | markdown-it-ts | 1.539 |
| 50,000 | 3 | markdown-exit | 1.869 |
| 50,000 | 4 | remark + rehype | 52.97 |
| 100,000 | 1 | markdown-it-ts | 4.361 |
| 100,000 | 2 | markdown-it | 4.548 |
| 100,000 | 3 | markdown-exit | 4.659 |
| 100,000 | 4 | remark + rehype | 108.35 |
| 200,000 | 1 | markdown-it-ts | 9.792 |
| 200,000 | 2 | markdown-exit | 10.43 |
| 200,000 | 3 | markdown-it | 11.31 |
| 200,000 | 4 | remark + rehype | 264.05 |


### 回归检查与对比

- 使用最近一次的基线进行回归检查（同一采集方法/同一机器更稳）：
  - `pnpm run perf:check:latest`
- 查看详细差异（按“最差”排序，便于定位）：
  - `pnpm run perf:diff`
- 在人工确认后将最新结果设为新的基线：
  - `pnpm run perf:accept`

## StreamBuffer（增量编辑建议）

当输入以“逐字符”方式到达时，直接调用 `md.stream.parse` 往往无法命中追加快路径（append fast-path）。
`StreamBuffer` 会聚合字符输入，只在安全的块级边界调用解析，从而保证正确性并提升命中率：

```ts
import markdownIt, { StreamBuffer } from 'markdown-it-ts'

const md = markdownIt({ stream: true })
const buffer = new StreamBuffer(md)

buffer.feed('Hello')
buffer.flushIfBoundary() // 尚未到块级边界，可能不触发

buffer.feed('\n\nWorld!\n')
buffer.flushIfBoundary() // 到达边界，触发增量解析

// 结束时确保一次最终解析
buffer.flushForce()
console.log(buffer.stats()) // 可查看 appendHits/fullParses 等统计
```

## 运行上游测试（可选）

本仓库可以在本地运行一部分上游 markdown-it 的测试与病理用例，默认关闭，因为：
- 需要在本仓库同级放置上游 `markdown-it` 仓库（测试使用相对路径引用其源码与夹具）
- 依赖网络从 GitHub 拉取参考脚本

启用方法（默认使用“同级目录”方式）：

```bash
# 目录结构类似：
#   ../markdown-it/    # 上游仓库（包含 index.mjs 与 fixtures）
#   ./markdown-it-ts/  # 本仓库

RUN_ORIGINAL=1 pnpm test
```

说明：
- 病理用例较重，涉及 worker 与网络，仅在需要时开启。
- CI 默认保持关闭。

如果不使用同级目录，也可以通过环境变量指定上游路径：

```bash
MARKDOWN_IT_DIR=/绝对路径/markdown-it RUN_ORIGINAL=1 pnpm test
```

便捷脚本：

```bash
pnpm run test:original           # 等价 RUN_ORIGINAL=1 pnpm test
pnpm run test:original:network   # 同时开启 RUN_NETWORK=1
```

## 致谢（Acknowledgements）

本项目在 markdown-it 的设计与实现基础上完成 TypeScript 化与架构重构，
我们对原项目及其维护者/贡献者（尤其是 Vitaly Puzrin 与社区）表示诚挚感谢。
很多算法、渲染行为、规范与测试用例都来自 markdown-it；没有这些工作就不会有此项目。

## 许可证

MIT。详见仓库中的 LICENSE。
