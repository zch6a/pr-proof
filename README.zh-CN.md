<div align="center">

# pr-proof

**拿你的仓库去核对 PR 或 issue 里说的话。** 它提到的文件、函数、命令行选项存不存在；引用的 issue 是不是真的；“fixes #41” 指向的是不是一个 issue；说“加了测试”是不是真有测试；引用的 CVE 存不存在。核对不上的写进一条评论，再打一个标签。不用 AI，也不猜是谁或什么写的：只讲事实，请对方补充证据。

<a href="https://github.com/zch6a/pr-proof/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/zch6a/pr-proof/actions/workflows/ci.yml/badge.svg"></a>
<img alt="No dependencies" src="https://img.shields.io/badge/dependencies-0-2ea44f">
<img alt="No AI" src="https://img.shields.io/badge/AI-none-blue">
<a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue"></a>

[English](README.md) · **简体中文**

</div>

---

维护者现在会收到一些 PR 和 bug 报告，读起来很像样，描述的却是项目里根本没有的代码：一个从没写过的函数、一个放错地方的文件、“fixes #41” 而 #41 是别人的 PR、嘴上说加了测试其实没有。一条条手动去核对，正是最消耗维护者的工作。pr-proof 替你核对，并留下这样一条评论（测试项目上的真实输出）：

