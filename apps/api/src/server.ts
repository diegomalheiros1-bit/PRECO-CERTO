import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });
const host = process.env.HOST ?? '127.0.0.1';
if (host !== '127.0.0.1' && host !== 'localhost') throw new Error('Por segurança, HOST deve ser 127.0.0.1 ou localhost.');
const port = Number(process.env.PORT ?? 3333);
const app=buildApp();
app.listen({host:'127.0.0.1',port}).catch(error=>{app.log.error(error);process.exit(1)});

