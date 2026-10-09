/* DENMOR AI OPERATIONS · panel privado */
'use strict';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mx = (n) => '$' + Math.round(+n || 0).toLocaleString('es-MX');
const hora = (t) => (t ? new Date(t).toLocaleString('es-MX', { timeZone: 'America/Chihuahua', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const hace = (t) => { if (!t) return ''; const s = (Date.now() - new Date(t)) / 1000; if (s < 60) return 'ahora'; if (s < 3600) return `hace ${Math.round(s / 60)} min`; if (s < 86400) return `hace ${Math.round(s / 3600)} h`; return hora(t); };
const SS = { get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch {} }, del: (k) => { try { sessionStorage.removeItem(k); } catch {} } };

function toast(t, ms = 3200) { const e = $('toast'); e.textContent = t; e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (e.hidden = true), ms); }

const AGENTES = {
  coordinador: ['Coordinador', 'Recibe tus órdenes, las convierte en tareas y supervisa a los demás agentes.'],
  vendedor: ['Vendedor', 'Atiende WhatsApp con el catálogo real, cotiza y transfiere a una persona cuando hace falta.'],
  supervisor: ['Supervisor web', 'Cada hora revisa el sitio: páginas, buscador, enlaces, botón de WhatsApp y existencias.'],
  inventarios: ['Inventarios', 'Cada mañana revisa fotos faltantes, precios, existencias inconsistentes y duplicados.'],
  administrador: ['Administrador', 'Cada noche prepara el reporte de conversaciones, cotizaciones, interesados y tareas.'],
  marketing: ['Marketing', 'Cada lunes propone publicaciones y seguimiento. Nada se publica sin tu aprobación.'],
  programador: ['Programador', 'Analiza errores y propone correcciones. No cambia código por su cuenta.'],
};
const ESTADO_T = { pendiente: ['Pendiente', ''], en_proceso: ['En proceso', 'blue'], esperando_aprobacion: ['Esperando aprobación', 'warn'], completada: ['Completada', 'ok'], fallida: ['Fallida', 'red'], cancelada: ['Cancelada', ''] };
const TIPO_AP = { descuento: 'Descuento', publicacion: 'Publicación', mensaje_masivo: 'Mensajes a clientes', cambio_precio: 'Cambio de precio', operacion_financiera: 'Operación financiera', cambio_importante: 'Cambio importante', otro: 'Otro' };

/* ---------------- sesión (Supabase Auth) ---------------- */
let PUB = null, SESION = null, YO = null;
async function publico() { if (!PUB) PUB = await (await fetch('/api/publico')).json(); return PUB; }
function guardarSesion(s) { SESION = s; if (s) SS.set('dn_ops_s', JSON.stringify(s)); else SS.del('dn_ops_s'); }
async function gotrue(ruta, cuerpo, token) {
  const p = await publico();
  const r = await fetch(`${p.supabaseUrl.replace(/\/$/, '')}/auth/v1/${ruta}`, { method: 'POST', headers: { apikey: p.supabaseAnonKey, 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(cuerpo || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error_description || j.msg || j.message || 'No se pudo iniciar sesión');
  return j;
}
async function token() {
  if (!SESION) return null;
  if (SESION.local) return 'local-pruebas-denmor-ops';
  if (SESION.vence - Date.now() < 60000) {
    try { const j = await gotrue('token?grant_type=refresh_token', { refresh_token: SESION.refresh }); guardarSesion({ access: j.access_token, refresh: j.refresh_token, vence: Date.now() + j.expires_in * 1000 }); }
    catch { guardarSesion(null); mostrarLogin(); return null; }
  }
  return SESION.access;
}
async function api(ruta, opt = {}) {
  const t = await token();
  const r = await fetch('/api' + ruta, { ...opt, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t, ...(opt.headers || {}) }, body: opt.body && typeof opt.body !== 'string' ? JSON.stringify(opt.body) : opt.body });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { guardarSesion(null); mostrarLogin('Tu sesión terminó o tu correo no está autorizado.'); throw new Error('sin sesión'); }
  if (!r.ok) throw new Error(j.error || 'Error ' + r.status);
  return j;
}
function mostrarLogin(msg = '') { document.body.classList.add('bloqueado'); $('login').hidden = false; $('lMsg').textContent = msg; }
$('lForm').addEventListener('submit', async (ev) => {
  ev.preventDefault(); $('lMsg').textContent = 'Entrando…';
  try {
    const p = await publico();
    if (!p.supabaseUrl) throw new Error('El panel aún no tiene configurado Supabase (SUPABASE_URL y SUPABASE_ANON_KEY).');
    const j = await gotrue('token?grant_type=password', { email: $('lEmail').value.trim(), password: $('lPass').value });
    guardarSesion({ access: j.access_token, refresh: j.refresh_token, vence: Date.now() + j.expires_in * 1000 });
    $('lPass').value = ''; await iniciar();
  } catch (e) { $('lMsg').textContent = e.message; }
});
$('lLocal').addEventListener('click', async () => { guardarSesion({ local: true }); await iniciar(); });
$('btnSalir').addEventListener('click', async () => { try { if (SESION && !SESION.local) await gotrue('logout', {}, SESION.access); } catch {} guardarSesion(null); location.hash = ''; location.reload(); });

async function iniciar() {
  try { YO = await api('/sesion'); } catch (e) { if (e.message !== 'sin sesión') mostrarLogin(e.message); return; }
  $('login').hidden = true; document.body.classList.remove('bloqueado');
  ir();
}

/* ---------------- navegación ---------------- */
const SECCIONES = { tablero: cargarTablero, whatsapp: cargarWhatsApp, ordenes: cargarOrdenes, agentes: cargarAgentes, aprobaciones: cargarAprobaciones, config: cargarConfig };
let actual = null;
function ir() {
  const s = (location.hash || '#tablero').slice(1).split('/')[0];
  actual = SECCIONES[s] ? s : 'tablero';
  document.querySelectorAll('.sec').forEach((e) => (e.hidden = e.id !== 's-' + actual));
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.s === actual));
  SECCIONES[actual]().catch((e) => toast(e.message));
}
window.addEventListener('hashchange', () => { if (YO) ir(); });
setInterval(() => { if (!YO || document.hidden) return; if (actual === 'tablero') cargarTablero().catch(() => {}); if (actual === 'whatsapp') { cargarListaWa().catch(() => {}); if (CHAT) cargarChat(CHAT, true).catch(() => {}); } }, 6000);

/* ---------------- pausa general ---------------- */
let PAUSA = false;
function pintarPausa(p) { PAUSA = !!p; $('btnPausa').textContent = PAUSA ? '▶ Reanudar agentes' : 'Pausar todos los agentes'; $('btnPausa').classList.toggle('activa', !PAUSA); $('bandaPausa').hidden = !PAUSA; }
$('btnPausa').addEventListener('click', async () => {
  const nueva = !PAUSA;
  if (nueva && !confirm('¿Pausar a TODOS los agentes? Nadie responderá en WhatsApp ni se ejecutarán tareas hasta que los reanudes.')) return;
  const r = await api('/agentes/pausa', { method: 'POST', body: { pausa: nueva } });
  pintarPausa(r.pausa_global); toast(nueva ? 'Agentes en pausa' : 'Agentes reanudados');
});

/* ---------------- tablero ---------------- */
async function cargarTablero() {
  const d = await api('/tablero');
  pintarPausa(d.pausa_global);
  $('nAprob').hidden = !d.hoy.aprobaciones_pendientes; $('nAprob').textContent = d.hoy.aprobaciones_pendientes;
  $('tabHora').textContent = 'Hoy · ' + new Date().toLocaleDateString('es-MX', { timeZone: 'America/Chihuahua', weekday: 'long', day: 'numeric', month: 'long' });
  const h = d.hoy;
  const k = [
    ['Agentes activos', d.agentes.filter((a) => a.activo).length + ' / ' + d.agentes.length],
    ['Conversaciones', h.conversaciones], ['Clientes interesados', h.interesados], ['Cotizaciones', `${h.cotizaciones} · ${mx(h.monto_cotizado)}`],
    ['Esperando a una persona', h.conversaciones_humano, h.conversaciones_humano > 0], ['Aprobaciones pendientes', h.aprobaciones_pendientes, h.aprobaciones_pendientes > 0],
    ['Tareas pendientes', h.tareas_pendientes], ['Errores hoy', h.errores, h.errores > 0], ['Costo IA hoy', `US$${d.gasto_usd.toFixed(2)} / ${d.presupuesto_usd}`, d.gasto_usd > d.presupuesto_usd * 0.8],
  ];
  $('kpis').innerHTML = k.map(([t, v, a]) => `<div class="kpi ${a ? 'alerta' : ''}"><span>${esc(t)}</span><b>${esc(v)}</b></div>`).join('');
  $('tabAgentes').innerHTML = d.agentes.map((a) => `<div class="row"><i class="dot ${a.activo ? 'on' : ''}"></i><div class="t"><b>${esc(AGENTES[a.agente][0])}</b><small>${a.ultimo ? esc(a.ultimo.titulo) + ' · ' + hace(a.ultimo.creado) : esc(AGENTES[a.agente][1])}</small></div></div>`).join('');
  $('tabAprob').innerHTML = d.aprobaciones.length ? d.aprobaciones.map((a) => `<div class="row"><span class="pill warn">${esc(TIPO_AP[a.tipo])}</span><div class="t"><a href="#aprobaciones">${esc(a.titulo)}</a><small>${esc(a.solicitado_por)} · ${hace(a.creado)}</small></div></div>`).join('') : '<p class="muted">Nada pendiente.</p>';
  $('tabTareas').innerHTML = d.tareas.length ? d.tareas.map(filaTarea).join('') : '<p class="muted">Sin tareas.</p>';
  $('tabErrores').innerHTML = d.errores.length ? d.errores.map((e) => `<div class="row"><span class="pill red">${esc(e.origen)}</span><div class="t">${esc(e.mensaje)}<small>${hace(e.creado)}</small></div></div>`).join('') : '<p class="muted">Sin errores registrados.</p>';
}
function filaTarea(t) {
  const [et, cl] = ESTADO_T[t.estado] || [t.estado, ''];
  return `<div class="row"><span class="pill ${cl}">${esc(et)}</span><div class="t"><b>${esc(t.titulo)}</b><small>${esc(AGENTES[t.agente]?.[0] || t.agente)} · ${esc(t.prioridad)} · ${hace(t.creado)}</small>${t.resultado ? `<details><summary>Resultado</summary><pre class="txt">${esc(t.resultado)}</pre></details>` : ''}</div>
    ${['pendiente', 'esperando_aprobacion'].includes(t.estado) ? `<button class="sec2" data-cancelar="${t.id}">Cancelar</button>` : ''}${['fallida', 'cancelada'].includes(t.estado) ? `<button class="sec2" data-reintentar="${t.id}">Reintentar</button>` : ''}</div>`;
}
document.addEventListener('click', async (ev) => {
  const c = ev.target.closest('[data-cancelar]'), r = ev.target.closest('[data-reintentar]');
  if (c) { await api(`/tareas/${c.dataset.cancelar}/cancelar`, { method: 'POST' }); toast('Tarea cancelada'); SECCIONES[actual](); }
  if (r) { await api(`/tareas/${r.dataset.reintentar}/reintentar`, { method: 'POST' }); toast('Tarea enviada de nuevo'); SECCIONES[actual](); }
});

/* ---------------- WhatsApp ---------------- */
let CHAT = null, MODO_W = '', SIM = null;
async function cargarWhatsApp() { await cargarListaWa(); if (CHAT) await cargarChat(CHAT); }
async function cargarListaWa() {
  const q = $('wBuscar').value.trim();
  const d = await api(`/conversaciones?modo=${MODO_W}&q=${encodeURIComponent(q)}`);
  $('wLista').innerHTML = d.conversaciones.length ? d.conversaciones.map((c) => `<div class="it ${c.id === CHAT ? 'on' : ''}" data-c="${c.id}"><b><span>${esc(c.nombre || c.telefono)}</span><span class="pill ${c.modo === 'humano' ? 'blue' : 'ok'}">${c.modo === 'humano' ? 'Persona' : 'Asistente'}</span></b>
    <small>${c.simulador ? '🧪 ' : ''}${esc(c.telefono)}${c.interesado ? ' · ⭐ interesado' : ''} · ${hace(c.ultimo_entrante || c.ultimo_saliente)}</small><small>${esc((c.ultimo_autor === 'cliente' ? '' : '↪ ') + (c.ultimo_texto || ''))}</small></div>`).join('') : '<p class="muted" style="padding:12px">Sin conversaciones todavía.</p>';
}
$('wLista').addEventListener('click', async (ev) => {
  const it = ev.target.closest('[data-c]'); if (!it) return;
  CHAT = it.dataset.c; SIM = null;
  await cargarChat(CHAT).catch((e) => toast(e.message)); cargarListaWa();
  if (window.innerWidth <= 820) $('wChat').scrollIntoView({ behavior: 'smooth' }); // en celular, baja al chat
});
$('wBuscar').addEventListener('input', () => { clearTimeout(cargarListaWa.t); cargarListaWa.t = setTimeout(cargarListaWa, 300); });
$('wModo').addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (!b) return; MODO_W = b.dataset.m; $('wModo').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); cargarListaWa(); });

