// Configuración de DENMOR AI OPERATIONS.
// Los valores por defecto viven aquí; el panel guarda cambios en ops.configuracion y se combinan encima.

export const ZONA = 'America/Chihuahua';

export const AGENTES = ['coordinador', 'vendedor', 'supervisor', 'inventarios', 'administrador', 'marketing', 'programador'];

export const MODELOS = {
  'claude-opus-5-5': { nombre: 'Claude Opus 5.5', entrada: 4, salida: 20, cache_lectura: 0.2, cache_escritura: 5 },
  'claude-sonnet-5-5': { nombre: 'Claude Sonnet 5.5', entrada: 2, salida: 10, cache_lectura: 0.2, cache_escritura: 2.5 },
  'claude-haiku-5-5': { nombre: 'Claude Haiku 5.5', entrada: 0.1, salida: 0.5, cache_lectura: 0.01, cache_escritura: 0.125 },
};
// Precios en USD por millón de tokens (lista de Anthropic, octubre 2026). Lectura de caché: la tarifa publicada
// (Haiku: 10 % de la entrada, estimado); escritura de caché ≈ 125 % de la entrada. Solo se usan para estimar el gasto y el tope diario.

export const DEFAULTS = {
  agentes: {
    pausa_global: false,
    vendedor: { activo: true, modelo: 'claude-opus-5-5', esfuerzo: 'low' },
    coordinador: { activo: true, modelo: 'claude-opus-5-5', esfuerzo: 'medium' },
    supervisor: { activo: true },
    inventarios: { activo: true },
    administrador: { activo: true, modelo: 'claude-opus-5-5', esfuerzo: 'low' },
    marketing: { activo: true, modelo: 'claude-opus-5-5', esfuerzo: 'medium' },
    programador: { activo: true, modelo: 'claude-opus-5-5', esfuerzo: 'medium' },
  },
  // Segundos de espera antes de responder (mínimo y máximo). La espera cuenta desde que llega el mensaje,
  // así que el tiempo que tarda Claude en pensar ya va incluido.
  tiempos: {
    agrupar: 4, // espera para juntar varios mensajes seguidos del cliente
    saludo: [5, 15],
    consulta: [10, 25],
    cotizacion: [15, 45],
    escribiendo: true, // mostrar "escribiendo…" mientras se prepara la respuesta
  },
  horario: {
    // null = cerrado. Horas en hora de Chihuahua.
    dias: { lun: ['09:00', '19:00'], mar: ['09:00', '19:00'], mie: ['09:00', '19:00'], jue: ['09:00', '19:00'], vie: ['09:00', '19:00'], sab: ['09:00', '14:00'], dom: null },
    // 'atender': el asistente contesta igual · 'mensaje': solo avisa el horario · 'silencio': no contesta
    fuera_de_horario: 'atender',
    mensaje_fuera_de_horario: 'Gracias por escribir a Denmor Herramientas. Nuestro horario es de lunes a viernes de 9:00 a 19:00 y sábados de 9:00 a 14:00. Te respondemos en cuanto abramos.',
  },
  humano: {
    detener_si_respondes_en_app: true, // si contestas desde WhatsApp Business, el asistente se calla en ese chat
    reactivar_tras_horas: 0, // 0 = solo se reactiva con el botón "Reactivar asistente"
    // Si el cliente escribe alguna de estas frases, la conversación pasa de inmediato a una persona (sin IA)
    palabras_transferencia: ['asesor', 'humano', 'persona real', 'hablar con alguien', 'encargado', 'gerente', 'queja', 'reclamo', 'devolucion', 'estafa', 'fraude', 'ya pague', 'ya deposite', 'ya transferi', 'comprobante de pago'],
    mensaje_transferencia: 'Claro, te comunico con un asesor de Denmor. Te responde por este mismo chat.',
  },
  limites: {
    presupuesto_diario_usd: 10, // al llegar al tope, el asistente transfiere a humano y avisa en el panel
    respuestas_por_contacto_dia: 40,
    turnos_herramientas: 6,
    max_tokens: 8000,
    max_antiguedad_horas: 6, // mensajes más viejos (p. ej. tras una falla) no se contestan solos: los ve una persona
  },
  negocio: {
    nombre: 'Denmor Herramientas',
    ciudad: 'Chihuahua, Chih.',
    direccion: 'C. José Martí Pérez 3104, Chihuahua',
    sitio: 'https://denmorherramientas.com',
    whatsapp: '614 192 7887',
    instagram: '@denmorherramientas',
    horario_texto: 'Lunes a viernes de 9:00 a 19:00 y sábados de 9:00 a 14:00.',
    envios: 'Hacemos envíos a todo México. El costo y la paquetería se confirman con un asesor según el destino. También puedes recoger sin costo en la tienda.',
    pagos: 'La forma de pago se acuerda con un asesor por WhatsApp. El asistente no cobra ni recibe pagos.',
    sobre_pedido: 'Los productos sin existencia se pueden pedir sobre pedido; el tiempo estimado es de 7 a 10 días y lo confirma un asesor.',
    condiciones: 'Vendemos herramienta nueva y seminueva. Cada pieza seminueva se prueba y se califica (AA a F) según su estado.',
    extra: '',
  },
  catalogo: {
    sitio: 'https://denmorherramientas.com',
    core: 'https://denmorherramientas.com/core.json',
    existencias: 'https://raw.githubusercontent.com/makmexchihuahua-hub/makmex-existencias/main/existencias.json',
    ajustes: 'https://raw.githubusercontent.com/denmorherramientas-coder/denmor-ajustes/main/ajustes.json',
    detalle: 'https://denmorherramientas.com/detail-{b}.json',
    cache_minutos: 10,
  },
  supervisor: {
    paginas: ['https://denmorherramientas.com/', 'https://denmorherramientas.com/nosotros/'],
    max_horas_existencias: 3, // alerta si el robot de SICAR no ha subido existencias en este tiempo
  },
  cotizaciones: { vigencia_dias: 3 },
};

