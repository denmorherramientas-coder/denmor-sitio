// "Claude" de demostración para el servidor local y las pruebas del panel (no llama a la API real).
// El vendedor busca en el catálogo con lo que escribió el cliente y responde con el primer resultado;
// el coordinador reparte la orden; los demás agentes devuelven un texto de prueba.
import { ultimoResultado } from './claude-falso.js';

export function claudeDemo() {
  const crear = async (p) => {
    const usage = { input_tokens: 900, output_tokens: 60, cache_read_input_tokens: 2500, cache_creation_input_tokens: 0 };
    const fin = (text) => ({ model: p.model, stop_reason: 'end_turn', content: [{ type: 'text', text }], usage });
    const ult = p.messages[p.messages.length - 1];
    if (p.output_config?.format) {
      return fin(JSON.stringify({ respuesta: '(demo) Entendido: el supervisor revisa el sitio y marketing prepara una propuesta.', tareas: [
        { agente: 'supervisor', titulo: 'Revisar el sitio', descripcion: 'Revisión completa', prioridad: 'normal', requiere_aprobacion: false },
        { agente: 'marketing', titulo: 'Propuesta de publicación', descripcion: 'Una publicación de baterías', prioridad: 'normal', requiere_aprobacion: true },
      ], no_se_puede: [] }));
    }
    const tools = (p.tools || []).map((t) => t.name);
    if (tools.includes('buscar_productos') && tools.includes('transferir_a_humano')) {
      if (typeof ult.content === 'string') {
        const texto = ult.content.replace(/<contexto_sistema>[\s\S]*?<\/contexto_sistema>\n?/, '').trim();
        return { model: p.model, stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'demo1', name: 'buscar_productos', input: { consulta: texto, marca: '', solo_con_existencia: false } }], usage };
      }
      const r = ultimoResultado(p);
      const m = r?.resultados?.[0];
      if (!m) return fin('(demo) No encontré ese producto en el catálogo. ¿Me das el modelo o te comunico con un asesor?');
      const v = m.variantes.find((x) => x.precio) || m.variantes[0];
      return fin(`(demo) Tenemos *${m.nombre}* (${v.condicion}) en $${(v.precio || 0).toLocaleString('en-US')}. ${v.disponibilidad}. ${m.enlace}`);
    }
    return fin('(demo) Tarea revisada. Sin hallazgos importantes.');
  };
  return { beta: { messages: { create: crear } } };
}
