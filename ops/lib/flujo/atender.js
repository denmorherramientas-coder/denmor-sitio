// Atención automática de una conversación de WhatsApp.
//
// Orden de seguridad:
//  1. Pausa general, vendedor apagado o conversación tomada por un humano → no se responde.
//  2. Se espera unos segundos para juntar varios mensajes seguidos del cliente.
//  3. Un candado evita que dos procesos contesten la misma conversación.
//  4. Justo antes de enviar se vuelve a revisar: si respondiste desde la app, si se tomó la conversación o
//     si se pausó todo, la respuesta preparada se descarta.
import { ZONA } from '../config.js';
import { clasificarMensaje, esperaObjetivo } from '../agentes/vendedor.js';

const DIAS = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];

export function dentroDeHorario(horario, ahora = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: ZONA, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(ahora).map((x) => [x.type, x.value]));
  const dia = DIAS[['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday)];
  const rango = horario.dias?.[dia];
  if (!rango) return false;
  const min = (+p.hour % 24) * 60 + +p.minute;
  const [a, b] = rango.map((t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; });
  return min >= a && min < b;
}

const normal = (t) => ' ' + String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9ñ]+/g, ' ') + ' ';

// Devuelve la frase encontrada (palabras completas) o null
export function pideAsesor(texto, frases = []) {
  const t = normal(texto);
  for (const f of frases) { const n = normal(f).trim(); if (n && t.includes(' ' + n + ' ')) return f; }
  return null;
}

const dormir = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

/**
 * deps: { repo, wa, vendedor: { responder }, catalogo: () => Promise<cat>, cliente, fetchImpl, dormir, ahora: () => Date, aleatorio }
 * evento: { conversacionId, recibido: Date }
 */