// después de escribir en el simulador, revisa seguido unos segundos para mostrar la respuesta en cuanto llegue
function seguirChat(id, veces = 16) { let n = 0; const paso = () => { if (CHAT !== id || ++n > veces) return; cargarChat(id, true).catch(() => {}); setTimeout(paso, 1500); }; setTimeout(paso, 1200); }
const AUTOR = { cliente: 'Cliente', asistente: 'Asistente', humano_app: 'Tú (app WhatsApp Business)', humano_panel: 'Equipo (panel)', sistema: 'Sistema' };
async function cargarChat(id, silencioso) {
  const d = await api('/conversaciones/' + id);
  const c = d.conversacion;
  const pie = $('wChat').querySelector('.msgs');
  const abajo = !pie || pie.scrollTop + pie.clientHeight >= pie.scrollHeight - 30;
  const borrador = $('wTexto') ? $('wTexto').value : '';
  $('wChat').innerHTML = `<div class="chead"><div class="t"><b>${esc(c.nombre || c.telefono)}</b><small>${esc(c.telefono)}${c.interesado ? ' · ⭐ ' + esc(c.nota_interes || 'interesado') : ''}</small></div>
      ${c.modo === 'humano' ? '<button class="ok-btn" id="wReactivar">REACTIVAR ASISTENTE</button>' : '<button class="prim" id="wTomar">TOMAR CONVERSACIÓN</button>'}</div>
    ${c.simulador ? '<div class="aviso sim">🧪 Conversación del simulador: nada de esto se envía por WhatsApp.</div>' : ''}
    ${c.modo === 'humano' ? `<div class="aviso hum">👤 La atiende una persona: el asistente no responde aquí. ${esc(c.motivo_modo || '')}</div>` : ''}
    <div class="msgs">${d.mensajes.map((m) => `<div class="m ${m.direccion === 'entrante' ? 'in' : 'out'} ${m.autor.startsWith('humano') ? 'hum' : ''} ${m.estado_entrega === 'fallido' || m.estado_entrega === 'failed' ? 'fail' : ''}">${esc(m.texto || '[' + m.tipo + ']')}<small>${esc(AUTOR[m.autor] || m.autor)} · ${hora(m.creado)}${m.estado_entrega ? ' · ' + esc(m.estado_entrega) : ''}${m.error ? ' · ⚠ ' + esc(m.error) : ''}</small></div>`).join('') || '<p class="muted">Sin mensajes.</p>'}</div>
    <div class="compose">${c.simulador ? `<textarea id="wSimTexto" rows="1" placeholder="Escribe como si fueras el cliente…"></textarea><button class="prim" id="wSimEnviar">Enviar como cliente</button>`
      : `<textarea id="wTexto" rows="1" placeholder="Responder como Denmor (pasa la conversación a atención humana)"></textarea><button class="prim" id="wEnviar">Enviar</button>`}</div>`;
  if ($('wTexto')) $('wTexto').value = borrador;
  const box = $('wChat').querySelector('.msgs'); if (!silencioso || abajo) box.scrollTop = box.scrollHeight;
  $('wTomar')?.addEventListener('click', async () => { await api(`/conversaciones/${id}/tomar`, { method: 'POST' }); toast('Conversación tomada: el asistente ya no responde aquí'); cargarChat(id); cargarListaWa(); });
  $('wReactivar')?.addEventListener('click', async () => { await api(`/conversaciones/${id}/reactivar`, { method: 'POST' }); toast('Asistente reactivado (responderá a los siguientes mensajes)'); cargarChat(id); cargarListaWa(); });
  $('wEnviar')?.addEventListener('click', async () => {
    const t = $('wTexto').value.trim(); if (!t) return;
    if (!confirm('Se enviará este mensaje por WhatsApp y el asistente dejará de responder en esta conversación. ¿Enviar?')) return;
    try { const r = await api(`/conversaciones/${id}/mensaje`, { method: 'POST', body: { texto: t } }); $('wTexto').value = ''; toast(r.simulado ? 'Guardado (envío a WhatsApp deshabilitado)' : 'Enviado'); cargarChat(id); } catch (e) { toast(e.message, 6000); }
  });
  const simEnviar = async () => { const t = $('wSimTexto').value.trim(); if (!t) return; $('wSimTexto').value = ''; await api('/simulador', { method: 'POST', body: { texto: t, sesion: SIM || '1', sinEspera: true } }); cargarChat(id); seguirChat(id); };
  $('wSimEnviar')?.addEventListener('click', simEnviar);
  $('wSimTexto')?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); simEnviar(); } });
}
$('wSim').addEventListener('click', async () => {
  const t = prompt('Simulador: escribe el primer mensaje del cliente (nada se envía por WhatsApp).', 'Hola, ¿tienen rotomartillo Milwaukee M18?');
  if (!t) return;
  SIM = String(Date.now());
  const r = await api('/simulador', { method: 'POST', body: { texto: t, sesion: SIM, sinEspera: true } });
  CHAT = r.conversacionId; await cargarListaWa(); await cargarChat(CHAT); seguirChat(CHAT);
  toast('El vendedor está preparando la respuesta…');
});

