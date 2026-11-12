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

维护者现在会收到读起来很像样、描述的却是项目里根本没有的代码的 PR 和 bug 报告：一个从没写过的函数、一个放错地方的文件、“fixes #41” 而 #41 是别人的 PR、嘴上说加了测试其实没有。一条条手动去核对，正是最消耗维护者的工作。pr-proof 替你核对，并留下这样一条评论（测试项目上的真实输出）：

> **pr-proof** could not verify 5 statements in this pull request against the repository:
>
> | | Says | Checked |
> |---|---|---|
> | Fixes (line 1) | #41 | It says it fixes #41, which is a pull request, not an issue. |
> | File (line 3) | src/widget/tokens.py | No file or folder `src/widget/tokens.py` in this repository or in this pull request's changes (at a47c80f). |
> | Function (line 3) | refresh_token_cache() | The name `refresh_token_cache` appears nowhere in this repository or in this pull request's changes (at a47c80f). |
> | Option (line 4) | --force-sync | The option `--force-sync` appears nowhere in this repository or in this pull request's changes (at a47c80f). |
> | Tests (line 4) | This also adds regression tests. | It says it adds tests, but none of the changed files is a test file. |

作者改好描述或代码之后，下一次运行会把同一条评论改成“全部核对通过”，并去掉标签。

## 核对什么

| | |
|---|---|
| **文件** | 行内代码里的路径（`src/auth.py`、`lib/x.js:42`、`docs/`），以及代码块里堆栈信息中的路径（Python、JavaScript、Go）：在仓库里，或者被这个 PR 新增、改名、删除 |
| **函数** | 行内代码里的 `name()`、`obj.name()`、`Mod::name()`：这个名字在仓库里或 PR 新增的行里出现过 |
| **选项** | 行内代码里的 `--long-option`：在仓库或 PR 里出现过 |
| **引用** | `#12`、`owner/repo#12` 和 issue 链接是否存在；PR 里“fixes / closes / resolves #12”指向的是 issue 而不是 PR |
| **安全公告** | CVE 编号在 CVE 列表（cve.org）里存在；GHSA 编号在 GitHub Advisory Database 里存在 |
| **说法** | PR 说加了测试，就要改到测试文件；说更新了文档，就要改到文档 |

有意跳过：HTML 注释（PR 模板把说明放在里面）、引用的回复、没勾选的复选框、否定说法（“还没有测试”“测试之后补”）、网址、占位符（`path/to/file`、`your-app`）、系统绝对路径（`/etc/hosts`、`~/.config`）、通配符，以及代码块里除堆栈信息以外的名字（贴出来的代码片段调用的是别人的代码）。

## 它绝不做的事

- **不用 AI。** 每条结果你都可以自己去核实：一个文件列表、源码里的一个词、一个 API 的回答。
- **不指控。** 它不说某个贡献是 AI 写的、是垃圾、或者不好。它只说哪些说法核对不上，以及怎么回应（“一个链接或一句解释就够了”）。
- **不运行 PR 里的任何东西。** 它读取已检出的基础分支，以及通过 API 拿到的 PR 改动。所以它和 `pull_request_target` 一起用是安全的（fork 来的 PR 需要它才能拿到能发评论的 token）。
- **不做决定。** 它不关闭、不批准、不要求修改，只评论和打标签；`mode: summary` 连这些都不做。
- 默认**跳过维护者和机器人**（`check-maintainers: true` 可以把他们也算上）。

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
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      # 基础分支（pull_request_target 的默认）：不会检出 PR 里的任何东西。
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: zch6a/pr-proof@v0.1.0
        with:
          mode: summary # 先只写任务摘要；觉得说得对了再改成 "comment"
```

输入项、输出项和命令行用法见 [English README](README.md#use)。

它可以和看 PR“形式”的工具一起用，比如 [anti-slop](https://github.com/peakoss/anti-slop)（分支名、大小、模板、账号年龄）：它们查形式，pr-proof 查事实。

## 局限

- **依赖库里的函数会被报出来。** 仓库里只要哪里出现过 `get`，`requests.get()` 就算找到（通常都会出现）；只有依赖库才有的函数找不到。评论里写了怎么回应。
- 只有在整个仓库（文本最多 300 MB、单个文件最多 1 MB）和整个 diff 都读完时才核对函数和选项名；否则列为“未核对”，绝不说成“不存在”。
- “加了测试”“更新了文档”目前只识别英文；测试和文档文件按文件名和目录识别。
- 引用了 token 看不到的仓库里的 issue，不核对。只支持 GitHub 上的仓库。

## 许可证

[MIT](LICENSE)
