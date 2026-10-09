// Cliente de Claude falso para pruebas: sigue un guion de pasos.
// Cada paso es { herramienta, entrada } | { texto } | { rechazo: true } | (params) => paso
export function claudeFalso(guion) {
  const llamadas = [];
  let i = 0;
  const crear = async (params) => {
    params = { ...params, messages: params.messages.slice() }; // copia: el agente sigue agregando mensajes
    llamadas.push(params);
    let paso = guion[Math.min(i++, guion.length - 1)];
    if (typeof paso === 'function') paso = paso(params);
    const usage = { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 3000, cache_creation_input_tokens: 0 };
    if (paso.rechazo) return { model: params.model, stop_reason: 'refusal', content: [], usage };
    if (paso.herramienta) return { model: params.model, stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu_' + i, name: paso.herramienta, input: paso.entrada }], usage };
    if (paso.json) return { model: params.model, stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(paso.json) }], usage };
    return { model: params.model, stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '', signature: 'x' }, { type: 'text', text: paso.texto }], usage };
  };
  return { beta: { messages: { create: crear } }, llamadas };
}

// Último resultado de herramienta que vio Claude (para que el guion "lea" lo que devolvió el catálogo)
export function ultimoResultado(params) {
  for (let k = params.messages.length - 1; k >= 0; k--) {
    const c = params.messages[k].content;
    if (Array.isArray(c)) { const t = c.find((b) => b.type === 'tool_result'); if (t) return JSON.parse(t.content); }
  }
  return null;
}