/* ---------------- órdenes y tareas ---------------- */
async function cargarOrdenes() {
  const [o, t] = await Promise.all([api('/ordenes'), api('/tareas?estado=' + $('tFiltro').value)]);
  $('oLista').innerHTML = o.ordenes.length ? o.ordenes.map((x) => {
    const i = x.interpretacion || {};
    return `<div class="row"><span class="pill ${x.estado === 'interpretada' ? 'ok' : x.estado === 'error' ? 'red' : ''}">${x.estado === 'recibida' ? 'Procesando' : x.estado === 'interpretada' ? 'Asignada' : 'Error'}</span><div class="t"><b>${esc(x.texto)}</b><small>${esc(x.creado_por)} · ${hace(x.creado)}</small>
      ${i.respuesta ? `<pre class="txt">${esc(i.respuesta)}${i.tareas?.length ? '\n\nTareas:\n' + i.tareas.map((y) => `• ${AGENTES[y.agente]?.[0] || y.agente}: ${y.titulo}${y.requiere_aprobacion ? ' (requiere tu aprobación)' : ''}`).join('\n') : ''}${i.no_se_puede?.length ? '\n\nNo se puede: ' + i.no_se_puede.join('; ') : ''}</pre>` : ''}</div></div>`;
  }).join('') : '<p class="muted">Todavía no hay órdenes.</p>';
  $('tLista').innerHTML = t.tareas.length ? t.tareas.map(filaTarea).join('') : '<p class="muted">Sin tareas.</p>';
}
$('oEnviar').addEventListener('click', async () => {
  const texto = $('oTexto').value.trim(); if (!texto) return;
  $('oEnviar').disabled = true; $('oMsg').textContent = 'Enviando…';
  try { await api('/ordenes', { method: 'POST', body: { texto, prioridad: $('oPrioridad').value } }); $('oTexto').value = ''; $('oMsg').textContent = 'Recibida. El coordinador la está repartiendo.'; await cargarOrdenes(); setTimeout(() => actual === 'ordenes' && cargarOrdenes(), 8000); }
  catch (e) { $('oMsg').textContent = e.message; } finally { $('oEnviar').disabled = false; }
});
$('tFiltro').addEventListener('change', cargarOrdenes);
$('tCrear').addEventListener('click', async () => {
  if (!$('tTitulo').value.trim()) return toast('Escribe un título');
  await api('/tareas', { method: 'POST', body: { agente: $('tAgente').value, titulo: $('tTitulo').value.trim(), descripcion: $('tDesc').value.trim(), prioridad: $('tPrioridad').value } });
  $('tTitulo').value = $('tDesc').value = ''; toast('Tarea creada'); cargarOrdenes();
});

