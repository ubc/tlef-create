import { randomUUID } from 'node:crypto';
import sseService from '../sseService.js';
import { readAuthoringSession } from './authoringService.js';

// Stream the same owner-authorized durable snapshot used by GET. Connecting,
// reconnecting and disconnecting never dispatch model work or cancel a run.
export async function streamAuthoringSession(req, res, { read = readAuthoringSession, intervalMs = 1000 } = {}) {
  const owner = String(req.user.id);
  const id = req.params.id;
  const initial = await read(owner, id); // Authorize before opening the stream.
  if (res.destroyed || res.writableEnded) return;
  const connection = `authoring-${randomUUID()}`;
  sseService.addClient(connection, res, { userId: owner });
  let timer;
  let closed = false;
  let signature;
  const expires = Date.now() + 15 * 60_000;
  const close = () => { closed = true; clearTimeout(timer); };
  res.on('close', close);
  res.on('error', close);
  const emit = session => {
    if (closed) return;
    if (res.writableLength > 1024 * 1024) { res.end(); close(); return; }
    const next = JSON.stringify(session);
    if (next !== signature) {
      sseService.sendToClient(connection, 'authoring-snapshot', session);
      signature = next;
    } else sseService.sendToClient(connection, 'heartbeat', { timestamp: new Date().toISOString() });
  };
  emit(initial);
  const refresh = async () => {
    try {
      if (closed) return;
      if (Date.now() >= expires) { res.end(); return; }
      emit(await read(owner, id)); // Recheck ownership while connected.
      if (!closed) timer = setTimeout(refresh, intervalMs);
    } catch { res.end(); close(); }
  };
  timer = setTimeout(refresh, intervalMs);
}
