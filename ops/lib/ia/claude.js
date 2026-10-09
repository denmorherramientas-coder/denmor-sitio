// Conexión con Claude API: un bucle de herramientas con límites de turnos, registro de consumo y manejo de rechazos.
import Anthropic from '@anthropic-ai/sdk';

let clientePorDefecto = null;
export function clienteClaude() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Falta la variable ANTHROPIC_API_KEY (Claude API).');
  clientePorDefecto ||= new Anthropic({ maxRetries: 2, timeout: 120000 });
  return clientePorDefecto;
}

const textoDe = (content) => content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();

/**
 * Ejecuta un agente con herramientas.
 * @param {object} p
 * @param {object} p.cliente       cliente de Anthropic (o uno falso en pruebas)
 * @param {string} p.modelo
 * @param {string} p.esfuerzo      low | medium | high
 * @param {string} p.sistema       instrucciones estables (se guardan en caché)
 * @param {Array}  p.mensajes      historial [{role, content}]
 * @param {Array}  p.herramientas  definiciones de herramientas
 * @param {(nombre:string, entrada:object) => Promise<any>} p.ejecutar
 * @param {(uso:object, modelo:string) => Promise<void>} [p.alUsar]  registro de consumo por llamada
 * @returns {Promise<{texto:string, motivo:string, llamadas:Array, mensajes:Array}>}
 */
export async function ejecutarAgente({ cliente, modelo, esfuerzo = 'low', sistema, mensajes, herramientas = [], ejecutar, alUsar, maxTurnos = 6, maxTokens = 8000 }) {
  const msgs = mensajes.slice();
  const llamadas = [];
  for (let turno = 0; turno < maxTurnos; turno++) {
    const r = await cliente.beta.messages.create({
      model: modelo,
      max_tokens: maxTokens,
      system: [{ type: 'text', text: sistema, cache_control: { type: 'ephemeral' } }],
      tools: herramientas.length ? herramientas : undefined,
      messages: msgs,
      output_config: { effort: esfuerzo },
      // Si el modelo declina por sus filtros de seguridad, la API reintenta con otro modelo adecuado.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    if (alUsar && r.usage) await alUsar(r.usage, r.model || modelo);

    if (r.stop_reason === 'refusal') return { texto: '', motivo: 'rechazo', llamadas, mensajes: msgs };
    if (r.stop_reason === 'max_tokens') return { texto: '', motivo: 'limite_tokens', llamadas, mensajes: msgs };
    msgs.push({ role: 'assistant', content: r.content });
    if (r.stop_reason === 'pause_turn') continue;

    const usos = r.content.filter((b) => b.type === 'tool_use');
    if (r.stop_reason !== 'tool_use' || !usos.length) return { texto: textoDe(r.content), motivo: 'fin', llamadas, mensajes: msgs };

    const resultados = await Promise.all(usos.map(async (u) => {
      llamadas.push({ nombre: u.name, entrada: u.input });
      try {
        const salida = await ejecutar(u.name, u.input || {});
        return { type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(salida ?? { ok: true }) };
      } catch (e) {
        return { type: 'tool_result', tool_use_id: u.id, content: JSON.stringify({ error: String(e.message || e).slice(0, 500) }), is_error: true };
      }
    }));
    msgs.push({ role: 'user', content: resultados });
  }
  return { texto: '', motivo: 'demasiados_turnos', llamadas, mensajes: msgs };
}

// Respuesta en JSON con esquema (para interpretar órdenes y redactar reportes)
export async function respuestaEstructurada({ cliente, modelo, esfuerzo = 'medium', sistema, texto, esquema, alUsar, maxTokens = 8000 }) {
  const r = await cliente.beta.messages.create({
    model: modelo,
    max_tokens: maxTokens,
    system: [{ type: 'text', text: sistema, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: texto }],
    output_config: { effort: esfuerzo, format: { type: 'json_schema', schema: esquema } },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  });
  if (alUsar && r.usage) await alUsar(r.usage, r.model || modelo);
  if (r.stop_reason === 'refusal') throw new Error('Claude declinó la solicitud.');
  if (r.stop_reason === 'max_tokens') throw new Error('La respuesta excedió el límite de tokens.');
  const t = textoDe(r.content);
  try {
    return JSON.parse(t);
  } catch {
    throw new Error('Claude no devolvió JSON válido.');
  }
}