/* ---------------- agentes, reportes y cotizaciones ---------------- */
async function cargarAgentes() {
  const [c, r, q] = await Promise.all([api('/config'), api('/reportes?agente=' + $('rFiltro').value), api('/cotizaciones')]);
  const cfg = c.config.agentes, dueno = c.rol === 'propietario';
  $('aLista').innerHTML = Object.entries(AGENTES).map(([k, [n, d]]) => {
    const a = cfg[k] || {};
    return `<div class="ag"><h3>${esc(n)} <label class="sw"><input type="checkbox" data-ag="${k}" ${a.activo !== false ? 'checked' : ''} ${dueno ? '' : 'disabled'}> ${a.activo !== false ? 'Activo' : 'Apagado'}</label></h3><p>${esc(d)}</p>
      ${a.modelo ? `<div class="fila"><select data-modelo="${k}" ${dueno ? '' : 'disabled'}>${Object.entries(c.modelos).map(([id, m]) => `<option value="${id}" ${id === a.modelo ? 'selected' : ''}>${esc(m.nombre)}</option>`).join('')}</select>
        <select data-esfuerzo="${k}" ${dueno ? '' : 'disabled'}>${['low', 'medium', 'high'].map((e) => `<option value="${e}" ${e === a.esfuerzo ? 'selected' : ''}>Esfuerzo ${{ low: 'bajo', medium: 'medio', high: 'alto' }[e]}</option>`).join('')}</select></div>` : '<small class="muted">Sin IA: revisiones automáticas sin costo.</small>'}</div>`;
  }).join('');
  if ($('rFiltro').options.length === 1) $('rFiltro').innerHTML += Object.entries(AGENTES).map(([k, [n]]) => `<option value="${k}">${esc(n)}</option>`).join('');
  $('rLista').innerHTML = r.reportes.length ? r.reportes.map((x) => `<div class="row"><span class="pill">${esc(AGENTES[x.agente]?.[0] || x.agente)}</span><div class="t"><b>${esc(x.titulo)}</b><small>${hora(x.creado)}</small><details><summary>Ver reporte</summary><pre class="txt">${esc(x.texto)}</pre></details></div></div>`).join('') : '<p class="muted">Aún no hay reportes.</p>';
  $('cLista').innerHTML = q.cotizaciones.length ? `<div class="scroll"><table class="tb"><tr><th>Folio</th><th>Cliente</th><th>Partidas</th><th>Total</th><th>Fecha</th></tr>${q.cotizaciones.map((x) => `<tr><td>${esc(x.folio)}</td><td>${esc(x.nombre || '')}<br><small class="muted">${esc(x.telefono)}</small></td><td>${x.partidas.map((p) => `${p.cantidad}× ${esc(p.clave)} ${mx(p.precio_unitario)}`).join('<br>')}</td><td><b>${mx(x.total)}</b></td><td>${hora(x.creado)}</td></tr>`).join('')}</table></div>` : '<p class="muted">Sin cotizaciones.</p>';
}
$('aLista').addEventListener('change', async (ev) => {
  const e = ev.target; let a, body;
  if (e.dataset.ag) { a = e.dataset.ag; body = { activo: e.checked }; }
  else if (e.dataset.modelo) { a = e.dataset.modelo; body = { modelo: e.value }; }
  else if (e.dataset.esfuerzo) { a = e.dataset.esfuerzo; body = { esfuerzo: e.value }; }
  else return;
  try { await api('/agentes/' + a, { method: 'POST', body }); toast('Guardado'); cargarAgentes(); } catch (x) { toast(x.message); }
});
$('rFiltro').addEventListener('change', cargarAgentes);

