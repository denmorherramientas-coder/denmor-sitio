// API del panel privado DENMOR AI OPERATIONS.
import { manejar } from '../../lib/api.js';

export default (req) => manejar(req);

export const config = { path: '/api/*' };
