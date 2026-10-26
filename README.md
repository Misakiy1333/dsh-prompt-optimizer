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

## 它不做什么 / What it does NOT do

**这是纯本地规则引擎，不调用模型。**

插件全部逻辑跑在浏览器里，零网络请求、零模型调用。它靠句式特征做切分和分类，**不理解语义**。所以：

- 它能整理你的表达结构，但不会替你补全没说出口的需求
- 它不会把「写个登录页」扩展成一份完整的产品规格
- 语义级的重写需要调用模型，本插件目前不走那条路

这个取舍是刻意的：调用模型会引入跨插件依赖，而本插件在 linked checkout 下解析不到 `@deepseek-ai/*` 包，硬依赖会导致加载失败。

## 闲聊输入原样保留 / Bare acknowledgements are left alone

`ok`、`好的`、`嗯`、`收到`、`继续`、`thanks` 这类纯确认词不会被套模板 —— 它们是在回应上一轮对话，不是指令。按钮会提示「这句太短，像答复而不是指令」。

## 安装 / Install

```bash
git clone https://github.com/Misakiy1333/dsh-prompt-optimizer.git
```

然后在 Harness 里安装本地目录：

```js
plugin_manager({
  action: "install_bundle",
  target: "<absolute-path-to>/dsh-prompt-optimizer"
})
```

或走 DSH 界面：**设置 → 插件 → 从本地目录安装**，选这个目录，然后刷新页面（F5）。

安装后按钮出现在 `conversation.input.right` 槽位，order 30，位于模型选择器左侧。

## 结构 / Layout

| 文件 | 作用 |
|---|---|
| `package.json` | bundle + client 声明 |
| `cordis.patch.yml` | 声明挂载的行 |
| `index.js` | Host 半边（空实现，仅为让 bundle 格式完整） |
| `client.js` | 客户端组件 + 本地改写引擎 |
| `locale/zh.json`, `locale/en.json` | 插件列表里的中英文名称与描述 |
| `icon.svg` | 图标 |

## 兼容性 / Compatibility

- 需要 Harness 提供 `conversation.input.right` 槽位（`@deepseek-ai/dsh-client-ui-conversation`）
- 依赖槽位标准 props：`useInput`、`inputActions.setDraft`、`sessionId`
- 已在 DeepSeek Harness Desktop（Windows）上实测

## 已知限制 / Known limits

- 句子切分基于标点，超长无标点的段落会整段当成一个目标
- 中英混排时按 CJK 字符数判断语言，混排比例接近时可能判错
- 草稿上限 6000 字符

## License

MIT — see [LICENSE](./LICENSE).
