// "Cerebro" del asistente: arma la respuesta con Claude (API de Anthropic) usando el catálogo real de Denmor.
import { cargarCatalogo, buscar, porClave, ficha } from './catalogo.mjs';

const MODELO = () => process.env.WA_MODELO || 'claude-haiku-5-5';

function ahoraChihuahua() {
  const d = new Date();
  const fecha = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Chihuahua', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: true }).format(d);
  const p = {}; new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chihuahua', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d).forEach((x) => (p[x.type] = x.value));
  const min = (+p.hour % 24) * 60 + +p.minute;
  const abierta = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(p.weekday) ? min >= 600 && min < 1020 : p.weekday === 'Sat' ? min >= 600 && min < 840 : false;
  return { fecha, abierta };
}

function instrucciones(promo) {
  const t = ahoraChihuahua();
  return `Eres quien atiende el WhatsApp de DENMOR Herramientas, una tienda de herramienta Milwaukee, DeWalt y Ryobi en Chihuahua, Chih. Contestas como un buen vendedor de mostrador de la tienda: amable, directo, en español de México norteño, natural y cálido, sin sonar a robot ni a guion.

CÓMO ESCRIBES
- Mensajes cortos, como se escribe en WhatsApp: 1 a 4 líneas. Nada de listas largas ni formatos raros. Puedes usar *negritas* de WhatsApp para un precio o un modelo, con moderación.
- Si tienes que mandar dos ideas distintas, sepáralas con una línea en blanco (se mandarán como dos mensajes).
- Un emoji de vez en cuando está bien (👍🔧), no en cada mensaje.
- Saluda solo al inicio de la plática. No repitas el nombre de la tienda en cada mensaje.
- Si el cliente pregunta si eres un robot, una persona o una IA, no lo niegues: di con naturalidad que eres el asistente de Denmor y que si quiere lo comunicas con alguien del equipo.

DATOS DE LA TIENDA
- Dirección: C. José Martí Pérez 3104, Col. Ángel Trías, Chihuahua, Chih.
- Horario: lunes a viernes 10:00 a 17:00, sábado 10:00 a 14:00. Domingo cerrado.
- Ahora es ${t.fecha} (hora de Chihuahua). La tienda está ${t.abierta ? 'ABIERTA' : 'CERRADA'} en este momento.
- WhatsApp: 614 192 7887. Sitio con catálogo y existencias: denmorherramientas.com
- Envíos a todo México por Estafeta; el costo del envío se confirma por aquí según el destino.
- Lo que no hay en existencia se surte sobre pedido en 7 a 10 días.
- Existencias: "Denmor" es la tienda de José Martí (se puede pasar a recoger). "Bodega 1" también está en Chihuahua: se trae a la tienda. "CDMX" es el almacén de Ciudad de México: se envía.
- Condición de cada pieza (es parte de la clave, ej. 2904-20-B): AA nuevo en caja · A nuevo sin caja · B como nuevo sin caja (sin uso, puede traer un detalle mínimo del traslado) · C semi nuevo con uso, funciona perfecto · D, E, F usado o remate, probado y funcionando.
${promo ? `- Promoción activa: ${promo.nombre || 'descuento'} de ${Math.round(promo.pct)} %${promo.hasta ? ' hasta el ' + promo.hasta : ''}. Los precios que te da la herramienta de búsqueda YA traen el descuento.` : ''}

REGLAS IMPORTANTES
- Precios y existencias: SOLO los que te da la herramienta buscar_productos. Nunca inventes precio, existencia, modelo ni característica. Si no aparece, dilo y ofrece conseguirlo sobre pedido o comunicarlo con alguien del equipo.
- Características, especificaciones, qué incluye, para qué sirve, voltaje, torque, etc.: SOLO lo que diga ficha_producto. Si la ficha no lo trae, dilo con honestidad y ofrece checarlo con alguien del equipo. No completes con lo que "sabes" de la marca.
- Cuando recomiendes un modelo en concreto, manda su link (el campo "link") solo, en su propio párrafo: al cliente le aparece la foto y puede ver todo en la página. Un link por mensaje, máximo dos por respuesta.
- Cuando el cliente pregunte por una herramienta, búscala antes de contestar. Ofrece primero lo que hay en Denmor, luego Bodega 1, luego CDMX. Menciona la condición (nuevo, como nuevo, etc.) junto con el precio.
- No ofrezcas descuentos extra, precios de distribuidor ni negocies. Si piden rebaja, precio de mayoreo o distribuidor, pásalo con alguien del equipo (pasar_a_persona).
- Pedidos: cuando el cliente quiera comprar o apartar, junta: qué clave(s) y cuántas, su nombre, y si pasa a la tienda o quiere envío (con dirección y código postal). Luego usa registrar_pedido y dile que en un momento alguien del equipo le confirma existencia, total y forma de pago. No pidas datos de tarjeta ni cuentas bancarias nunca.
- Pasa la plática a una persona (pasar_a_persona) cuando: lo pidan, haya una queja, garantía o devolución, pregunten algo que no sabes, o el cliente se vea molesto. Después de pasarla, dile que en breve le contesta alguien del equipo${t.abierta ? '' : ' en cuanto abra la tienda'}.
- Si mandan foto o nota de voz, pide amablemente que te escriban qué herramienta buscan o el modelo.
- No hables de temas que no sean de la tienda.`;
}