export async function atender(evento, deps) {
  const { repo, wa } = deps;
  const zz = deps.dormir || dormir;
  const ahora = deps.ahora || (() => new Date());
  const id = evento.conversacionId;

  let cfg = await repo.config({ fresca: true });
  const parar = async () => {
    cfg = await repo.config({ fresca: true });
    if (cfg.agentes.pausa_global) return 'pausa_global';
    if (!cfg.agentes.vendedor.activo) return 'vendedor_apagado';
    const c = await repo.conversacion(id);
    if (!c) return 'sin_conversacion';
    if (c.modo === 'humano') return 'atiende_humano';
    return null;
  };
  let alto = await parar();
  if (alto) return { resultado: alto };

  // juntar mensajes seguidos: si llegó otro mensaje después de este, el aviso más reciente se encarga
  await zz((cfg.tiempos.agrupar || 0) * 1000);
  const c0 = await repo.conversacion(id);
  if (evento.recibido && c0.ultimo_entrante && new Date(c0.ultimo_entrante) > new Date(evento.recibido)) return { resultado: 'agrupado' };

  if (!(await repo.tomarCandado(id, 180))) return { resultado: 'ocupado' };
  const enviados = [];
  try {
    for (let ronda = 0; ronda < 3; ronda++) {
      alto = await parar();
      if (alto) return { resultado: alto, enviados };
      const pendientes = await repo.sinResponder(id);
      if (!pendientes.length) break;
      const ultimo = pendientes[pendientes.length - 1];
      const conv = await repo.conversacion(id);
      const enHorario = dentroDeHorario(cfg.horario, ahora());

      // fuera de horario
      if (!enHorario && cfg.horario.fuera_de_horario === 'silencio') { await repo.marcarRespondido(id, ultimo.creado); return { resultado: 'fuera_de_horario', enviados }; }
      if (!enHorario && cfg.horario.fuera_de_horario === 'mensaje') {
        const hist = await repo.historial(id, 10);
        const yaAvisado = hist.some((m) => m.autor === 'asistente' && m.texto === cfg.horario.mensaje_fuera_de_horario && ahora() - new Date(m.creado) < 12 * 3600e3);
        if (!yaAvisado) await enviar(deps, conv, cfg.horario.mensaje_fuera_de_horario, enviados, { tipo: 'fuera_de_horario' });
        await repo.marcarRespondido(id, ultimo.creado);
        return { resultado: 'fuera_de_horario', enviados };
      }

      // límites: mensajes por contacto y presupuesto diario
      if ((await repo.respuestasHoy(id)) >= cfg.limites.respuestas_por_contacto_dia) {
        await repo.cambiarModo(id, 'humano', 'Límite diario de respuestas del asistente para este contacto', 'sistema');
        await repo.marcarRespondido(id, ultimo.creado);
        return { resultado: 'limite_contacto', enviados };
      }
      if ((await repo.gastoHoy()) >= cfg.limites.presupuesto_diario_usd) {
        await repo.registrarError('vendedor', new Error('Se alcanzó el presupuesto diario de Claude API; las conversaciones pasan a atención humana.'));
        await enviar(deps, conv, 'Gracias por tu mensaje. Un asesor de Denmor te responde por este chat en breve.', enviados, { tipo: 'presupuesto' });
        await repo.cambiarModo(id, 'humano', 'Presupuesto diario de IA agotado', 'sistema');
        await repo.marcarRespondido(id, ultimo.creado);
        return { resultado: 'presupuesto', enviados };
      }

      // palabras que piden un asesor: transferencia inmediata, sin IA
      const frase = pideAsesor(pendientes.map((m) => m.texto || '').join(' '), cfg.humano.palabras_transferencia);
      if (frase) {
        await enviar(deps, conv, cfg.humano.mensaje_transferencia + (enHorario ? '' : ' (en cuanto abramos)'), enviados, { tipo: 'transferencia', frase });
        await repo.marcarRespondido(id, ultimo.creado);
        await repo.cambiarModo(id, 'humano', `El cliente pidió un asesor ("${frase}")`, 'sistema');
        return { resultado: 'transferido', enviados };
      }

      if (cfg.tiempos.escribiendo) wa.escribiendo(ultimo.wa_message_id || null).catch(() => {});
      const tipo = clasificarMensaje(pendientes.map((m) => m.texto || ''));
      const limite = new Date(ultimo.creado).getTime() + esperaObjetivo(tipo, cfg.tiempos, deps.aleatorio);

      let r;
      try {
        const catalogo = await deps.catalogo();
        const historial = await repo.historial(id, 30);
        r = await deps.vendedor.responder({ conv, historial, pendientes, cfg, enHorario, ahora: ahora() }, { cliente: deps.cliente, catalogo, repo, fetchImpl: deps.fetchImpl });
      } catch (e) {
        await repo.registrarError('vendedor', e, { conversacion: id });
        r = { texto: enHorario ? 'Gracias por tu mensaje. Un asesor de Denmor te responde por este chat en breve.' : 'Gracias por tu mensaje. Un asesor de Denmor te responde por este chat en cuanto abramos.', transferir: { motivo: 'Falla técnica del asistente', urgente: false }, motivo: 'error' };
      }

      await zz(limite - ahora().getTime());

      // revisión final antes de enviar
      alto = await parar();
      if (alto) { await repo.registrar('vendedor', 'respuesta.descartada', 'conversacion', id, { motivo: alto }); return { resultado: alto, enviados }; }
      const nuevos = await repo.sinResponder(id);
      if (nuevos.length && new Date(nuevos[nuevos.length - 1].creado) > new Date(ultimo.creado)) continue; // llegó otro mensaje: se prepara una respuesta que lo incluya

      await enviar(deps, conv, r.texto, enviados, { tipo, motivo: r.motivo, cotizacion: r.cotizacion?.folio || null });
      await repo.marcarRespondido(id, ultimo.creado);
      await repo.contarRespuesta(id);
      if (r.transferir) await repo.cambiarModo(id, 'humano', `${r.transferir.urgente ? 'URGENTE · ' : ''}${r.transferir.motivo}`, 'vendedor');
    }
  } finally {
    await repo.soltarCandado(id);
  }
  // si llegó un mensaje mientras se trabajaba (y su aviso encontró el candado ocupado), se atiende ahora
  const quedan = await repo.sinResponder(id);
  if (quedan.length && !evento._reintento) return atender({ conversacionId: id, recibido: null, _reintento: true }, { ...deps, dormir: zz });
  return { resultado: enviados.length ? 'respondido' : 'sin_cambios', enviados };
}

async function enviar(deps, conv, texto, enviados, meta) {
  const { repo, wa } = deps;
  try {
    const r = await wa.enviarTexto(conv.wa_id, texto);
    await repo.registrarSaliente({ conversacionId: conv.id, autor: 'asistente', texto, waMessageId: r.id, estado: r.simulado ? 'simulado' : 'enviado', meta: { ...meta, simulado: r.simulado || undefined, motivo_simulado: r.motivo } });
    enviados.push(texto);
  } catch (e) {
    await repo.registrarSaliente({ conversacionId: conv.id, autor: 'asistente', texto, estado: 'fallido', error: e.message, meta });
    await repo.registrarError('whatsapp', e, { conversacion: conv.id, codigo: e.codigo });
    // fuera de la ventana de 24 h u otro error permanente: que lo vea una persona
    await repo.cambiarModo(conv.id, 'humano', 'No se pudo enviar el mensaje por WhatsApp', 'sistema');
  }
}
