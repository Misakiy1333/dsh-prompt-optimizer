# dsh-prompt-optimizer

A composer button for [DeepSeek Harness](https://github.com/deepseek-ai) that rewrites the current draft into a structured prompt and puts it straight back into the input box — it never sends.

输入框右下角加一个「优化提示词」按钮：点一下，当前草稿被改写成结构化提示词，直接填回输入框，**不会替你发送**。

---

## 它做什么 / What it does

You type a rough request, click the button, and the draft becomes a scaffolded prompt with a goal, its constraints separated out, and an output contract that matches the kind of request it detected.

你写一句粗略的需求，点一下按钮，草稿变成：目标、拆分出来的约束、以及匹配意图的输出要求。

```
帮我写一个登录页。要有记住密码。还要适配手机。不要用第三方库。
        ↓  点「优化提示词」
## 目标
帮我写一个登录页。

## 约束
- 要有记住密码。
- 还要适配手机。
- 不要用第三方库。

## 输出要求
- 直接给出可用的结果，不要复述本提示词
- 结论先行，必要的推理过程放在结论之后
- 完整可运行/可直接使用，不要留 TODO 占位
- 不确定的地方明确标注，不要编造
```

## 三个意图分支 / Three intent branches

| 意图 | 判断依据 | 输出要求差异 |
|---|---|---|
| **任务** task | 出现「写 / 做 / 生成 / 实现 / 重构」等动词 | 完整可运行、不留 TODO |
| **提问** question | 出现「为什么 / 怎么 / 如何 / 是否」等疑问词 | 先答问题、展开理由、给出依据 |
| **开放** open | 两者都不匹配 | 先确认理解、多方案列取舍 |

约束类句子（「要有…」「不要…」「必须…」）会被从普通要求里分出来，单独成段。

## 它怎么工作 / How it works

**真实模型调用，不是模板拼接。**

点击按钮会让**当前会话正在使用的那个模型**重写你的草稿：保留原意、拆出约束、按任务性质补输出要求。调用走 Harness 的 `llm` 服务，用的是你已经在用的 provider 和 model，不需要额外配置 API key。

一次调用大约几秒，期间按钮转圈并禁用。

### 模型不可用时回退到本地规则

如果会话没有模型路由、模型调用报错或超时，插件会**自动退回本地规则引擎**：按句式特征做切分和意图分类，产出一份结构化的提示词，并在按钮上提示「已用本地规则」。它不理解语义，但至少能整理结构，不会让你一无所获。

### 架构 / Architecture

```
Composer 按钮
    ↓ ctx.remote.promptOptimizer.optimize(draft, provider, model)
Client 半边 ── 手写 Typert Remote contribution ──→ Gateway
    ↓
Host 半边 ── PromptOptimizerService.optimize ──→ llm.prepareCall / stream
```

**Remote 是手写的，没有用代码生成器。** `createTypertRemoteInfo(spec, zod)` 接受普通对象——生成器产出的文件本身就是这样的对象。两侧各写一份相同结构即可：

- Host：`ctx.get('typert').remotes.register(contribution)` 让 Gateway 认领端点
- Client：`ctx.remote.$mount(contribution)` 挂载命名空间

Client 的工厂函数只能 `require('react')`，所以它传的是纯描述对象；Gateway 校验 `codec.mode === 'strict'` 等结构字段，不校验 zod 实例身份。

### 依赖边界 / Dependency boundaries

这两条都来自真实踩过的坑：

- `@deepseek-ai/dsh-typert-protocol` **从 profile 安装的包里无法 import**，所以 `RemoteError` 在本地重新声明。协议自己的类靠 `isDSHRemoteError` 标记做跨 realm 识别而非 `instanceof`，本副本跨线语义完全一致。
- `zod` **只有从包目录才能解析**（link 安装时 Node 从源码目录起解析），所以它在 `dependencies` 里声明，并装进插件自身目录。

## 闲聊输入原样保留 / Bare acknowledgements are left alone

`ok`、`好的`、`嗯`、`收到`、`继续`、`thanks` 这类纯确认词不会被套模板 —— 它们是在回应上一轮对话，不是指令。按钮会提示「这句太短，像答复而不是指令」，草稿保持不动。

## 安装 / Install

```bash
git clone https://github.com/Misakiy1333/dsh-prompt-optimizer.git
cd dsh-prompt-optimizer
pnpm install          # 只为装 zod，Host 半边需要
```

然后在 Harness 里安装本地目录：

```js
plugin_manager({
  action: "install_bundle",
  target: "<absolute-path-to>/dsh-prompt-optimizer"
})
```

或走 DSH 界面：**设置 → 插件 → 从本地目录安装**，选这个目录。

**装完必须重启 DSH**，不只是刷新页面：Host 半边变了，HMR 只热替换客户端。

安装后按钮出现在 `conversation.input.right` 槽位，order 30，位于模型选择器左侧。

## 结构 / Layout

| 文件 | 作用 |
|---|---|
| `package.json` | bundle + client 声明，`zod` 依赖 |
| `cordis.patch.yml` | 声明挂载的行 |
| `index.js` | Host 半边：`PromptOptimizerService` + 手写 Remote 声明 + 模型调用 |
| `client.js` | 客户端：按钮组件 + Remote 挂载 + 本地回退引擎 |
| `locale/zh.json`, `locale/en.json` | 插件列表里的中英文名称与描述 |
| `icon.svg` | 图标 |

## 兼容性 / Compatibility

- 需要 Harness 提供 `conversation.input.right` 槽位（`@deepseek-ai/dsh-client-ui-conversation`）
- 需要 `remote` 客户端服务与 `typert` 注册表；缺失时按钮仍显示，但会提示无路由
- 依赖槽位标准 props：`useInput`、`inputActions.setDraft`、`sessionId`
- 已在 DeepSeek Harness Desktop（Windows）上实测
- 回退引擎需要 `llm` 服务不可用时不报错——它只依赖句式规则

## 已知限制 / Known limits

**模型调用**
- 一次调用几秒；超时上限 90 秒
- 输出上限 1600 字符，超出按行截断
- 用的是会话当前模型路由；没选模型时会回退到 catalog 默认

**回退引擎**
- 句子切分基于标点，超长无标点的段落会整段当成一个目标
- 中英混排时按 CJK 字符数判断语言，混排比例接近时可能判错
- 草稿上限 6000 字符

## License

MIT — see [LICENSE](./LICENSE).
