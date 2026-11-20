// What the account's AI actions look like to the person: one row per action, with how many are used and how many are left.
// The server (GET /v1/cloud/usage -> ai_actions) says the numbers; this only arranges them. A missing limit (null) means no cap.

/** Portuguese labels, passed through t() by the screens. */
export const AI_ACTION_LABELS = {
  ask_total: 'Perguntas, receitas, resumos e emails (total)',
  chat: 'Perguntas sobre reuniões',
  recipe: 'Receitas',
  summary: 'Resumos',
  email: 'Emails de seguimento',
  regenerate: 'Notas escritas outra vez',
};

const ORDER = ['ask_total', 'chat', 'recipe', 'summary', 'email', 'regenerate'];

export function aiMeterRows(usage) {
  if (!usage || typeof usage !== 'object') return [];
  const source = { ...(usage.actions || {}), ...(usage.ask_total ? { ask_total: usage.ask_total } : {}) };
  return ORDER.filter((key) => source[key]).map((key) => {
    const { used = 0, limit = null } = source[key];
    const unlimited = limit == null;
    return { key, used, limit, left: unlimited ? null : Math.max(0, limit - used), full: !unlimited && used >= limit, unlimited };
  });
}

/** A plan's limits as the catalogue gives them ({chat: 20, ask_total: 30, ...}), in the order the screens show them. */
export function aiLimitRows(limits) {
  if (!limits || typeof limits !== 'object') return [];
  return ORDER.filter((key) => key in limits).map((key) => ({ key, limit: limits[key] }));
}
