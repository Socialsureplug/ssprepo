import { createClient } from '@app/ui';

export const API_BASE = import.meta.env.VITE_API_URL ?? '/api';
export const api = createClient(API_BASE);