const esObj = (x) => x && typeof x === 'object' && !Array.isArray(x);

export function combinar(base, extra) {
  if (!esObj(base) || !esObj(extra)) return extra === undefined ? base : extra;
  const out = { ...base };
  for (const [k, v] of Object.entries(extra)) out[k] = esObj(v) && esObj(base[k]) ? combinar(base[k], v) : v;
  return out;
}

export function configCompleta(filas) {
  let c = structuredClone(DEFAULTS);
  for (const { clave, valor } of filas || []) if (clave in DEFAULTS) c[clave] = combinar(c[clave], valor);
  return c;
}

export function costoUsd(modelo, uso) {
  const p = MODELOS[modelo] || MODELOS['claude-opus-5-5'];
  const m = 1e6;
  return ((uso.tokens_entrada || 0) * p.entrada + (uso.tokens_salida || 0) * p.salida + (uso.tokens_cache_lectura || 0) * p.cache_lectura + (uso.tokens_cache_escritura || 0) * p.cache_escritura) / m;
}

// Variables de entorno necesarias (los valores nunca se muestran; solo si existen)
export const VARIABLES = {
  DATABASE_URL: 'Conexión a la base de datos de Supabase (pooler, modo transacción)',
  SUPABASE_URL: 'Dirección del proyecto de Supabase (para el inicio de sesión del panel)',
  SUPABASE_ANON_KEY: 'Llave pública "anon" de Supabase (para el inicio de sesión del panel)',
  ANTHROPIC_API_KEY: 'Llave de Claude API',
  D360_API_KEY: 'Llave de 360dialog del número de WhatsApp',
  WEBHOOK_SECRETO: 'Secreto que 360dialog envía en cada aviso (lo generas tú, mínimo 32 caracteres)',
  INTERNO_SECRETO: 'Secreto para que las funciones se llamen entre sí (mínimo 32 caracteres)',
  WHATSAPP_ENVIO_HABILITADO: 'Debe valer "si" para que el asistente pueda enviar mensajes reales',
};

export function estadoVariables() {
  return Object.fromEntries(Object.keys(VARIABLES).map((k) => [k, !!process.env[k]]));
}
