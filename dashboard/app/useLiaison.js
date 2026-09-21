'use client';
import { useSyncExternalStore } from 'react';

// Single source of truth for "can ODIN reach the world": one shared poll of /api/liaison
// (the server's own probe), whatever the number of components listening.
const PERIODE = 30000;
let valeur = null;
let minuterie = null;
const abonnes = new Set();

async function charger() {
  try {
    const r = await fetch('/api/liaison', { cache: 'no-store' });
    if (r.ok) valeur = await r.json();
  } catch {}
  abonnes.forEach((f) => f());
}

function abonner(f) {
  abonnes.add(f);
  if (abonnes.size === 1) {
    charger();
    minuterie = setInterval(charger, PERIODE);
  }
  return () => {
    abonnes.delete(f);
    if (!abonnes.size) clearInterval(minuterie);
  };
}

// After a settings change, without waiting for the next poll
export function rafraichirLiaison(nouvelle) {
  if (nouvelle) {
    valeur = nouvelle;
    abonnes.forEach((f) => f());
  } else charger();
}

// initiale: state rendered by the server, so the page never shows a wrong state first
export function useLiaison(initiale = null) {
  return useSyncExternalStore(abonner, () => valeur ?? initiale, () => initiale);
}

export const HORS_LIAISON = 'Indisponible hors ligne';