> **pr-proof** could not verify 5 statements in this pull request against the repository:
>
> | | Says | Checked |
> |---|---|---|
> | Fixes (line 1) | `#41` | It says it fixes #41, which is a pull request, not an issue: closing keywords only close issues. |
> | File (line 3) | `src/widget/tokens.py` | No file or folder `src/widget/tokens.py` in this repository or in this pull request's changes (at ffadaa6). |
> | Function (line 3) | `refresh_token_cache()` | The name `refresh_token_cache` appears nowhere in this repository or in this pull request's changes (at ffadaa6). |
> | Option (line 4) | `--force-sync` | The option `--force-sync` appears nowhere in this repository or in this pull request's changes (at ffadaa6). |
> | Tests (line 4) | `This also adds regression tests.` | It says it adds tests, but none of the changed files is a test file, and no added line is a test. |
>
> If these are right (a function from a dependency, an issue in another tracker), a link or a line of explanation is all that is needed. This is a check of facts, not a judgement of the contribution or of how it was written.
>
> <sub>Checked 1 file, 1 function, 1 option, 1 reference and 1 statement about tests or docs against ffadaa6. [pr-proof](https://github.com/zch6a/pr-proof) runs no AI and nothing from the pull request.</sub>

作者改好描述或代码之后，下一次运行会把同一条评论改成“全部核对通过”，并去掉标签。这两点都在 GitHub 上真实跑过：本仓库的 [PR #1](https://github.com/zch6a/pr-proof/pull/1) 和 [issue #2](https://github.com/zch6a/pr-proof/issues/2)。

## 核对什么

| | |
|---|---|
| **文件** | 行内代码里的路径（`src/auth.py`、`lib/x.js:42`、`docs/`），以及代码块里堆栈信息中的路径（Python、JavaScript、Go）：在仓库里，或者被这个 PR 新增、改名、删除 |
| **函数** | 行内代码里的 `name()`、`obj.name()`、`Mod::name()`：这个名字在仓库里或 PR 新增的行里出现过 |
| **选项** | 行内代码里的 `--long-option`：在仓库或 PR 里出现过 |
| **引用** | `#12`、`owner/repo#12` 和 issue 链接是否存在；PR 里“fixes / closes / resolves #12”指向的是 issue 而不是 PR |
| **安全公告** | CVE 编号在 CVE 列表（cve.org）里存在；GHSA 编号在 GitHub Advisory Database 里存在 |
| **说法** | PR 说加了测试，就要改到测试文件；说更新了文档，就要改到文档 |

有意跳过（把真实存在的东西说成“无法核实”，会冤枉贡献者）：HTML 注释（PR 模板把说明放在里面）、引用的回复、模板里的复选框（勾没勾都不算作者本人的说法）；否定、提问、表态和计划（“我没加测试”“要不要加测试？”“之后再补测试”），以及测试运行结果（“全部 456 个测试通过”）；不属于这个仓库的名字：不带目录的文件名（`sample.txt` 通常是读者自己的文件）、带斜杠的普通词（`and/or`、`react-dom/client`、`origin/main`）、库名（`Node.js`）、网址、占位符、绝对路径和家目录路径、通配符、被忽略或生成的文件、子模块里的文件；堆栈信息里依赖库和运行时的帧（`site-packages`、`node_modules`、`/usr/lib`），以及代码块里除堆栈信息以外的代码；标准库的调用（`JSON.parse()`）、所有框架都自带的选项（`--help`）、颜色（讲颜色的那一行里的 `#333`）、序号（“step #1”）和 `#0`。

**实测**：在 11 个项目（Flask、Express、HTTPie、bat、HTTPX、Vite、cobra、OkHttp、Laravel、mdBook、Docusaurus：Python、JavaScript/TypeScript、Rust、Go、Kotlin/Java、PHP）最近合并的 230 个 PR 和 79 个已关闭的 issue 上运行（合并过的 PR 里被报出来的几乎都是误报），一共只报了 7 个 PR 里的 7 条，issue 里一条也没有：1 条是真问题（描述里把一个 PR 根本没碰的文件写成问题所在），5 条是用 “fixes” 指向了一个（被取代、已关闭的）PR，1 条是依赖库里的函数（可以用 `ignore` 排除）。建索引最多 6.4 秒、230 MB（Docusaurus，4,310 个文件）。`scripts/precision.mjs` 可以对照这个基线重跑。

## 它绝不做的事

- **不用 AI。** 每条结果你都可以自己去核实：一个文件列表、源码里的一个词、一个 API 的回答。
- **不指控。** 它不说某个贡献是 AI 写的、是垃圾、或者不好。它只说哪些说法核对不上，以及怎么回应（“一个链接或一句解释就够了”）。
- **不运行 PR 里的任何东西。** 它读取已检出的基础分支，以及通过 API 拿到的 PR 改动。所以它和 `pull_request_target` 一起用是安全的（fork 来的 PR 需要它才能拿到能发评论的 token）。
- **不做决定。** 它不关闭、不批准、不要求修改，只评论和打标签；`mode: summary` 连这些都不做。
- 默认**跳过维护者和机器人**（`check-maintainers: true` 可以把他们也算上）。
- **不会因为工作流的配置去怪贡献者**：fork 来的 PR 用 `pull_request` 事件时 token 只读，它只写任务摘要；token 没有写权限时给一个警告，而不是让检查变红。

## 使用

`.github/workflows/pr-proof.yml`：

```yaml
name: pr-proof
on:
  pull_request_target:
    types: [opened, edited, synchronize, reopened]
  issues:
    types: [opened, edited]
permissions:
  contents: read
  issues: write
  pull-requests: write
# 每个 PR 或 issue 同一时间只跑一个（刚打开就编辑，两次运行会抢着写评论）。
concurrency:
  group: pr-proof-${{ github.event.pull_request.number || github.event.issue.number }}
  cancel-in-progress: true
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      # 基础分支（pull_request_target 的默认）：不会检出 PR 里的任何东西。
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: zch6a/pr-proof@v1 # 或者某个发布版，比如 @v1.0.0
        with:
          mode: summary # 先只写任务摘要；觉得说得对了再改成 "comment"
```

输入项、输出项和命令行用法见 [English README](README.md#use)。`ignore` 可以列出永远不核对的名字（依赖库的函数、别的工具的选项、生成的路径，`*` 匹配任意字符），一行一个或用逗号分隔。1.x 的每个版本都保持不变的东西（输入项、评论、退出码、JSON）见 [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md)。

**issue 里默认不核对名字**，只核对引用和安全公告。在 11 个项目已关闭的 issue 上实测：issue 里提到的文件、函数、选项大多是报告者自己的项目（“在我的应用里，`src/lib/bread.ts` ……”）、功能建议（“希望能有 `--markdown-tables`”），或者在开 issue 时是对的、后来改掉了的名字。`issue-names: true` 可以照样核对（适合收到大量编造 bug 报告的项目）。

它可以和看 PR“形式”的工具一起用，比如 [anti-slop](https://github.com/peakoss/anti-slop)（分支名、大小、模板、账号年龄）：它们查形式，pr-proof 查事实。

## 局限

- **依赖库里的函数会被报出来。** 仓库里只要哪里出现过 `get`，`requests.get()` 就算找到（通常都会出现）；只有依赖库才有的函数找不到。评论里写了怎么回应，`ignore` 可以永久排除这类名字。
- 只有在整个仓库（文本最多 300 MB；源文件最多 16 MB，UTF-8 或 UTF-16）和整个 diff 都读完时才核对函数和选项名；否则列为“未核对”，绝不说成“不存在”。超过 3,000 个文件的 PR（API 最多只列这么多）也一样。
- 一段文字最多查 30 个引用和 30 个安全公告编号，其余的列为“未核对”。
- “加了测试”“更新了文档”目前只识别英文；测试和文档文件按文件名和目录识别。
- 引用了 token 看不到的仓库里的 issue，不核对。只支持 GitHub 上的仓库。

误报是最严重的 bug：看到了请[告诉我们](https://github.com/zch6a/pr-proof/issues/new?template=false-alarm.yml)。参与开发见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[MIT](LICENSE)