/* ---------------- aprobaciones ---------------- */
function detalleAprob(a) {
  const d = a.detalle || {};
  if (a.tipo === 'publicacion') return `<pre class="txt">${esc(d.texto || '')}</pre>${d.claves?.length ? `<small class="muted">Productos: ${esc(d.claves.join(', '))}</small>` : ''}`;
  if (a.tipo === 'mensaje_masivo') return `<pre class="txt">${(d.mensajes || []).map((m) => '• ' + esc(m.texto)).join('\n')}</pre><small class="muted">Solo se envía a clientes que aceptaron seguimiento y escribieron en las últimas 24 h.</small>`;
  if (a.tipo === 'descuento') return `<pre class="txt">Pide: ${esc(d.solicitud || '')}\nProductos: ${esc((d.claves || []).join(', '))}\nContexto: ${esc(d.motivo || '')}</pre><small class="muted">Escribe en la nota qué autorizas (ej. "10 % en 2904-20-AA"). La conversación pasará a ti para responder al cliente.</small>`;
  return `<pre class="txt">${esc(d.detalle || d.descripcion || JSON.stringify(d, null, 2))}</pre>`;
}
async function cargarAprobaciones() {
  const d = await api('/aprobaciones');
  const pend = d.aprobaciones.filter((a) => a.estado === 'pendiente'), hist = d.aprobaciones.filter((a) => a.estado !== 'pendiente');
  $('nAprob').hidden = !pend.length; $('nAprob').textContent = pend.length;
  $('apPend').innerHTML = pend.length ? pend.map((a) => `<div class="card ap"><h3>${esc(a.titulo)}</h3><span class="pill warn">${esc(TIPO_AP[a.tipo])}</span> <small class="muted">Solicita: ${esc(AGENTES[a.solicitado_por]?.[0] || a.solicitado_por)} · ${hace(a.creado)}</small>
      ${detalleAprob(a)}<div class="fila"><input id="nota-${a.id}" placeholder="Nota (opcional)" style="flex:1">
      <button class="ok-btn" data-decidir="aprobada" data-id="${a.id}">Aprobar</button><button class="no-btn" data-decidir="rechazada" data-id="${a.id}">Rechazar</button></div></div>`).join('') : '<div class="card"><p class="muted">No hay nada pendiente de aprobar.</p></div>';
  $('apHist').innerHTML = hist.length ? hist.map((a) => `<div class="row"><span class="pill ${a.estado === 'aprobada' ? 'ok' : 'red'}">${a.estado === 'aprobada' ? 'Aprobada' : 'Rechazada'}</span><div class="t"><b>${esc(a.titulo)}</b><small>${esc(TIPO_AP[a.tipo])} · ${esc(a.decidido_por || '')} · ${hora(a.decidido_en)}${a.nota_decision ? ' · ' + esc(a.nota_decision) : ''}</small></div></div>`).join('') : '<p class="muted">Sin historial.</p>';
}
$('apPend').addEventListener('click', async (ev) => {
  const b = ev.target.closest('[data-decidir]'); if (!b) return;
  const dec = b.dataset.decidir;
  if (!confirm(dec === 'aprobada' ? '¿Aprobar? Se ejecutará lo que se describe.' : '¿Rechazar?')) return;
  try { const r = await api('/aprobaciones/' + b.dataset.id, { method: 'POST', body: { decision: dec, nota: $('nota-' + b.dataset.id).value } }); toast((dec === 'aprobada' ? 'Aprobada. ' : 'Rechazada. ') + (r.efectos || []).join(' '), 6000); cargarAprobaciones(); }
  catch (e) { toast(e.message); }
});

