/**
 * Host half of the dsh-prompt-optimizer bundle.
 *
 * The rewrite itself runs in the Client half, so this file exists only to give
 * the bundle a well-formed Host row. That is a deliberate constraint: the
 * plugin resolves no package outside itself, which keeps it loadable from a
 * linked checkout where bare `@deepseek-ai/*` specifiers would not resolve.
 */

/** Describe the plugin to the Host loader. */
export function apply() {}
