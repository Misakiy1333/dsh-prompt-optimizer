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
    /** How long a transient state stays visible after a rewrite. */
    const FLASH_MS = 2400;

    /* ── copy ─────────────────────────────────────────────────────────────── */

    const COPY = {
      zh: {
        idle: '优化提示词',
        busy: '优化中…',
        done: '已优化',
        tip: '用当前模型把草稿改写成结构化提示词（只改草稿，不发送）',
        tipDone: '已填回输入框，发送前可以继续改',
        empty: '输入框是空的，先写一句再点优化',
        tooLong: '草稿超过 6000 字，先精简一下',
        noSession: '先进入一个会话再优化',
        noRoute: '当前会话还没有模型路由，先选一个模型',
        trivial: '这句太短，像答复而不是指令；写清要做什么再优化',
        failed: '优化失败',
      },
      en: {
        idle: 'Improve prompt',
        busy: 'Improving…',
        done: 'Improved',
        tip: 'Rewrite the draft as a structured prompt with the current model (edits the draft, does not send)',
        tipDone: 'Filled back into the composer; keep editing before you send',
        empty: 'The composer is empty — write a line first',
        tooLong: 'Draft is longer than 6000 characters; trim it first',
        noSession: 'Open a session first',
        noRoute: 'This session has no model route yet — pick a model first',
        trivial: 'Too short to be an instruction — say what you want done, then retry',
        failed: 'Optimization failed',
      },
    };

    /** Pick the copy table for a locale id such as `zh-CN`. */
    function copyFor(locale) {
      const id = typeof locale === 'string' ? locale.toLowerCase() : '';
      return id.startsWith('zh') ? COPY.zh : COPY.en;
    }

    /* ── local fallback (used when no model route resolves) ───────────────── */

    /** Bare acknowledgements are answers, not instructions. */
    const TRIVIAL = [
      'ok', 'okay', 'k', 'yes', 'no', 'sure', 'thanks', 'thankyou', 'thx', 'gotit', 'yep', 'nope',
      '好', '好的', '好吧', '行', '可以', '嗯', '哦', '收到', '了解', '明白了', '懂了', '谢谢', '多谢',
      '继续', '接着来', '再来', '对', '是的', '不是', '没问题', '辛苦了', 'ok了', '好了',
    ];

    function isTrivial(text) {
      const compact = text.toLowerCase().replace(/[\s。！？!?.,，、~～…—-]+/gu, '');
      if (compact === '') return true;
      return TRIVIAL.some((w) => {
        const c = w.replace(/[\s。！？!?.,，、~～…—-]+/gu, '');
        return c !== '' && compact === c;
      });
    }

    /* ── inline styles ────────────────────────────────────────────────────── */

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
      buttonDone: { color: 'var(--dsw-alias-text-success, #0a8f3c)', borderColor: 'currentColor' },
      buttonDisabled: { opacity: '.45', cursor: 'default' },
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

    /**
     * Resolve the session's model route from its projections.
     * @param {object} pluginCtx
     * @param {string} sessionId
     * @returns {{ provider: string, model: string } | undefined}
     */
    function resolveRoute(pluginCtx, sessionId) {
      const binding = pluginCtx?.get?.('sessions')?.binding?.(sessionId);
      const face = binding?.session?.projections?.faceOf?.('modelSelection');
      const state = face?.get?.();
      const next = state?.next ?? state?.current;
      if (next !== undefined && typeof next.provider === 'string' && typeof next.model === 'string') {
        return { provider: next.provider, model: next.model };
      }

      const catalog = pluginCtx?.get?.('remote')?.session?.modelCatalog?.();
      const fallback = catalog?.value?.default;
      if (fallback !== undefined && typeof fallback.provider === 'string' && typeof fallback.model === 'string') {
        return { provider: fallback.provider, model: fallback.model };
      }
      return undefined;
    }

    function iconIdle() {
      return h(
        'svg',
        { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true, style: { flex: 'none' } },
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
        { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true, style: { flex: 'none' } },
        h('path', {
          d: 'M3 8.5 6.2 11.7 13 4.9',
          stroke: 'currentColor',
          strokeWidth: '1.7',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      );
    }

    function iconBusy() {
      return h(
        'svg',
        { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true, style: { flex: 'none' } },
        h('circle', {
          cx: 8, cy: 8, r: 5.5,
          stroke: 'currentColor', strokeWidth: '1.7', strokeOpacity: '.25',
        }),
        h('path', {
          d: 'M8 2.5A5.5 5.5 0 0 1 13.5 8',
          stroke: 'currentColor', strokeWidth: '1.7', strokeLinecap: 'round',
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
      const busy = phase === 'busy';

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
        if (text.trim() === '') return flash('error', copy.empty);
        if (text.length > MAX_DRAFT) return flash('error', copy.tooLong);
        if (isTrivial(text)) return flash('error', copy.trivial);
        if (sessionId === undefined || typeof inputActions?.setDraft !== 'function') {
          return flash('error', copy.noSession);
        }

        const route = resolveRoute(pluginCtx, sessionId);
        if (route === undefined) return flash('error', copy.noRoute);

        if (timer.current !== undefined) clearTimeout(timer.current);
        setNote('');
        setPhase('busy');

        void (async () => {
          try {
            const remote = pluginCtx.get('remote');
            const next = await remote.promptOptimizer.optimize(text, route.provider, route.model);
            if (!mounted.current) return;
            if (typeof next !== 'string' || next.trim() === '') throw new Error(copy.failed);
            inputActions.setDraft(next);
            flash('done', copy.tipDone);
          } catch (error) {
            if (!mounted.current) return;
            const reason = error instanceof Error && error.message !== '' ? error.message : copy.failed;
            flash('error', reason);
          }
        })();
      }, [draft, copy, sessionId, inputActions, pluginCtx, flash]);

      const label = busy ? copy.busy : phase === 'done' ? copy.done : copy.idle;
      const tooltip = note !== '' ? note : copy.tip;
      const buttonStyle = Object.assign(
        {},
        S.button,
        phase === 'done' ? S.buttonDone : undefined,
        empty || busy ? S.buttonDisabled : undefined,
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
            'aria-busy': busy ? 'true' : undefined,
            disabled: empty || busy,
            onMouseDown: (event) => event.preventDefault(),
            onClick: run,
          },
          busy ? iconBusy() : phase === 'done' ? iconDone() : iconIdle(),
          h('span', null, label),
        ),
      );
    }

    /* ── plugin ───────────────────────────────────────────────────────────── */

    /**
     * Build the Remote contribution by hand.
     *
     * The Client factory can only `require('react')` — no `@deepseek-ai/*` and no
     * `zod`. The Gateway's `validateContribution` therefore only inspects the
     * descriptor shape (`codec.mode === 'strict'`, namespace/method names), so a
     * plain object carrying those fields mounts exactly like a generated one.
     * The Host half holds the real zod-backed declaration; the wire is JSON, so
     * the two sides only have to agree on names and arity.
     */
    function buildContribution() {
      const ENDPOINT = 'promptOptimizer/optimize';
      const strictCodec = (name) => ({
        mode: 'strict',
        typeSymbol: `dsh-prompt-optimizer#${ENDPOINT}:${name}`,
        create: () => undefined,
        jsonSchema: { type: 'string' },
      });
      const parameter = (name) => ({
        name,
        wire: name,
        description: name,
        source: 'json',
        codec: strictCodec(name),
        strictCodec: strictCodec(name),
      });

      const descriptor = {
        id: `dsh-prompt-optimizer#${ENDPOINT}`,
        namespace: 'promptOptimizer',
        method: 'optimize',
        service: 'promptOptimizer',
        description: 'Rewrite one composer draft into a structured prompt.',
        invocation: { kind: 'direct' },
        parameters: [parameter('draft'), parameter('provider'), parameter('model')],
        cancellation: { parameter: 'signal' },
        result: {
          mode: 'strict',
          typeSymbol: 'dsh-prompt-optimizer#RewrittenPrompt',
          create: () => undefined,
          description: 'the rewritten prompt text',
          jsonSchema: { type: 'string' },
        },
      };

      return {
        package: 'dsh-prompt-optimizer',
        descriptors: [descriptor],
        methods: { [ENDPOINT]: descriptor },
      };
    }

    return {
      name: 'dsh-prompt-optimizer',
      /** `remote` mounts the namespace; `slots` places the button. */
      inject: ['remote', 'slots'],
      apply(ctx) {
        live.ctx = ctx;

        // Mount the Remote namespace so `ctx.remote.promptOptimizer.optimize`
        // resolves. A failure here must not take the button down with it: the
        // button then reports no route instead of disappearing.
        const remote = ctx.get('remote');
        if (remote !== undefined && typeof remote.$mount === 'function') {
          ctx.effect(
            () => remote.$mount(buildContribution()),
            'prompt-optimizer: mount remote namespace',
          );
        } else {
          console.error('[prompt-optimizer] the remote service is unavailable; the button will report no route');
        }

        ctx.slots.inject(SLOT, () =>
          ctx.slots.register({ name: SLOT, id: CELL, order: 30 }, OptimizerButton),
        );
      },
    };
  },
});
