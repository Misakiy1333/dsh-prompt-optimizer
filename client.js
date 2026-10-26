window.__ModuleLoader__.load({
  id: 'dsh-prompt-optimizer',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Slot cell: compact controls before the composer submit action. */
    const SLOT = 'conversation.input.right';
    /** Our own cell id — a fresh id adds a cell beside the shipped entries. */
    const CELL = 'prompt-optimizer';
    /** Drafts above this size are refused instead of rewritten. */
    const MAX_DRAFT = 6000;
    /** How long a transient state stays visible. */
    const FLASH_MS = 2400;

    /* ── copy ─────────────────────────────────────────────────────────────── */

    const COPY = {
      zh: {
        idle: '优化提示词',
        done: '已优化',
        tip: '把当前输入改写成结构化提示词（只改草稿，不发送）',
        tipDone: '已填回输入框，发送前可以继续改',
        empty: '输入框是空的，先写一句再点优化',
        tooLong: '草稿超过 6000 字，先精简一下',
        noSession: '先进入一个会话再优化',
        trivial: '这句太短，像答复而不是指令；写清要做什么再优化',
      },
      en: {
        idle: 'Improve prompt',
        done: 'Improved',
        tip: 'Rewrite the current draft as a structured prompt (edits the draft, does not send)',
        tipDone: 'Filled back into the composer; keep editing before you send',
        empty: 'The composer is empty — write a line first',
        tooLong: 'Draft is longer than 6000 characters; trim it first',
        noSession: 'Open a session first',
        trivial: 'Too short to be an instruction — say what you want done, then retry',
      },
    };

    /** Pick the copy table for a locale id such as `zh-CN`. */
    function copyFor(locale) {
      const id = typeof locale === 'string' ? locale.toLowerCase() : '';
      return id.startsWith('zh') ? COPY.zh : COPY.en;
    }

    /* ── local rewrite engine (no imports, no network) ────────────────────── */

    /** Split a draft into sentence-ish fragments, keeping list markers separate. */
    function fragments(text) {
      return text
        .split(/\n+/u)
        .map((line) => line.trim())
        .filter((line) => line !== '')
        .flatMap((line) => {
          // Keep an explicit list item as one unit; split prose on terminator marks.
          if (/^([-*•·]|\d+[.、)])\s+/.test(line)) return [line.replace(/^([-*•·]|\d+[.、)])\s+/, '')];
          return line
            .split(/(?<=[。！？；])|(?<=[.!?;])\s+/u)
            .map((part) => part.trim())
            .filter((part) => part !== '');
        });
    }

    /** Detect the draft language so the rewritten prompt matches it. */
    function languageOf(text) {
      const cjk = (text.match(/[\u4e00-\u9fff]/gu) ?? []).length;
      const latin = (text.match(/[A-Za-z]/gu) ?? []).length;
      return cjk >= latin ? 'zh' : 'en';
    }

    /** Cues that mark a fragment as a constraint rather than the main goal. */
    const CONSTRAINT_CUES_ZH = ['要', '需要', '必须', '不要', '别', '不能', '支持', '适配', '兼容', '用', '基于', '限制', '注意', '确保', '保证'];
    const CONSTRAINT_CUES_EN = ['must', 'should', 'need', 'needs', 'required', "don't", 'do not', 'avoid', 'without', 'support', 'using', 'use', 'based on', 'ensure', 'make sure'];

    /** Question-like openers that mean the goal is a question, not a build task. */
    const QUESTION_CUES_ZH = ['为什么', '怎么', '如何', '什么', '哪里', '哪个', '是否', '能不能', '可不可以'];
    const QUESTION_CUES_EN = ['why', 'how', 'what', 'where', 'which', 'whether', 'can ', 'could ', 'is it', 'does '];

    /** A task verb list used to decide whether the draft asks for output or an answer. */
    const TASK_CUES_ZH = ['写', '做', '生成', '实现', '创建', '改', '优化', '设计', '分析', '检查', '修复', '重构', '翻译', '总结', '对比', '解释'];
    const TASK_CUES_EN = ['write', 'build', 'create', 'implement', 'make', 'generate', 'refactor', 'design', 'analyse', 'analyze', 'review', 'fix', 'translate', 'summarise', 'summarize', 'compare', 'explain'];

    function hasAny(text, cues) {
      const lower = text.toLowerCase();
      return cues.some((cue) => lower.includes(cue));
    }

    /**
     * Bare acknowledgements and conversational filler. These answer the previous
     * turn; they are not instructions, so wrapping them in a prompt scaffold
     * only adds noise.
     */
    const TRIVIAL = [
      'ok', 'okay', 'k', 'yes', 'no', 'sure', 'thanks', 'thank you', 'thx', 'got it', 'yep', 'nope',
      '好', '好的', '好吧', '行', '可以', '嗯', '哦', '收到', '了解', '明白了', '懂了', '谢谢', '多谢',
      '继续', '接着来', '再来', '对', '是的', '不是', '没问题', '辛苦了', 'ok了', '好了',
    ];

    /** True when the draft carries no instruction worth restructuring. */
    function isTrivial(text) {
      const compact = text
        .toLowerCase()
        .replace(/[\s。！？!?.,，、~～…—-]+/gu, '');
      if (compact === '') return true;
      // Nothing beyond a couple of acknowledgement characters.
      if (compact.length <= 4) {
        return TRIVIAL.some((word) => {
          const w = word.replace(/[\s。！？!?.,，、~～…—-]+/gu, '');
          return w !== '' && compact === w;
        });
      }
      return TRIVIAL.includes(compact);
    }

    /** Classify the draft so the generated scaffold matches its real intent. */
    function classify(text) {
      const zh = languageOf(text) === 'zh';
      const isQuestion = hasAny(text, zh ? QUESTION_CUES_ZH : QUESTION_CUES_EN);
      const isTask = hasAny(text, zh ? TASK_CUES_ZH : TASK_CUES_EN);
      if (isQuestion && !isTask) return 'question';
      if (isTask) return 'task';
      return 'open';
    }

    /** True when a fragment reads like a constraint or requirement. */
    function isConstraint(fragment, zh) {
      if (/^([-*•·]|\d+[.、)])/.test(fragment)) return true;
      return hasAny(fragment, zh ? CONSTRAINT_CUES_ZH : CONSTRAINT_CUES_EN);
    }

    /** Headings per intent and language. */
    const HEADINGS = {
      zh: {
        goal: '## 目标',
        context: '## 背景',
        requirements: '## 要求',
        constraints: '## 约束',
        output: '## 输出要求',
      },
      en: {
        goal: '## Goal',
        context: '## Context',
        requirements: '## Requirements',
        constraints: '## Constraints',
        output: '## Output',
      },
    };

    /** Output contracts per intent. */
    const OUTPUT_RULES = {
      zh: {
        question: [
          '- 先直接回答问题，再展开理由',
          '- 不确定的地方明确标注，不要编造',
          '- 需要引用事实时给出依据来源',
        ],
        task: [
          '- 直接给出可用的结果，不要复述本提示词',
          '- 结论先行，必要的推理过程放在结论之后',
          '- 完整可运行/可直接使用，不要留 TODO 占位',
          '- 不确定的地方明确标注，不要编造',
        ],
        open: [
          '- 先确认你的理解，再给出结果',
          '- 不确定的地方明确标注，不要编造',
          '- 若有多种可行方案，列出并说明取舍',
        ],
      },
      en: {
        question: [
          '- Answer the question first, then give the reasoning',
          '- Flag anything uncertain instead of inventing it',
          '- Cite the basis when you state a fact',
        ],
        task: [
          '- Give the finished result directly; do not restate this prompt',
          '- Lead with the conclusion; keep supporting reasoning after it',
          '- Complete and runnable — leave no TODO placeholders',
          '- Flag anything uncertain instead of inventing it',
        ],
        open: [
          '- State your understanding before the result',
          '- Flag anything uncertain instead of inventing it',
          '- If several approaches work, list them with the tradeoffs',
        ],
      },
    };

    /**
     * Turn a free-form draft into a structured prompt.
     * Local rules only: no network, no model call, no imports.
     * @param {string} raw
     * @returns {string}
     */
    function optimize(raw) {
      const text = String(raw ?? '').trim();
      if (text === '') return '';

      // A bare acknowledgement is not an instruction: hand it back untouched so
      // the caller can tell the user there is nothing to restructure.
      if (isTrivial(text)) return '';

      const zh = languageOf(text) === 'zh';
      const head = zh ? HEADINGS.zh : HEADINGS.en;
      const parts = fragments(text);

      // The first fragment carries the goal unless it is a bare constraint.
      let goal = (parts[0] ?? text).replace(/[：:]\s*$/u, '');
      let rest = parts.slice(1);
      if (isConstraint(goal, zh) && rest.length > 0) {
        goal = rest[0].replace(/[：:]\s*$/u, '');
        rest = parts.filter((_, index) => index !== 1).slice(1);
      }
      if (goal === '') goal = text.replace(/[：:]\s*$/u, '');

      const requirements = [];
      const constraints = [];
      for (const part of rest) {
        if (isConstraint(part, zh)) constraints.push(part);
        else requirements.push(part);
      }

      const intent = classify(text);
      const out = [head.goal, goal];

      if (requirements.length > 0) {
        out.push('', head.requirements);
        for (const line of requirements) out.push(`- ${line}`);
      }
      if (constraints.length > 0) {
        out.push('', head.constraints);
        for (const line of constraints) out.push(`- ${line}`);
      }

      out.push('', head.output);
      for (const line of (zh ? OUTPUT_RULES.zh : OUTPUT_RULES.en)[intent]) out.push(line);

      return out.join('\n');
    }

    /* ── inline styles ────────────────────────────────────────────────────── */

    /**
     * A plugin factory gets no `styles` builtin — only `React`, `require`,
     * `ctx` and `console`. Every visual property is therefore an inline React
     * style object, which also keeps cleanup automatic on unmount.
     */
    const S = {
      wrap: { display: 'flex', alignItems: 'center' },
      button: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        height: '24px',
        padding: '0 8px',
        border: '1px solid var(--dsw-alias-border-subtle, rgba(127,127,127,.28))',
        borderRadius: 'var(--dsw-radius-sm, 6px)',
        background: 'transparent',
        color: 'var(--dsw-alias-text-secondary, inherit)',
        fontFamily: 'var(--dsw-font-family, inherit)',
        fontSize: '12px',
        lineHeight: '1',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transition: 'background .15s ease, color .15s ease, border-color .15s ease',
      },
      buttonDone: {
        color: 'var(--dsw-alias-text-success, #0a8f3c)',
        borderColor: 'currentColor',
      },
      buttonDisabled: { opacity: '.45', cursor: 'default' },
      icon: { flex: 'none' },
    };

    /* ── component ────────────────────────────────────────────────────────── */

    /** Bridge between `apply` and the component: `slots.register` forwards no custom props. */
    const live = { ctx: undefined };

    /** Read the active locale id from the Client locale service. */
    function readLocale(pluginCtx) {
      const face = pluginCtx?.get?.('locale');
      if (face === undefined || face === null) return undefined;
      if (typeof face.getSnapshot === 'function') return face.getSnapshot()?.active;
      return undefined;
    }

    function iconIdle() {
      return h(
        'svg',
        { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('path', {
          d: 'M8 1.5 9.4 5.6 13.5 7 9.4 8.4 8 12.5 6.6 8.4 2.5 7 6.6 5.6Z',
          fill: 'currentColor',
        }),
        h('path', {
          d: 'M12.5 10.5 13.1 12.1 14.7 12.7 13.1 13.3 12.5 14.9 11.9 13.3 10.3 12.7 11.9 12.1Z',
          fill: 'currentColor',
          opacity: '.7',
        }),
      );
    }

    function iconDone() {
      return h(
        'svg',
        { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('path', {
          d: 'M3 8.5 6.2 11.7 13 4.9',
          stroke: 'currentColor',
          strokeWidth: '1.7',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      );
    }

    /**
     * The composer control: read the live draft, rewrite it, write it back.
     * @param {object} props - slot standard props.
     */
    function OptimizerButton(props) {
      const pluginCtx = live.ctx;
      const sessionId = props.sessionId;
      const inputActions = props.inputActions;
      const [phase, setPhase] = React.useState('idle');
      const [note, setNote] = React.useState('');
      const mounted = React.useRef(true);
      const timer = React.useRef(undefined);

      React.useEffect(() => {
        mounted.current = true;
        return () => {
          mounted.current = false;
          if (timer.current !== undefined) clearTimeout(timer.current);
        };
      }, []);

      const copy = copyFor(readLocale(pluginCtx));
      const draft = props.useInput((state) => state?.draft) ?? '';
      const empty = String(draft).trim() === '';

      const flash = React.useCallback((next, message) => {
        setPhase(next);
        setNote(message);
        if (timer.current !== undefined) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          if (!mounted.current) return;
          setPhase('idle');
          setNote('');
        }, FLASH_MS);
      }, []);

      const run = React.useCallback(() => {
        const text = String(draft ?? '');
        if (text.trim() === '') {
          flash('error', copy.empty);
          return;
        }
        if (text.length > MAX_DRAFT) {
          flash('error', copy.tooLong);
          return;
        }
        if (sessionId === undefined || typeof inputActions?.setDraft !== 'function') {
          flash('error', copy.noSession);
          return;
        }
        const next = optimize(text);
        if (next === '') {
          // Not an instruction — leave the draft alone and say why.
          flash('error', copy.trivial);
          return;
        }
        inputActions.setDraft(next);
        flash('done', copy.tipDone);
      }, [draft, copy, sessionId, inputActions, flash]);

      const label = phase === 'done' ? copy.done : copy.idle;
      const tooltip = note !== '' ? note : copy.tip;

      const buttonStyle = Object.assign(
        {},
        S.button,
        phase === 'done' ? S.buttonDone : undefined,
        empty ? S.buttonDisabled : undefined,
      );

      return h(
        'div',
        { style: S.wrap, className: 'dsh-po' },
        h(
          'button',
          {
            type: 'button',
            className: 'dsh-po-btn',
            style: buttonStyle,
            'data-state': phase,
            'data-dsh-prompt-optimizer': 'button',
            title: tooltip,
            'aria-label': label,
            disabled: empty,
            onMouseDown: (event) => event.preventDefault(),
            onClick: run,
          },
          phase === 'done' ? iconDone() : iconIdle(),
          h('span', null, label),
        ),
      );
    }

    /* ── plugin ───────────────────────────────────────────────────────────── */

    return {
      name: 'dsh-prompt-optimizer',
      inject: ['slots'],
      apply(ctx) {
        live.ctx = ctx;
        ctx.slots.inject(SLOT, () =>
          ctx.slots.register({ name: SLOT, id: CELL, order: 30 }, OptimizerButton),
        );
      },
    };
  },
});
