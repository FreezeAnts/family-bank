import { ulid } from 'ulid';

export function newId() {
  return ulid();
}

export function nowIso() {
  return new Date().toISOString();
}