/* ---------------- configuración ---------------- */
const DIAS = [['lun', 'Lun'], ['mar', 'Mar'], ['mie', 'Mié'], ['jue', 'Jue'], ['vie', 'Vie'], ['sab', 'Sáb'], ['dom', 'Dom']];
let CFG = null;
async function guardar(sec, valor, msg = 'Guardado') { try { await api('/config/' + sec, { method: 'PUT', body: { valor } }); toast(msg); CFG = (await api('/config')).config; } catch (e) { toast(e.message, 6000); } }
const campo = (id, et, v, tipo = 'text', extra = '') => `<label class="lb">${esc(et)}<input id="${id}" type="${tipo}" value="${esc(v)}" ${extra}></label>`;

async function cargarConfig() {
  const c = await api('/config'); CFG = c.config; const dueno = c.rol === 'propietario';
  const h = CFG.horario;
  $('cfHorario').innerHTML = DIAS.map(([k, n]) => { const r = h.dias[k]; return `<div class="dia"><b>${n}</b><label class="sw"><input type="checkbox" data-abierto="${k}" ${r ? 'checked' : ''}> Abierto</label><input type="time" data-ini="${k}" value="${r ? r[0] : '09:00'}"> a <input type="time" data-fin="${k}" value="${r ? (r[1] === '24:00' ? '23:59' : r[1]) : '19:00'}"></div>`; }).join('')
    + `<div class="grid2 mt"><label class="lb">Fuera de horario<select id="cfFuera"><option value="atender">El asistente atiende igual</option><option value="mensaje">Solo avisa el horario</option><option value="silencio">No responde</option></select></label></div>
       <label class="lb">Mensaje fuera de horario<textarea id="cfMsgFuera" rows="2">${esc(h.mensaje_fuera_de_horario)}</textarea></label><button class="prim" id="cfHorarioG">Guardar horario</button>`;
  $('cfFuera').value = h.fuera_de_horario;
  $('cfHorarioG').onclick = () => {
    const dias = {}; for (const [k] of DIAS) dias[k] = document.querySelector(`[data-abierto="${k}"]`).checked ? [document.querySelector(`[data-ini="${k}"]`).value, document.querySelector(`[data-fin="${k}"]`).value] : null;
    guardar('horario', { dias, fuera_de_horario: $('cfFuera').value, mensaje_fuera_de_horario: $('cfMsgFuera').value.trim() });
  };
  const t = CFG.tiempos;
  const rango = (k, n) => `<div class="lb">${n}<div class="fila"><input id="cfT_${k}_a" type="number" min="0" max="120" value="${t[k][0]}" style="width:90px"> a <input id="cfT_${k}_b" type="number" min="0" max="120" value="${t[k][1]}" style="width:90px"></div></div>`;
  $('cfTiempos').innerHTML = `<div class="grid2">${rango('saludo', 'Saludo')}${rango('consulta', 'Consulta sencilla')}${rango('cotizacion', 'Cotización')}${campo('cfAgrupar', 'Esperar para juntar mensajes seguidos', t.agrupar, 'number', 'min="0" max="30"')}</div>
    <label class="sw mt"><input type="checkbox" id="cfEscribiendo" ${t.escribiendo ? 'checked' : ''}> Mostrar "escribiendo…" mientras se prepara la respuesta</label>
    <p class="muted">La espera cuenta desde que llega el mensaje; el tiempo que tarda el asistente en pensar ya va incluido.</p><button class="prim" id="cfTiemposG">Guardar tiempos</button>`;
  $('cfTiemposG').onclick = () => { const v = { agrupar: +$('cfAgrupar').value, escribiendo: $('cfEscribiendo').checked }; for (const k of ['saludo', 'consulta', 'cotizacion']) v[k] = [+$(`cfT_${k}_a`).value, +$(`cfT_${k}_b`).value]; guardar('tiempos', v); };
  const hu = CFG.humano;
  $('cfHumano').innerHTML = `<label class="sw"><input type="checkbox" id="cfDetener" ${hu.detener_si_respondes_en_app ? 'checked' : ''} ${dueno ? '' : 'disabled'}> Si respondes desde WhatsApp Business en el celular, el asistente se detiene en esa conversación</label>
    <div class="grid2 mt">${campo('cfReact', 'Reactivar solo después de (horas sin actividad; 0 = solo con el botón)', hu.reactivar_tras_horas, 'number', 'min="0" max="168"' + (dueno ? '' : ' disabled'))}</div>
    <label class="lb">Palabras que piden un asesor (separadas por comas)<textarea id="cfPalabras" rows="2" ${dueno ? '' : 'disabled'}>${esc(hu.palabras_transferencia.join(', '))}</textarea></label>
    ${dueno ? '<button class="prim" id="cfHumanoG">Guardar</button>' : '<p class="muted">Solo el propietario cambia esta sección.</p>'}`;
  if (dueno) $('cfHumanoG').onclick = () => guardar('humano', { detener_si_respondes_en_app: $('cfDetener').checked, reactivar_tras_horas: +$('cfReact').value, palabras_transferencia: $('cfPalabras').value.split(',').map((x) => x.trim()).filter(Boolean) });
  const li = CFG.limites;
  $('cfLimites').innerHTML = `<div class="grid2">${campo('cfPres', 'Presupuesto diario de Claude (USD)', li.presupuesto_diario_usd, 'number', 'min="0" step="0.5"' + (dueno ? '' : ' disabled'))}${campo('cfResp', 'Respuestas máximas por cliente al día', li.respuestas_por_contacto_dia, 'number', 'min="1"' + (dueno ? '' : ' disabled'))}</div>
    <p class="muted">Al llegar al presupuesto, las conversaciones nuevas pasan a atención humana y se registra un aviso.</p>${dueno ? '<button class="prim" id="cfLimG">Guardar</button>' : ''}`;
  if (dueno) $('cfLimG').onclick = () => guardar('limites', { presupuesto_diario_usd: +$('cfPres').value, respuestas_por_contacto_dia: +$('cfResp').value });
  const ne = CFG.negocio;
  const NEG = [['direccion', 'Dirección'], ['horario_texto', 'Horario (texto para clientes)'], ['envios', 'Envíos'], ['pagos', 'Pagos'], ['sobre_pedido', 'Sobre pedido'], ['condiciones', 'Condiciones de productos'], ['extra', 'Información adicional (promociones vigentes, avisos)']];
  $('cfNegocio').innerHTML = NEG.map(([k, n]) => `<label class="lb">${n}<textarea data-neg="${k}" rows="2">${esc(ne[k] || '')}</textarea></label>`).join('') + '<button class="prim" id="cfNegG">Guardar</button>';
  $('cfNegG').onclick = () => { const v = {}; document.querySelectorAll('[data-neg]').forEach((e) => (v[e.dataset.neg] = e.value.trim())); guardar('negocio', v); };
  cargarEstado(dueno).catch((e) => ($('cfEstado').textContent = e.message));
  api('/bitacora').then((b) => { $('cfBitacora').innerHTML = `<div class="scroll"><table class="tb"><tr><th>Fecha</th><th>Quién</th><th>Acción</th></tr>${b.bitacora.slice(0, 80).map((x) => `<tr><td>${hora(x.creado)}</td><td>${esc(x.actor)}</td><td>${esc(x.accion)}</td></tr>`).join('')}</table></div>`; });
}
async function cargarEstado(dueno) {
  const e = await api('/estado');
  const V = { DATABASE_URL: 'Base de datos (Supabase)', SUPABASE_URL: 'Supabase · dirección', SUPABASE_ANON_KEY: 'Supabase · llave pública', ANTHROPIC_API_KEY: 'Claude API', D360_API_KEY: '360dialog (WhatsApp)', WEBHOOK_SECRETO: 'Secreto del webhook', INTERNO_SECRETO: 'Secreto interno', WHATSAPP_ENVIO_HABILITADO: 'Envío real por WhatsApp' };
  const ok = (b) => `<span class="pill ${b ? 'ok' : 'warn'}">${b ? 'Listo' : 'Falta'}</span>`;
  $('cfEstado').innerHTML = `<div class="grid2">${Object.entries(V).map(([k, n]) => `<div class="row">${ok(e.variables[k])}<div class="t">${esc(n)}</div></div>`).join('')}</div>
    <div class="row">${ok(e.base_datos.ok)}<div class="t">Conexión a la base de datos</div></div>
    <div class="row">${ok(e.catalogo.ok && e.catalogo.precios_confiables)}<div class="t">Catálogo<small>${e.catalogo.ok ? `${e.catalogo.modelos} modelos · existencias ${e.catalogo.existencias.aplicadas ? 'en vivo' : 'sin actualizar'}${e.catalogo.avisos.length ? ' · ' + esc(e.catalogo.avisos.join(' ')) : ''}` : esc(e.catalogo.error)}</small></div></div>
    <div class="row">${ok(e.whatsapp.envio_habilitado)}<div class="t">Envío por WhatsApp<small>${e.whatsapp.envio_habilitado ? (e.whatsapp.numeros_prueba.length ? 'Solo a números de prueba: ' + esc(e.whatsapp.numeros_prueba.join(', ')) : 'A todos los clientes') : 'Deshabilitado: las respuestas se guardan como simuladas'}</small></div></div>
    <div class="row"><span class="pill">Webhook</span><div class="t"><code>${esc(e.webhook)}</code><small>Dirección que recibe los mensajes de 360dialog</small></div>
    ${dueno ? '<button class="sec2" id="cfWebhook">Conectar en 360dialog</button>' : ''}</div>`;
  $('cfWebhook')?.addEventListener('click', async () => {
    const t = prompt('Esto registra la dirección del webhook en 360dialog para tu número. Hazlo solo después de autorizar la conexión. Escribe CONECTAR para continuar.');
    if (t !== 'CONECTAR') return;
    try { const r = await api('/whatsapp/conectar-webhook', { method: 'POST', body: { confirmo: 'CONECTAR' } }); toast('Webhook conectado: ' + r.destino, 6000); } catch (x) { toast(x.message, 8000); }
  });
}

/* ---------------- arranque ---------------- */
(async () => {
  try { SESION = JSON.parse(SS.get('dn_ops_s') || 'null'); } catch { SESION = null; }
  const p = await publico().catch(() => ({}));
  if (!p.supabaseUrl && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) $('lLocal').hidden = false;
  if (SESION) await iniciar(); else mostrarLogin();
})();
