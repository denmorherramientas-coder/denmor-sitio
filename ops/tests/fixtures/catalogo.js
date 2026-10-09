// Catálogo de prueba con los casos difíciles: ajustes por marca/familia/modelo, precio fijo, redondeo,
// descuentos, promoción, kits (batería + cargador equivalente), existencias por sucursal y modelos ocultos.
export const COLS = ['sku', 'model', 'grade', 'kit', 'combo', 'name', 'brand', 'cat', 'fam', 'p1', 'disc', 'p2', 'p3', 'st', 'img', 'ib', 'sales', 'ah', 'info', 'b', 'np', 'ord', 'top', 'pk', 'bat', 'car', 'pics', 'pr'];

function fila(o) {
  const base = { kit: 0, combo: 0, disc: 0, p2: 0, p3: 0, st: [0, 0, 0], img: 'x1', ib: 0, sales: 0, ah: '', info: [], b: 0, np: 1, ord: 100, top: 0, pk: -1, bat: '', car: '', pics: ['x1'], pr: 0 };
  const v = { ...base, ...o };
  return COLS.map((c) => v[c]);
}

export function core() {
  return {
    updated: '2026-10-08',
    cols: COLS,
    rows: [
      fila({ sku: '2904-20-AA', model: '2904-20', grade: 'AA', name: 'Rotomartillo M18 FUEL 1/2"', brand: 'Milwaukee', cat: 'Rotomartillo', fam: 'Taladros y rotomartillos', p1: 3299, disc: 3170, p2: 2900, p3: 2800, st: [1, 2, 0], sales: 50 }),
      fila({ sku: '2904-20-B', model: '2904-20', grade: 'B', name: 'Rotomartillo M18 FUEL 1/2"', brand: 'Milwaukee', cat: 'Rotomartillo', fam: 'Taladros y rotomartillos', p1: 2699, p2: 2400, p3: 2300, st: [0, 1, 0] }),
      fila({ sku: '2904-20-AA-KIT', model: '2904-20', grade: 'AA', kit: 1, name: 'Rotomartillo M18 FUEL 1/2" kit', brand: 'Milwaukee', cat: 'Rotomartillo', fam: 'Taladros y rotomartillos', p1: 5999, p2: 5400, p3: 5200, st: [1, 1, 0], bat: '48-11-1850', car: '48-59-1808' }),
      fila({ sku: '48-11-1850-AA', model: '48-11-1850', grade: 'AA', name: 'Batería M18 REDLITHIUM 5.0 Ah', brand: 'Milwaukee', cat: 'Batería', fam: 'Baterías y cargadores', p1: 1510, p2: 1300, p3: 1250, st: [3, 0, 2] }),
      fila({ sku: '48-11-1850-C', model: '48-11-1850', grade: 'C', name: 'Batería M18 REDLITHIUM 5.0 Ah', brand: 'Milwaukee', cat: 'Batería', fam: 'Baterías y cargadores', p1: 990, st: [0, 0, 0] }),
      fila({ sku: '48-59-1812-A', model: '48-59-1812', grade: 'A', name: 'Cargador M12/M18 rápido', brand: 'Milwaukee', cat: 'Cargador', fam: 'Baterías y cargadores', p1: 1205, st: [0, 0, 0] }),
      fila({ sku: 'DCD791B-AA', model: 'DCD791B', grade: 'AA', name: 'Taladro atornillador 20V MAX XR', brand: 'DeWalt', cat: 'Taladro', fam: 'Taladros y rotomartillos', p1: 1899, disc: 1799, st: [0, 0, 4] }),
      fila({ sku: 'DCF887B-B', model: 'DCF887B', grade: 'B', name: 'Atornillador de impacto 20V MAX XR', brand: 'DeWalt', cat: 'Atornillador de impacto', fam: 'Impacto y matracas', p1: 1745, st: [0, 0, 0] }),
      fila({ sku: 'P262-AA', model: 'P262', grade: 'AA', name: 'Llave de impacto 18V ONE+', brand: 'Ryobi', cat: 'Llave de impacto', fam: 'Impacto y matracas', p1: 1333, st: [2, 0, 0] }),
      fila({ sku: 'XPH12Z-A', model: 'XPH12Z', grade: 'A', name: 'Rotomartillo 18V LXT', brand: 'Makita', cat: 'Rotomartillo', fam: 'Taladros y rotomartillos', p1: 2101, st: [0, 1, 0] }),
      fila({ sku: '2767-20-AA', model: '2767-20', grade: 'AA', name: 'Llave de impacto M18 FUEL 1/2" alto torque', brand: 'Milwaukee', cat: 'Llave de impacto', fam: 'Impacto y matracas', p1: 5999, st: [1, 0, 0] }),
      fila({ sku: '2767-20-D', model: '2767-20', grade: 'D', name: 'Llave de impacto M18 FUEL 1/2" alto torque', brand: 'Milwaukee', cat: 'Llave de impacto', fam: 'Impacto y matracas', p1: 3456, st: [0, 1, 0], img: null, pics: [] }),
      fila({ sku: 'OCULTO-AA', model: 'OCULTO', grade: 'AA', name: 'Producto oculto por el panel', brand: 'Milwaukee', cat: 'Otros', fam: 'Otros', p1: 999, st: [5, 5, 5] }),
      fila({ sku: 'SINPRECIO-AA', model: 'SINPRECIO', grade: 'AA', name: 'Lámpara sin precio', brand: 'Ryobi', cat: 'Lámpara', fam: 'Iluminación', p1: 0, st: [1, 0, 0] }),
    ],
  };
}

export function ajustes({ promo = true } = {}) {
  return {
    precios: { global: 2, marcas: { milwaukee: 5, otras: -3 }, familias: { 'Impacto y matracas': 1.5 }, modelos: { P262: 10 }, redondeo: 10, fijos: { 'DCD791B-AA': 1777 } },
    promo: promo ? { activo: true, pct: 10, nombre: 'Prueba', desde: '2020-01-01', hasta: '2099-12-31', horaIni: '', horaFin: '' } : { activo: false },
    ocultos: ['OCULTO'],
  };
}

export function existencias() {
  return {
    actualizado: '2026-10-08T17:46:59',
    sucursales: { 1: 'MakMex cedis', 2: 'Denmor', 3: 'makmex CDMX', 4: 'handyman' },
    existencias: {
      '2904-20-AA': { 1: 2, 2: 1, 3: 0, 4: 9 },
      '2904-20-B': { 1: 0, 2: 0, 3: 1 },
      '48-11-1850-AA': { 1: 1, 2: 0, 3: 3 },
      '48-11-1850-C': { 1: 0, 2: 4, 3: 0 },
      '48-59-1808-A': { 1: 0, 2: 2, 3: 0 }, // cargador equivalente (mismo grupo que 48-59-1812)
      'DCD791B-AA': { 1: 0, 2: 0, 3: 2 },
      'P262-AA': { 1: 1, 2: 1, 3: 0 },
      'XPH12Z-A': { 1: 0, 2: 1, 3: 0 },
      '2767-20-AA': { 1: 1, 2: 0, 3: 0 },
      '2767-20-D': { 1: 0, 2: 1, 3: 0 },
      'OCULTO-AA': { 1: 5, 2: 5, 3: 5 },
      'SINPRECIO-AA': { 1: 1, 2: 0, 3: 0 },
    },
  };
}