const HERRAMIENTAS = [
  { name: 'buscar_productos', description: 'Busca en el catálogo de Denmor por modelo, clave o descripción (ej. "2904-20", "rotomartillo milwaukee", "esmeriladora dewalt 20v"). Devuelve opciones con condición, precio actual y existencia por tienda.', input_schema: { type: 'object', properties: { consulta: { type: 'string' } }, required: ['consulta'] } },
  { name: 'ficha_producto', description: 'Ficha de un producto del catálogo: descripción, especificaciones, qué incluye, condición, precio, existencia y link con foto. Úsala cuando pregunten detalles de un modelo. Acepta la clave (ej. 2904-20-B) o el modelo (ej. 2904-20).', input_schema: { type: 'object', properties: { clave: { type: 'string' } }, required: ['clave'] } },
  { name: 'registrar_pedido', description: 'Registra un pedido en el panel de la tienda para que el equipo lo confirme. Úsalo solo cuando el cliente ya dijo qué quiere y cómo lo recibe.', input_schema: { type: 'object', properties: {
    nombre_cliente: { type: 'string' },
    articulos: { type: 'array', items: { type: 'object', properties: { clave: { type: 'string', description: 'Clave exacta, ej. 2904-20-B o 2869-20-AA-KIT5A' }, cantidad: { type: 'integer' } }, required: ['clave', 'cantidad'] } },
    entrega: { type: 'string', enum: ['tienda', 'envio'] },
    direccion: { type: 'string', description: 'Calle, número, colonia, ciudad, estado y CP si es envío' },
    nota: { type: 'string' },
  }, required: ['articulos', 'entrega'] } },
  { name: 'pasar_a_persona', description: 'Pasa la conversación a alguien del equipo de la tienda. El asistente deja de contestar en este chat por unas horas.', input_schema: { type: 'object', properties: { motivo: { type: 'string' } }, required: ['motivo'] } },
];

async function llamarClaude(system, messages) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY || '', 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODELO(), max_tokens: 700, system, tools: HERRAMIENTAS, messages }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Claude ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
  return j;
}

/**
 * historial: [{r:'u'|'b'|'h', t:'texto'}]  (u = cliente, b = asistente, h = persona de la tienda)
 * acciones: { registrarPedido(datos) → folio, pasarAPersona(motivo) }
 * Devuelve { texto, acciones: [...] }
 */
export async function responder(historial, acciones, opciones = {}) {
  const cat = opciones.catalogo || (await cargarCatalogo());
  const messages = [];
  for (const m of historial.slice(-24)) {
    const role = m.r === 'u' ? 'user' : 'assistant';
    const content = m.r === 'h' ? `[Respondió alguien del equipo] ${m.t}` : m.t;
    if (messages.length && messages[messages.length - 1].role === role) messages[messages.length - 1].content += '\n' + content;
    else messages.push({ role, content });
  }
  while (messages.length && messages[0].role !== 'user') messages.shift();
  if (!messages.length) return { texto: '', acciones: [] };
  const system = instrucciones(cat.promo);
  const hechas = [];
  const llamar = opciones.llamar || llamarClaude;
  for (let vuelta = 0; vuelta < 5; vuelta++) {
    const res = await llamar(system, messages);
    const usos = (res.content || []).filter((c) => c.type === 'tool_use');
    if (!usos.length || res.stop_reason !== 'tool_use') {
      const texto = (res.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
      return { texto, acciones: hechas };
    }
    messages.push({ role: 'assistant', content: res.content });
    const resultados = [];
    for (const u of usos) {
      let out;
      try {
        if (u.name === 'buscar_productos') {
          const r = buscar(cat, String(u.input.consulta || ''));
          out = r.modelos.length ? JSON.stringify(r) : 'Sin resultados en el catálogo para esa búsqueda.';
        } else if (u.name === 'ficha_producto') {
          const f = await ficha(cat, String(u.input.clave || ''));
          out = f ? JSON.stringify(f) : 'Esa clave no está en el catálogo. Búscala primero con buscar_productos.';
        } else if (u.name === 'registrar_pedido') {
          const items = (u.input.articulos || []).map((a) => { const p = porClave(cat, a.clave); return p ? { sku: p.sku, nombre: p.nombre, cond: p.cal || 'CB', cant: Math.max(1, Math.min(99, +a.cantidad || 1)), precio: p.precio } : null; });
          if (items.some((x) => !x)) out = 'Alguna clave no existe en el catálogo. Busca de nuevo la clave exacta antes de registrar.';
          else { const folio = await acciones.registrarPedido({ ...u.input, items }); hechas.push({ tipo: 'pedido', folio }); out = `Pedido registrado con folio ${folio}. Total aproximado $${items.reduce((s, x) => s + x.precio * x.cant, 0).toLocaleString('es-MX')}. Un miembro del equipo confirmará.`; }
        } else if (u.name === 'pasar_a_persona') {
          await acciones.pasarAPersona(String(u.input.motivo || '')); hechas.push({ tipo: 'persona', motivo: u.input.motivo });
          out = 'Listo: el equipo ya fue avisado y tú dejarás de contestar en este chat. Despídete brevemente.';
        } else out = 'Herramienta desconocida.';
      } catch (e) { out = 'Error: ' + e.message; }
      resultados.push({ type: 'tool_result', tool_use_id: u.id, content: out });
    }
    messages.push({ role: 'user', content: resultados });
  }
  return { texto: '', acciones: hechas };
}
